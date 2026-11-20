// AI SEO for the sites — every pipeline run of a site, recorded in seo_runs (PY DB, country 'site:<key>')
// exactly like the buyer runs (lib/seo/runLog.js): steps, changes, snapshot, comparison, report.
// runSitePipeline(key) is the ONE entry point: the daily cron (/api/cron/seo-sites) and "Run now"
// (Admin Manager → AI SEO, /api/manager/seo?site=<key>). The run opens a publish batch: every change only
// queues its path, and ONE ping goes to the site at the end (POST <siteUrl>/api/seo/publish).
// Report: Claude only (lib/seo/report.js facts + draft); if Claude can't answer, the numbers. Server-only.
import 'server-only';
import { seoDb, isMissingTable } from '../seo/store.js';
import { claudeClient } from '../aiTrack.js';
import { compareSnapshots, dataReport, cleanReport, reportPrompt, displayChanges } from '../seo/report.js';
import { TREND_GEOS } from '../seo/trends.js';
import { scopeOf, siteFor, guidePath } from './scope.js';
import { runCollect, runDecide, runAutopilot, runImprove, gscPages, siteGsc, noGscAccess, siteVisits } from './run.js';
import { startBatch, flushBatch } from './remote.js';

const enc = encodeURIComponent;
const day = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => day(new Date(Date.now() - n * 86400000));
const errText = (e) => String(e?.message || e).slice(0, 300);
export const SITE_REPORT_MODEL = process.env.SEO_REPORT_MODEL || 'claude-opus-5-5';
export const STEPS = ['trends', 'collect', 'decide', 'autopilot', 'improve'];

const active = new Set();
export const isRunning = (key) => active.has(key);

export async function runSitePipeline(key, opts = {}) {
  const site = siteFor(key);
  if (!site) return { error: 'unknown site' };
  if (active.has(site.key)) return { skipped: 'a run is already in progress for this site' };
  active.add(site.key);
  try { return await inner(site, opts); } finally { active.delete(site.key); }
}

async function inner(site, { trigger = 'cron', by = null, deadline = Date.now() + 120000, steps = STEPS, record = true } = {}) {
  const scope = scopeOf(site.key);
  if (record) { try { if (await runningRun(site.key)) return { skipped: 'a run is already in progress for this site' }; } catch { /* no table yet */ } }
  const startedAt = new Date().toISOString();
  let runId = null;
  let logNote = record ? null : 'single stage (not recorded)';
  if (record) try {
    const [row] = await seoDb(scope).insert('seo_runs', [{ country: scope, trigger, status: 'running', started_at: startedAt, created_by: by }]);
    runId = row?.id || null;
  } catch (e) { logNote = isMissingTable(e) ? 'run migrations/012_seo_runs.sql to keep run reports' : `run record: ${errText(e)}`; }
  const out = {};
  startBatch(site.key);
  try {
    for (const s of steps) {
      try {
        if (s === 'trends') out.trends = await runCollect(site.key, ['trends']);
        else if (s === 'collect') out.collect = await runCollect(site.key, ['ads', 'gsc', 'site_search', 'keyword_planner']);
        else if (s === 'decide') out.decide = await runDecide(site.key);
        else if (s === 'autopilot') out.autopilot = await runAutopilot(site.key, { deadline });
        else if (s === 'improve') out.improve = await runImprove(site.key);
      } catch (e) { out[`${s}Error`] = errText(e); }
    }
  } finally {
    // one ping per site per run (a full run pings even with no change: the site refreshes its feed copy)
    out.publish = await flushBatch(site.key, { always: record }).catch((e) => ({ ok: false, error: errText(e) }));
  }
  if (runId) {
    try { out.report = await finishRun(site, runId, startedAt, out); }
    catch (e) {
      out.reportError = errText(e);
      await seoDb(scope).update('seo_runs', `id=eq.${enc(runId)}`, { status: 'failed', error: errText(e), steps: out, finished_at: new Date().toISOString() }, { returning: 'minimal' }).catch(() => {});
    }
  } else out.report = { skipped: logNote || 'no run record' };
  return { runId, ...out };
}

async function finishRun(site, runId, startedAt, steps) {
  const scope = scopeOf(site.key); const q = enc(scope);
  const [changeRows, snapshot, prev] = await Promise.all([
    seoDb(scope).select('seo_changes', `select=action,path,before,after,reason,by,created_at&country=eq.${q}&created_at=gte.${enc(startedAt)}&order=created_at.asc&limit=1000`),
    takeSnapshot(site),
    seoDb(scope).select('seo_runs', `select=snapshot&country=eq.${q}&status=eq.done&id=neq.${enc(runId)}&order=started_at.desc&limit=1`),
  ]);
  const changes = displayChanges(changeRows);
  const comparison = compareSnapshots(snapshot, prev[0]?.snapshot || null);
  const { report, model } = await writeReport(site, snapshot, comparison, changes);
  await seoDb(scope).update('seo_runs', `id=eq.${enc(runId)}`, { status: 'done', finished_at: new Date().toISOString(), steps, changes, snapshot, comparison, report, model }, { returning: 'minimal' });
  return { status: report.status, model, changes: changes.length };
}

// ── the numbers at this run ──
async function gscTotals(site, start, end) {
  const j = await siteGsc(site, { startDate: start, endDate: end, type: 'web', dimensions: [], rowLimit: 1 });
  const r = (j.rows || [])[0] || {};
  return { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 };
}
const sumPages = (rows, paths) => {
  const t = { clicks: 0, impressions: 0, posW: 0 };
  for (const r of rows || []) if (paths.has(r.keys[0])) { t.clicks += r.clicks; t.impressions += r.impressions; t.posW += r.position * r.impressions; }
  return { clicks: t.clicks, impressions: t.impressions, ctr: t.impressions ? t.clicks / t.impressions : 0, position: t.impressions ? t.posW / t.impressions : 0 };
};

async function pipelinePages(site) {
  const q = enc(scopeOf(site.key));
  const [overrides, guides] = await Promise.all([
    seoDb('py').select('seo_overrides', `select=path,title,extra_links&country=eq.${q}&limit=5000`),
    seoDb('py').select('seo_drafts', `select=slug,related&country=eq.${q}&status=eq.approved&limit=5000`),
  ]);
  const list = []; const counts = { variants: 0, retired: 0, guides: guides.length, titles: 0, linked: 0 };
  for (const o of overrides) {
    if (o.title) { list.push({ path: o.path, kind: 'new title' }); counts.titles++; }
    if ((o.extra_links || []).length) { if (!o.title) list.push({ path: o.path, kind: 'extra links' }); counts.linked++; }
  }
  for (const g of guides) list.push({ path: guidePath(site, g.related?.cc, g.slug), kind: 'guide' });
  return { list, counts };
}

export async function takeSnapshot(site) {
  const scope = scopeOf(site.key); const q = enc(scope);
  const end = daysAgo(2); const start = daysAgo(8); const prevEnd = daysAgo(9); const prevStart = daysAgo(15);
  const snap = { window: { start, end, prevStart, prevEnd }, site_domain: site.domain, notes: [] };
  const note = (where, e) => snap.notes.push(`${where}: ${errText(e)}`);
  const { list, counts } = await pipelinePages(site).catch((e) => { note('pipeline pages', e); return { list: [], counts: {} }; });
  snap.pages = counts;
  const paths = new Set(list.map((p) => p.path));
  let curPages = []; let prevPages = [];
  try {
    const [cur, prev, curQ, prevQ, cp, pp] = await Promise.all([
      gscTotals(site, start, end), gscTotals(site, prevStart, prevEnd),
      siteGsc(site, { startDate: start, endDate: end, type: 'web', dimensions: ['query'], rowLimit: 250 }),
      siteGsc(site, { startDate: prevStart, endDate: prevEnd, type: 'web', dimensions: ['query'], rowLimit: 1000 }),
      gscPages(site, start, end), gscPages(site, prevStart, prevEnd),
    ]);
    snap.site = { cur, prev };
    curPages = cp || []; prevPages = pp || [];
    const prevBy = new Map((prevQ.rows || []).map((r) => [r.keys[0], r]));
    snap.keywords = (curQ.rows || []).sort((a, b) => b.impressions - a.impressions).slice(0, 25).map((r) => {
      const p = prevBy.get(r.keys[0]);
      return { query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10, prevPosition: p ? Math.round(p.position * 10) / 10 : null, prevClicks: p ? p.clicks : null };
    });
  } catch (e) {
    note('Search Console', noGscAccess(e) ? new Error('no Search Console access for this site') : e);
    snap.site = { cur: {}, prev: {} }; snap.keywords = [];
  }
  snap.pipeline = { cur: sumPages(curPages, paths), prev: sumPages(prevPages, paths) };
  const visits = await siteVisits(site).catch((e) => { note('PostHog', e); return new Map(); });
  const curBy = new Map(curPages.map((r) => [r.keys[0], r]));
  const prevBy = new Map(prevPages.map((r) => [r.keys[0], r]));
  snap.pageResults = list.map((p) => {
    const c = curBy.get(p.path); const v = prevBy.get(p.path); const ph = visits.get(p.path) || {};
    return { path: p.path, kind: p.kind, clicks: c?.clicks || 0, impressions: c?.impressions || 0, position: c ? Math.round(c.position * 10) / 10 : null,
      prevClicks: v?.clicks || 0, prevImpressions: v?.impressions || 0, visits: ph.visits || 0, prevVisits: ph.prevVisits || 0, contacts: 0 };
  }).sort((a, b) => (b.impressions + b.visits * 10) - (a.impressions + a.visits * 10)).slice(0, 300);
  try {
    const [latest] = await seoDb('py').select('seo_signals', `select=date&country=eq.${q}&source=eq.ads&order=date.desc&limit=1`);
    const ads = latest ? await seoDb('py').select('seo_signals', `select=term,metrics&country=eq.${q}&source=eq.ads&date=eq.${latest.date}&limit=5000`) : [];
    snap.adsTerms = ads.map((r) => ({ term: r.term, clicks: r.metrics?.clicks || 0, conversions: r.metrics?.conversions || 0, cost: r.metrics?.cost || 0 })).sort((a, b) => b.clicks - a.clicks).slice(0, 15);
  } catch (e) { note('Ads terms', e); snap.adsTerms = []; }
  try {
    const open = await seoDb('py').select('seo_opportunities', `select=type&country=eq.${q}&status=eq.open&limit=5000`);
    snap.opportunities = { open: open.length, byType: open.reduce((a, o) => ({ ...a, [o.type]: (a[o.type] || 0) + 1 }), {}) };
  } catch (e) { note('opportunities', e); snap.opportunities = { open: 0, byType: {} }; }
  try {
    const tr = await seoDb('py').select('seo_trends', `select=title&geo=in.(${site.countries.map((c) => TREND_GEOS[c]).join(',')})&topic=eq.property&order=seen_at.desc&limit=30`);
    snap.trends = [...new Set(tr.map((t) => t.title))].slice(0, 10);
  } catch { snap.trends = []; }
  return snap;
}

// ── the report ──
const SITE_REPORT_SYSTEM = `You are the SEO analyst for a guide website that sends readers to Casa-Libre (a property marketplace). You get the facts of one run of the site's automatic SEO pipeline (guides it wrote and published, titles and internal links it changed, Google Search Console numbers of the site, keywords, page results, comparison with the previous run) and a draft report written from those numbers.
Write the report in plain English for the founders: short, concrete, no hype, no SEO jargon without explanation.
Rules: use ONLY numbers present in the facts; never invent figures, causes or competitors. If data is thin (new site, new guides, few impressions, no Search Console access), say so plainly — new guides need 2–4 weeks.
Timing matters: the Google numbers cover the 7 days BEFORE this run, so this run's changes cannot have caused them. Never say a change from this run improved or hurt anything; say what it is meant to do and that the next runs will show the effect.
"pages" are totals live now (from all runs); "changesThisRun" is only this run. "notes" list data that could not be read.
Keep it short: at most 6 items per list, one sentence each. Return ONLY JSON (no text before or after): {"status": "improving"|"steady"|"declining"|"starting", "headline": str (one sentence), "summary": [str] (2-4 short paragraphs), "whatChanged": [str], "keywords": [str], "wins": [str], "problems": [str], "next": [str]}`;

/** dataReport() speaks of the buyer site's filter pages: adapt its wording to a guide site. */
export function siteDataReport(snap, cmp, changes) {
  const d = dataReport(snap, cmp, changes);
  const guides = changes.filter((c) => c.action === 'publish_guide').length;
  const edited = changes.filter((c) => ['set_title', 'add_links'].includes(c.action)).length;
  if (d.status !== 'starting') d.headline = d.headline.replace(/this run added \d+ pages and (\d+) guides and edited (\d+)\./, `this run published ${guides} guides and edited ${edited} pages.`);
  d.summary = d.summary.map((s) => s.replace(/Live from the pipeline: \d+ added pages, /, 'Live from the pipeline: '));
  d.next = d.next.map((s) => (/No pipeline pages live yet/.test(s) ? 'No pipeline guides live yet: they are written when a relevant search shows demand and no guide of the site covers it.' : s));
  if ((snap.notes || []).length) d.problems.push(...snap.notes.slice(0, 3));
  return d;
}

export async function writeReport(site, snapshot, comparison, changes) {
  const draft = siteDataReport(snapshot, comparison, changes);
  const user = JSON.stringify({ site: site.domain, kind: site.kind, notes: snapshot.notes || [], facts: JSON.parse(reportPrompt(snapshot, comparison, changes, draft)) });
  let why = '';
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('no ANTHROPIC_API_KEY');
    const client = await claudeClient({ feature: 'seo_site_report', country: 'py' }, { timeout: 90000, maxRetries: 0 });
    const msg = await client.messages.create({ model: SITE_REPORT_MODEL, max_tokens: 8000, system: SITE_REPORT_SYSTEM, messages: [{ role: 'user', content: user }] });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const m = /\{[\s\S]*\}/.exec(text);
    let json = null;
    try { json = m ? JSON.parse(m[0]) : null; } catch { json = null; }
    if (!json) throw new Error(`no report in Claude's answer (stop: ${msg.stop_reason || '?'}, ${text.length} chars)`);
    const model = msg.model || SITE_REPORT_MODEL;
    return { report: { ...cleanReport(json, draft), writtenBy: model }, model };
  } catch (e) {
    const m = errText(e);
    why = /credit balance/i.test(m) ? 'Claude unavailable: the Anthropic account has no credit (Plans & Billing)' : `Claude unavailable: ${m.slice(0, 160)}`;
  }
  return { report: { ...draft, writtenBy: 'numbers', aiNote: why }, model: 'numbers' };
}

// ── for Admin Manager → AI SEO (funnel sites + hub) ──
export async function listRuns(key, limit = 60) {
  const q = enc(scopeOf(key));
  const rows = await seoDb('py').select('seo_runs', `select=id,trigger,status,started_at,finished_at,model,error,report,changes,comparison&country=eq.${q}&order=started_at.desc&limit=${limit}`);
  return rows.map((r) => ({
    id: r.id, trigger: r.trigger, status: r.status, started_at: r.started_at, finished_at: r.finished_at, model: r.model, error: r.error,
    report_status: r.report?.status || null, headline: r.report?.headline || null,
    changes: (r.changes || []).map((c) => ({ action: c.action })), site: r.comparison?.weekOnWeek?.site || null,
  }));
}
export async function getRun(key, id) {
  const [r] = await seoDb('py').select('seo_runs', `select=*&country=eq.${enc(scopeOf(key))}&id=eq.${enc(id)}&limit=1`);
  return r || null;
}
export async function runningRun(key) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const [r] = await seoDb('py').select('seo_runs', `select=id,started_at&country=eq.${enc(scopeOf(key))}&status=eq.running&started_at=gte.${enc(since)}&limit=1`);
  return r || null;
}
