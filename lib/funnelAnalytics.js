// PostHog numbers for the two funnel sites (Admin → Funnels → Analytics, and the
// "Funnel sites" card on Analytics). The funnel sites send to the same PostHog project as
// the main site, with super properties funnel_site ('owners' | 'agents'), funnel_country
// (py|bo|uy|ve|sv) and funnel_page (the page slug). Events: $pageview, $pageleave,
// form_start, form_step_complete, generate_lead, cl_click (href, utm_content, position).
// Pure — test/funnelLeads.test.js. The main-site numbers leave these events out
// (lib/analyticsSite.js NOT_FUNNEL / SITE_EXPR 'funnel').
import { UKEY, SOURCE_EXPR, GEO_BASE } from './posthogSql.js';
import { IS_FUNNEL } from './analyticsSite.js';

export const FUNNEL_DAYS = [7, 28, 90];
// The main Analytics page passes its own range (7/30/90/180/365): accepted for the summary.
const ALL_DAYS = [7, 28, 30, 90, 180, 365];
export const normFunnelDays = (d) => (ALL_DAYS.includes(Number(d)) ? Number(d) : 7);

const SITES = ['owners', 'agents'];
// Only the funnel sites' own events: lets PostHog skip most of the project's rows (fast enough
// not to hit its query time limit).
export const FUNNEL_EVENTS = ['$pageview', '$pageleave', 'form_start', 'form_step_complete', 'generate_lead', 'cl_click'];
const COUNTRIES = ['py', 'bo', 'uy', 've', 'sv'];

// WHERE for funnel events: site ('owners' | 'agents' | anything else = both) and
// countries (an array of codes; empty = every country). Never trusts the input.
export function funnelWhere({ days, site, countries = [] }) {
  const parts = [
    `timestamp >= now() - INTERVAL ${normFunnelDays(days)} DAY`,
    `event IN (${FUNNEL_EVENTS.map((e) => `'${e}'`).join(', ')})`,
    IS_FUNNEL, GEO_BASE,
  ];
  if (SITES.includes(site)) parts.push(`toString(properties.funnel_site) = '${site}'`);
  const cc = (countries || []).map((c) => String(c).toLowerCase()).filter((c) => COUNTRIES.includes(c));
  if (cc.length) parts.push(`lower(toString(properties.funnel_country)) IN (${cc.map((c) => `'${c}'`).join(', ')})`);
  return parts.join(' AND ');
}

const PAGE = `coalesce(nullIf(toString(properties.funnel_page), ''), '(home)')`;

// One scan → visitors, pageviews, form starts (events + people), step completes, leads
// (events + people), Casa-Libre clicks (events + people).
export const summarySql = (where) => `SELECT
    uniqExact(${UKEY}),
    countIf(event = '$pageview'),
    countIf(event = 'form_start'), uniqExactIf(${UKEY}, event = 'form_start'),
    countIf(event = 'form_step_complete'),
    countIf(event = 'generate_lead'), uniqExactIf(${UKEY}, event = 'generate_lead'),
    countIf(event = 'cl_click'), uniqExactIf(${UKEY}, event = 'cl_click')
  FROM events WHERE ${where}`;

export function summaryFromRow(row) {
  const v = (row || []).map((x) => Number(x || 0));
  const visitors = v[0] || 0;
  const leadPeople = v[6] || 0;
  return {
    visitors,
    pageviews: v[1] || 0,
    formStarts: v[2] || 0,
    formStarters: v[3] || 0,
    stepCompletes: v[4] || 0,
    leads: v[5] || 0,
    leadPeople,
    clClicks: v[7] || 0,
    clClickers: v[8] || 0,
    conversion: visitors ? Math.round((leadPeople / visitors) * 10000) / 100 : 0,   // % of visitors who became a lead
  };
}

export const bySiteSql = (where) => `SELECT toString(properties.funnel_site) AS s, uniqExact(${UKEY}),
    countIf(event = '$pageview'), countIf(event = 'generate_lead'), countIf(event = 'cl_click')
  FROM events WHERE ${where} GROUP BY s ORDER BY 2 DESC`;

export const byCountrySql = (where) => `SELECT lower(toString(properties.funnel_country)) AS c, uniqExact(${UKEY}),
    countIf(event = '$pageview'), countIf(event = 'generate_lead')
  FROM events WHERE ${where} GROUP BY c ORDER BY 2 DESC`;

export const pagesSql = (where) => `SELECT toString(properties.funnel_site) AS s, ${PAGE} AS p,
    countIf(event = '$pageview') AS views, uniqExactIf(${UKEY}, event = '$pageview') AS visitors,
    countIf(event = 'form_start') AS starts, countIf(event = 'generate_lead') AS leads, countIf(event = 'cl_click') AS clicks
  FROM events WHERE ${where} GROUP BY s, p ORDER BY views DESC, leads DESC LIMIT 40`;

export const sourcesSql = (where) => `SELECT ${SOURCE_EXPR} AS src, uniqExact(${UKEY}) AS visitors,
    countIf(event = '$pageview') AS views, countIf(event = 'generate_lead') AS leads
  FROM events WHERE ${where} GROUP BY src ORDER BY visitors DESC LIMIT 15`;

export const clicksSql = (where) => `SELECT coalesce(nullIf(toString(properties.position), ''), '—') AS pos,
    coalesce(nullIf(toString(properties.utm_content), ''), '—') AS content, count() AS clicks, uniqExact(${UKEY}) AS people
  FROM events WHERE ${where} AND event = 'cl_click' GROUP BY pos, content ORDER BY clicks DESC LIMIT 15`;

export const dailySql = (where, tz = 'America/Asuncion') => `SELECT toString(toDate(toTimeZone(timestamp, '${tz}'))) AS d,
    uniqExact(${UKEY}), countIf(event = '$pageview'), countIf(event = 'form_start'), countIf(event = 'generate_lead'), countIf(event = 'cl_click')
  FROM events WHERE ${where} GROUP BY d ORDER BY d`;

const num = (x) => Number(x || 0);

// Fill every day of the window (days with no events show as 0).
export function dailyFromRows(rows, days, today) {
  const by = new Map(rows.map((r) => [String(r[0]), r]));
  const out = [];
  const end = new Date(`${today}T00:00:00Z`);
  for (let i = normFunnelDays(days) - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    const r = by.get(d);
    out.push({ date: d, visitors: num(r?.[1]), pageviews: num(r?.[2]), formStarts: num(r?.[3]), leads: num(r?.[4]), clClicks: num(r?.[5]) });
  }
  return out;
}

export const bySiteFromRows = (rows) => rows.map((r) => ({ site: r[0] || '—', visitors: num(r[1]), pageviews: num(r[2]), leads: num(r[3]), clClicks: num(r[4]) }));
export const byCountryFromRows = (rows) => rows.map((r) => ({ country: r[0] || '—', visitors: num(r[1]), pageviews: num(r[2]), leads: num(r[3]) }));
export const pagesFromRows = (rows) => rows.map((r) => ({ site: r[0] || '—', page: r[1], views: num(r[2]), visitors: num(r[3]), formStarts: num(r[4]), leads: num(r[5]), clClicks: num(r[6]) }));
export const sourcesFromRows = (rows) => rows.map((r) => ({ source: r[0] || 'direct', visitors: num(r[1]), pageviews: num(r[2]), leads: num(r[3]) }));
export const clicksFromRows = (rows) => rows.map((r) => ({ position: r[0], content: r[1], clicks: num(r[2]), people: num(r[3]) }));
