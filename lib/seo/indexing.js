// Google indexing — is Google keeping our pages in its index? Pure helpers (tests load them directly).
// The daily SEO run (lib/seo/runLog.js takeSnapshot) inspects, with Search Console's URL Inspection API
// (free, about 2,000 checks a day per site):
//   - a random sample of the sitemap's pages (Google has no "pages indexed" total in any API, so the
//     site figure is an estimate: indexed share of the sample x pages in the sitemap), and
//   - every page the SEO pipeline added in the last 14 days (new filter pages and guides).
// The result is stored in the run's snapshot (seo_runs.snapshot.indexing), so there is a day-by-day
// history that the AI Analyst and the Admin Manager read (lib/seo/searchHealth.js).

export const NEW_PAGE_DAYS = 14;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const ageDays = (iso, now) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 86400000)) : null);
const pathOf = (url) => String(url || '').replace(/^https?:\/\/[^/]+/, '') || '/';

// inspected rows ({ url, verdict, coverage, lastCrawl }) -> counts; ERROR rows (quota, no access) are left out
export function countIndexed(rows = []) {
  const checked = rows.filter((r) => r && r.verdict !== 'ERROR');
  const indexed = checked.filter((r) => r.verdict === 'PASS').length;
  return { checked: checked.length, indexed, notIndexed: checked.length - indexed, errors: rows.length - checked.length, indexedPct: pct(indexed, checked.length) };
}

// Google's reason for a page not being indexed ("Discovered - currently not indexed", "Crawled - currently
// not indexed", "URL is unknown to Google", ...) -> how many pages per reason
export function reasons(rows = []) {
  const out = {};
  for (const r of rows) if (r && r.verdict !== 'PASS' && r.verdict !== 'ERROR') { const k = r.coverage || 'Unknown'; out[k] = (out[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// the whole indexing block stored in the run snapshot
export function summarizeIndexing({ sampleRows = [], newRows = [], inSitemap = 0, newPages = [], at = new Date().toISOString() } = {}) {
  const now = Date.parse(at) || Date.now();
  const sample = countIndexed(sampleRows);
  const fresh = countIndexed(newRows);
  const added = new Map(newPages.map((p) => [p.path, p]));
  return {
    at,
    inSitemap,
    sitewide: { ...sample, estimatedIndexed: sample.checked ? Math.round((sample.indexed / sample.checked) * inSitemap) : null },
    newPages: {
      ...fresh,
      notIndexedList: newRows.filter((r) => r.verdict !== 'PASS' && r.verdict !== 'ERROR').slice(0, 20).map((r) => {
        const p = added.get(pathOf(r.url)) || {};
        return { path: pathOf(r.url), kind: p.kind || null, addedDaysAgo: ageDays(p.at, now), reason: r.coverage || null, lastCrawl: r.lastCrawl || null };
      }),
    },
    reasons: reasons([...sampleRows, ...newRows]),
    notIndexedExamples: sampleRows.filter((r) => r.verdict !== 'PASS' && r.verdict !== 'ERROR').slice(0, 10).map((r) => ({ path: pathOf(r.url), reason: r.coverage || null })),
  };
}

// pages the pipeline added recently, from seo_changes rows (enable_variant has the base path in `path`
// and the variant in after.enabled_variants; publish_guide has the guide path)
export function recentPipelinePages(changes = [], { now = Date.now(), days = NEW_PAGE_DAYS, limit = 25 } = {}) {
  const since = now - days * 86400000;
  const out = new Map();
  for (const c of changes) {
    if (!c || c.reverted_at || Date.parse(c.created_at) < since) continue;
    if (c.action === 'publish_guide' && c.path) out.set(c.path, { path: c.path, kind: 'guide', at: c.created_at });
    if (c.action === 'enable_variant' && c.path) {
      const before = new Set(c.before?.enabled_variants || []);
      for (const v of c.after?.enabled_variants || []) if (!before.has(v)) out.set(`${c.path}/${v}`, { path: `${c.path}/${v}`, kind: 'filter page', at: c.created_at });
    }
  }
  return [...out.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

// stored snapshots of the last runs (newest first) -> a day-by-day series and the change over the period
export function indexingHistory(runs = []) {
  const series = runs
    .map((r) => ({ date: String(r.started_at || r.snapshot?.indexing?.at || '').slice(0, 10), ix: r.snapshot?.indexing }))
    .filter((x) => x.ix && x.ix.sitewide && x.date)
    .map(({ date, ix }) => ({
      date,
      inSitemap: ix.inSitemap ?? null,
      sampleIndexedPct: ix.sitewide.indexedPct ?? null,
      estimatedIndexed: ix.sitewide.estimatedIndexed ?? null,
      newPagesChecked: ix.newPages?.checked ?? 0,
      newPagesIndexed: ix.newPages?.indexed ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = series[0]; const last = series[series.length - 1];
  return {
    series,
    change: series.length > 1 ? {
      from: first.date, to: last.date,
      estimatedIndexed: last.estimatedIndexed != null && first.estimatedIndexed != null ? last.estimatedIndexed - first.estimatedIndexed : null,
      sampleIndexedPctPoints: last.sampleIndexedPct != null && first.sampleIndexedPct != null ? Math.round((last.sampleIndexedPct - first.sampleIndexedPct) * 10) / 10 : null,
      inSitemap: last.inSitemap != null && first.inSitemap != null ? last.inSitemap - first.inSitemap : null,
    } : null,
  };
}

// ranking from the stored snapshot: site clicks / impressions / position this week vs the week before,
// and the biggest keyword moves
export function rankingFrom(snap = {}) {
  const r1 = (x) => (x == null ? null : Math.round(Number(x) * 10) / 10);
  const blk = (o = {}) => ({ clicks: o.clicks ?? null, impressions: o.impressions ?? null, position: r1(o.position) });
  const kws = (snap.keywords || []).map((k) => ({ query: k.query, clicks: k.clicks, impressions: k.impressions, position: r1(k.position), prevPosition: r1(k.prevPosition) }));
  return {
    window: snap.window || null,
    thisWeek: blk(snap.site?.cur), previousWeek: blk(snap.site?.prev),
    topKeywords: kws.slice(0, 12),
    improved: kws.filter((k) => k.prevPosition != null && k.position != null && k.prevPosition - k.position >= 1).sort((a, b) => (b.prevPosition - b.position) - (a.prevPosition - a.position)).slice(0, 5),
    dropped: kws.filter((k) => k.prevPosition != null && k.position != null && k.position - k.prevPosition >= 1).sort((a, b) => (b.position - b.prevPosition) - (a.position - a.prevPosition)).slice(0, 5),
    pipelinePages: snap.pipeline ? { thisWeek: blk(snap.pipeline.cur), previousWeek: blk(snap.pipeline.prev) } : null,
  };
}
