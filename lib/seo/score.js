// Stage 3 — the priority score of an opportunity (pure — test/seoScore.test.js).
//   score = demand × availability × closeness
//   demand       what people search: Ads conversions weigh most, then clicks, Search Console clicks
//                and impressions, how often visitors typed it in our own search box, and how many
//                people search it on Google each month (Keyword Planner)
//   availability do we have listings to show? (≥5 = full; fewer = heavily discounted)
//   closeness    how close we are to page 1 for it (positions 5–10 are the cheapest wins)
export const DEFAULT_WEIGHTS = { adsConversion: 10, adsClick: 2, gscClick: 2, gscImpression: 0.1, siteSearch: 3, kpSearch: 0.03 };

export function demandOf(m = {}, w = DEFAULT_WEIGHTS) {
  const a = m.ads || {}, g = m.gsc || {}, s = m.site || {}, k = m.kp || {};
  return (Number(a.conversions) || 0) * w.adsConversion + (Number(a.clicks) || 0) * w.adsClick
    + (Number(g.clicks) || 0) * w.gscClick + (Number(g.impressions) || 0) * w.gscImpression
    + (Number(s.searches) || 0) * w.siteSearch
    + (Number(k.volume) || 0) * (w.kpSearch ?? DEFAULT_WEIGHTS.kpSearch);
}

// listings = live listings behind the page; null = the opportunity needs none (guides, trends, bids)
export function availabilityOf(listings, min = 5) {
  if (listings == null) return 1;
  const n = Number(listings) || 0;
  if (n >= min) return Math.min(1.5, 0.75 + n / 80);
  if (n > 0) return 0.25;
  return 0.05;
}

// position = our average Search Console position for the term (0 / null = not ranking)
export function closenessOf(position) {
  const p = Number(position) || 0;
  if (!p) return 0.8;                        // not ranking yet: a new page starts from zero
  if (p <= 3) return 0.4;                    // already on top: little to win
  if (p <= 10) return 1.6 - (p - 4) * 0.05;  // page 1, below the fold: the cheapest wins
  if (p <= 20) return 1.2 - (p - 11) * 0.04; // page 2: one push away
  return 0.6;
}

export function scoreOpportunity({ metrics = {}, listings = null, position = null, min = 5, weights } = {}) {
  const d = demandOf(metrics, weights || DEFAULT_WEIGHTS);
  return Math.round(d * availabilityOf(listings, min) * closenessOf(position) * 10) / 10;
}
