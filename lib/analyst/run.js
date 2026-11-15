// AI Analyst — one run: collect the data pack (lib/analyst/dataPack.js) → (if there are anomaly
// days) a small web-search call for outside events on those dates → one Claude call that reads
// everything and returns the analysis as JSON (lib/analyst/prompt.js).
// Runs are kept in this server's memory and in a local JSON file (ANALYST_RUNS_DIR, default
// .analyst-runs/ in the app folder) — NOT in the database: nothing is written to production.
// On a server whose disk is wiped on deploy they last until the next deploy. Server-only.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { claudeClient } from '../aiTrack.js';
import { addUsage, emptyUsage, costUsd, parseReport } from '../manager/agent.js';
import { buildAnalystPack } from './dataPack.js';
import { TZ, localToday } from './math.js';
import { ANALYST_SYSTEM, ANALYST_SCHEMA, ANALYST_ASK, SEARCH_SYSTEM, SEARCH_SCHEMA, searchBrief } from './prompt.js';

export const ANALYST_MODEL = process.env.ANALYST_MODEL || process.env.MANAGER_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.ANALYST_EFFORT || 'medium';
const WEB_SEARCH = process.env.ANALYST_WEB_SEARCH !== '0';
const SEARCH_USD = 0.01;   // US$10 per 1,000 web searches
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
const KEEP = 40;

const DIR = () => process.env.ANALYST_RUNS_DIR || path.join(process.cwd(), '.analyst-runs');
const jobs = (globalThis.__clAnalystRuns ||= new Map());   // id → run (running or recent)
const nowIso = () => new Date().toISOString();

async function save(run) {
  jobs.set(run.id, run);
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
    for (const f of (await fs.readdir(DIR())).filter((x) => x.endsWith('.json'))) {
      try { const r = JSON.parse(await fs.readFile(path.join(DIR(), f), 'utf8')); byId.set(r.id, r); } catch { /* skip */ }
    }
  } catch { /* none yet */ }
  for (const r of jobs.values()) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(({ id, country, period, status, createdAt, finishedAt, costUsd: c, result, error, by }) => ({ id, country, period, status, createdAt, finishedAt, costUsd: c, headline: result?.headline || null, error: error || null, by: by || null }));
}

export async function getRun(id) {
  if (!/^[a-z0-9-]{8,60}$/.test(String(id || ''))) return null;
  if (jobs.has(id)) return jobs.get(id);
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

// Web search for outside events on the anomaly days. → { externalEvents, usage, searches }
export async function searchEvents(client, pack, state = { fallback: true }) {
  try {
    const msg = await ask(client, {
      model: ANALYST_MODEL, max_tokens: 12000, system: SEARCH_SYSTEM, thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SEARCH_SCHEMA } },
      messages: [{ role: 'user', content: searchBrief(pack) }],
    }, state);
    const searches = Number(msg.usage?.server_tool_use?.web_search_requests) || 0;
    const ok = msg.stop_reason !== 'refusal' && msg.stop_reason !== 'max_tokens';
    return { usage: msg.usage, searches, externalEvents: ok ? { ...parseReport(msg), method: searches ? `web search (${searches})` : 'no search run' } : { error: `search stopped: ${msg.stop_reason}` } };
  } catch (e) {
    return { searches: 0, externalEvents: { error: `web search failed: ${String(e?.message || e).slice(0, 160)}` } };
  }
}

// The pack the model reads: the code-only helper fields out.
export function modelPack(pack) {
  const p = JSON.parse(JSON.stringify(pack));
  delete p.dates;
  return p;
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

  // 1. outside events on the anomaly dates (small input: only the anomaly facts)
  if (WEB_SEARCH && (pack.sections.anomalies?.days || []).length) {
    onStage('search');
    const found = await searchEvents(client, pack, state);
    addUsage(usage, found.usage || {});
    searches += found.searches || 0;
    pack.externalEvents = found.externalEvents;
  }

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
  const result = parseReport(msg);
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
  const { headline, summary, anomalies, channels, externalContext, nextSteps } = r.result;
  return { headline, summary, anomalies, channels, externalContext, nextSteps, keyNumbers: r.pack.keyNumbers, period: r.pack.period, costUsd: r.costUsd, model: r.model };
}
