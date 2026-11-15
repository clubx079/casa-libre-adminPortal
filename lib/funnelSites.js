// The six Casa-Libre SEO sites (Roland's domains, Nov 2026) as the admin sees them. Each is its own website and repo;
// this file is only how the admin names them and recognises their traffic and leads.
//
// How a site is recognised:
//  - PostHog events: properties.funnel_domain (the site's own domain). Events sent before funnel_domain existed (the
//    temporary hosts funnel-owners / funnel-agents.apps.airosofts.com) are mapped from funnel_site + funnel_country.
//  - Visits they send to Casa-Libre: utm_source = the domain without dots (comovendermicasarapidoorg …),
//    utm_medium = funnel | library, utm_campaign = seo-<country>.
//  - Leads (public.funnel_leads): site = 'owners' (.org) or 'owners2' (.online). Until a country DB allows 'owners2',
//    the .online site saves its leads as 'owners' with form_location = 'owners2'.
// Pure: imported by API routes, pages and test/funnelSites.test.js.

export const FUNNEL_SITE_LIST = [
  { key: 'org', domain: 'comovendermicasarapido.org', label: 'Owners · .org', short: 'Owners .org', kind: 'owners', countries: ['py', 'bo', 'uy', 've', 'sv'] },
  { key: 'online', domain: 'comovendermicasarapido.online', label: 'Owners · hard cases (.online)', short: 'Owners .online', kind: 'owners', countries: ['py'] },
  { key: 'agpy', domain: 'agenteinmobiliarioparaguay.com', label: 'Agents · Paraguay', short: 'Agents PY', kind: 'agents', countries: ['py'] },
  { key: 'agbo', domain: 'agenteinmobiliariobolivia.com', label: 'Agents · Bolivia', short: 'Agents BO', kind: 'agents', countries: ['bo'] },
  { key: 'libpy', domain: 'laparaguayainmobiliaria.com', label: 'Library · Paraguay', short: 'Library PY', kind: 'library', countries: ['py'] },
  { key: 'libbo', domain: 'inmobiliariabolivia.org', label: 'Library · Bolivia', short: 'Library BO', kind: 'library', countries: ['bo'] },
];
// The agents guides of Uruguay, Venezuela and El Salvador only ever lived on the temporary host.
export const LEGACY_AGENTS = { key: 'agents-old', domain: 'funnel-agents.apps.airosofts.com', label: 'Agents · temporary host', short: 'Agents (temp.)', kind: 'agents', countries: ['uy', 've', 'sv'] };

export const FUNNEL_SITE_KEYS = FUNNEL_SITE_LIST.map((s) => s.key);
const ALL = [...FUNNEL_SITE_LIST, LEGACY_AGENTS];
export const funnelSite = (key) => ALL.find((s) => s.key === key) || null;
export const funnelSiteLabel = (key) => funnelSite(key)?.label || key || '—';
export const funnelSiteDomain = (key) => funnelSite(key)?.domain || '';
export const OWNER_SITE_KEYS = FUNNEL_SITE_LIST.filter((s) => s.kind === 'owners').map((s) => s.key);

/** The sites that have pages for a country (the tabs of Admin → Funnels for that country). */
export const sitesForCountry = (cc) => FUNNEL_SITE_LIST.filter((s) => !cc || s.countries.includes(cc));

/** 'all' or one of the six keys (or the legacy agents key). */
export const normFunnelSite = (s) => (ALL.some((x) => x.key === s) ? s : 'all');

// ---- PostHog: which site an event belongs to (HogQL) ----
const DOM = `lower(coalesce(toString(properties.funnel_domain), ''))`;
const FS = `lower(coalesce(toString(properties.funnel_site), ''))`;
const FC = `lower(coalesce(toString(properties.funnel_country), ''))`;
export const FUNNEL_KEY_EXPR = `multiIf(
    ${FUNNEL_SITE_LIST.map((s) => `${DOM} = '${s.domain}', '${s.key}'`).join(',\n    ')},
    ${FS} = 'owners2', 'online',
    ${FS} = 'owners', 'org',
    ${FS} = 'agents' AND ${FC} = 'bo', 'agbo',
    ${FS} = 'agents' AND ${FC} = 'py', 'agpy',
    ${FS} = 'agents', '${LEGACY_AGENTS.key}',
    ${FS} = 'library' AND ${FC} = 'bo', 'libbo',
    ${FS} = 'library', 'libpy',
    'other')`;

// ---- Visits the sites send to Casa-Libre: utm_source → site ----
// utm_source of each site (its domain without dots), plus the two temporary hosts' sources.
export const UTM_SOURCE_TO_SITE = {
  ...Object.fromEntries(FUNNEL_SITE_LIST.map((s) => [s.domain.replace(/\./g, ''), s.key])),
  vendermicasa: 'org',
  comovendermaspropiedades: 'agpy',
};
/** The source name shown in "Where visitors come from" and the Users table for a funnel site. */
export const funnelSourceName = (key) => `funnel · ${funnelSiteDomain(key) || key}`;

// HogQL branch for lib/posthogSql.js SOURCE_EXPR: a visit tagged by one of the sites → 'funnel · <domain>'.
const SRC = `lower(coalesce(properties.utm_source, ''))`;
export const FUNNEL_SOURCE_BRANCHES = Object.entries(UTM_SOURCE_TO_SITE)
  .map(([utm, key]) => `${SRC} = '${utm}', '${funnelSourceName(key)}'`).join(',\n    ');

// ---- Leads ----
/** Which site a funnel_leads row came from. */
export function leadSiteKey(r) {
  const site = String(r?.site || '').toLowerCase();
  const loc = String(r?.form_location || '').toLowerCase();
  const cc = String(r?.country || '').toLowerCase();
  if (site === 'owners2' || loc === 'owners2') return 'online';
  if (site === 'owners') return 'org';
  if (site === 'agents') return cc === 'bo' ? 'agbo' : cc === 'py' ? 'agpy' : LEGACY_AGENTS.key;
  return site || 'org';
}
