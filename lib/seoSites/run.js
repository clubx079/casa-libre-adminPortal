// AI SEO for the sites — the stage runners for ONE site (mirror of lib/seo/run.js). Rows: PY DB,
// country = 'site:<key>'. Settings: seo_settings row 'site:<key>' (DEFAULT_SETTINGS + caps). Server-only.
//   runCollect(key, only)   stage 1: gsc (sc-domain:<domain>, query×page, 28 days ending 2 days ago),
//                           ads (PY sites + the hub: Casa-Libre's Google Ads search terms relevant to the site),
//                           trends (shared seo_trends, geos of the site's countries), keyword_planner (stub)
//   runDecide(key)          stages 2–3 → seo_opportunities (coverage vs the site's catalog + drafts)
//   runAutopilot(key)       stages 4–6: guides written + published, links added, within the daily caps
//   runImprove(key)         stage 8: titles for low CTR, links for slipping guides
//   watch(key)              stage 7: per page Search Console numbers (+ PostHog visits when configured)
import 'server-only';
import { seoDb, getOverrides, loadSettings } from '../seo/store.js';
import { adsSearch, gscQuery, googleSetup } from '../googleApi';
import { periods } from '../searchConsole';
import { parseTrendsRss, topicOf, TREND_GEOS, seenHour } from '../seo/trends.js';
import { hogql, posthogConfigured } from '../posthogHogql';
import { scopeOf, siteFor, gscBody } from './scope.js';
import { FUNNEL_SITE_LIST as SITE_LIST } from '../funnelSites.js';
import { isRelevant, isQuestionOrTopic, isHubTopic } from './relevance.js';
import { decideSite, improveSite, knownGuides } from './decide.js';
import { fetchCatalog, startBatch, flushBatch, hasBatch } from './remote.js';
import { applyOpportunity, approveGuide, setTitle, addLinks } from './actions.js';

const enc = encodeURIComponent;
const day = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => day(new Date(Date.now() - n * 86400000));
const today = () => day(new Date());
const nowIso = () => new Date().toISOString();
const errText = (e) => String(e?.message || e).slice(0, 300);
const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return String(u || '').replace(/\/+$/, '') || '/'; } };
const ctxOf = (key) => { const site = siteFor(key); if (!site) throw Object.assign(new Error('unknown site'), { status: 400 }); return { site, scope: scopeOf(site.key), q: enc(scopeOf(site.key)) }; };
export const gscProperty = (site) => `sc-domain:${site.domain}`;
/** A Search Console query of the site (the hub: its own host only, never the country subdomains). */
export const siteGsc = (site, body) => gscQuery(gscProperty(site), gscBody(site, body));
export const noGscAccess = (e) => /permission|sufficient|not (?:a )?verified|forbidden|403|does not have|not.*owner/i.test(String(e?.message || e));

async function store(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) await seoDb('py').insert(table, rows.slice(i, i + 500), { upsert: true, onConflict, returning: 'minimal' });
  return rows.length;
}

// ── stage 1: collect ──
async function collectGsc(site, scope) {
  const p = periods(28);
  let j;
  try { j = await siteGsc(site, { startDate: p.start, endDate: p.end, type: 'web', dimensions: ['query', 'page'], rowLimit: 2500 }); }
  catch (e) { if (noGscAccess(e)) return { source: 'gsc', skipped: 'no Search Console access for this site' }; throw e; }
  const date = today();
  const uniq = new Map();
  for (const r of j.rows || []) {
    const term = String(r.keys[0] || '').trim();
    if (!term) continue;
    const row = { country: scope, source: 'gsc', term, page: pathOf(r.keys[1]), date, collected_at: nowIso(),
      metrics: { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: Math.round((r.ctr || 0) * 10000) / 10000, position: Math.round((r.position || 0) * 10) / 10, window_days: 28, start: p.start, end: p.end, property: gscProperty(site) } };
    const k = `${row.term}|${row.page}`;
    const prev = uniq.get(k);
    if (!prev || prev.metrics.impressions < row.metrics.impressions) uniq.set(k, row);
  }
  return { source: 'gsc', property: gscProperty(site), stored: await store('seo_signals', [...uniq.values()], 'country,source,term,page,date') };
}

// Casa-Libre's one Ads account advertises Paraguay: the same search terms the buyer pipeline reads, fetched
// once per 10 minutes for all the PY sites, and only the ones relevant to the site are kept.
const adsCache = (globalThis.__seoSiteAds ||= { at: 0, terms: null });
async function adsTerms() {
  if (adsCache.terms && Date.now() - adsCache.at < 10 * 60_000) return adsCache.terms;
  const j = await adsSearch(`SELECT search_term_view.search_term, metrics.clicks, metrics.impressions, metrics.conversions, metrics.cost_micros
    FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0 ORDER BY metrics.impressions DESC LIMIT 2000`);
  const by = new Map();
  for (const r of j.results || []) {
    const term = String(r.searchTermView?.searchTerm || '').trim();
    if (!term) continue;
    const m = by.get(term) || { clicks: 0, impressions: 0, conversions: 0, cost: 0 };
    m.clicks += Number(r.metrics?.clicks) || 0; m.impressions += Number(r.metrics?.impressions) || 0;
    m.conversions += Number(r.metrics?.conversions) || 0; m.cost += (Number(r.metrics?.costMicros) || 0) / 1e6;
    by.set(term, m);
  }
  adsCache.terms = by; adsCache.at = Date.now();
  return by;
}
async function collectAds(site, scope) {
  if (!site.countries.includes('py') || site.rootCountry !== 'py') return { source: 'ads', skipped: 'Google Ads advertises Paraguay only' };
  const s = googleSetup();
  if (!s.refreshToken || !s.developerToken) return { source: 'ads', skipped: 'Google not connected' };
  const by = await adsTerms();
  const date = today();
  const rows = [...by.entries()].filter(([term]) => isRelevant(term, site.kind, site.key)).map(([term, m]) => ({ country: scope, source: 'ads', term, page: '', date, collected_at: nowIso(),
    metrics: { clicks: m.clicks, impressions: m.impressions, conversions: Math.round(m.conversions * 100) / 100, cost: Math.round(m.cost * 100) / 100, window_days: 30, currency: 'USD' } }));
  return { source: 'ads', terms: by.size, relevant: rows.length, stored: await store('seo_signals', rows, 'country,source,term,page,date') };
}

// Google Trends: shared with the buyer pipeline (seo_trends has no country, only geo) — stored in the PY DB.
async function collectTrends(site) {
  const out = { source: 'trends', geos: {} };
  for (const cc of site.countries) {
    const geo = TREND_GEOS[cc];
    try {
      const r = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, { cache: 'no-store', headers: { 'user-agent': 'Mozilla/5.0 (compatible; seo-pipeline)' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`Trends RSS ${r.status}`);
      const hour = seenHour();
      const rows = parseTrendsRss(await r.text()).map((it) => ({ geo, title: it.title.slice(0, 200), traffic: it.traffic, traffic_label: it.trafficLabel, news: it.news.slice(0, 5),
        topic: topicOf(it.title, it.news.map((n) => n.title)), pub_date: it.pubDate, seen_hour: hour, seen_at: nowIso() }));
      out.geos[geo] = await store('seo_trends', rows, 'geo,title,seen_hour');
    } catch (e) { out.geos[geo] = `error: ${errText(e)}`; }
  }
  return out;
}

const COLLECTORS = {
  ads: collectAds, gsc: collectGsc, trends: collectTrends,
  site_search: async () => ({ source: 'site_search', skipped: 'not applicable for the SEO sites (no search box)' }),
  keyword_planner: collectKeywordPlanner,
};

// Keyword Planner: the country pipelines read Google's monthly volumes once a week (lib/seo/collect.js);
// each site takes the latest reading of its countries and keeps only the searches that fit it (owners,
// agents, library, hub topics) and could be a guide. No extra calls to Google. Competitor names never.
async function collectKeywordPlanner(site, scope) {
  const { namesCompetitor } = await import('../aiVisibility/core.js');
  const date = today();
  const rows = []; const per = {};
  for (const cc of site.countries) {
    const db = seoDb(cc);
    const [last] = await db.select('seo_signals', `select=date&country=eq.${cc}&source=eq.keyword_planner&order=date.desc&limit=1`).catch(() => []);
    if (!last) { per[cc] = 'no reading yet'; continue; }
    const kp = await db.select('seo_signals', `select=term,metrics&country=eq.${cc}&source=eq.keyword_planner&date=eq.${last.date}&limit=2000`).catch(() => []);
    const fit = kp.filter((r) => !namesCompetitor(r.term) && isRelevant(r.term, site.kind, site.key) && (site.kind === 'hub' ? isHubTopic(r.term) : isQuestionOrTopic(r.term)));
    per[cc] = `${fit.length} of ${kp.length} (read ${last.date})`;
    for (const r of fit) rows.push({ country: scope, source: 'keyword_planner', term: r.term, page: '', date, collected_at: nowIso(), metrics: { ...r.metrics, from_country: cc } });
  }
  const uniq = [...new Map(rows.map((r) => [r.term, r])).values()];
  return { source: 'keyword_planner', countries: per, stored: uniq.length ? await store('seo_signals', uniq, 'country,source,term,page,date') : 0 };
}

export async function runCollect(key, only = null) {
  const { site, scope } = ctxOf(key);
  const settings = await loadSettings(scope);
  const out = [];
  for (const [name, fn] of Object.entries(COLLECTORS)) {
    if (only && !only.includes(name)) continue;
    if (settings.collect && settings.collect[name] === false) { out.push({ source: name, skipped: 'switched off in Settings' }); continue; }
    let res;
    for (let i = 0; i < 3; i += 1) {
      try { res = await fn(site, scope); break; } catch (e) {
        res = { source: name, error: errText(e) };
        if (!/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|timeout/i.test(`${e?.message} ${e?.cause?.code || ''}`)) break;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    out.push(res);
  }
  return out;
}

// ── stage 3: decide ──
export async function latestSignals(scope) {
  const q = enc(scope);
  const rows = [];
  for (let off = 0; off < 50000; off += 1000) {
    // 9 days: the weekly Keyword Planner reading stays in view until the next one
    const page = await seoDb('py').select('seo_signals', `select=source,term,page,date,metrics&country=eq.${q}&date=gte.${daysAgo(9)}&order=id.asc&limit=1000&offset=${off}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  // + the AI-assistant gaps of the site's countries (lib/aiVisibility; the site's relevance filter applies at Decide)
  try {
    const site = siteFor(String(scope).replace(/^site:/, ''));
    const { signalsFor } = await import('../aiVisibility/run.js');
    for (const cc of site?.countries || []) rows.push(...await signalsFor(cc));
  } catch { /* none yet */ }
  return rows;
}

const DECIDE_TYPES = ['strengthen_page', 'write_guide', 'trend_post'];
export async function runDecide(key) {
  const { site, scope, q } = ctxOf(key);
  const settings = await loadSettings(scope);
  if (!settings.decide) return { skipped: 'Decide is switched off in Settings' };
  const geos = site.countries.map((cc) => TREND_GEOS[cc]).join(',');
  const [signals, catalog, drafts, trends] = await Promise.all([
    latestSignals(scope),
    fetchCatalog(site.key, { fresh: true }),
    seoDb('py').select('seo_drafts', `select=slug,title,h1,status,related&country=eq.${q}&limit=5000`),
    seoDb('py').select('seo_trends', `select=geo,title,traffic,traffic_label,news,topic,pub_date,seen_at&geo=in.(${geos})&seen_at=gte.${enc(new Date(Date.now() - settings.thresholds.trendHours * 3600000).toISOString())}&limit=2000`),
  ]);
  // the other sites of the same kind sharing a country: a topic they already wrote is not written again
  const peers = SITE_LIST.filter((s) => s.key !== site.key && s.kind === site.kind && s.countries.some((c) => site.countries.includes(c)));
  const otherDrafts = peers.length ? await seoDb('py').select('seo_drafts', `select=term,title,related,status&country=in.(${peers.map((s) => `"site:${s.key}"`).join(',')})&status=neq.rejected&limit=5000`).catch(() => []) : [];
  const opps = decideSite({ site, signals, catalog: catalog.guides, drafts, otherDrafts, trends, settings });
  const at = nowIso();
  const rows = opps.map((o) => ({ country: scope, key: o.key, type: o.type, term: o.term, url: o.url, parsed: o.parsed, score: o.score, evidence: o.evidence, updated_at: at }));
  for (let i = 0; i < rows.length; i += 300) await seoDb('py').insert('seo_opportunities', rows.slice(i, i + 300), { upsert: true, onConflict: 'country,key', returning: 'minimal' });
  const keep = new Set(opps.map((o) => o.key));
  const open = await seoDb('py').select('seo_opportunities', `select=id,key,type,evidence&country=eq.${q}&status=eq.open&limit=5000`);
  const stale = open.filter((o) => DECIDE_TYPES.includes(o.type) && !o.evidence?.reason && !keep.has(o.key));
  for (const o of stale) await seoDb('py').remove('seo_opportunities', `id=eq.${o.id}`);
  return {
    signals: signals.length, opportunities: opps.length, byType: opps.reduce((a, o) => ({ ...a, [o.type]: (a[o.type] || 0) + 1 }), {}), removedStale: stale.length,
    catalog: catalog.ok ? catalog.guides.length : 0,
    note: catalog.ok ? null : `${catalog.error}: coverage judged from ${catalog.stale ? 'the last good catalog copy and ' : ''}the pipeline's own guides only`,
  };
}

// ── stages 4–6: autopilot ──
export async function runAutopilot(key, { by = 'autopilot', deadline = Infinity } = {}) {
  const { site, scope, q } = ctxOf(key);
  const settings = await loadSettings(scope);
  const a = settings.auto || {};
  const types = [a.guides && 'write_guide', a.trendPosts && 'trend_post', settings.improve.autoLinks && 'strengthen_page'].filter(Boolean);
  if (!types.length) return { skipped: 'Autopilot is switched off in Settings' };
  const since = new Date(Date.now() - 86400000).toISOString();
  const done = await seoDb('py').select('seo_changes', `select=action&country=eq.${q}&by=eq.${enc(by)}&created_at=gte.${enc(since)}&limit=500`);
  let guidesLeft = Math.max(0, settings.thresholds.maxGuidesPerDay - done.filter((c) => c.action === 'publish_guide').length);
  const opps = await seoDb('py').select('seo_opportunities', `select=id,type,term,url,score&country=eq.${q}&status=eq.open&type=in.(${types.join(',')})&order=score.desc&limit=200`);
  const applied = []; const skipped = [];
  let leftForTomorrow = 0;
  const own = !hasBatch(site.key);
  if (own) startBatch(site.key);
  let publish = null;
  try {
    for (const o of opps) {
      if (Date.now() > deadline) { leftForTomorrow++; continue; }
      const isGuide = o.type === 'write_guide' || o.type === 'trend_post';
      if (isGuide && guidesLeft <= 0) continue;
      try {
        const r = await applyOpportunity(site.key, o.id, { by });
        if (isGuide && r?.draft?.id) { await approveGuide(site.key, r.draft.id, { by }); guidesLeft--; }
        applied.push(`${o.type} ${o.url || o.term}`);
      } catch (e) { skipped.push(`${o.type} ${o.url || o.term}: ${String(e?.message || e).slice(0, 160)}`); }
    }
  } finally {
    if (own) publish = await flushBatch(site.key);
  }
  return { applied, skipped, leftForTomorrow, guidesLeftToday: guidesLeft, ...(publish ? { publish } : {}) };
}

// ── Search Console pages of the site ──
export async function gscPages(site, start, end, dims = ['page']) {
  try {
    const j = await siteGsc(site, { startDate: start, endDate: end, type: 'web', dimensions: dims, rowLimit: 5000 });
    return (j.rows || []).map((r) => ({ keys: r.keys.map((k, i) => (dims[i] === 'page' ? pathOf(k) : k)), clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 }));
  } catch (e) { if (noGscAccess(e)) return null; throw e; }
}

// ── stage 8: improve ──
export async function runImprove(key, { by = 'weekly loop' } = {}) {
  const { site, scope, q } = ctxOf(key);
  const settings = await loadSettings(scope);
  if (!settings.improve.enabled) return { skipped: 'Improve is switched off in Settings' };
  const end = daysAgo(2);
  const cur = await gscPages(site, daysAgo(8), end);
  if (!cur) return { skipped: 'no Search Console access for this site' };
  const [prev, pq, month] = await Promise.all([gscPages(site, daysAgo(15), daysAgo(9)), gscPages(site, daysAgo(29), end, ['page', 'query']), gscPages(site, daysAgo(29), end)]);
  const topQuery = new Map();
  for (const r of pq || []) { const [p, qq] = r.keys; if (!topQuery.has(p) || topQuery.get(p).impressions < r.impressions) topQuery.set(p, { q: qq, impressions: r.impressions }); }
  const prevBy = new Map((prev || []).map((r) => [r.keys[0], r]));
  const pages = (month || []).map((r) => {
    const w = cur.find((x) => x.keys[0] === r.keys[0]);
    const pv = prevBy.get(r.keys[0]);
    return { page: r.keys[0], cur: { impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: w?.position || r.position }, prev: pv ? { position: pv.position } : null, topQuery: topQuery.get(r.keys[0])?.q || null };
  });
  const [catalog, drafts, overridesByPath] = await Promise.all([
    fetchCatalog(site.key),
    seoDb('py').select('seo_drafts', `select=slug,title,h1,status,related&country=eq.${q}&status=eq.approved&limit=5000`),
    getOverrides(scope),
  ]);
  const guidePaths = new Set(knownGuides(site, catalog.guides, drafts).map((g) => g.path));
  const actions = improveSite({ site, pages, guidePaths, overridesByPath, settings });
  const done = []; const proposed = [];
  for (const a of actions) {
    try {
      if (a.type === 'new_title' && settings.improve.autoTitles && a.allowed) { await setTitle(site.key, a.url, a.title, { by, reason: a.reason }); done.push(a); continue; }
      if (a.type === 'strengthen_page' && settings.improve.autoLinks) { await addLinks(site.key, a.url, { by, reason: a.reason }); done.push(a); continue; }
    } catch (e) { a.error = errText(e); }
    proposed.push(a);
  }
  const at = nowIso();
  const rows = proposed.map((a) => ({ country: scope, key: `${a.type}|${a.url}`, type: a.type, term: a.term, url: a.url, parsed: a.title ? { title: a.title } : {},
    score: a.type === 'new_title' ? 50 : 30, evidence: { reason: a.reason, title: a.title || null, nextAt: a.nextAt || null, error: a.error || null }, updated_at: at }));
  if (rows.length) await seoDb('py').insert('seo_opportunities', rows, { upsert: true, onConflict: 'country,key', returning: 'minimal' });
  const keep = new Set(rows.map((r) => r.key));
  const old = await seoDb('py').select('seo_opportunities', `select=id,key,evidence&country=eq.${q}&status=eq.open&type=in.(new_title,strengthen_page)&limit=2000`);
  for (const o of old) if (o.evidence?.reason && !keep.has(o.key)) await seoDb('py').remove('seo_opportunities', `id=eq.${o.id}`);
  return { pagesChecked: pages.length, applied: done.map((a) => `${a.type} ${a.url}`), proposed: proposed.length, ...(catalog.ok ? {} : { note: catalog.error }) };
}

// PostHog: visits per page of the site (properties.funnel_domain + $pathname; the hub by its $host), this week and the week before.
export async function siteVisits(site) {
  if (!posthogConfigured()) return new Map();
  const rows = await hogql(`SELECT replaceRegexpAll(toString(properties.$pathname), '/+$', '') AS p,
      uniqIf(properties.$session_id, timestamp > now() - INTERVAL 7 DAY) AS cur,
      uniqIf(properties.$session_id, timestamp <= now() - INTERVAL 7 DAY) AS prev
    FROM events WHERE event = '$pageview' AND timestamp > now() - INTERVAL 14 DAY
      AND ${site.kind === 'hub'
    ? `lower(replaceRegexpAll(coalesce(toString(properties.$host), ''), '^www[.]', '')) = '${site.domain}'`
    : `lower(coalesce(toString(properties.funnel_domain), '')) = '${site.domain}'`}
    GROUP BY p ORDER BY cur DESC LIMIT 2000`);
  const m = new Map();
  for (const r of rows) { const [p, cur, prev] = Array.isArray(r) ? r : Object.values(r); const k = String(p || '') || '/'; m.set(k, { visits: Number(cur) || 0, prevVisits: Number(prev) || 0, contacts: 0 }); }
  return m;
}

// ── stage 7: watch ──
export async function watch(key) {
  const { site, scope } = ctxOf(key);
  const [signals, overrides] = await Promise.all([latestSignals(scope), getOverrides(scope)]);
  const latest = signals.filter((s) => s.source === 'gsc').reduce((d, s) => (s.date > d ? s.date : d), '');
  const pages = new Map();
  for (const s of signals) {
    if (s.source !== 'gsc' || s.date !== latest) continue;
    const m = s.metrics || {};
    let r = pages.get(s.page);
    if (!r) { r = { path: s.page, clicks: 0, impressions: 0, posSum: 0, topQuery: null, topImp: 0 }; pages.set(s.page, r); }
    r.clicks += m.clicks || 0; r.impressions += m.impressions || 0; r.posSum += (m.position || 0) * (m.impressions || 0);
    if ((m.impressions || 0) > r.topImp) { r.topImp = m.impressions; r.topQuery = s.term; }
  }
  let note = null;
  let visits = new Map();
  try { visits = await siteVisits(site); } catch (e) { note = `PostHog: ${errText(e)}`; }
  for (const p of visits.keys()) if (!pages.has(p)) pages.set(p, { path: p, clicks: 0, impressions: 0, posSum: 0, topQuery: null, topImp: 0 });
  const out = [...pages.values()].map((r) => {
    const v = visits.get(r.path);
    return { path: r.path, listings: null, indexable: null, exists: null, overridden: !!overrides.get(r.path)?.title,
      gsc: { clicks: r.clicks, impressions: r.impressions, ctr: r.impressions ? r.clicks / r.impressions : 0, position: r.impressions ? Math.round((r.posSum / r.impressions) * 10) / 10 : null, topQuery: r.topQuery },
      ads: { clicks: 0, conversions: 0, cost: 0, terms: 0 }, site: { searches: 0 }, posthog: v ? { views: v.visits, contacts: 0, sessions: v.visits } : null };
  }).sort((a, b) => (b.gsc.impressions + (b.posthog?.sessions || 0) * 10) - (a.gsc.impressions + (a.posthog?.sessions || 0) * 10));
  return { pages: out.slice(0, 200), note: note || (latest ? null : 'No Search Console rows collected for this site yet.') };
}
