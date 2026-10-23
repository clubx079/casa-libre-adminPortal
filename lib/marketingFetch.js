// Google Ads reads shared by the Marketing page (app/api/marketing/report) and the Admin
// Manager's weekly data pack (lib/manager/dataPack.js). Server-only, read-only.
import { adsSearch } from './googleApi.js';
import { adsReport, adsAcquisition } from './marketingReport.js';

// range: lib/marketingReport rangeFor(days). The one ad account, all campaigns.
export async function adsAll(range) {
  const when = `segments.date BETWEEN '${range.start}' AND '${range.end}'`;
  const q = async (gaql) => (await adsSearch(gaql)).results || [];
  const [campaigns, daily, keywords, terms, actions, adActions] = await Promise.all([
    q(`SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE ${when}`),
    q(`SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.conversions FROM customer WHERE ${when}`),
    q(`SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM keyword_view WHERE ${when} AND metrics.impressions > 0 ORDER BY metrics.clicks DESC LIMIT 15`),
    q(`SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM search_term_view WHERE ${when} AND metrics.impressions > 0 ORDER BY metrics.clicks DESC LIMIT 15`),
    q(`SELECT segments.conversion_action_name, metrics.conversions FROM campaign WHERE ${when} AND metrics.conversions > 0`),
    // "From Google Ads": contacts / sign-ups Google attributes to ad clicks, per campaign
    // (all_conversions so secondary actions count too).
    q(`SELECT campaign.id, campaign.name, segments.conversion_action_name, metrics.all_conversions FROM campaign WHERE ${when} AND metrics.all_conversions > 0`),
  ]);
  return { ...adsReport({ campaigns, daily, keywords, terms, actions }, range), acquisition: adsAcquisition({ campaigns, actions: adActions, daily }, range) };
}
