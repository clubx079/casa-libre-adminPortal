// AI SEO report — where each keyword the pipeline acted on came from, and why it was added
// (pure — test/aiVisibility.test.js). Sources:
//   keyword_planner  Google Keyword Planner: real monthly searches in the country
//   ads              Google Ads: people searched it and clicked / converted on our ads
//   gsc              Search Console: Google already shows one of our pages for it
//   site_search      people typed it in the Casa-Libre search box
//   ai_visibility    AI assistants (Grok bot pipeline): competitors are named for it, Casa-Libre isn't
//   trends           trending in the country now
export const SOURCE_NAMES = {
  keyword_planner: 'Keyword Planner', ads: 'Google Ads', gsc: 'Search Console', site_search: 'Site search',
  ai_visibility: 'AI assistants (Grok bot pipeline)', trends: 'Google Trends',
};
const n = (v) => Number(v) || 0;
const fmt = (v) => Math.round(n(v)).toLocaleString('en-US');

// evidence (as Decide stores it) → the sources that back this keyword
export function sourcesOf(ev = {}, type = '') {
  const out = [];
  if (n(ev.kp?.volume) > 0) out.push('keyword_planner');
  if (n(ev.ads?.clicks) > 0 || n(ev.ads?.impressions) > 0) out.push('ads');
  if (n(ev.gsc?.impressions) > 0 || n(ev.page?.impressions) > 0) out.push('gsc');
  if (n(ev.site?.searches) > 0) out.push('site_search');
  if (ev.aiv?.gap) out.push('ai_visibility');
  if (type === 'trend_post' || ev.traffic != null) out.push('trends');
  return out;
}

const ACTION_WORDS = {
  create_variant: 'Added a filter page', write_guide: 'Wrote and published an answer guide', trend_post: 'Published a trend post',
  strengthen_page: 'Strengthened the page with internal links', new_title: 'Changed the page title',
};

// One plain-English reason: what was done and the numbers behind it.
export function whyText(opp = {}) {
  const ev = opp.evidence || {};
  const bits = [];
  if (n(ev.kp?.volume) > 0) bits.push(`${fmt(ev.kp.volume)} Google searches a month (Keyword Planner${ev.kp.competition ? `, ${String(ev.kp.competition).toLowerCase()} ad competition` : ''})`);
  if (n(ev.ads?.clicks) > 0) bits.push(`${fmt(ev.ads.clicks)} clicks on our ads in 30 days${n(ev.ads.conversions) > 0 ? ` and ${ev.ads.conversions} conversions` : ''}`);
  const g = ev.page || ev.gsc;
  if (n(g?.impressions) > 0) bits.push(`Google showed us ${fmt(g.impressions)} times${g.position ? ` at position ${Math.round(g.position * 10) / 10}` : ''} (Search Console)`);
  if (n(ev.site?.searches) > 0) bits.push(`typed ${fmt(ev.site.searches)} times in our search box`);
  if (ev.aiv?.gap) {
    const comp = (ev.aiv.competitors || []).length;
    bits.push(`AI assistants named ${comp ? 'competitors' : 'other sites'} in ${Math.round(n(ev.aiv.compRate) * 100)}% of answers to "${ev.aiv.question}" and Casa-Libre in ${Math.round(n(ev.aiv.ourRate) * 100)}% (${ev.aiv.answers || 0} answers)`);
  }
  if (opp.type === 'trend_post' && ev.trafficLabel) bits.push(`trending now in Google Trends (${ev.trafficLabel} searches)`);
  if (n(ev.listings) > 0) bits.push(`${fmt(ev.listings)} live listings to show`);
  const what = ACTION_WORDS[opp.type] || 'Changed';
  return bits.length ? `${what} because: ${bits.join('; ')}.` : `${what}.`;
}

// seo_changes rows of a run + their opportunities → the "Keywords added" list of the report.
export function keywordsAdded(changes = [], oppsById = new Map()) {
  const out = [];
  const seen = new Set();
  for (const c of changes) {
    const o = c.opportunity_id ? oppsById.get(c.opportunity_id) : null;
    if (!o || seen.has(o.id)) continue;
    seen.add(o.id);
    const sources = sourcesOf(o.evidence, o.type);
    out.push({ keyword: o.term, page: o.url || c.path, action: o.type, sources, sourceNames: sources.map((s) => SOURCE_NAMES[s]), reason: whyText(o) });
  }
  return out;
}
