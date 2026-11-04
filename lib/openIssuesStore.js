// Open issues — collect the data for one country and build the list (lib/openIssues.js).
// READ-ONLY: the WhatsApp chats (Relay, live number) of the people who wrote in the last 30
// days on that country's site, that country's DB (accounts, listings, drafts, payments, the
// assistant's log, the automations) and PostHog (views per listing). Cached 5 minutes
// (lib/swrCache.js); ?fresh=1 on the API reloads. The team's decisions (done / dismissed /
// sent / gift) live in the `automations` row 'open_issues' (free_tiers[0].issues — no table
// of its own, no DB change). Server only.
import 'server-only';
import { dbFor } from './db';
import { swr, forget } from './swrCache';
import { selectAll } from './selectAll';
import { relay, phoneParam, inboxMode } from './relayInbox';
import { conversationsWithCountry } from './inboxData';
import { inSite } from './inboxRules';
import { countryInfo } from './automationAdmin';
import { HIDE_DELETED_USERS } from './userInsights';
import { isInternalEmail } from './internalTraffic';
import { hogql, posthogConfigured } from './posthogHogql';
import { GEO_BASE } from './posthogSql';
import { siteClause } from './analyticsSite';
import { draftMissing } from './aiFacts';
import { buildIssues, issueCounts, phoneKey, DEFAULT_SETTINGS, isTeamMessage } from './openIssues';
import { attachHandling } from './openIssuesHandling.js';
import { loadFollowups } from './manager/daily.js';
import { payKind, MIN_GAP_H, MAX_SENDS } from './manager/payFollowups.js';
import { classifyInbound, inboundItems } from './waClassify';
import { aiLink, aiRef } from './aiLinks';
import { issuesInEnglish } from './issueTranslate';
import { localDay, isDay, saveDay, readDay, applyState } from './openIssuesDays';
import { readSuspensions } from './securityWatch';
import { ADVICE_ID, listingOfKey } from './manager/viewsAdvice';

export const STATE_ID = 'open_issues';
const D = 86400000;
const enc = encodeURIComponent;
const meta = (row) => { try { return JSON.parse(row?.error || '{}') || {}; } catch { return {}; } };
const inList = (ids) => `in.(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;

// ── the team's decisions ──
export async function readState(db) {
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${STATE_ID}&limit=1`).catch(() => []);
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  return s.issues && typeof s.issues === 'object' ? s.issues : {};
}
export async function writeState(db, id, patch) {
  const issues = await readState(db);
  issues[id] = { ...(issues[id] || {}), ...patch, at: new Date().toISOString() };
  // keep the last 60 days
  const cut = Date.now() - 60 * D;
  for (const [k, v] of Object.entries(issues)) if (Date.parse(v?.at || 0) < cut) delete issues[k];
  const free_tiers = [{ issues }];
  const [row] = await db.select('automations', `select=id&id=eq.${STATE_ID}&limit=1`);
  const p = { enabled: false, free_tiers, updated_at: new Date().toISOString() };
  if (row) await db.update('automations', `id=eq.${STATE_ID}`, p, { returning: 'minimal' });
  else await db.insert('automations', [{ id: STATE_ID, wait_days: 0, ...p }], { returning: 'minimal' });
  return issues[id];
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } }));
  return out;
}

// The team's own chats never become issues: Pakistan numbers (+92, our test phones), the team's
// names (Roland tests the flows from his US number), and any number in INBOX_TEAM_PHONES.
const TEAM_NAMES = ['roland lallier', 'hamza maqsood', 'omar faiz', 'omar new'];
const teamPhones = () => String(process.env.INBOX_TEAM_PHONES || '').split(/[\s,]+/).map((p) => p.replace(/\D/g, '')).filter(Boolean);
export function isTeamChat(c) {
  const d = String(c?.phone || '').replace(/\D/g, '');
  const name = String(c?.name || '').trim().toLowerCase();
  return d.startsWith('92') || TEAM_NAMES.some((n) => name === n || name.startsWith(`${n} `)) || teamPhones().some((p) => p && d.endsWith(p.slice(-8)));
}

// the chats of this country with a message from the contact in the last `days` days, with their messages
async function loadChats(country, days, now) {
  const all = await conversationsWithCountry(inboxMode());
  const since = now - days * D;
  const mine = all.filter((c) => inSite(c, country) && Date.parse(c.last_inbound_at || 0) >= since && !isTeamChat(c));
  const msgs = await pool(mine, 6, (c) => relay(inboxMode(), `/conversations/${phoneParam(c.phone)}/messages?limit=40`));
  return mine.map((c, k) => ({ ...c, messages: msgs[k]?.ok ? msgs[k].data?.data || [] : [] }));
}

// PostHog: views per listing in the last `days` days (this site) — also used by the Admin
// Manager's "views but no contacts" emails (lib/manager/viewsAdviceRun.js)
export async function viewsFor(country, ids, days) {
  const out = new Map();
  if (!posthogConfigured() || !ids.length) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).map((x) => `'${x}'`).join(',');
    if (!part) continue;
    const rows = await hogql(`SELECT toString(properties.property_id) AS pid, count() AS v FROM events
      WHERE event = 'property_viewed' AND timestamp >= now() - INTERVAL ${Number(days)} DAY AND ${GEO_BASE}${siteClause(country)} AND toString(properties.property_id) IN (${part}) GROUP BY pid`, { fresh: 10 * 60_000, stale: 60 * 60_000 }).catch(() => []);
    for (const [pid, v] of rows || []) out.set(String(pid), Number(v) || 0);
  }
  return out;
}

// clicks on the assistant's tracked links (website /r/ai → PostHog link_click, slug 'ai'), per reply
export async function aiClicks(country, days = 30) {
  const out = new Map();
  if (!posthogConfigured()) return out;
  const rows = await hogql(`SELECT toString(properties.answer) AS a, count() AS n, min(timestamp) AS t FROM events
    WHERE event = 'link_click' AND properties.slug = 'ai' AND timestamp >= now() - INTERVAL ${Number(days)} DAY ${siteClause(country)} GROUP BY a`, { fresh: 5 * 60_000, stale: 30 * 60_000 }).catch(() => []);
  for (const [a, n, t] of rows || []) if (a) out.set(String(a), { count: Number(n) || 0, first: t });
  return out;
}

export async function collectIssues(country, { now = Date.now() } = {}) {
  const db = dbFor(country);
  const info = countryInfo(country);
  const S = DEFAULT_SETTINGS;
  const since30 = new Date(now - S.lookbackDays * D).toISOString();
  const sources = {};
  const [chats, users, listings, drafts, payments, aiRows, adviceRows, [payRow], state, suspensions] = await Promise.all([
    loadChats(country, S.lookbackDays, now).catch((e) => { sources.relay = String(e?.message || e); return []; }),
    selectAll(db, 'users', `select=id,full_name,email,phone,suspended,blocked,created_at&${HIDE_DELETED_USERS}&order=id.asc`).catch(() => []),
    selectAll(db, 'properties', 'select=id,slug,created_by,status,admin_status,created_at,property_type,listing_type,city,neighborhood,raw_data&origin=eq.user&order=id.asc').catch(() => []),
    db.select('listing_drafts', `select=id,user_id,data,updated_at&updated_at=gte.${enc(since30)}&order=updated_at.desc&limit=2000`).catch(() => []),
    db.select('payments', `select=id,user_id,property_id,kind,amount_usd,status,created_at&created_at=gte.${enc(since30)}&order=created_at.desc&limit=2000`).catch(() => []),
    db.select('email_log', `select=automation_id,to_phone,subject,error,relay_message_id,created_at&automation_id=in.(inbox_ai,inbox_ai_person)&created_at=gte.${enc(since30)}&order=created_at.desc&limit=2000`).catch(() => []),
    db.select('email_log', `select=dedupe_key,created_at&automation_id=eq.${ADVICE_ID}&status=in.(sent,delivered,read)&created_at=gte.${enc(new Date(now - 60 * D).toISOString())}&order=created_at.desc&limit=5000`).catch(() => []),
    db.select('automations', 'select=id,free_days&id=eq.payment_followup&limit=1').catch(() => []),
    readState(db).catch(() => ({})),
    readSuspensions(db).catch(() => []),
  ]);
  sources.chats = chats.length;
  // the AI sorts the last messages of every chat (robot / thanks / a person) — cached per message
  const items = chats.flatMap((c) => inboundItems(c.messages || [], { limit: 4 }));
  const kinds = items.length ? await classifyInbound(db, items).catch(() => new Map()) : new Map();
  sources.sortedBy = { ai: [...kinds.values()].filter((k) => k.by === 'ai').length, rules: [...kinds.values()].filter((k) => k.by === 'rules').length };
  // what the automations and the Admin Manager already sent (so Open issues doesn't repeat them)
  const [fRows, [draftRow]] = await Promise.all([
    db.select('email_log', `select=automation_id,template_key,to_email,run_id,dedupe_key,created_at&automation_id=in.(draft_reminders,manager,payment_followup,listing_held)&status=in.(sent,delivered,read,test)&created_at=gte.${enc(new Date(now - 60 * D).toISOString())}&order=created_at.asc&limit=10000`).catch(() => []),
    db.select('automations', 'select=id,enabled,milestones&id=eq.draft_reminders&limit=1').catch(() => []),
  ]);
  const draftReminders = new Map();
  for (const r of fRows.filter((x) => x.automation_id === 'draft_reminders' && x.run_id)) { const k = String(r.run_id); const v = draftReminders.get(k) || { count: 0, last: null }; draftReminders.set(k, { count: v.count + 1, last: r.created_at }); }
  const managerByEmail = new Map();
  for (const r of fRows.filter((x) => x.automation_id === 'manager' && x.to_email)) { const k = String(r.to_email).toLowerCase(); managerByEmail.set(k, [...(managerByEmail.get(k) || []), { kind: r.template_key, at: r.created_at }]); }
  const paymentReminders = new Map();
  for (const r of fRows.filter((x) => ['payment_followup', 'listing_held'].includes(x.automation_id) && x.run_id)) paymentReminders.set(String(r.run_id), (paymentReminders.get(String(r.run_id)) || 0) + 1);
  const followups = {
    draftReminders, managerByEmail, paymentReminders,
    draftSteps: draftRow?.enabled ? (Array.isArray(draftRow.milestones) ? draftRow.milestones.length : 0) : 0,
  };
  // the team's own accounts never become issues
  const realUsers = users.filter((u) => !isInternalEmail(u.email));
  const usersById = new Map(realUsers.map((u) => [String(u.id), u]));
  const mineListings = listings.filter((l) => usersById.has(String(l.created_by)));
  const byUser = new Map();
  for (const l of mineListings) byUser.set(String(l.created_by), [...(byUser.get(String(l.created_by)) || []), l]);
  const draftsByUser = new Map();
  for (const d of drafts) draftsByUser.set(String(d.user_id), [...(draftsByUser.get(String(d.user_id)) || []), d]);
  const personByPhone = new Map();
  for (const u of realUsers) {
    const k = phoneKey(u.phone);
    if (k.length === 8) personByPhone.set(k, { user: u, listings: byUser.get(String(u.id)) || [], drafts: draftsByUser.get(String(u.id)) || [] });
  }
  const isLive = (l) => l.admin_status === 'active' && (!l.status || l.status === 'published');
  const usersWithLive = new Set(mineListings.filter(isLive).map((l) => String(l.created_by)));

  // views / contacts in the last 14 days for live user listings
  const days = 14;
  const live = mineListings.filter(isLive);
  const views = await viewsFor(country, live.map((l) => String(l.id)), days).catch((e) => { sources.posthog = String(e?.message || e); return new Map(); });
  const hot = live.filter((l) => (views.get(String(l.id)) || 0) >= S.minViews);
  const clicks = hot.length ? await db.select('contact_link_clicks', `select=property_id,created_at&property_id=${inList(hot.map((l) => l.id))}&created_at=gte.${enc(new Date(now - 60 * D).toISOString())}&limit=10000`).catch(() => []) : [];
  const lastVnc = new Map();   // listing → when the Admin Manager last emailed the views advice
  for (const r of adviceRows) { const id = listingOfKey(r.dedupe_key); if (id && !lastVnc.has(id)) lastVnc.set(id, r.created_at); }
  const viewsStats = hot.map((l) => {
    const mine = clicks.filter((c) => String(c.property_id) === String(l.id));
    const sentAt = lastVnc.get(String(l.id)) || null;
    return {
      listing: l, views: views.get(String(l.id)) || 0, days,
      contacts: mine.filter((c) => Date.parse(c.created_at) >= now - days * D).length,
      vncSentAt: sentAt, contactsSinceAdvice: sentAt ? mine.filter((c) => Date.parse(c.created_at) >= Date.parse(sentAt)).length : 0,
    };
  });

  // checkouts that started and never succeeded (per listing)
  // (a listing's checkout = that listing paid later; one without a listing = that person paid later)
  const succeeded = payments.filter((p) => p.status === 'succeeded');
  const paidProps = new Set(succeeded.filter((p) => p.property_id).map((p) => String(p.property_id)));
  const paidLater = (p) => (p.property_id ? paidProps.has(String(p.property_id)) : succeeded.some((x) => String(x.user_id) === String(p.user_id) && Date.parse(x.created_at) >= Date.parse(p.created_at)));
  const propById = new Map(mineListings.map((l) => [String(l.id), l]));
  const checkouts = payments.filter((p) => p.status === 'started' && !paidLater(p)).map((p) => ({ ...p, listing: propById.get(String(p.property_id)) || null }));

  // the Admin Manager's payment emails (lib/manager/daily.js): threads + who got every one of them
  const fu = await loadFollowups(db, country, now).catch(() => null);
  const payExhausted = (fu?.payPlan.escalate || []).map((th) => {
    const listing = fu.listingsById.get(String(th.property_id)) || null;
    return { user_id: th.user_id, property_id: th.property_id, plan: payKind(th, listing, fu.payments), sends: th.sends, listing };
  });
  // everything we (and they) did, for "was it handled?" on every issue
  const history = await db.select('email_log', `select=automation_id,template_key,channel,status,to_email,to_phone,subject,error,created_at&automation_id=in.(inbox_ai,inbox_ai_person,open_issue,wa_reply,manager,manager_views,draft_reminders,listing_held,payment_followup,listing_views_milestone)&status=in.(sent,delivered,read,test)&created_at=gte.${enc(new Date(now - 60 * D).toISOString())}&order=created_at.desc&limit=20000`).catch(() => []);
  const teamByPhone = new Map();
  for (const c of chats) {
    const k = String(c.phone || '').replace(/\D/g, '').slice(-8);
    const team = (c.messages || []).filter(isTeamMessage).map((m) => ({ at: m.timestamps?.created || m.created_at, by: m.sent_by }));
    if (team.length) teamByPhone.set(k, team);
  }

  const issues = buildIssues({
    country, now, site: info.site, chats, personByPhone,
    aiLog: aiRows.map((r) => ({ ...r, meta: meta(r) })),
    pending: mineListings.filter((l) => l.status === 'payment_pending'),
    usersById, listingCountByUser: new Map([...byUser].map(([k, v]) => [k, v.length])),
    viewsStats, vncEnabled: process.env.MANAGER_AUTO_SEND !== '0',   // the manager emails the advice itself
    drafts: drafts.map((d) => ({ ...d, missing: draftMissing(d.data || {}) })), usersWithLive,
    checkouts, suspensions, state, followups, payments,
    clicksByAnswer: await aiClicks(country).catch(() => new Map()),
    linkFor: (path, phone, answer) => aiLink(info.site, path, { ref: aiRef(phone), answer: `${String(answer || '').slice(0, 7)}n` }),
    kindOf: (m) => kinds.get(String(m.id)) || null,
    payExhausted,
  });
  const tracked = attachHandling(issues, { history, teamByPhone, payThreads: fu?.pay || new Map(), suspensions, draftSteps: followups.draftSteps, now, gapH: MIN_GAP_H, maxSends: MAX_SENDS });
  // the team reads it in English (what people wrote, the assistant's messages, the drafts)
  const english = await issuesInEnglish(tracked).catch(() => tracked);
  return { country, mode: inboxMode(), generatedAt: new Date(now).toISOString(), issues: english, counts: issueCounts(english), sources, giftDays: Number(payRow?.free_days) || 90 };
}

export const loadIssues = (country, { fresh = false } = {}) => swr(`open-issues:${country}`, () => collectIssues(country), { fresh: 5 * 60_000, stale: 30 * 60_000, force: fresh });
export const forgetIssues = (country) => forget(`open-issues:${country}`);

// One day's list (lib/openIssuesDays.js). Today: the saved list, or a fresh run when there is none
// yet or `fresh` (then saved). A past day: the saved list with the team's decisions since. null = no list.
export async function getDayIssues(country, { day = null, fresh = false } = {}) {
  const db = dbFor(country);
  const today = localDay(country);
  const d = isDay(day) ? day : today;
  if (d === today && fresh) {
    forgetIssues(country);
    const data = await loadIssues(country, { fresh: true });
    await saveDay(db, today, data);
    return { ...data, day: today, isToday: true };
  }
  const saved = await readDay(db, d);
  if (saved) {
    const issues = applyState(saved.issues || [], await readState(db));
    return { ...saved, issues, counts: issueCounts(issues), day: d, isToday: d === today };
  }
  if (d !== today) return null;
  const data = await loadIssues(country);
  await saveDay(db, today, data);
  return { ...data, day: today, isToday: true };
}
