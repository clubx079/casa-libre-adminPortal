// Website vs app on the Analytics page. One PostHog project gets both: the website
// (posthog-js) and the mobile app (posthog-react-native, casa-libre-mobile-app
// lib/analytics.js), with the SAME event names (property_viewed, contact_*_click,
// property_saved, search_applied …). The app's events are told apart by:
//   • $lib = 'posthog-react-native'  (the SDK stamps it on every event)
//   • platform = 'mobile'            (the app registers it on every event)
//   • event = 'app_opened'           (the app's launch ping, recorded server-side by the
//                                     website's /api/mobile/install — no $lib, and its IP /
//                                     geo is the website server's, not the phone's)
// iPhone vs Android inside the app's events: $os ('iOS' / 'iPadOS' / 'Android', stamped by
// the SDK on every event, even the ones before the app registers its properties),
// app_platform (the app's own 'ios' | 'android') and, on the app_opened ping, platform
// ('ios' | 'android'). $os alone is not enough: the website's posthog-js sets it too (an
// iPhone browsing the website has $os iOS), so it only counts together with IS_APP.
// The "User analytics" tab is website-only, the "iPhone users" and "Android users" tabs
// app-only (one phone system each), and the "Property analytics" tab stays all platforms (it must match the view counts sellers get
// by email, which count every property_viewed).
// Pure — unit-tested in test/analyticsPlatform.test.js.
import { UKEY, CONTACT_IN } from './posthogSql.js';

export const APP_LIB = 'posthog-react-native';

// Older app_opened pings carry the website server's IP; newer ones the phone's (ip_source).
export const HAS_PHONE_IP = `(event != 'app_opened' OR coalesce(properties.ip_source, '') = 'phone')`;
export const IS_APP = `(coalesce(properties.$lib, '') = '${APP_LIB}' OR coalesce(properties.platform, '') = 'mobile' OR event = 'app_opened')`;

// The same decision in JS (tests, and anything holding an event in hand).
export const isAppEvent = (event, props = {}) =>
  props.$lib === APP_LIB || props.platform === 'mobile' || event === 'app_opened';

// One phone system of the app's events. Events missing all three properties would be in
// neither tab; the app has none (checked against PostHog, Nov 2026).
const appOs = (osNames, name) =>
  `(${IS_APP} AND (coalesce(properties.$os, '') IN (${osNames.map((o) => `'${o}'`).join(', ')}) OR coalesce(properties.app_platform, '') = '${name}' OR (event = 'app_opened' AND coalesce(properties.platform, '') = '${name}')))`;
export const IS_IOS = appOs(['iOS', 'iPadOS'], 'ios');
export const IS_ANDROID = appOs(['Android'], 'android');

// The same decision in JS: 'ios' | 'android' | null (not an app event, or unknown).
export function appOsOf(event, props = {}) {
  if (!isAppEvent(event, props)) return null;
  if (props.$os === 'iOS' || props.$os === 'iPadOS' || props.app_platform === 'ios' || (event === 'app_opened' && props.platform === 'ios')) return 'ios';
  if (props.$os === 'Android' || props.app_platform === 'android' || (event === 'app_opened' && props.platform === 'android')) return 'android';
  return null;
}

export const PLATFORMS = ['web', 'app', 'ios', 'android', 'all'];

// Anything unknown → the fallback (the website, unless the caller says otherwise).
export function normPlatform(p, fallback = 'web') {
  const s = String(p || '').toLowerCase();
  if (s === 'mobile') return 'app';
  if (s === 'iphone') return 'ios';
  return PLATFORMS.includes(s) ? s : fallback;
}

// The app, whole or one phone system: all three read the app's events the same way
// (screens, per-phone visitors, the app funnel).
export const isAppPlatform = (p) => ['app', 'ios', 'android'].includes(normPlatform(p));

// HogQL to AND onto a WHERE: web → no app events; app → only app events; ios / android →
// only that phone system's app events; all → nothing.
export function platformClause(platform) {
  const p = normPlatform(platform);
  if (p === 'app') return ` AND ${IS_APP}`;
  if (p === 'ios') return ` AND ${IS_IOS}`;
  if (p === 'android') return ` AND ${IS_ANDROID}`;
  if (p === 'web') return ` AND NOT ${IS_APP}`;
  return '';
}

// One visitor. Website: a signed-in person by person_id, an anonymous one by IP (see
// lib/posthogSql.js UKEY). App: phones on mobile data share carrier IPs (CGNAT), so an
// anonymous phone counts by its own distinct id instead — the app makes that the install
// id (`install:<id>`, the same one its app_opened ping uses).
export const APP_UKEY = `if(coalesce(person.properties.email, '') != '', toString(person_id), distinct_id)`;
export const ukeyFor = (platform) => (isAppPlatform(platform) ? APP_UKEY : UKEY);

// "Page views": $pageview on the website, $screen in the app.
export const pageviewEvent = (platform) => (isAppPlatform(platform) ? '$screen' : '$pageview');

// Where a visitor is. The app's server-side app_opened carries the website server's
// location, so geo cuts of app traffic leave it out.
export const geoEventsClause = (platform) => (isAppPlatform(platform) ? " AND event != 'app_opened'" : '');

// The funnel, top to bottom: [label, HogQL condition]. The first step is everyone.
export function funnelSteps(platform) {
  if (isAppPlatform(platform)) {
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
    // anywhere: the pop-up, the bottom bar, a page — one row per store (every click carries
    // properties.store since the start, so past clicks count too). The combined "Clicked an
    // app button" row was removed (user, Nov 6 2026).
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
