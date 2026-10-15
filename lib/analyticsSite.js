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
  // El Salvador runs on its airosofts host until casa-libre.com.sv is live.
  sv: String.raw`casa-libre\.com\.sv|casa-libre-el-salvador\.apps\.airosofts\.com`,
};

// HogQL string literal ('…' with \ and ' escaped).
const lit = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export const SITE_EXPR = `
  multiIf(
${Object.entries(SITE_HOSTS).map(([cc, re]) => `    match(coalesce(properties.$host, ''), ${lit(`(?i)(${re})`)}), '${cc}',`).join('\n')}
    coalesce(properties.site_country, '') != '', lower(properties.site_country),
    'py'
  )`;

// The same decision in JS (tests, and anything that has an event's props in hand).
export function siteOf(props = {}) {
  const host = String(props.$host || '');
  for (const [cc, re] of Object.entries(SITE_HOSTS)) if (new RegExp(re, 'i').test(host)) return cc;
  if (props.site_country) return String(props.site_country).toLowerCase();
  return 'py';
}

// Any country code → only that country site's traffic (a country with no site yet
// shows its own, empty, numbers — never another country's). No country → all sites.
export function siteClause(site) {
  const s = String(site || '').toLowerCase();
  return /^[a-z]{2}$/.test(s) ? ` AND ${SITE_EXPR} = '${s}'` : '';
}
