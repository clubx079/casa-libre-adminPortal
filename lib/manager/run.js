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
import { buildActions, recentActionKeys, blockedTargets, safeBody, safeUrl } from './actions.js';
import { fixThreads, planFollowups, followupDraft, escalationAction, LOOKBACK_DAYS } from './fixFollowups.js';
import { sendAction } from './send.js';

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
    // follow-ups on "please fix your listing" emails (lib/manager/fixFollowups.js): still not
    // fixed → a reminder now; reminders used up → an action for Omar in every report
    const site = countryInfo(country).site;
    const fixSince = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
    const fixReports = await db.select(TABLE, `select=id,created_at,actions&status=eq.done&country=eq.${country}&created_at=gte.${fixSince}&order=created_at.asc`).catch(() => []);
    const threads = fixThreads(fixReports);
    const inList = (ids) => `in.(${ids.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`;
    const pids = [...new Set([...threads.values()].map((t) => t.property_id))];
    const fixListings = pids.length ? await db.select('properties', `select=id,raw_data,status,admin_status,contact_name,contact_phone,property_type,neighborhood,city&id=${inList(pids)}`).catch(() => []) : [];
    const listingsById = new Map(fixListings.map((l) => [String(l.id), l]));
    const fuids = [...new Set([...threads.values()].map((t) => t.user_id))];
    const fixUsers = fuids.length ? await db.select('users', `select=id,email,full_name&id=${inList(fuids)}`).catch(() => []) : [];
    const fixUsersById = new Map(fixUsers.map((u) => [String(u.id), u]));
    const fixPlan = planFollowups(threads, listingsById);
    const ctx = (t) => ({ listing: listingsById.get(String(t.property_id)), user: fixUsersById.get(String(t.user_id)), site });
    for (const t of fixPlan.escalate) {
      const a = escalationAction(t, ctx(t));
      if (!keys.has(a.key)) { keys.add(a.key); actions.push(a); }
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
      recentKeys: recentActionKeys(recent, Date.now() - 14 * 86400000),
      blocked: blockedTargets(brief),
    });
    // the AI never writes a second fix email for a listing whose thread is still open — the
    // reminders below carry it on
    const stillOpen = new Set([...fixPlan.resend, ...fixPlan.escalate].map((t) => t.key));   // not fixed yet
    const openThread = (d) => d.kind === 'listing_fix' && stillOpen.has(`${d.user_id}:${d.property_id}`);
    const drafts = aiDrafts.filter((d) => !openThread(d));
    for (const d of aiDrafts) if (openThread(d)) dropped.push({ reason: 'fix already being followed up', draft: d });
    let reminders = 0;
    for (const t of fixPlan.resend) {
      const u = fixUsersById.get(String(t.user_id));
      if (!u?.email || isInternalEmail(u.email, extra) || isDeletedEmail(u.email)) continue;
      const d = followupDraft(t, ctx(t));
      const buttonUrl = safeUrl(d.button_url, site);
      drafts.push({ id: crypto.randomUUID(), feedback_id: null, section: 'listings', ...d, body: safeBody(d.body, site), button_url: buttonUrl, button_label: buttonUrl ? d.button_label : null, status: 'draft' });
      reminders += 1;
    }
    if (reminders || fixPlan.escalate.length) log.push({ at: nowIso(), text: `Fix follow-ups: ${reminders} reminder(s) to sellers who haven't fixed their listing yet${fixPlan.escalate.length ? `; ${fixPlan.escalate.length} still not fixed after every reminder → action for Omar` : ''}.` });

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
  } catch (e) {
    log.push({ at: nowIso(), text: `Failed: ${String(e?.message || e).slice(0, 300)}` });
    await save({ status: 'failed', error: String(e?.message || e).slice(0, 1000), finished_at: nowIso(), log }).catch(() => {});
    throw e;
  }
}
