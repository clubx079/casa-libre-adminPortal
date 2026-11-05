// Website vs app on the Analytics page. One PostHog project gets both: the website
// (posthog-js) and the mobile app (posthog-react-native, casa-libre-mobile-app
// lib/analytics.js), with the SAME event names (property_viewed, contact_*_click,
// property_saved, search_applied …). The app's events are told apart by:
//   • $lib = 'posthog-react-native'  (the SDK stamps it on every event)
//   • platform = 'mobile'            (the app registers it on every event)
//   • event = 'app_opened'           (the app's launch ping, recorded server-side by the
//                                     website's /api/mobile/install — no $lib, and its IP /
//                                     geo is the website server's, not the phone's)
// The "User analytics" tab is website-only, the "Mobile users" tab app-only, and the
// "Property analytics" tab stays all platforms (it must match the view counts sellers get
// by email, which count every property_viewed).
// Pure — unit-tested in test/analyticsPlatform.test.js.
import { UKEY, CONTACT_IN } from './posthogSql.js';

export const APP_LIB = 'posthog-react-native';

export const IS_APP = `(coalesce(properties.$lib, '') = '${APP_LIB}' OR coalesce(properties.platform, '') = 'mobile' OR event = 'app_opened')`;

// The same decision in JS (tests, and anything holding an event in hand).
export const isAppEvent = (event, props = {}) =>
  props.$lib === APP_LIB || props.platform === 'mobile' || event === 'app_opened';

export const PLATFORMS = ['web', 'app', 'all'];

// Anything unknown → the fallback (the website, unless the caller says otherwise).
export function normPlatform(p, fallback = 'web') {
  const s = String(p || '').toLowerCase();
  if (s === 'mobile') return 'app';
  return PLATFORMS.includes(s) ? s : fallback;
}

// HogQL to AND onto a WHERE: web → no app events; app → only app events; all → nothing.
export function platformClause(platform) {
  const p = normPlatform(platform);
  if (p === 'app') return ` AND ${IS_APP}`;
  if (p === 'web') return ` AND NOT ${IS_APP}`;
  return '';
}

// One visitor. Website: a signed-in person by person_id, an anonymous one by IP (see
// lib/posthogSql.js UKEY). App: phones on mobile data share carrier IPs (CGNAT), so an
// anonymous phone counts by its own distinct id instead — the app makes that the install
// id (`install:<id>`, the same one its app_opened ping uses).
export const APP_UKEY = `if(coalesce(person.properties.email, '') != '', toString(person_id), distinct_id)`;
export const ukeyFor = (platform) => (normPlatform(platform) === 'app' ? APP_UKEY : UKEY);

// "Page views": $pageview on the website, $screen in the app.
export const pageviewEvent = (platform) => (normPlatform(platform) === 'app' ? '$screen' : '$pageview');

// Where a visitor is. The app's server-side app_opened carries the website server's
// location, so geo cuts of app traffic leave it out.
export const geoEventsClause = (platform) => (normPlatform(platform) === 'app' ? " AND event != 'app_opened'" : '');

// The funnel, top to bottom: [label, HogQL condition]. The first step is everyone.
export function funnelSteps(platform) {
  if (normPlatform(platform) === 'app') {
    return [
      ['Opened the app', '1'],
      ['Searched', "event = 'search_applied'"],
      ['Viewed a property', "event = 'property_viewed'"],
      ['Saved a property', "event = 'property_saved'"],
      ['Contacted a seller', CONTACT_IN],
      ['Signed in', "event IN ('user_signed_up', 'user_logged_in') OR coalesce(person.properties.email, '') != ''"],
      // publishing happens on the website, in the phone's browser (the app's publish_tapped)
      ['Tapped Publish', "event = 'publish_tapped'"],
    ];
  }
  return [
    // everyone who used the site in the window — same number as the Unique users card
    ['Visited the site', '1'],
    ['Searched', "event = 'search_applied'"],
    ['Viewed a property', "event = 'property_viewed'"],
    ['Saved a property', "event = 'property_saved'"],
    ['Contacted a seller', CONTACT_IN],
    ['Listed a property', "event = 'listing_created'"],
    // tapped the App Store / Google Play badge on the website (buyer components/AppBadges.js),
    // anywhere: the pop-up, the bottom bar, a page. The total stays as it always was; the two
    // rows under it split it by store (every click carries properties.store since the start,
    // so the split covers past clicks too).
    ['Clicked an app button', "event = 'app_badge_clicked'"],
    ['Clicked Android app button', "event = 'app_badge_clicked' AND properties.store = 'google_play'"],
    ['Clicked iPhone app button', "event = 'app_badge_clicked' AND properties.store = 'app_store'"],
  ];
}

// ONE scan for the summary cards + funnel (PostHog queues queries it gets at the same
// time). `where` is the caller's filter (geo + country site + platform). Columns:
// pageviews, unique users, pageviews today, users today, then one per funnel step.
export function summarySql({ days, where, platform }) {
  const key = ukeyFor(platform);
  const pv = pageviewEvent(platform);
  const steps = funnelSteps(platform).map(([, cond]) => (cond === '1' ? `uniqExact(${key})` : `uniqExactIf(${key}, ${cond})`));
  return `SELECT countIf(event = '${pv}'), uniqExact(${key}),
               countIf(event = '${pv}' AND toDate(timestamp) = today()), uniqExactIf(${key}, toDate(timestamp) = today()),
               ${steps.join(', ')}
             FROM events WHERE timestamp >= now() - INTERVAL ${Number(days)} DAY AND ${where}`;
}

// The summary row → the response's totals / today / funnel.
export function summaryFromRow(row, platform) {
  const v = (row || []).map((x) => Number(x || 0));
  return {
    totals: { pageviews: v[0] || 0, uniqueUsers: v[1] || 0 },
    today: { pageviews: v[2] || 0, uniqueUsers: v[3] || 0 },
    funnel: funnelSteps(platform).map(([step], i) => ({ step, persons: v[4 + i] || 0 })),
  };
}
