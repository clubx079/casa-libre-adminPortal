// Admin Manager — the DAILY follow-ups (cron /api/cron/followups, every day; the report run on
// Mon / Wed / Fri also calls it when it is done). The weekly report keeps its own rhythm; these
// personal emails don't wait for it:
//   • the first "your payment didn't go through" email for every checkout started and not paid
//     (Verified badge, home page display, extra listing, listing extension) — payFollowups.js
//   • the payment reminders (up to 3) — payFollowups.js
//   • the listing-fix reminders (up to 3) — fixFollowups.js
// Each one is added to the latest report's emails (its Emails tab lists it, sent by "Admin
// Manager (daily)") and sent the same way an admin's Send does (send.js) — so it is logged in
// email_log and shows on the person's page. MANAGER_AUTO_SEND=0 → left there as drafts.
// The escalations ("still not fixed / not paid after every email" → an action for Omar) stay in
// the report. A day already done (within 20 h) is skipped unless force.
import { dbFor } from '../db.js';
import { isInternalEmail } from '../internalTraffic.js';
import { internalEmails } from '../internalAudience.js';
import { isDeletedEmail } from '../userInsights.js';
import { countryInfo } from '../automationAdmin.js';
import { fixThreads, planFollowups, LOOKBACK_DAYS } from './fixFollowups.js';
import { payThreads, planPayFollowups, newCheckouts, NEW_DAYS } from './payFollowups.js';
import { dailyDrafts } from './dailyDrafts.js';
import { sendAction } from './send.js';

const TABLE = 'manager_reports';
const DAY = 86400000;
const nowIso = () => new Date().toISOString();
const inList = (ids) => `in.(${ids.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`;
export const DAILY_TAG = 'Daily follow-ups';
const autoSend = () => process.env.MANAGER_AUTO_SEND !== '0';

// Everything the follow-ups need, read once: the threads (emails already sent) and their plans.
// A failed read never looks like "not paid / not fixed": that part is left out this time.
export async function loadFollowups(db, country, now = Date.now()) {
  const site = countryInfo(country).site;
  const since = new Date(now - LOOKBACK_DAYS * DAY).toISOString();
  const reports = await db.select(TABLE, `select=id,created_at,actions&status=eq.done&country=eq.${country}&created_at=gte.${since}&order=created_at.asc`).catch(() => null);
  if (!reports) return null;
  const fix = fixThreads(reports);
  const pay = payThreads(reports);
  const recentSince = new Date(now - (NEW_DAYS + 1) * DAY).toISOString();
  const threadUids = [...new Set([...fix.values(), ...pay.values()].map((t) => t.user_id))];
  const [recentPays, threadPays] = await Promise.all([
    db.select('payments', `select=user_id,property_id,kind,plan,status,amount_usd,created_at&status=in.(started,succeeded)&created_at=gte.${encodeURIComponent(recentSince)}&limit=2000`).catch(() => null),
    threadUids.length ? db.select('payments', `select=user_id,property_id,kind,plan,status,amount_usd,created_at&user_id=${inList(threadUids)}&status=in.(started,succeeded)&limit=2000`).catch(() => null) : [],
  ]);
  const payments = recentPays && threadPays ? [...new Map([...recentPays, ...threadPays].map((p) => [`${p.user_id}|${p.property_id}|${p.status}|${p.created_at}`, p])).values()] : null;
  const pids = [...new Set([...fix.values(), ...pay.values()].map((t) => t.property_id).concat((payments || []).filter((p) => p.status === 'started').map((p) => p.property_id)).filter(Boolean))];
  const uids = [...new Set(threadUids.concat((payments || []).map((p) => p.user_id)).filter(Boolean))];
  const [listings, users] = await Promise.all([
    pids.length ? db.select('properties', `select=id,raw_data,status,admin_status,promotion_plan,promoted_at,contact_name,contact_phone,property_type,neighborhood,city&id=${inList(pids)}`).catch(() => null) : [],
    uids.length ? db.select('users', `select=id,email,full_name,suspended,blocked&id=${inList(uids)}`).catch(() => []) : [],
  ]);
  const listingsById = new Map((listings || []).map((l) => [String(l.id), l]));
  const usersById = new Map(users.map((u) => [String(u.id), u]));
  return {
    site, fix, pay, listingsById, usersById, payments: payments || [],
    fixPlan: listings ? planFollowups(fix, listingsById, now) : { resend: [], escalate: [] },
    payPlan: listings && payments ? planPayFollowups(pay, listingsById, payments, now) : { resend: [], escalate: [] },
    checkouts: listings && payments ? newCheckouts({ payments, threadKeys: new Set(pay.keys()), listingsById, now }) : [],
  };
}

// → { ok, skipped?, reportId, firstEmails, payReminders, fixReminders, sent, failed }
export async function runDailyFollowups(country, { force = false, by = 'Admin Manager (daily)', now = Date.now() } = {}) {
  const db = dbFor(country);
  const [latest] = await db.select(TABLE, `select=id,log&status=eq.done&country=eq.${country}&order=created_at.desc&limit=1`);
  if (!latest) return { ok: false, error: 'no_report_yet' };
  const lastDaily = [...(latest.log || [])].reverse().find((l) => String(l.text || '').startsWith(DAILY_TAG));
  if (!force && lastDaily && now - Date.parse(lastDaily.at) < 20 * 3600000) return { ok: true, skipped: 'Already done in the last 20 hours.', reportId: latest.id };

  const state = await loadFollowups(db, country, now);
  if (!state) return { ok: false, error: 'reports_unreadable' };
  const extra = await internalEmails(country).catch(() => new Set());
  const canEmail = (u) => !!u?.email && !u.suspended && !u.blocked && !isInternalEmail(u.email, extra) && !isDeletedEmail(u.email);
  const drafts = dailyDrafts(state, { canEmail });
  const counts = { firstEmails: drafts.filter((d) => d.kind === 'unpaid_listing' && !d.followup).length, payReminders: drafts.filter((d) => d.kind === 'unpaid_listing' && d.followup).length, fixReminders: drafts.filter((d) => d.kind === 'listing_fix').length };

  // add them to the latest report (read again right before writing, so nothing is lost)
  const [row] = await db.select(TABLE, `select=id,actions,log&id=eq.${latest.id}&limit=1`);
  if (drafts.length) await db.update(TABLE, `id=eq.${latest.id}`, { actions: [...(row?.actions || []), ...drafts] }, { returning: 'minimal' });
  const sent = [], failed = [];
  if (autoSend()) {
    for (const a of drafts) {
      const res = await sendAction(country, latest.id, a.id, by).catch((e) => ({ ok: false, error: String(e?.message || e) }));
      (res.ok ? sent : failed).push(res.ok ? a.id : `${a.subject}: ${res.error}`);
    }
  }
  const text = `${DAILY_TAG}: ${counts.firstEmails} first payment email(s), ${counts.payReminders} payment reminder(s), ${counts.fixReminders} listing-fix reminder(s)${autoSend() ? ` — ${sent.length} sent${failed.length ? `, ${failed.length} not sent (${failed.join('; ').slice(0, 300)})` : ''}` : ' — left as drafts (MANAGER_AUTO_SEND=0)'}.`;
  const [fresh] = await db.select(TABLE, `select=log&id=eq.${latest.id}&limit=1`).catch(() => [row]);
  await db.update(TABLE, `id=eq.${latest.id}`, { log: [...(fresh?.log || row?.log || []), { at: nowIso(), text }] }, { returning: 'minimal' }).catch(() => {});
  return { ok: true, reportId: latest.id, ...counts, sent: sent.length, failed };
}
