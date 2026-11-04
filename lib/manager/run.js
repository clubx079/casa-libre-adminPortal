// Admin Manager — one weekly run, start to finish, saved in manager_reports (migration 007):
//   collect (data pack) → the analyst reads it with the earlier reports, the admins' notes and
//   the memory (lib/manager/brief.js) → every number checked (verify.js) → the loop carried
//   forward (memory.js) → done, with the drafts as actions.
// startRun() answers at once and does the work in the background, so the cron / the
// "Run now" button never waits minutes on an open request; the page polls the row.
// One run per country at a time. Server-only.
import crypto from 'node:crypto';
import { dbFor } from '../db.js';
import { hogql } from '../posthogHogql.js';
import { isInternalEmail } from '../internalTraffic.js';
import { internalEmails } from '../internalAudience.js';
import { isDeletedEmail } from '../userInsights.js';
import { countryInfo } from '../automationAdmin.js';
import { buildDataPack } from './dataPack.js';
import { runBrief } from './brief.js';
import { verifyBrief } from './verify.js';
import { readMemory, historyForRun, trackerOf, nextTracker, slug, HISTORY_REPORTS } from './memory.js';
import { buildActions, answeredItems, blockedTargets } from './actions.js';
import { escalationAction } from './fixFollowups.js';
import { payEscalationAction } from './payFollowups.js';
import { loadFollowups, runDailyFollowups } from './daily.js';
import { sendAction } from './send.js';
import { sendViewsAdvice } from './viewsAdviceRun.js';

// The report's emails go out on their own as soon as it is written (no approval step).
// MANAGER_AUTO_SEND=0 keeps them as drafts for an admin to approve.
export const autoSend = () => process.env.MANAGER_AUTO_SEND !== '0';

export const TABLE = 'manager_reports';
const STALE_MS = 2 * 3600 * 1000;           // a run "running" this long was cut off (server restart)
const running = (globalThis.__clManagerRuns ||= new Map()); // country → promise (this server)

const nowIso = () => new Date().toISOString();

// Rows left 'running' by a server that restarted mid-run → failed, so the page and the
// next run don't wait on them forever.
export async function markStale(db) {
  const before = new Date(Date.now() - STALE_MS).toISOString();
  await db.update(TABLE, `status=eq.running&created_at=lt.${encodeURIComponent(before)}`, { status: 'failed', error: 'Interrupted (the server restarted during the run).', finished_at: nowIso() }, { returning: 'minimal' }).catch(() => {});
}

// → { ok, id } or { ok:false, error, id? } (already running).
export async function startRun(country, { trigger = 'manual', by = null } = {}) {
  const db = dbFor(country);
  await markStale(db);
  if (running.has(country)) return { ok: false, error: 'already_running' };
  const [busy] = await db.select(TABLE, `select=id&status=eq.running&country=eq.${country}&limit=1`);
  if (busy) return { ok: false, error: 'already_running', id: busy.id };
  const [row] = await db.insert(TABLE, [{ country, trigger, status: 'running', stage: 'collect', created_by: by, log: [{ at: nowIso(), text: 'Started — collecting this week\'s numbers.' }] }]);
  const job = executeRun(country, row.id).catch(() => {}).finally(() => running.delete(country));
  running.set(country, job);
  return { ok: true, id: row.id };
}

// The tool functions the agent may call, bound to this country (read-only).
export function toolDeps(country) {
  const db = dbFor(country);
  return {
    select: (table, query) => db.select(table, query),
    count: async (table, filters) => (await db.selectWithCount(table, `select=id${filters ? `&${filters}` : ''}&limit=1`)).count,
    hogql: (sql) => hogql(sql, { fresh: 60_000, stale: 0 }),
  };
}

export async function executeRun(country, id) {
  const db = dbFor(country);
  const log = [{ at: nowIso(), text: 'Started — collecting the numbers.' }];
  const save = (patch) => db.update(TABLE, `id=eq.${id}`, patch, { returning: 'minimal' });
  const say = async (text, patch = {}) => { log.push({ at: nowIso(), text }); await save({ ...patch, log }).catch(() => {}); };
  try {
    // the earlier reports (the loop) + what the team told the manager to remember
    const recent = await db.select(TABLE, `select=id,created_at,period_start,period_end,report,actions,feedback,data_pack&status=eq.done&country=eq.${country}&order=created_at.desc&limit=${HISTORY_REPORTS}`).catch(() => []);
    const memory = await readMemory(db);
    const history = historyForRun(recent);
    // the period continues from the previous report, however it was started (the live admin
    // has no "Run now": every report is part of the chain)
    // views but no contacts → the price / photos advice to each seller, before the numbers are read
    const advice = autoSend() ? await sendViewsAdvice(country).catch((e) => ({ error: String(e?.message || e) })) : { skipped: true };
    if (advice.error) await say(`Views-but-no-contacts emails failed: ${advice.error.slice(0, 160)}`);
    else if (!advice.skipped) await say(`Views but no contacts: ${advice.sent} seller(s) emailed the price / photos advice${advice.failed ? `, ${advice.failed} failed` : ''}.`);
    const pack = await buildDataPack(country, { previous: recent[0] || null, since: recent[0]?.period_end || null });
    for (const r of recent) if (!r.report?.kpis && r.data_pack?.kpis) r.report = { ...r.report, kpis: r.data_pack.kpis };
    for (const r of recent) delete r.data_pack;   // only its key numbers are needed (trend)
    const broken = Object.entries(pack).filter(([, v]) => v && typeof v === 'object' && v.error).map(([k, v]) => `${k}: ${v.error}`);
    await say(`Numbers collected${broken.length ? ` (${broken.length} source(s) unavailable: ${broken.join('; ').slice(0, 300)})` : ''}. Reading them with ${recent.length} earlier report(s), ${history.openActions.length} open action(s), ${history.adminNotes.length} admin note(s) and ${memory.length} memory note(s)…`, {
      stage: 'analyze', data_pack: pack, period_start: pack.period.start, period_end: pack.period.end,
    });

    const result = await runBrief({ country, pack, history, memory });

    // the number guard: every number must come from what the manager was given
    const { brief, guard } = verifyBrief(result.brief, { pack, sources: [history, memory.map((n) => n.text)] });
    await say(`Brief written (US$${result.costUsd.toFixed(2)}). Number check: ${guard.checked} numbers, ${guard.unverified.length} not found in the data${guard.removedPoints.length ? `, ${guard.removedPoints.length} line(s) removed` : ''}.`);

    // stable, unique keys; the loop carried forward
    const keys = new Set();
    const actions = (brief.actions || []).map((a) => {
      let key = slug(a.key || a.title);
      while (keys.has(key)) key = `${key}-2`;
      keys.add(key);
      return { ...a, key };
    });
    // the follow-ups (lib/manager/daily.js — sent every day, not only with the report): what
    // is still not fixed / not paid after every email becomes an action for Omar here
    const site = countryInfo(country).site;
    const fu = await loadFollowups(db, country);
    if (fu) {
      for (const t of fu.fixPlan.escalate) {
        const a = escalationAction(t, { listing: fu.listingsById.get(String(t.property_id)), user: fu.usersById.get(String(t.user_id)), site });
        if (!keys.has(a.key)) { keys.add(a.key); actions.push(a); }
      }
      for (const t of fu.payPlan.escalate) {
        const a = payEscalationAction(t, { listing: fu.listingsById.get(String(t.property_id)), user: fu.usersById.get(String(t.user_id)), payments: fu.payments });
        if (!keys.has(a.key)) { keys.add(a.key); actions.push(a); }
      }
    }

    const doneKeys = new Set(history.openActions.filter((o) => o.marked_done_by_admin).map((o) => o.key));
    const checks = (brief.followup_checks || []).map((c) => ({ ...c, key: slug(c.key) }));
    const tracker = nextTracker({ previous: trackerOf(recent[0]), actions, checks, doneKeys, now: nowIso() });

    // drafts → the review queue
    const extra = await internalEmails(country).catch(() => new Set());
    const ids = [...new Set((brief.drafts || []).map((d) => d.user_id).filter(Boolean))];
    const users = ids.length ? await db.select('users', `select=id,email&id=in.(${ids.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`).catch(() => []) : [];
    const byId = new Map(users.map((u) => [String(u.id), u]));
    const { actions: aiDrafts, dropped } = buildActions(brief.drafts || [], {
      site,
      newId: () => crypto.randomUUID(),
      skipUser: (uid) => { const u = byId.get(String(uid)); return !u || !u.email || isInternalEmail(u.email, extra) || isDeletedEmail(u.email); },
      answered: answeredItems(fu?.reports || recent),   // the same problem is never answered twice
      blocked: blockedTargets(brief),
    });
    // the AI never writes a second fix email for a listing that already has one (the daily
    // reminders carry it on), and never a payment email: code writes those every day
    const fixOpen = new Set(fu ? [...fu.fixPlan.resend, ...fu.fixPlan.escalate].map((t) => t.key) : []);
    const skipDraft = (d) => d.kind === 'unpaid_listing' || (d.kind === 'listing_fix' && fixOpen.has(`${d.user_id}:${d.property_id}`));
    const drafts = aiDrafts.filter((d) => !skipDraft(d));
    for (const d of aiDrafts) if (skipDraft(d)) dropped.push({ reason: d.kind === 'unpaid_listing' ? 'payment emails go out daily' : 'fix already being followed up', draft: d });

    const { drafts: _d, ...rest } = brief;
    const report = {
      version: 2,
      ...rest,
      followup_checks: checks,
      actions,
      tracker,
      guard,
      kpis: pack.kpis,
      trend: [...recent].reverse().map((r) => ({ at: r.period_end || r.created_at, kpis: r.report?.kpis || r.data_pack?.kpis || null })).filter((x) => x.kpis).concat([{ at: pack.period.end, kpis: pack.kpis }]),
      memory_used: memory.length,
      history_used: { reports: recent.length, openActions: history.openActions.length, adminNotes: history.adminNotes.length },
    };
    log.push({ at: nowIso(), text: `Done. ${actions.length} action(s), ${(brief.followup_checks || []).length} earlier action(s) checked, ${drafts.length} draft email(s)${dropped.length ? `, ${dropped.length} left out (${[...new Set(dropped.map((d) => d.reason))].join(', ')})` : ''}. Cost US$${result.costUsd.toFixed(2)}.` });
    await save({
      status: 'done', stage: 'done', report, notes: null, actions: drafts, usage: { ...result.usage, dropped: dropped.length }, cost_usd: result.costUsd, model: result.model, finished_at: nowIso(), log,
    });
    // send them now — each one the same way an admin's "Send" does (lib/manager/send.js)
    if (autoSend() && drafts.length) {
      const sent = [], failed = [];
      for (const a of drafts) {
        const res = await sendAction(country, id, a.id, 'Admin Manager (automatic)').catch((e) => ({ ok: false, error: String(e?.message || e) }));
        (res.ok ? sent : failed).push(res.ok ? a.id : `${a.subject}: ${res.error}`);
      }
      log.push({ at: nowIso(), text: `Sent ${sent.length} email(s) automatically${failed.length ? `; ${failed.length} not sent (${failed.join('; ').slice(0, 300)})` : ''}.` });
      await save({ log }).catch(() => {});
    }
    // and today's follow-ups (first payment emails + reminders), added to this report — the
    // daily cron (/api/cron/followups) does the same on the other days
    await runDailyFollowups(country, { force: true }).catch(() => {});
  } catch (e) {
    log.push({ at: nowIso(), text: `Failed: ${String(e?.message || e).slice(0, 300)}` });
    await save({ status: 'failed', error: String(e?.message || e).slice(0, 1000), finished_at: nowIso(), log }).catch(() => {});
    throw e;
  }
}
