// PostHog numbers for the casa-libre.com hub (umbrella site + blog for every country, ES/EN/PT):
// Analytics → Hub tracker. The hub sends to the same PostHog project as the country sites with
// super properties hub_site (true), hub_lang (es|en|pt) and hub_page, host casa-libre.com (or
// www.), and NO site_country. Events: $pageview, $pageleave, hub_country_click {href, country},
// blog_article_view {slug, country, category}, blog_lang_switch, hub_cta_click,
// cl_click {href, utm_content}, form_start, form_submit, form_error, call_confirmed.
// Pure — test/hubAnalytics.test.js. The country-site numbers leave these events out
// (lib/analyticsSite.js NOT_HUB / SITE_EXPR 'hub').
import { UKEY, SOURCE_EXPR, GEO_BASE } from './posthogSql.js';
import { IS_HUB, SITE_HOSTS } from './analyticsSite.js';

export const HUB_DAYS = [7, 28, 90];
// The Analytics page's range control (7/30/90/180/365) drives the tab: all accepted.
const ALL_DAYS = [7, 28, 30, 90, 180, 365];
export const normHubDays = (d) => (ALL_DAYS.includes(Number(d)) ? Number(d) : 7);

// Only the hub's own events: lets PostHog skip most of the project's rows (fast enough not to
// hit its query time limit).
export const HUB_EVENTS = [
  '$pageview', '$pageleave', 'hub_country_click', 'blog_article_view', 'blog_lang_switch', 'hub_cta_click',
  'cl_click', 'form_start', 'form_submit', 'form_error', 'call_confirmed',
];

export function hubWhere({ days }) {
  return [
    `timestamp >= now() - INTERVAL ${normHubDays(days)} DAY`,
    `event IN (${HUB_EVENTS.map((e) => `'${e}'`).join(', ')})`,
    IS_HUB, GEO_BASE,
  ].join(' AND ');
}

const lit = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const PROP = (k) => `coalesce(nullIf(toString(properties.${k}), ''), '')`;

// Which country site a link points at (cl_click href). Like SITE_HOSTS, but on a whole URL
// (a subdomain follows '//' or '.', not the start of the string), plus .com.py.
export const HREF_HOSTS = {
  py: String.raw`casa-libre\.com\.py`,
  bo: SITE_HOSTS.bo,
  uy: String.raw`[/.]uy\.casa-libre\.com|casa-libre\.com\.uy`,
  ve: SITE_HOSTS.ve,
  sv: String.raw`[/.]sv\.casa-libre\.com|casa-libre\.com\.sv|casa-libre-el-salvador\.apps\.airosofts\.com`,
};
export const HREF_COUNTRY_EXPR = `multiIf(
${Object.entries(HREF_HOSTS).map(([cc, re]) => `    match(${PROP('href')}, ${lit(`(?i)(${re})`)}), '${cc}',`).join('\n')}
    'other'
  )`;
export function countryOfHref(href) {
  for (const [cc, re] of Object.entries(HREF_HOSTS)) if (new RegExp(re, 'i').test(String(href || ''))) return cc;
  return 'other';
}

const PAGE = `coalesce(nullIf(toString(properties.hub_page), ''), nullIf(toString(properties.$pathname), ''), '/')`;
const LANG = `coalesce(nullIf(lower(toString(properties.hub_lang)), ''), '—')`;

// One scan → visitors, pageviews, blog article views, country-site clicks, Casa-Libre clicks,
// CTA clicks, form starts / submits / errors, call confirmations (+ people for the main ones).
export const summarySql = (where) => `SELECT
    uniqExact(${UKEY}),
    countIf(event = '$pageview'),
    countIf(event = 'blog_article_view'),
    countIf(event = 'hub_country_click'), uniqExactIf(${UKEY}, event = 'hub_country_click'),
    countIf(event = 'cl_click'), uniqExactIf(${UKEY}, event = 'cl_click'),
    countIf(event = 'hub_cta_click'),
    countIf(event = 'form_start'), uniqExactIf(${UKEY}, event = 'form_start'),
    countIf(event = 'form_submit'), uniqExactIf(${UKEY}, event = 'form_submit'),
    countIf(event = 'form_error'),
    countIf(event = 'call_confirmed'),
    countIf(event = 'blog_lang_switch')
  FROM events WHERE ${where}`;

const num = (x) => Number(x || 0);

export function summaryFromRow(row) {
  const v = (row || []).map(num);
  const visitors = v[0] || 0;
  const pageviews = v[1] || 0;
  return {
    visitors,
    pageviews,
    pagesPerVisitor: visitors ? Math.round((pageviews / visitors) * 100) / 100 : 0,
    articleViews: v[2] || 0,
    countryClicks: v[3] || 0, countryClickers: v[4] || 0,
    clClicks: v[5] || 0, clClickers: v[6] || 0,
    ctaClicks: v[7] || 0,
    formStarts: v[8] || 0, formStarters: v[9] || 0,
    formSubmits: v[10] || 0, formSubmitters: v[11] || 0,
    formErrors: v[12] || 0,
    callsConfirmed: v[13] || 0,
    langSwitches: v[14] || 0,
  };
}

export const dailySql = (where, tz = 'America/Asuncion') => `SELECT toString(toDate(toTimeZone(timestamp, '${tz}'))) AS d,
    uniqExact(${UKEY}), countIf(event = '$pageview'), countIf(event = 'blog_article_view'), countIf(event IN ('hub_country_click', 'cl_click'))
  FROM events WHERE ${where} GROUP BY d ORDER BY d`;

// Fill every day of the window (days with no events show as 0).
export function dailyFromRows(rows, days, today) {
  const by = new Map(rows.map((r) => [String(r[0]), r]));
  const out = [];
  const end = new Date(`${today}T00:00:00Z`);
  for (let i = normHubDays(days) - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    const r = by.get(d);
    out.push({ date: d, visitors: num(r?.[1]), pageviews: num(r?.[2]), articleViews: num(r?.[3]), sends: num(r?.[4]) });
  }
  return out;
}

export const pagesSql = (where) => `SELECT ${PAGE} AS p, count() AS views, uniqExact(${UKEY}) AS visitors
  FROM events WHERE ${where} AND event = '$pageview' GROUP BY p ORDER BY views DESC LIMIT 30`;

export const articlesSql = (where) => `SELECT ${PROP('slug')} AS slug, lower(${PROP('country')}) AS c, any(${PROP('category')}) AS cat,
    count() AS views, uniqExact(${UKEY}) AS visitors
  FROM events WHERE ${where} AND event = 'blog_article_view' GROUP BY slug, c ORDER BY views DESC LIMIT 30`;

export const blogCountrySql = (where) => `SELECT coalesce(nullIf(lower(${PROP('country')}), ''), '—') AS c, uniqExact(${UKEY}) AS visitors, count() AS views
  FROM events WHERE ${where} AND event = 'blog_article_view' GROUP BY c ORDER BY visitors DESC`;

export const langSql = (where) => `SELECT ${LANG} AS l, uniqExact(${UKEY}) AS visitors, countIf(event = '$pageview') AS views
  FROM events WHERE ${where} GROUP BY l ORDER BY visitors DESC`;

// What the hub sends to each country site: hub_country_click (its own country prop) and
// cl_click from the blog (country read from the link's host).
export const sendsSql = (where) => `SELECT
    if(event = 'hub_country_click', coalesce(nullIf(lower(${PROP('country')}), ''), ${HREF_COUNTRY_EXPR}), ${HREF_COUNTRY_EXPR}) AS c,
    countIf(event = 'hub_country_click') AS country_clicks, countIf(event = 'cl_click') AS cl_clicks, uniqExact(${UKEY}) AS people
  FROM events WHERE ${where} AND event IN ('hub_country_click', 'cl_click') GROUP BY c ORDER BY country_clicks + cl_clicks DESC`;

export const clContentSql = (where) => `SELECT coalesce(nullIf(toString(properties.utm_content), ''), '—') AS content, count() AS clicks, uniqExact(${UKEY}) AS people
  FROM events WHERE ${where} AND event = 'cl_click' GROUP BY content ORDER BY clicks DESC LIMIT 15`;

export const sourcesSql = (where) => `SELECT ${SOURCE_EXPR} AS src, uniqExact(${UKEY}) AS visitors, countIf(event = '$pageview') AS views
  FROM events WHERE ${where} GROUP BY src ORDER BY visitors DESC LIMIT 15`;

export const geoSql = (where) => `SELECT coalesce(nullIf(toString(properties.$geoip_country_name), ''), 'Unknown') AS g, uniqExact(${UKEY}) AS visitors, countIf(event = '$pageview') AS views
  FROM events WHERE ${where} GROUP BY g ORDER BY visitors DESC LIMIT 20`;

export const pagesFromRows = (rows) => rows.map((r) => ({ page: r[0] || '/', views: num(r[1]), visitors: num(r[2]) }));
export const articlesFromRows = (rows) => rows.map((r) => ({ slug: r[0] || '—', country: r[1] || '', category: r[2] || '', views: num(r[3]), visitors: num(r[4]) }));
export const blogCountryFromRows = (rows) => rows.map((r) => ({ country: r[0] || '—', visitors: num(r[1]), views: num(r[2]) }));
export const langFromRows = (rows) => rows.map((r) => ({ lang: r[0] || '—', visitors: num(r[1]), views: num(r[2]) }));
export const sendsFromRows = (rows) => rows.map((r) => ({ country: r[0] || 'other', countryClicks: num(r[1]), clClicks: num(r[2]), people: num(r[3]) }));
export const clContentFromRows = (rows) => rows.map((r) => ({ content: r[0], clicks: num(r[1]), people: num(r[2]) }));
export const sourcesFromRows = (rows) => rows.map((r) => ({ source: r[0] || 'direct', visitors: num(r[1]), views: num(r[2]) }));
export const geoFromRows = (rows) => rows.map((r) => ({ country: r[0] || 'Unknown', visitors: num(r[1]), views: num(r[2]) }));
