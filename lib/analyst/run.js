// AI Analyst — one run: collect the data pack (lib/analyst/dataPack.js) → the outside-world
// timeline (lib/analyst/outsideEvents.js: exchange rates, holidays, disasters, weather fetched in
// code + ONE web-search call for news, all cached) with each event's impact on our visitors →
// one Claude call that reads everything and returns the analysis as JSON (lib/analyst/prompt.js)
// → the answer checked in code (lib/analyst/guard.js).
// Runs are SAVED IN THE CONTROL DB (table analyst_runs — migrations/control/002_analyst_runs.sql), so
// they survive deploys and restarts; the admin's own DB, never a country's marketplace data. Until that
// table exists (or if the control DB can't be reached) they fall back to this server's memory + a local
// JSON file (ANALYST_RUNS_DIR, default .analyst-runs/). Runs saved in files before the table existed are
// copied into it automatically (once per server start). Server-only.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { claudeClient } from '../aiTrack.js';
import { addUsage, emptyUsage, costUsd, parseReport } from '../manager/agent.js';
import { buildAnalystPack } from './dataPack.js';
import { TZ, localToday } from './math.js';
import { ANALYST_SYSTEM, ANALYST_SCHEMA, ANALYST_ASK, modelPack } from './prompt.js';
import { pickCountries, eventWindow, gatherStructured, searchNews, finalizeEvents, eventImpact, SITE_ISO, LOOKBACK_DAYS } from './outsideEvents.js';
import { guardReport } from './guard.js';

export const ANALYST_MODEL = process.env.ANALYST_MODEL || process.env.MANAGER_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.ANALYST_EFFORT || 'medium';
const WEB_SEARCH = process.env.ANALYST_WEB_SEARCH !== '0';
const SEARCH_USD = 0.01;   // US$10 per 1,000 web searches
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
const KEEP = 40;

const DIR = () => process.env.ANALYST_RUNS_DIR || path.join(process.cwd(), '.analyst-runs');
const jobs = (globalThis.__clAnalystRuns ||= new Map());   // id → run (running or recent)
const nowIso = () => new Date().toISOString();

// ── the control DB (analyst_runs) ──
let _ctrl = null;
async function ctrl() {
  if (!process.env.CONTROL_DB_URL || !process.env.CONTROL_DB_KEY) return null;
  if (!_ctrl) { const { makeClient } = await import('../db.js'); _ctrl = makeClient(process.env.CONTROL_DB_URL, process.env.CONTROL_DB_KEY); }
  return _ctrl;
}
const toRow = (r) => ({
  id: r.id, country: r.country, status: r.status, request: r.request || null, period: r.period || null, previous_period: r.previousPeriod || null,
  result: r.result || null, pack: r.pack || null, usage: r.usage || null, cost_usd: r.costUsd ?? null, model: r.model || null, error: r.error || null,
  created_by: r.by || null, created_at: r.createdAt, finished_at: r.finishedAt || null,
});
const fromRow = (x) => ({
  id: x.id, country: x.country, status: x.status, stage: x.status, request: x.request, period: x.period, previousPeriod: x.previous_period,
  result: x.result, pack: x.pack, usage: x.usage, costUsd: x.cost_usd == null ? null : Number(x.cost_usd), model: x.model, error: x.error,
  by: x.created_by, createdAt: x.created_at, finishedAt: x.finished_at,
});
async function dbSave(runs) {
  const db = await ctrl();
  if (!db) return false;
  await db.insert('analyst_runs', runs.map(toRow), { upsert: true, onConflict: 'id', returning: 'minimal' });
  return true;
}
// runs kept in local files before the table existed → copied into it once per server start
let _imported = false;
async function importLocalRuns() {
  if (_imported) return;
  _imported = true;
  try {
    const files = (await fs.readdir(DIR())).filter((f) => f.endsWith('.json'));
    const runs = [];
    for (const f of files) { try { const r = JSON.parse(await fs.readFile(path.join(DIR(), f), 'utf8')); if (r?.id && r.status !== 'running') runs.push(r); } catch { /* skip */ } }
    if (runs.length) await dbSave(runs);
  } catch { _imported = false; }
}

async function save(run) {
  jobs.set(run.id, run);
  try { if (await dbSave([run])) { await importLocalRuns(); return; } } catch { /* fall back to the local file */ }
  try {
    await fs.mkdir(DIR(), { recursive: true });
    await fs.writeFile(path.join(DIR(), `${run.id}.json`), JSON.stringify(run));
    const files = (await fs.readdir(DIR())).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) await fs.unlink(path.join(DIR(), f)).catch(() => {});
  } catch { /* memory only */ }
}

export async function listRuns() {
  const byId = new Map();
  try {
    const db = await ctrl();
    if (db) {
      await importLocalRuns();
      const rows = await db.select('analyst_runs', 'select=id,country,period,status,created_at,finished_at,cost_usd,result,error,created_by&order=created_at.desc&limit=200');
      for (const x of rows) byId.set(x.id, { id: x.id, country: x.country, period: x.period, status: x.status, createdAt: x.created_at, finishedAt: x.finished_at, costUsd: x.cost_usd == null ? null : Number(x.cost_usd), result: { headline: x.result?.headline || null }, error: x.error, by: x.created_by });
    }
  } catch { /* table not there yet: files + memory below */ }
  try {
    for (const f of (await fs.readdir(DIR())).filter((x) => x.endsWith('.json'))) {
      try { const r = JSON.parse(await fs.readFile(path.join(DIR(), f), 'utf8')); if (!byId.has(r.id)) byId.set(r.id, r); } catch { /* skip */ }
    }
  } catch { /* none yet */ }
  for (const r of jobs.values()) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(({ id, country, period, status, createdAt, finishedAt, costUsd: c, result, error, by }) => ({ id, country, period, status, createdAt, finishedAt, costUsd: c, headline: result?.headline || null, error: error || null, by: by || null }));
}

export async function getRun(id) {
  if (!/^[a-z0-9-]{8,60}$/.test(String(id || ''))) return null;
  if (jobs.has(id)) return jobs.get(id);
  try {
    const db = await ctrl();
    if (db) { const [x] = await db.select('analyst_runs', `select=*&id=eq.${encodeURIComponent(id)}&limit=1`); if (x) return fromRow(x); }
  } catch { /* fall back to the file */ }
  try { return JSON.parse(await fs.readFile(path.join(DIR(), `${id}.json`), 'utf8')); } catch { return null; }
}

// Ask once; retry without the fallback beta on an account that does not have it.
async function ask(client, params, state) {
  try {
    return state.fallback ? await client.beta.messages.stream({ ...params, ...FALLBACK }).finalMessage() : await client.messages.stream(params).finalMessage();
  } catch (e) {
    if (!(state.fallback && e instanceof Anthropic.BadRequestError && /fallback/i.test(String(e.message)))) throw e;
    state.fallback = false;
    return client.messages.stream(params).finalMessage();
  }
}

// The outside-world timeline → pack.outsideWorld. Never fails the run: errors are listed.
export async function outsideWorld(pack, { client, state, usage, webSearch = WEB_SEARCH } = {}) {
  const countries = pickCountries(pack);
  const win = eventWindow(pack.period);
  const today = localToday(pack.timezone || TZ.py);
  const siteIsos = pack.country === 'all' ? Object.values(SITE_ISO) : [SITE_ISO[pack.country]].filter(Boolean);
  const chartStart = pack.sections?.mainSite?.daily?.rows?.[0]?.[0] || null;
  const structured = await gatherStructured({ countries, win, chartStart, today, siteIsos });
  let news = { events: [], note: 'web search off', searches: 0 };
  const errors = [...structured.errors];
  if (webSearch && client) {
    try {
      news = await searchNews({ countries, win, site: pack.site, today, model: ANALYST_MODEL, callModel: (params) => ask(client, params, state) });
      if (!news.fromCache) addUsage(usage, news.usage || {});
    } catch (e) { errors.push(`news search: ${String(e?.message || e).slice(0, 160)}`); }
  }
  const events = finalizeEvents([...structured.events, ...news.events]);
  if (pack._series) for (const e of events) e.impact = eventImpact(e, pack._series, { end: pack.period.end });
  pack.outsideWorld = {
    window: win, countries,
    howToRead: `Events from ${win.start} (${LOOKBACK_DAYS} days before the period) to ${win.end}. impact = our visitors per day in the 7 days before the event vs days 0–3 and 4–21 after (the event's country too when it is a visitor country). Sources: fx = exchange rates (currency-api), holidays = date.nager.at, gdacs = disasters, weather = Open-Meteo (capital city), web_search = news found by a web search (URL checked against the search results).`,
    fx: structured.fx,
    events,
    newsNote: news.note || '',
    newsDropped: (news.dropped || []).length,
    errors,
  };
  return { searches: news.fromCache ? 0 : (news.searches || 0) };
}

// → { pack, result, usage, costUsd, searches, model }
export async function analyze({ country, days = 28, start = null, end = null, onStage = () => {} } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  onStage('collect');
  const pack = await buildAnalystPack(country, { days, start, end });
  const client = await claudeClient({ feature: 'analyst', country: country === 'all' ? 'py' : country }, { timeout: 10 * 60 * 1000, maxRetries: 2 });
  const usage = emptyUsage();
  const state = { fallback: true };
  let searches = 0;
  let model = ANALYST_MODEL;

  // 1. the outside world: structured data + one news search (cached)
  onStage('outside');
  try {
    const ow = await outsideWorld(pack, { client, state, usage });
    searches += ow.searches;
  } catch (e) { pack.outsideWorld = { error: String(e?.message || e).slice(0, 200), events: [] }; }

  // 2. the analysis
  onStage('analyze');
  const msg = await ask(client, {
    model: ANALYST_MODEL, max_tokens: 32000,
    system: ANALYST_SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: ANALYST_SCHEMA } },
    messages: [{ role: 'user', content: [{ type: 'text', text: `Data pack (JSON):\n${JSON.stringify(modelPack(pack))}` }, { type: 'text', text: ANALYST_ASK }] }],
  }, state);
  addUsage(usage, msg.usage);
  if (msg.stop_reason === 'refusal') throw new Error(`The model declined (${msg.stop_details?.category || 'no category'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error('The analysis was cut off (max_tokens)');
  model = msg.model || model;
  const result = guardReport(parseReport(msg), pack);
  const cost = Math.round((costUsd(usage) + searches * SEARCH_USD) * 10000) / 10000;
  return { pack, result, usage: { ...usage, webSearches: searches }, costUsd: cost, model };
}

// Start a run in the background; the page polls getRun(id). → { id }
export async function startAnalysis({ country, days, start, end, by = null }) {
  const busy = [...jobs.values()].find((r) => r.status === 'running' && r.country === country);
  if (busy) return { id: busy.id, already: true };
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const run = { id, country, request: { days, start, end }, period: null, status: 'running', stage: 'collect', createdAt: nowIso(), by };
  jobs.set(id, run);
  analyze({ country, days, start, end, onStage: (stage) => { run.stage = stage; } })
    .then(async (r) => {
      Object.assign(run, { status: 'done', stage: 'done', finishedAt: nowIso(), period: r.pack.period, previousPeriod: r.pack.previousPeriod, result: r.result, pack: r.pack, usage: r.usage, costUsd: r.costUsd, model: r.model });
      await save(run);
    })
    .catch(async (e) => {
      Object.assign(run, { status: 'failed', stage: 'failed', finishedAt: nowIso(), error: String(e?.message || e).slice(0, 500) });
      await save(run);
    });
  return { id };
}

// For the weekly Admin Manager report (lib/manager/run.js): the analysis of the report's own
// days, trimmed to what the report page shows. period = the pack's { start, end } (ISO times).
export async function analystForReport(country, period) {
  const tz = TZ[country] || TZ.py;
  const start = localToday(tz, new Date(period.start));
  const end = localToday(tz, new Date(period.end));
  const r = await analyze({ country, start, end: end < start ? start : end });
  const { headline, summary, changes = [], channels, nextSteps } = r.result;
  // the report page shows "anomalies" (date · kind: what / cause (confidence))
  const anomalies = changes.slice(0, 4).map((c) => ({ date: c.when, kind: c.direction, what: `${c.title} — ${c.change}`, cause: c.explanation, confidence: c.confidence }));
  return { headline, summary, anomalies, changes, channels, nextSteps, keyNumbers: r.pack.keyNumbers, period: r.pack.period, costUsd: r.costUsd, model: r.model };
}
