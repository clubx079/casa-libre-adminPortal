// Google ranking + indexing for one country, for the AI Analyst and the Admin Manager data packs.
// Read from the daily SEO runs (seo_runs.snapshot: Search Console clicks / impressions / positions and the
// URL Inspection index check, lib/seo/indexing.js), so the reports cost no extra Google calls and show a
// day-by-day indexing history. Server-only.
import 'server-only';
import { seoDb } from './store.js';
import { indexingHistory, rankingFrom } from './indexing.js';

const errText = (e) => String(e?.message || e).slice(0, 240);

export const SEARCH_HEALTH_HOW_TO_READ = 'From the daily SEO run (Admin Manager -> AI SEO). ranking = Google Search Console for the 7 days ending 2 days before the run, vs the 7 days before (position: 1 = top; lower is better). indexing = Google\'s URL Inspection check at each run: sitewide.estimatedIndexed = indexed share of a random sample of the sitemap x pages in the sitemap (an estimate; Google gives no exact total); newPages = pages the SEO pipeline added in the last 14 days and how many Google has indexed; reasons = Google\'s reason for pages not indexed ("Discovered/Crawled - currently not indexed" = Google knows the page but has not added it yet; "URL is unknown to Google" = not found yet). history = one point per run. New pages usually take 1-3 weeks to be indexed.';

export async function searchHealth(cc, { runs = 10 } = {}) {
  let rows;
  try {
    rows = await seoDb(cc).select('seo_runs', `select=started_at,snapshot&country=eq.${cc}&status=eq.done&order=started_at.desc&limit=${runs}`);
  } catch (e) { return { error: errText(e) }; }
  if (!rows.length) return { error: 'no SEO run yet for this country' };
  const latest = rows[0];
  const snap = latest.snapshot || {};
  const withIndex = rows.find((r) => r.snapshot?.indexing);
  return {
    asOf: latest.started_at,
    ranking: rankingFrom(snap),
    indexing: withIndex ? {
      asOf: withIndex.started_at,
      latest: withIndex.snapshot.indexing,
      history: indexingHistory(rows),
    } : { error: 'no index check yet: it runs with the next daily SEO run' },
    notes: (snap.notes || []).slice(0, 5),
  };
}
