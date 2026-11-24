// AI SEO — every pipeline run, recorded (table seo_runs, migrations/012_seo_runs.sql) with:
//   steps       what each stage returned            changes     what this run changed + why
//   snapshot    the numbers at this run             comparison  vs the previous run (lib/seo/report.js)
//   report      the AI SEO report by Claude (if Claude can't answer: written from the numbers, with why)
// runPipeline() is the ONE entry point: the daily cron (/api/cron/seo?job=all) and the "Run now"
// button (Admin Manager → AI SEO) both call it. Without migration 012 the pipeline still runs; only
// the record is skipped. Server-only.
import 'server-only';
import { seoDb, isMissingTable } from './store.js';
import { runCollect, runDecide, runAutopilot, runImprove, gscPages } from './run.js';
import { gscQuery } from '../googleApi';
import { siteFor as gscSiteFor, indexingCheck } from '../searchConsole';
import { summarizeIndexing, recentPipelinePages, NEW_PAGE_DAYS } from './indexing.js';
import { hogql, posthogConfigured } from '../posthogHogql';
import { siteClause } from '../analyticsSite';
import { GEO_BASE, CONTACT_IN } from '../posthogSql';
import { claudeClient } from '../aiTrack.js';
import { compareSnapshots, dataReport, cleanReport, reportPrompt, displayChanges, REPORT_SYSTEM } from './report.js';

const enc = encodeURIComponent;
const day = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => day(new Date(Date.now() - n * 86400000));
const errText = (e) => String(e?.message || e).slice(0, 300);
export const REPORT_MODEL = process.env.SEO_REPORT_MODEL || 'claude-opus-5-5';
export const STEPS = ['trends', 'collect', 'decide', 'autopilot', 'improve'];

// ── the run ──
// one run at a time per country in this server (a second click / overlapping cron is refused)
const active = new Set();
export const isRunning = (cc) => active.has(cc);

export async function runPipeline(cc, opts = {}) {
  if (active.has(cc)) return { skipped: 'a run is already in progress for this country' };
  active.add(cc);
  try { return await runPipelineInner(cc, opts); } finally { active.delete(cc); }
}

async function runPipelineInner(cc, { trigger = 'cron', by = null, deadline = Date.now() + 255000, steps = STEPS, record = true } = {}) {
  // another server process (cron vs "Run now") may be running this country: the DB knows
  if (record) { try { if (await runningRun(cc)) return { skipped: 'a run is already in progress for this country' }; } catch { /* no table yet */ } }
  const startedAt = new Date().toISOString();
  let runId = null;
  let logNote = record ? null : 'single stage (not recorded)';
  if (record) try {
    const [row] = await seoDb(cc).insert('seo_runs', [{ country: cc, trigger, status: 'running', started_at: startedAt, created_by: by }]);
    runId = row?.id || null;
  } catch (e) { logNote = isMissingTable(e) ? 'run migrations/012_seo_runs.sql to keep run reports' : `run record: ${errText(e)}`; }
  const out = {};
  // each step on its own: one failing source (e.g. Google down) doesn't stop the others
  for (const s of steps) {
    try {
      if (s === 'trends') out.trends = await runCollect(cc, ['trends']);
      else if (s === 'collect') out.collect = await runCollect(cc, ['ads', 'gsc', 'site_search', 'keyword_planner']);
      else if (s === 'decide') out.decide = await runDecide(cc);
      else if (s === 'autopilot') out.autopilot = await runAutopilot(cc, { deadline });
      else if (s === 'improve') out.improve = await runImprove(cc);
    } catch (e) { out[`${s}Error`] = errText(e); }
  }
  if (runId) {
    try { out.report = await finishRun(cc, runId, startedAt, out); }
    catch (e) {
      out.reportError = errText(e);
      await seoDb(cc).update('seo_runs', `id=eq.${enc(runId)}`, { status: 'failed', error: errText(e), steps: out, finished_at: new Date().toISOString() }, { returning: 'minimal' }).catch(() => {});
    }
  } else out.report = { skipped: logNote || 'no run record' };
  return { runId, ...out };
}

async function finishRun(cc, runId, startedAt, steps) {
  const [changeRows, snapshot, prev] = await Promise.all([
    seoDb(cc).select('seo_changes', `select=action,path,before,after,reason,by,created_at,opportunity_id&country=eq.${cc}&created_at=gte.${enc(startedAt)}&order=created_at.asc&limit=1000`),
    takeSnapshot(cc),
    seoDb(cc).select('seo_runs', `select=snapshot&country=eq.${cc}&status=eq.done&id=neq.${enc(runId)}&order=started_at.desc&limit=1`),
  ]);
  const changes = displayChanges(changeRows);
  // Keywords this run acted on: where each came from (Keyword Planner, Google Ads, Search Console,
  // site search, AI assistants) and why it was added (lib/seo/reasons.js)
  try {
    const ids = [...new Set(changeRows.map((c) => c.opportunity_id).filter(Boolean))];
    const opps = ids.length ? await seoDb(cc).select('seo_opportunities', `select=id,type,term,url,evidence&id=in.(${ids.join(',')})&limit=1000`) : [];
    const { keywordsAdded } = await import('./reasons.js');
    snapshot.keywordsAdded = keywordsAdded(changeRows, new Map(opps.map((o) => [o.id, o])));
  } catch (e) { snapshot.notes = [...(snapshot.notes || []), `keywords added: ${errText(e)}`]; }
  // AI assistants this week (lib/aiVisibility): how often they name Casa-Libre, and the open gaps
  try {
    const { overview } = await import('../aiVisibility/run.js');
    const v = await overview(7);
    const mine = v.questions.filter((q) => q.country === cc);
    snapshot.aiVisibility = { mentionRate: v.mentionRate, answers: v.answers, byAssistant: v.byAssistant, gaps: mine.filter((q) => q.gap).map((q) => ({ question: q.question, ourRate: q.ourRate, compRate: q.compRate, keyword: q.keyword })), questions: mine.length };
  } catch { /* table not there yet */ }
  const comparison = compareSnapshots(snapshot, prev[0]?.snapshot || null);
  const { report, model } = await writeReport(cc, snapshot, comparison, changes);
  await seoDb(cc).update('seo_runs', `id=eq.${enc(runId)}`, {
    status: 'done', finished_at: new Date().toISOString(), steps, changes, snapshot, comparison, report, model,
  }, { returning: 'minimal' });
  return { status: report.status, model, changes: changes.length };
}

// ── the numbers at this run ──
async function gscTotals(property, start, end) {
  const j = await gscQuery(property, { startDate: start, endDate: end, type: 'web', dimensions: [], rowLimit: 1 });
  const r = (j.rows || [])[0] || {};
  return { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 };
}
const sumPages = (rows, paths) => {
  const t = { clicks: 0, impressions: 0, posW: 0 };
  for (const r of rows || []) if (paths.has(r.keys[0])) { t.clicks += r.clicks; t.impressions += r.impressions; t.posW += r.position * r.impressions; }
  return { clicks: t.clicks, impressions: t.impressions, ctr: t.impressions ? t.clicks / t.impressions : 0, position: t.impressions ? t.posW / t.impressions : 0 };
};

// The pages the pipeline added or changed (from what is live now).
async function pipelinePages(cc) {
  const [overrides, guides] = await Promise.all([
    seoDb(cc).select('seo_overrides', `select=path,title,enabled_variants,retired_variants,extra_links&country=eq.${cc}&limit=5000`),
    seoDb(cc).select('seo_drafts', `select=slug&country=eq.${cc}&status=eq.approved&limit=5000`),
  ]);
  const list = [];
  const counts = { variants: 0, retired: 0, guides: guides.length, titles: 0, linked: 0 };
  for (const o of overrides) {
    for (const v of o.enabled_variants || []) { list.push({ path: `${o.path}/${v}`, kind: 'added page' }); counts.variants++; }
    counts.retired += (o.retired_variants || []).length;
    if (o.title) { list.push({ path: o.path, kind: 'new title' }); counts.titles++; }
    if ((o.extra_links || []).length) { if (!o.title) list.push({ path: o.path, kind: 'extra links' }); counts.linked++; }
  }
  for (const g of guides) list.push({ path: `/guias/${g.slug}`, kind: 'guide' });
  return { list, counts };
}

async function visitsByPath(cc) {
  if (!posthogConfigured()) return new Map();
  const rows = await hogql(`SELECT session.$entry_pathname AS p,
      uniqIf(properties.$session_id, timestamp > now() - INTERVAL 7 DAY) AS cur,
      uniqIf(properties.$session_id, timestamp <= now() - INTERVAL 7 DAY) AS prev,
      countIf(${CONTACT_IN} AND timestamp > now() - INTERVAL 7 DAY) AS contacts
    FROM events WHERE timestamp > now() - INTERVAL 14 DAY AND ${GEO_BASE}${siteClause(cc)}
      AND (session.$entry_pathname LIKE '/venta/%' OR session.$entry_pathname LIKE '/alquiler/%' OR session.$entry_pathname LIKE '/guias/%')
    GROUP BY p ORDER BY cur DESC LIMIT 2000`);
  const m = new Map();
  for (const r of rows) { const [p, cur, prev, contacts] = Array.isArray(r) ? r : Object.values(r); const k = String(p || '').replace(/\/+$/, ''); if (k) m.set(k, { visits: Number(cur) || 0, prevVisits: Number(prev) || 0, contacts: Number(contacts) || 0 }); }
  return m;
}

export async function takeSnapshot(cc) {
  const end = daysAgo(2); const start = daysAgo(8); const prevEnd = daysAgo(9); const prevStart = daysAgo(15);
  const snap = { window: { start, end, prevStart, prevEnd }, notes: [] };
  // Google indexing: every page the pipeline added in the last 14 days + a random sitemap sample
  // (URL Inspection API; at most ~60 s, side by side with the steps below)
  const indexingP = (async () => {
    const since = new Date(Date.now() - NEW_PAGE_DAYS * 86400000).toISOString();
    const ch = await seoDb(cc).select('seo_changes', `select=action,path,before,after,created_at,reverted_at&country=eq.${cc}&action=in.(enable_variant,publish_guide)&created_at=gte.${enc(since)}&order=created_at.desc&limit=500`);
    const newPages = recentPipelinePages(ch);
    const r = await indexingCheck(cc, { sample: 30, newPages });
    if (!r.access) throw new Error('no Search Console access for this country');
    return summarizeIndexing({ ...r, newPages });
  })();
  indexingP.catch(() => {});
  const note = (where, e) => snap.notes.push(`${where}: ${errText(e)}`);
  const { list, counts } = await pipelinePages(cc).catch((e) => { note('pipeline pages', e); return { list: [], counts: {} }; });
  snap.pages = counts;
  const paths = new Set(list.map((p) => p.path));
  let curPages = []; let prevPages = [];
  try {
    const site = await gscSiteFor(cc);
    if (!site) throw new Error('no Search Console access for this country');
    const [cur, prev, curQ, prevQ, cp, pp] = await Promise.all([
      gscTotals(site.property, start, end), gscTotals(site.property, prevStart, prevEnd),
      gscQuery(site.property, { startDate: start, endDate: end, type: 'web', dimensions: ['query'], rowLimit: 250 }),
      gscQuery(site.property, { startDate: prevStart, endDate: prevEnd, type: 'web', dimensions: ['query'], rowLimit: 1000 }),
      gscPages(cc, start, end), gscPages(cc, prevStart, prevEnd),
    ]);
    snap.site = { cur, prev };
    curPages = cp || []; prevPages = pp || [];
    const prevBy = new Map((prevQ.rows || []).map((r) => [r.keys[0], r]));
    snap.keywords = (curQ.rows || []).sort((a, b) => b.impressions - a.impressions).slice(0, 25).map((r) => {
      const p = prevBy.get(r.keys[0]);
      return { query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10, prevPosition: p ? Math.round(p.position * 10) / 10 : null, prevClicks: p ? p.clicks : null };
    });
  } catch (e) { note('Search Console', e); snap.site = { cur: {}, prev: {} }; snap.keywords = []; }
  snap.pipeline = { cur: sumPages(curPages, paths), prev: sumPages(prevPages, paths) };
  const visits = await visitsByPath(cc).catch((e) => { note('PostHog', e); return new Map(); });
  const curBy = new Map(curPages.map((r) => [r.keys[0], r]));
  const prevBy = new Map(prevPages.map((r) => [r.keys[0], r]));
  snap.pageResults = list.map((p) => {
    const c = curBy.get(p.path); const v = prevBy.get(p.path); const ph = visits.get(p.path) || {};
    return { path: p.path, kind: p.kind, clicks: c?.clicks || 0, impressions: c?.impressions || 0, position: c ? Math.round(c.position * 10) / 10 : null,
      prevClicks: v?.clicks || 0, prevImpressions: v?.impressions || 0, visits: ph.visits || 0, prevVisits: ph.prevVisits || 0, contacts: ph.contacts || 0 };
  }).sort((a, b) => (b.impressions + b.visits * 10) - (a.impressions + a.visits * 10)).slice(0, 300);
  try {
    const [latest] = await seoDb(cc).select('seo_signals', `select=date&country=eq.${cc}&source=eq.ads&order=date.desc&limit=1`);
    const ads = latest ? await seoDb(cc).select('seo_signals', `select=term,metrics&country=eq.${cc}&source=eq.ads&date=eq.${latest.date}&limit=5000`) : [];
    snap.adsTerms = ads.map((r) => ({ term: r.term, clicks: r.metrics?.clicks || 0, conversions: r.metrics?.conversions || 0, cost: r.metrics?.cost || 0 }))
      .sort((a, b) => b.clicks - a.clicks).slice(0, 15);
  } catch (e) { note('Ads terms', e); snap.adsTerms = []; }
  // Google indexing (started at the top, runs alongside the rest)
  try { snap.indexing = await indexingP; } catch (e) { note('Indexing', e); snap.indexing = null; }
  try {
    const open = await seoDb(cc).select('seo_opportunities', `select=type&country=eq.${cc}&status=eq.open&limit=5000`);
    snap.opportunities = { open: open.length, byType: open.reduce((a, o) => ({ ...a, [o.type]: (a[o.type] || 0) + 1 }), {}) };
  } catch (e) { note('opportunities', e); snap.opportunities = { open: 0, byType: {} }; }
  try {
    const tr = await seoDb(cc).select('seo_trends', `select=title&geo=eq.${cc.toUpperCase()}&order=seen_at.desc&limit=30`);
    snap.trends = [...new Set(tr.map((t) => t.title))].slice(0, 10);
  } catch { snap.trends = []; }
  return snap;
}

// ── the report: Claude (else the numbers) ──
const parseJson = (text) => { const m = /\{[\s\S]*\}/.exec(String(text || '')); return m ? JSON.parse(m[0]) : null; };

async function withClaude(cc, user) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('no ANTHROPIC_API_KEY');
  const client = await claudeClient({ feature: 'seo_report', country: cc }, { timeout: 90000, maxRetries: 0 });
  const msg = await client.messages.create({ model: REPORT_MODEL, max_tokens: 8000, system: REPORT_SYSTEM, messages: [{ role: 'user', content: user }] });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let json = null;
  try { json = parseJson(text); } catch { json = null; }
  if (!json) throw new Error(`no report in Claude's answer (stop: ${msg.stop_reason || '?'}, ${text.length} chars)`);
  return { json, model: msg.model || REPORT_MODEL };
}

export async function writeReport(cc, snapshot, comparison, changes) {
  const draft = dataReport(snapshot, comparison, changes);
  const user = reportPrompt(snapshot, comparison, changes, draft);
  // Claude only (decided Nov 18, 2026: no Groq). If Claude can't answer, the run still keeps the
  // report written from the numbers, with Claude's error so the tab can say why.
  let why = '';
  try {
    const { json, model } = await withClaude(cc, user);
    return { report: { ...cleanReport(json, draft), writtenBy: model }, model };
  } catch (e) {
    const m = errText(e);
    why = /credit balance/i.test(m) ? 'Claude unavailable: the Anthropic account has no credit (Plans & Billing)' : `Claude unavailable: ${m.slice(0, 160)}`;
  }
  return { report: { ...draft, writtenBy: 'numbers', aiNote: why }, model: 'numbers' };
}

// ── for the AI SEO tab ──
export async function listRuns(cc, limit = 60) {
  const rows = await seoDb(cc).select('seo_runs', `select=id,trigger,status,started_at,finished_at,model,error,report,changes,comparison&country=eq.${cc}&order=started_at.desc&limit=${limit}`);
  return rows.map((r) => ({
    id: r.id, trigger: r.trigger, status: r.status, started_at: r.started_at, finished_at: r.finished_at, model: r.model, error: r.error,
    report_status: r.report?.status || null, headline: r.report?.headline || null,
    changes: (r.changes || []).map((c) => ({ action: c.action })), site: r.comparison?.weekOnWeek?.site || null,
  }));
}
export async function getRun(cc, id) {
  const [r] = await seoDb(cc).select('seo_runs', `select=*&country=eq.${cc}&id=eq.${enc(id)}&limit=1`);
  return r || null;
}
export async function runningRun(cc) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const [r] = await seoDb(cc).select('seo_runs', `select=id,started_at&country=eq.${cc}&status=eq.running&started_at=gte.${enc(since)}&limit=1`);
  return r || null;
}
