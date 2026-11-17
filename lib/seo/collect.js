// Stage 1 — Collect: pull each demand source and store it with a date (history builds up run after
// run). Read-only on every outside service. Server-only. Runner/cron: lib/seo/run.js, /api/cron/seo.
//   collectAds(cc)         Google Ads search terms, last 30 days (the one Ads account advertises PY)
//   collectGsc(cc)         Search Console query × page, last 28 days (ending 2 days ago: Google's lag)
//   collectSiteSearch(cc)  what visitors typed in the Casa-Libre search box (PostHog search_applied), 30 days
//   collectTrends(cc)      Google Trends trending-now RSS for the country, tagged property/economy/other
import 'server-only';
import { adsSearch, gscQuery, googleSetup } from '../googleApi';
import { siteFor as gscSiteFor, periods } from '../searchConsole';
import { hogql, posthogConfigured } from '../posthogHogql';
import { siteClause } from '../analyticsSite';
import { UKEY, GEO_BASE } from '../posthogSql';
import { seoDb } from './store.js';
import { parseTrendsRss, topicOf, TREND_GEOS, seenHour } from './trends.js';

export const ADS_COUNTRIES = ['py'];   // the one Google Ads account (874-655-0784) advertises Paraguay only
const today = () => new Date().toISOString().slice(0, 10);
const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return String(u || ''); } };
const errText = (e) => String(e?.message || e).slice(0, 300);

async function store(cc, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    await seoDb(cc).insert(table, rows.slice(i, i + 500), { upsert: true, onConflict, returning: 'minimal' });
  }
  return rows.length;
}

export async function collectAds(cc) {
  if (!ADS_COUNTRIES.includes(cc)) return { source: 'ads', skipped: 'no Google Ads account for this country' };
  const s = googleSetup();
  if (!s.refreshToken || !s.developerToken) return { source: 'ads', skipped: 'Google not connected' };
  const j = await adsSearch(`SELECT search_term_view.search_term, metrics.clicks, metrics.impressions, metrics.conversions, metrics.cost_micros
    FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0 ORDER BY metrics.impressions DESC LIMIT 2000`);
  const by = new Map();
  for (const r of j.results || []) {
    const term = String(r.searchTermView?.searchTerm || '').trim();
    if (!term) continue;
    const m = by.get(term) || { clicks: 0, impressions: 0, conversions: 0, cost: 0 };
    m.clicks += Number(r.metrics?.clicks) || 0;
    m.impressions += Number(r.metrics?.impressions) || 0;
    m.conversions += Number(r.metrics?.conversions) || 0;
    m.cost += (Number(r.metrics?.costMicros) || 0) / 1e6;
    by.set(term, m);
  }
  const date = today();
  const rows = [...by.entries()].map(([term, m]) => ({ country: cc, source: 'ads', term, page: '', date, collected_at: new Date().toISOString(),
    metrics: { clicks: m.clicks, impressions: m.impressions, conversions: Math.round(m.conversions * 100) / 100, cost: Math.round(m.cost * 100) / 100, window_days: 30, currency: 'USD' } }));
  return { source: 'ads', stored: await store(cc, 'seo_signals', rows, 'country,source,term,page,date') };
}

export async function collectGsc(cc) {
  const site = await gscSiteFor(cc);
  if (!site) return { source: 'gsc', skipped: 'no Search Console access for this country' };
  const p = periods(28);
  const j = await gscQuery(site.property, { startDate: p.start, endDate: p.end, type: 'web', dimensions: ['query', 'page'], rowLimit: 2500 });
  const date = today();
  const rows = (j.rows || []).map((r) => ({ country: cc, source: 'gsc', term: String(r.keys[0] || '').trim(), page: pathOf(r.keys[1]), date, collected_at: new Date().toISOString(),
    metrics: { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: Math.round((r.ctr || 0) * 10000) / 10000, position: Math.round((r.position || 0) * 10) / 10, window_days: 28, start: p.start, end: p.end, property: site.property } }))
    .filter((r) => r.term);
  // the same query + path can come from two hosts (www / apex): keep the bigger row
  const uniq = new Map();
  for (const r of rows) { const k = `${r.term}|${r.page}`; const prev = uniq.get(k); if (!prev || prev.metrics.impressions < r.metrics.impressions) uniq.set(k, r); }
  return { source: 'gsc', property: site.property, stored: await store(cc, 'seo_signals', [...uniq.values()], 'country,source,term,page,date') };
}

export async function collectSiteSearch(cc) {
  if (!posthogConfigured()) return { source: 'site_search', skipped: 'PostHog not configured' };
  const rows = await hogql(`SELECT lower(trim(toString(properties.query))) AS q, count() AS n, uniq(${UKEY}) AS people,
      topK(1)(toString(properties.operation)) AS op, topK(1)(toString(properties.property_type)) AS tp
    FROM events
    WHERE event = 'search_applied' AND timestamp > now() - INTERVAL 30 DAY AND ${GEO_BASE}${siteClause(cc)}
      AND coalesce(toString(properties.query), '') NOT IN ('', 'null')
    GROUP BY q HAVING length(q) >= 3 ORDER BY n DESC LIMIT 500`, { fresh: 60_000 });
  const date = today();
  const out = rows.map((r) => { const [q, n, people, op, tp] = Array.isArray(r) ? r : Object.values(r); return { q, n, people, op: op?.[0] || null, tp: tp?.[0] || null }; })
    .filter((r) => r.q)
    .map((r) => ({ country: cc, source: 'site_search', term: r.q.slice(0, 200), page: '', date, collected_at: new Date().toISOString(),
      metrics: { searches: Number(r.n) || 0, people: Number(r.people) || 0, operation: r.op, property_type: r.tp, window_days: 30 } }));
  return { source: 'site_search', stored: await store(cc, 'seo_signals', out, 'country,source,term,page,date') };
}

export async function collectTrends(cc, { fetchImpl = fetch } = {}) {
  const geo = TREND_GEOS[cc];
  if (!geo) return { source: 'trends', skipped: 'no geo' };
  const r = await fetchImpl(`https://trends.google.com/trending/rss?geo=${geo}`, { cache: 'no-store', headers: { 'user-agent': 'Mozilla/5.0 (compatible; seo-pipeline)' } });
  if (!r.ok) throw new Error(`Trends RSS ${r.status}`);
  const items = parseTrendsRss(await r.text());
  const hour = seenHour();
  const rows = items.map((it) => ({ geo, title: it.title.slice(0, 200), traffic: it.traffic, traffic_label: it.trafficLabel, news: it.news.slice(0, 5),
    topic: topicOf(it.title, it.news.map((n) => n.title)), pub_date: it.pubDate, seen_hour: hour, seen_at: new Date().toISOString() }));
  return { source: 'trends', geo, stored: await store(cc, 'seo_trends', rows, 'geo,title,seen_hour'), topics: rows.reduce((a, x) => ({ ...a, [x.topic]: (a[x.topic] || 0) + 1 }), {}) };
}

export const COLLECTORS = { ads: collectAds, gsc: collectGsc, site_search: collectSiteSearch, trends: collectTrends };

// Run the switched-on collectors for one country; each fails on its own.
export async function collectAll(cc, settings, only = null) {
  const out = [];
  for (const [name, fn] of Object.entries(COLLECTORS)) {
    if (only && !only.includes(name)) continue;
    if (settings?.collect && settings.collect[name] === false) { out.push({ source: name, skipped: 'switched off in Settings' }); continue; }
    // network blips ("fetch failed") get two more tries; real errors (auth, quota) don't
    let res;
    for (let i = 0; i < 3; i += 1) {
      try { res = await fn(cc); break; } catch (e) {
        res = { source: name, error: errText(e) };
        if (!/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|timeout/i.test(`${e?.message} ${e?.cause?.code || ''}`)) break;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    out.push(res);
  }
  return out;
}
