// SEO pipeline settings (Admin → SEO → Settings): feature switches + thresholds, one row per country
// in seo_settings. Pure defaults + merge (tests load it directly).
export const DEFAULT_SETTINGS = {
  collect: { ads: true, gsc: true, site_search: true, trends: true },
  decide: true,
  // Autopilot (daily, no approval): opportunities are applied by themselves, best first, within the
  // daily caps below. Every change still goes through the Check guards and is revertible.
  auto: { variants: true, guides: true, trendPosts: false },
  improve: { enabled: true, autoTitles: true, autoRetire: true, autoLinks: true },
  drafts: { claude: true },
  publish: { indexNow: true },
  thresholds: {
    minListings: 5,             // the website's 5-listing gate
    provenAdsClicks: 5,         // a search is "proven" with this many Ads clicks (30 days)…
    provenAdsConversions: 1,    // …or one Ads conversion
    provenSiteSearches: 3,      // …or typed this often in our search box
    provenGscImpressions: 50,   // …or this many Search Console impressions
    strengthenMinPos: 5,        // strengthen pages ranking between these positions
    strengthenMaxPos: 20,
    strengthenMinImpressions: 20,
    guideMinDemand: 4,          // demand score a question needs before a guide is drafted
    trendHours: 72,             // trending topics younger than this become trend posts
    lowCtrImpressions: 100,     // Improve: a page with this many impressions…
    lowCtr: 0.02,               // …and CTR below this gets a new title
    titleDays: 14,              // title changes: at most once per this many days per page
    zeroTrafficWeeks: 4,        // Improve: an enabled variant with no impressions for this long is retired (noindex)
    slipPositions: 3,           // Improve: position worse by this much week on week → strengthen
    maxNewPagesPerDay: 30,      // Autopilot: new filter pages switched on per day per country
    maxGuidesPerDay: 30,        // Autopilot: guides published per day per country (page edits: no daily cap)
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function mergeSettings(saved) {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!isObj(saved)) return out;
  for (const [k, v] of Object.entries(saved)) {
    if (!(k in out)) continue;
    if (isObj(out[k]) && isObj(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (!(k2 in out[k])) continue;
        if (typeof out[k][k2] === 'number') { const n = Number(v2); if (Number.isFinite(n)) out[k][k2] = n; }
        else if (typeof out[k][k2] === 'boolean') out[k][k2] = !!v2;
      }
    } else if (typeof out[k] === 'boolean') out[k] = !!v;
  }
  return out;
}
