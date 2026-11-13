// Which Casa Libre country site a PostHog event came from (one PostHog project
// serves every country), and the HogQL filter that scopes Analytics to the country
// picked in the admin's header switcher. Pure — unit-tested in test/analyticsSite.test.js.
//
// Order of trust:
//   1. a host that can only be one country (its own domain, or its staging host on
//      apps.airosofts.com) — a site deployed without its country env var would
//      otherwise stamp the default 'py' into site_country;
//   2. site_country, which the buyer portal registers on every event (COUNTRY.code);
//   3. 'py' — every real visit before site_country existed was casa-libre.com.py.

// country → regex (HogQL / re2, case-insensitive) of the hosts that belong to it.
export const SITE_HOSTS = {
  bo: String.raw`casa-libre\.com\.bo`,
  uy: String.raw`(^|\.)uy\.casa-libre\.com`,
  ve: String.raw`casa-libre\.com\.ve`,
  // El Salvador: sv.casa-libre.com since 2026-11-06 (and its airosofts staging host)
  sv: String.raw`(^|\.)sv\.casa-libre\.com|casa-libre\.com\.sv|casa-libre-el-salvador\.apps\.airosofts\.com`,
};

// The two Spanish funnel sites (vender-mi-casa, como-vender-mas-propiedades) send to the
// same PostHog project with funnel_site set and NO site_country, so without this they would
// fall through to 'py' and count as Paraguay main-site visitors. They get their own bucket
// ('funnel'), which no country filter matches, and NOT_FUNNEL keeps them out of the
// all-sites view too. Their numbers live on Admin → Funnels (lib/funnelAnalytics.js).
export const IS_FUNNEL = `coalesce(toString(properties.funnel_site), '') != ''`;
export const NOT_FUNNEL = `coalesce(toString(properties.funnel_site), '') = ''`;

// HogQL string literal ('…' with \ and ' escaped).
const lit = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export const SITE_EXPR = `
  multiIf(
    ${IS_FUNNEL}, 'funnel',
${Object.entries(SITE_HOSTS).map(([cc, re]) => `    match(coalesce(properties.$host, ''), ${lit(`(?i)(${re})`)}), '${cc}',`).join('\n')}
    coalesce(properties.site_country, '') != '', lower(properties.site_country),
    'py'
  )`;

// The same decision in JS (tests, and anything that has an event's props in hand).
export function siteOf(props = {}) {
  if (props.funnel_site) return 'funnel';
  const host = String(props.$host || '');
  for (const [cc, re] of Object.entries(SITE_HOSTS)) if (new RegExp(re, 'i').test(host)) return cc;
  if (props.site_country) return String(props.site_country).toLowerCase();
  return 'py';
}

// Any country code → only that country site's traffic (a country with no site yet
// shows its own, empty, numbers — never another country's). No country → all main sites.
// Funnel-site events are never in either (SITE_EXPR puts them in 'funnel').
export function siteClause(site) {
  const s = String(site || '').toLowerCase();
  return /^[a-z]{2}$/.test(s) ? ` AND ${SITE_EXPR} = '${s}'` : ` AND ${NOT_FUNNEL}`;
}
