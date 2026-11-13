// Google Search Console for the admin's "Search Console" page — read-only, through the admin's
// Google connection (lib/googleApi.js: the Marketing page's OAuth, scope webmasters.readonly).
//   overview(cc, days)   clicks / impressions / CTR / position for the period and the one before,
//                        the daily series, top keywords, top pages, devices, countries, sitemaps
//   indexCheck(cc, n)    the URL Inspection API on a random sample of the sitemap's pages: Google
//                        gives no "indexed pages" total through any API, so we estimate it
//                        (indexed share of the sample × pages in the sitemap). Cached 12 h.
// Search Console data is final about 2-3 days after the day, so periods end 2 days ago.
import 'server-only';
import { accessToken } from './googleApi';

// Each country site: the properties that may exist for it, best first, and its public origin.
export const GSC_SITES = {
  py: { origin: 'https://casa-libre.com.py', props: ['sc-domain:casa-libre.com.py', 'https://casa-libre.com.py/'] },
  bo: { origin: 'https://casa-libre.com.bo', props: ['sc-domain:casa-libre.com.bo', 'https://casa-libre.com.bo/'] },
  uy: { origin: 'https://uy.casa-libre.com', props: ['sc-domain:uy.casa-libre.com', 'https://uy.casa-libre.com/'] },
  ve: { origin: 'https://casa-libre.com.ve', props: ['sc-domain:casa-libre.com.ve', 'https://casa-libre.com.ve/'] },
  sv: { origin: 'https://sv.casa-libre.com', props: ['sc-domain:sv.casa-libre.com', 'https://sv.casa-libre.com/'] },
};
const RANK = { siteOwner: 4, siteFullUser: 3, siteRestrictedUser: 2, siteUnverifiedUser: 0 };

async function g(url, opts = {}) {
  const token = await accessToken();
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Search Console ${r.status}`);
  return j;
}

let sitesCache = null; // { at, list }
async function accessibleSites() {
  if (sitesCache && Date.now() - sitesCache.at < 3600_000) return sitesCache.list;
  const j = await g('https://www.googleapis.com/webmasters/v3/sites');
  const list = (j.siteEntry || []).map((s) => ({ url: s.siteUrl, level: s.permissionLevel }));
  sitesCache = { at: Date.now(), list };
  return list;
}

// The property to read for a country: the one with the highest permission, null = no access.
export async function siteFor(cc) {
  const conf = GSC_SITES[cc];
  if (!conf) return null;
  const list = await accessibleSites();
  const found = conf.props.map((p) => list.find((s) => s.url === p)).filter(Boolean)
    .filter((s) => (RANK[s.level] || 0) >= 2)
    .sort((a, b) => (RANK[b.level] || 0) - (RANK[a.level] || 0));
  return found[0] ? { property: found[0].url, level: found[0].level, origin: conf.origin } : null;
}

const iso = (d) => d.toISOString().slice(0, 10);
export function periods(days, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd) };
}

const query = (property, body) => g(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: 'POST', body: JSON.stringify(body) });
const row = (r) => ({ key: r.keys?.[0] ?? null, clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 });
const total = (j) => {
  const r = j.rows?.[0];
  return r ? { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 } : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
};

export async function overview(cc, days = 28) {
  const site = await siteFor(cc);
  if (!site) return { access: false, country: cc, tried: GSC_SITES[cc]?.props || [] };
  const p = periods(days);
  const base = { startDate: p.start, endDate: p.end, type: 'web' };
  const [cur, prev, daily, queries, pages, devices, countries, sitemaps] = await Promise.all([
    query(site.property, { ...base }),
    query(site.property, { startDate: p.prevStart, endDate: p.prevEnd, type: 'web' }),
    query(site.property, { ...base, dimensions: ['date'], rowLimit: 500 }),
    query(site.property, { ...base, dimensions: ['query'], rowLimit: 50 }),
    query(site.property, { ...base, dimensions: ['page'], rowLimit: 25 }),
    query(site.property, { ...base, dimensions: ['device'] }),
    query(site.property, { ...base, dimensions: ['country'], rowLimit: 8 }),
    g(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.property)}/sitemaps`).catch(() => ({ sitemap: [] })),
  ]);
  // every day of the period, zero where Google has no row
  const byDay = new Map((daily.rows || []).map((r) => [r.keys[0], row(r)]));
  const series = [];
  for (let t = Date.parse(`${p.start}T00:00:00Z`); t <= Date.parse(`${p.end}T00:00:00Z`); t += 86400000) {
    const k = new Date(t).toISOString().slice(0, 10);
    series.push(byDay.get(k) || { key: k, clicks: 0, impressions: 0, ctr: 0, position: 0 });
  }
  return {
    access: true, country: cc, property: site.property, level: site.level, origin: site.origin, days, period: p,
    totals: total(cur), previous: total(prev), daily: series,
    queries: (queries.rows || []).map(row), pages: (pages.rows || []).map(row),
    devices: (devices.rows || []).map(row), countries: (countries.rows || []).map(row),
    sitemaps: (sitemaps.sitemap || []).map((s) => ({
      path: s.path, lastDownloaded: s.lastDownloaded || null, lastSubmitted: s.lastSubmitted || null,
      errors: Number(s.errors || 0), warnings: Number(s.warnings || 0), isPending: !!s.isPending,
      submitted: (s.contents || []).reduce((n, c) => n + Number(c.submitted || 0), 0),
    })),
  };
}

// The sitemaps Google knows for a country, always fresh (no cache): pages submitted, last read.
export async function sitemapsFor(cc) {
  const site = await siteFor(cc);
  if (!site) return [];
  const j = await g(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.property)}/sitemaps`).catch(() => ({ sitemap: [] }));
  return (j.sitemap || []).map((s) => ({
    path: s.path, lastDownloaded: s.lastDownloaded || null, lastSubmitted: s.lastSubmitted || null,
    errors: Number(s.errors || 0), warnings: Number(s.warnings || 0), isPending: !!s.isPending,
    submitted: (s.contents || []).reduce((n, c) => n + Number(c.submitted || 0), 0),
  }));
}

// ---- index check (URL Inspection API, quota 2,000 / day / property) ----
async function sitemapUrls(origin, limit = 5000) {
  const seen = new Set();
  const out = [];
  const read = async (url, depth) => {
    if (depth > 2 || out.length >= limit || seen.has(url)) return;
    seen.add(url);
    const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
    if (!r || !r.ok) return;
    const xml = await r.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(xml)) { for (const u of locs) await read(u, depth + 1); return; }
    for (const u of locs) { if (out.length < limit) out.push(u); }
  };
  await read(`${origin}/sitemap.xml`, 0);
  return out;
}

const pick = (arr, n) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

const indexCache = new Map(); // cc -> result
export async function indexCheck(cc, n = 40, { force = false } = {}) {
  const hit = indexCache.get(cc);
  if (!force && hit && Date.now() - hit.at < 12 * 3600_000) {
    // stale as soon as Google re-read the sitemap after this check (e.g. after a deploy or a resubmit)
    const latest = Math.max(0, ...(await sitemapsFor(cc)).map((s) => Date.parse(s.lastDownloaded || 0) || 0));
    if (latest <= hit.at) return hit.result;
  }
  const site = await siteFor(cc);
  if (!site) return { access: false, country: cc };
  const urls = await sitemapUrls(site.origin);
  const home = `${site.origin}/`;
  const sample = [home, ...pick(urls.filter((u) => u !== home), n - 1)];
  const results = [];
  for (let i = 0; i < sample.length; i += 5) {   // 5 at a time (quota is 600 / minute)
    const part = await Promise.all(sample.slice(i, i + 5).map(async (u) => {
      try {
        const j = await g('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', body: JSON.stringify({ inspectionUrl: u, siteUrl: site.property }) });
        const s = j.inspectionResult?.indexStatusResult || {};
        return { url: u, verdict: s.verdict || 'UNKNOWN', coverage: s.coverageState || '', lastCrawl: s.lastCrawlTime || null };
      } catch (e) {
        return { url: u, verdict: 'ERROR', coverage: String(e.message || e).slice(0, 120), lastCrawl: null };
      }
    }));
    results.push(...part);
  }
  const checked = results.filter((r) => r.verdict !== 'ERROR');
  const indexed = checked.filter((r) => r.verdict === 'PASS').length;
  const share = checked.length ? indexed / checked.length : 0;
  const result = {
    access: true, country: cc, at: new Date().toISOString(), inSitemap: urls.length,
    checked: checked.length, indexed, share, estimatedIndexed: Math.round(share * urls.length),
    notIndexed: results.filter((r) => r.verdict !== 'PASS').slice(0, 25),
  };
  indexCache.set(cc, { at: Date.now(), result });
  return result;
}

// ---- resubmit the sitemap (tells Google to re-read it now) ----
// Needs the Search Console WRITE scope (https://www.googleapis.com/auth/webmasters); with the old
// read-only connection Google answers 403 and the page asks to reconnect Google once.
// Google has no API to request indexing of single pages (only "Request indexing" by hand in
// Search Console), so resubmitting the sitemap, with each page's real last-modified date, is the way.
export async function resubmitSitemap(cc) {
  const site = await siteFor(cc);
  if (!site) return { cc, ok: false, error: 'No access to this country in Search Console' };
  const sitemap = `${site.origin}/sitemap.xml`;
  let urls = null;
  try {
    const r = await fetch(sitemap, { cache: 'no-store' });
    urls = r.ok ? ((await r.text()).match(/<loc>/g) || []).length : null;
  } catch { urls = null; }
  const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.property)}/sitemaps/${encodeURIComponent(sitemap)}`;
  const token = await accessToken();
  const put = await fetch(base, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!put.ok) {
    const j = await put.json().catch(() => ({}));
    const msg = j?.error?.message || `Search Console ${put.status}`;
    return { cc, ok: false, sitemap, urls, needsReconnect: put.status === 403 && /scope|permission|insufficient/i.test(msg), error: msg };
  }
  const info = await g(base).catch(() => ({}));
  return { cc, ok: true, sitemap, urls, lastSubmitted: info.lastSubmitted || new Date().toISOString(), isPending: !!info.isPending };
}
