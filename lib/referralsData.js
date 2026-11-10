// Referral program — admin reads and writes for the active country's database
// (app/api/referrals). Pure rules: lib/referralsAdmin.js + lib/referrals/core.js.
//
// SENDING INVITES: nothing leaves the admin unless REFERRAL_SEND_MODE=live is set on the
// server. Otherwise every invite is only RECORDED (an event row with the rendered subject),
// so the audience, links and counts can be checked without messaging anyone.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { selectAll } from './selectAll';
import { countryInfo, countryFrame } from './automationAdmin';
import { renderTemplate } from './emailTemplateRender';
import { sendAutomationEmail } from './email';
import { relay } from './relayInbox';
import { BADGE_APPLE_CID, BADGE_PLAY_CID, BADGE_APPLE_PNG, BADGE_PLAY_PNG } from './emailBadges';
import { isInternalEmail } from './internalTraffic';
import { HIDE_DELETED_USERS } from './userInsights';
import { PHONE_PREFIX, toE164 } from './paidListingsAdmin';
import { REFERRALS_ID, referralConfig, codeFor, referralUrl, dataOf, isLive, pickRewardListing, higherPlan, DAY } from './referrals/core';
import { KIND, ensureCode, createReward, updateRecord } from './referrals/store';
import { DEFAULT_TEMPLATES, inviteAudience, roundDownProof, referrerRows, personRows, rewardRows, TEMPLATE_KEYS } from './referralsAdmin';

const q = (s) => encodeURIComponent(s);
const inList = (ids) => `in.(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;
const kindQ = (kind) => `automation_id=eq.${REFERRALS_ID}&template_key=eq.${kind}`;
const firstName = (full) => (full || '').trim().split(/\s+/)[0] || '';

export const sendMode = () => (String(process.env.REFERRAL_SEND_MODE || '').trim() === 'live' ? 'live' : 'record');
// Public links: the country's own site. REFERRAL_LINK_ORIGIN (local testing only) points
// every country's links at a local website instead.
export const siteFor = (cc) => String(process.env.REFERRAL_LINK_ORIGIN || countryInfo(cc).site).replace(/\/$/, '');

export async function loadRow(db) {
  const [row] = await db.select('automations', `select=*&id=eq.${REFERRALS_ID}&limit=1`);
  return row || null;
}

async function usersById(db, ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  const out = new Map();
  for (let i = 0; i < list.length; i += 150) {
    const rows = await db.select('users', `select=id,email,full_name,phone,phone_verified_at,verified,active,blocked,suspended,created_at&id=${inList(list.slice(i, i + 150))}`).catch(() => []);
    for (const u of rows) out.set(String(u.id), u);
  }
  return out;
}

// Everything the page shows.
export async function loadPage(db, cc) {
  const [row, templates, codes, clicks, persons, rewards, invites] = await Promise.all([
    loadRow(db),
    db.select('email_templates', 'select=id,name,key,subject,heading,body,button_label,button_url,is_active,updated_at&order=created_at.asc'),
    selectAll(db, 'email_log', `select=id,run_id,subject,created_at&${kindQ(KIND.code)}&order=id.asc`).catch(() => []),
    selectAll(db, 'email_log', `select=id,run_id,subject,created_at&${kindQ(KIND.click)}&order=id.asc`).catch(() => []),
    selectAll(db, 'email_log', `select=id,run_id,to_email,subject,error,created_at&${kindQ(KIND.person)}&order=id.asc`).catch(() => []),
    selectAll(db, 'email_log', `select=id,run_id,to_email,subject,error,created_at&${kindQ(KIND.reward)}&order=id.asc`).catch(() => []),
    db.select('email_log', `select=id,run_id,to_email,to_phone,subject,status,error,created_at&${kindQ('ref_invite')}&order=created_at.desc&limit=2000`).catch(() => []),
  ]);
  const cfg = referralConfig(row);
  const ids = [...codes, ...clicks, ...persons, ...rewards].map((r) => r.run_id).concat(persons.map((p) => dataOf(p).referred_id));
  const users = await usersById(db, ids);
  const referredIds = persons.map((p) => dataOf(p).referred_id).filter(Boolean);
  const theirListings = referredIds.length ? await db.select('properties', `select=id,created_by,status,admin_status,is_complete,is_delisted&created_by=${inList(referredIds.slice(0, 300))}&origin=eq.user&order=created_at.asc`).catch(() => []) : [];
  const listingsBy = new Map();
  for (const p of theirListings) { const k = String(p.created_by); if (!listingsBy.has(k)) listingsBy.set(k, []); listingsBy.get(k).push(p); }
  const propIds = [...new Set(rewards.map((r) => dataOf(r).property_id).filter(Boolean))];
  const props = propIds.length ? await db.select('properties', `select=id,property_type,neighborhood,city,promotion_plan,promotion_expires_at&id=${inList(propIds.slice(0, 300))}`).catch(() => []) : [];
  const site = siteFor(cc);
  const byTemplate = new Map(templates.map((t) => [t.key, t]));
  // invite batches
  const batches = new Map();
  for (const r of invites) {
    const d = dataOf(r);
    const b = batches.get(d.batch) || { id: d.batch, at: r.created_at, mode: d.mode, channel: d.channel, people: 0, emails: 0, whatsapp: 0, failed: 0, recorded: 0 };
    b.people++;
    if (d.email === 'sent') b.emails++; if (d.whatsapp === 'sent') b.whatsapp++;
    if (d.email === 'failed' || d.whatsapp === 'failed') b.failed++;
    if (d.mode !== 'live') b.recorded++;
    if (r.created_at < b.at) b.at = r.created_at;
    batches.set(d.batch, b);
  }
  return {
    setUp: !!row, settings: cfg, sendMode: sendMode(), site,
    templates: Object.values(TEMPLATE_KEYS).map((key) => { const t = byTemplate.get(key); return { key, id: t?.id || null, name: t?.name || null, subject: t?.subject || null, is_active: t?.is_active !== false }; }),
    referrers: referrerRows({ codes, clicks, persons, rewards, users, site }),
    people: personRows([...persons].reverse(), users, listingsBy),
    rewards: rewardRows([...rewards].reverse(), users, new Map(props.map((p) => [String(p.id), p]))),
    batches: [...batches.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))),
    totals: {
      links: codes.length, clicks: clicks.length, signups: persons.length,
      qualified: persons.filter((p) => p.subject === 'qualified').length,
      waiting: persons.filter((p) => p.subject === 'signed_up').length,
      rejected: persons.filter((p) => p.subject === 'rejected').length,
      rewardsGranted: rewards.filter((r) => ['granted', 'expired'].includes(r.subject)).length,
      rewardsPending: rewards.filter((r) => r.subject === 'pending').length,
      rewardsActive: rewards.filter((r) => r.subject === 'granted').length,
    },
  };
}

// Save the settings. The first save creates the row and the five Spanish emails.
export async function saveSettings(db, value) {
  const row = await loadRow(db);
  const existing = new Set((await db.select('email_templates', 'select=key&key=like.referral-%25')).map((t) => t.key));
  const missing = DEFAULT_TEMPLATES.filter((t) => !existing.has(t.key));
  if (missing.length) await db.insert('email_templates', missing, { returning: 'minimal' });
  if (row) await db.update('automations', `id=eq.${REFERRALS_ID}`, value, { returning: 'minimal' });
  else await db.insert('automations', [{ id: REFERRALS_ID, ...value }], { returning: 'minimal' });
  return { created: !row, templatesCreated: missing.length };
}

// The invite audience with each person's link (codes are derived from the user id, so the
// preview shows the exact link; the record is created when the invite goes out).
export async function audience(db, cc, cfg, { internal = null } = {}) {
  const users = await selectAll(db, 'users', `select=id,email,full_name,phone,phone_verified_at,verified,active,blocked,suspended,created_at&${HIDE_DELETED_USERS}&order=id.asc`);
  const live = await selectAll(db, 'properties', 'select=id,created_by,status,admin_status,is_complete,is_delisted&origin=eq.user&admin_status=eq.active&order=id.asc').catch(() => []);
  const liveOwners = new Set(live.filter(isLive).map((p) => String(p.created_by)));
  const invited = new Set((await db.select('email_log', `select=run_id&${kindQ('ref_invite')}&limit=10000`).catch(() => [])).map((r) => String(r.run_id)));
  const list = inviteAudience(users, { isInternal: (e) => isInternalEmail(e, internal), liveOwners, requireListing: cfg.requireReferrerListing });
  const site = siteFor(cc);
  const prefix = PHONE_PREFIX[cc] || '';
  return list.map((u) => ({
    id: String(u.id), name: u.full_name || null, email: u.email, phone: toE164(u.phone, prefix), phoneVerified: !!u.phone_verified_at,
    liveListings: live.filter((p) => String(p.created_by) === String(u.id) && isLive(p)).length,
    invited: invited.has(String(u.id)), link: referralUrl(site, codeFor(u.id)),
  }));
}

async function activeListings(db) {
  const r = await db.selectWithCount('properties', 'select=id&admin_status=eq.active&limit=1').catch(() => ({ count: 0 }));
  return r.count || 0;
}

export async function inviteVars(db, cc, cfg, person) {
  const site = siteFor(cc);
  return {
    name: firstName(person.name) || '',
    referral_url: person.link || referralUrl(site, codeFor(person.id)),
    referrals_url: `${site}/cuenta/referidos`,
    reward_days: String(cfg.referrer.days), new_user_days: String(cfg.newUser.days),
    milestone_count: String(cfg.milestone.every), milestone_days: String(cfg.milestone.days),
    active_listings: roundDownProof(await activeListings(db)),
  };
}

// Render the invite for one person (preview, and each real send).
export const PREVIEW_BADGES = { appleSrc: `data:image/png;base64,${BADGE_APPLE_PNG}`, playSrc: `data:image/png;base64,${BADGE_PLAY_PNG}` };
export async function renderInvite(db, cc, cfg, person, { badges = PREVIEW_BADGES } = {}) {
  const [tpl] = await db.select('email_templates', `select=*&key=eq.${TEMPLATE_KEYS.invite}&limit=1`);
  if (!tpl) return null;
  const vars = await inviteVars(db, cc, cfg, person);
  return { tpl, vars, ...renderTemplate(tpl, vars, { ...countryFrame(cc, badges), utm: { campaign: 'referidos', content: TEMPLATE_KEYS.invite } }) };
}

// Send (or, unless REFERRAL_SEND_MODE=live, only record) the invite to `ids`.
// skipInvited: leave out people an earlier batch already had. → { batch, mode, people, … }
export async function sendInvites(db, cc, cfg, { ids = [], channel = cfg.inviteChannel, skipInvited = true, internal = null } = {}) {
  const mode = sendMode();
  const all = await audience(db, cc, cfg, { internal });
  const want = new Set(ids.map(String));
  const people = all.filter((p) => want.has(p.id) && !(skipInvited && p.invited));
  const batch = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${randomUUID().slice(0, 6)}`;
  const out = { batch, mode, channel, people: people.length, emails: 0, whatsapp: 0, failed: 0, recorded: 0, skipped: all.filter((p) => want.has(p.id)).length - people.length };
  const users = await usersById(db, people.map((p) => p.id));
  for (const p of people) {
    const u = users.get(p.id);
    if (!u) continue;
    await ensureCode(db, u);                                    // the link now works
    const r = await renderInvite(db, cc, cfg, p, { badges: { appleSrc: `cid:${BADGE_APPLE_CID}`, playSrc: `cid:${BADGE_PLAY_CID}` } });
    const rec = { batch, mode, channel, email: null, whatsapp: null, subject: r?.subject || null, link: p.link };
    if (mode === 'live') {
      if ((channel === 'email' || channel === 'both') && r) {
        const res = await sendAutomationEmail({ country: cc, to: u.email, subject: r.subject, html: r.html, text: r.text });
        rec.email = res.ok ? 'sent' : 'failed'; if (res.ok) out.emails++; else out.failed++;
      }
      if ((channel === 'whatsapp' || channel === 'both') && cfg.inviteWaTemplate && p.phone) {
        const res = await relay('live', '/messages/template', { method: 'POST', json: { to: p.phone, template: cfg.inviteWaTemplate, language: 'es_MX', variables: { body: [firstName(u.full_name) || 'Hola'], button: `ref/${codeFor(u.id)}` } }, headers: { 'Idempotency-Key': `ref-invite:${batch}:${u.id}` } }).catch(() => ({ ok: false }));
        rec.whatsapp = res?.ok ? 'sent' : 'failed'; if (res?.ok) out.whatsapp++; else out.failed++;
      }
    } else {
      rec.email = channel !== 'whatsapp' ? 'recorded' : null;
      rec.whatsapp = channel !== 'email' ? (p.phone ? 'recorded' : 'no_phone') : null;
      out.recorded++;
    }
    await db.insert('email_log', [{
      automation_id: REFERRALS_ID, channel: 'event', template_key: 'ref_invite', status: mode === 'live' ? 'sent' : 'test',
      dedupe_key: `ref:invite:${batch}:${u.id}:ev`, run_id: u.id, to_email: u.email, to_phone: p.phone || null, subject: r?.subject || 'Invite',
      error: JSON.stringify(rec),
    }], { returning: 'minimal' });
  }
  return out;
}

// ── Promotions (same columns the website's grantPromotion writes) ──────────────────
async function applyPromotion(db, pid, plan, days, nowMs) {
  const [p] = await db.select('properties', `select=id,promotion_plan,promotion_expires_at&id=eq.${q(pid)}&limit=1`);
  if (!p) throw new Error('listing_not_found');
  const active = p.promotion_plan && p.promotion_expires_at && Date.parse(p.promotion_expires_at) > nowMs;
  const from = active ? Date.parse(p.promotion_expires_at) : nowMs;
  const until = new Date(from + days * DAY).toISOString();
  await db.update('properties', `id=eq.${q(pid)}`, { promotion_plan: active ? higherPlan(p.promotion_plan, plan) : plan, promoted_at: new Date(nowMs).toISOString(), promotion_expires_at: until, renewal_reminded_at: null }, { returning: 'minimal' });
  return { until, plan: active ? higherPlan(p.promotion_plan, plan) : plan };
}
// Take a revoked reward's days back off the listing (never below now; ends it if nothing is left).
async function removeDays(db, pid, days, nowMs) {
  const [p] = await db.select('properties', `select=id,promotion_plan,promotion_expires_at&id=eq.${q(pid)}&limit=1`);
  if (!p?.promotion_expires_at) return;
  const left = Date.parse(p.promotion_expires_at) - days * DAY;
  const patch = left > nowMs ? { promotion_expires_at: new Date(left).toISOString() } : { promotion_plan: null, promotion_expires_at: new Date(nowMs).toISOString() };
  await db.update('properties', `id=eq.${q(pid)}`, patch, { returning: 'minimal' });
}

// Manual grant: { email, plan, days, propertyId? } → the reward row.
export async function grantManual(db, { email, plan, days, propertyId, note, admin }, nowMs = Date.now()) {
  const [u] = await db.select('users', `select=id,email,full_name&email=eq.${q(String(email || '').trim().toLowerCase())}&limit=1`);
  if (!u) return { error: 'user_not_found' };
  const listings = await db.select('properties', `select=id,created_at,status,admin_status,is_complete,is_delisted,promotion_plan,promotion_expires_at&created_by=eq.${q(u.id)}&origin=eq.user&limit=200`);
  const pick = propertyId ? (listings.find((p) => String(p.id) === String(propertyId) && isLive(p)) ? { id: propertyId } : null) : pickRewardListing(listings, plan, nowMs);
  if (!pick) return { error: propertyId ? 'listing_not_live' : 'no_live_listing' };
  const row = await createReward(db, { key: `manual:${randomUUID()}`, user: u, data: { type: 'manual', plan, days, note: note || null, by: admin || null } });
  const taken = await updateRecord(db, row, { from: 'pending', to: 'granted', patch: { property_id: pick.id, granted_at: new Date(nowMs).toISOString() } });
  try {
    const res = await applyPromotion(db, pick.id, plan, days, nowMs);
    await updateRecord(db, taken, { patch: { until: res.until, plan_applied: res.plan } });
    return { ok: true, id: row.id, until: res.until };
  } catch (e) {
    await updateRecord(db, taken, { to: 'pending', patch: { last_error: String(e?.message || e) } });
    return { error: 'grant_failed' };
  }
}

export async function revokeReward(db, id, { admin } = {}, nowMs = Date.now()) {
  const [row] = await db.select('email_log', `select=id,run_id,to_email,subject,error,created_at&id=eq.${q(id)}&${kindQ(KIND.reward)}&limit=1`);
  if (!row) return { error: 'not_found' };
  if (!['pending', 'granted'].includes(row.subject)) return { error: 'not_active' };
  const d = dataOf(row);
  const taken = await updateRecord(db, row, { from: row.subject, to: 'revoked', patch: { revoked_at: new Date(nowMs).toISOString(), revoked_by: admin || null } });
  if (!taken) return { error: 'changed' };
  if (row.subject === 'granted' && d.property_id && d.until && Date.parse(d.until) > nowMs) await removeDays(db, d.property_id, d.days, nowMs);
  return { ok: true };
}

// A referral: 'approve' (an admin overrides the same-person check — it counts at the
// website's next run) or 'reject'.
export async function personAction(db, id, action, { admin } = {}) {
  const [row] = await db.select('email_log', `select=id,run_id,to_email,subject,error,created_at&id=eq.${q(id)}&${kindQ(KIND.person)}&limit=1`);
  if (!row) return { error: 'not_found' };
  if (action === 'approve') {
    if (row.subject !== 'rejected') return { error: 'not_rejected' };
    const r = await updateRecord(db, row, { from: 'rejected', to: 'signed_up', patch: { override: true, reason: null, matched: null, approved_by: admin || null } });
    return r ? { ok: true } : { error: 'changed' };
  }
  if (action === 'reject') {
    if (row.subject !== 'signed_up') return { error: 'only_waiting' };
    const r = await updateRecord(db, row, { from: 'signed_up', to: 'rejected', patch: { reason: 'admin', rejected_by: admin || null } });
    return r ? { ok: true } : { error: 'changed' };
  }
  return { error: 'bad_action' };
}
