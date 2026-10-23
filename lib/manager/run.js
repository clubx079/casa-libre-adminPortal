// Admin Manager — one weekly run, start to finish, saved in manager_reports (migration 007):
//   collect (data pack) → analyze (Claude + tools) → done, with the drafts as actions.
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
import { runTeam } from './team.js';
import { buildActions, recentActionKeys, blockedTargets } from './actions.js';

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
  const log = [{ at: nowIso(), text: 'Started — collecting this week\'s numbers.' }];
  const save = (patch) => db.update(TABLE, `id=eq.${id}`, patch, { returning: 'minimal' });
  const say = async (text, patch = {}) => { log.push({ at: nowIso(), text }); await save({ ...patch, log }).catch(() => {}); };
  try {
    // last finished report: for "vs last week" and the admins' feedback on it
    const recent = await db.select(TABLE, `select=id,created_at,period_start,period_end,report,actions,feedback&status=eq.done&country=eq.${country}&order=created_at.desc&limit=4`).catch(() => []);
    const pack = await buildDataPack(country, { previous: recent[0] || null });
    const broken = Object.entries(pack).filter(([, v]) => v && typeof v === 'object' && v.error).map(([k, v]) => `${k}: ${v.error}`);
    await say(`Numbers collected${broken.length ? ` (${broken.length} source(s) unavailable: ${broken.join('; ').slice(0, 300)})` : ''}. Five researchers are analysing (feedback, original listings & payments, follow-ups, traffic & marketing, scrapers)…`, {
      stage: 'analyze', data_pack: pack, period_start: pack.period.start, period_end: pack.period.end,
    });

    // five researchers in parallel, then the lead (lib/manager/team.js)
    const result = await runTeam({
      country, pack, deps: toolDeps(country),
      onProgress: async ({ who, text }) => { await say(`${who}: ${text}`); },
    });

    // drafts → the review queue
    const extra = await internalEmails(country).catch(() => new Set());
    const ids = [...new Set((result.report.drafts || []).map((d) => d.user_id).filter(Boolean))];
    const users = ids.length ? await db.select('users', `select=id,email&id=in.(${ids.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`).catch(() => []) : [];
    const byId = new Map(users.map((u) => [String(u.id), u]));
    const { actions, dropped } = buildActions(result.report.drafts || [], {
      site: countryInfo(country).site,
      newId: () => crypto.randomUUID(),
      skipUser: (uid) => { const u = byId.get(String(uid)); return !u || !u.email || isInternalEmail(u.email, extra) || isDeletedEmail(u.email); },
      recentKeys: recentActionKeys(recent, Date.now() - 14 * 86400000),
      blocked: blockedTargets(result.report),
    });
    const { drafts, ...report } = result.report;
    log.push({ at: nowIso(), text: `Done. ${actions.length} draft email(s) to review${dropped.length ? `, ${dropped.length} left out (${[...new Set(dropped.map((d) => d.reason))].join(', ')})` : ''}. Cost US$${result.costUsd.toFixed(2)}.` });
    await save({
      status: 'done', stage: 'done', report, notes: result.notes, actions, usage: { ...result.usage, dropped: dropped.length }, cost_usd: result.costUsd, model: result.model, finished_at: nowIso(), log,
    });
  } catch (e) {
    log.push({ at: nowIso(), text: `Failed: ${String(e?.message || e).slice(0, 300)}` });
    await save({ status: 'failed', error: String(e?.message || e).slice(0, 1000), finished_at: nowIso(), log }).catch(() => {});
    throw e;
  }
}
