// AI SEO for the six Casa-Libre SEO sites — the scope helpers (pure — test/seoSites.test.js).
// Every seo_* row of a site lives in the PY country DB (dbFor('py')) with country = 'site:<key>'
// (e.g. 'site:agpy'); the buyer pipeline's rows keep country = 'py' | 'bo' | … and never mix.
//   scopeOf('agpy') → 'site:agpy'          siteKeyOf('site:agpy') → 'agpy'
//   siteFor('agpy' | 'agenteinmobiliarioparaguay.com') → the FUNNEL_SITE_LIST entry (+ rootCountry, medium)
//   siteUrl(key)        SEO_SITE_URL_<KEY> (local: http://localhost:3053) else https://<domain>
//   guidePath(site, cc, slug)   '/<slug>' for the site's root country, '/<prefix>/<slug>' for the others
//   clLink(site, cc, path, content)   a Casa-Libre link of the guide's country with the site's UTM tags
import { FUNNEL_SITE_LIST } from '../funnelSites.js';

export const SITE_PREFIX = 'site:';
export const SITE_KEYS = FUNNEL_SITE_LIST.map((s) => s.key);
export const scopeOf = (key) => `${SITE_PREFIX}${key}`;
export const isSiteScope = (v) => typeof v === 'string' && v.startsWith(SITE_PREFIX) && SITE_KEYS.includes(v.slice(SITE_PREFIX.length));
export const siteKeyOf = (scope) => (isSiteScope(scope) ? scope.slice(SITE_PREFIX.length) : null);

// The URL prefix of each country on the sites (lib/countries.js of every site repo; the root country has none).
export const COUNTRY_PREFIX = { py: 'paraguay', bo: 'bolivia', uy: 'uruguay', ve: 'venezuela', sv: 'el-salvador' };
export const COUNTRY_NAME = { py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela', sv: 'El Salvador' };
// Paraguay + Uruguay write with voseo ("publicá"); Bolivia, Venezuela, El Salvador with tú.
export const VOICE = { py: 'voseo', uy: 'voseo', bo: 'tú', ve: 'tú', sv: 'tú' };
export const CL_ORIGIN = {
  py: 'https://casa-libre.com.py', bo: 'https://casa-libre.com.bo', uy: 'https://uy.casa-libre.com',
  ve: 'https://casa-libre.com.ve', sv: 'https://sv.casa-libre.com',
};
// Where each kind of site sends its readers on Casa-Libre (the sites' lib/site.js ctaPath).
export const CTA_PATH = { owners: '/publicar', agents: '/empresas', library: '/propiedades' };

const decorate = (s) => (s ? { ...s, rootCountry: s.countries[0], medium: s.kind === 'library' ? 'library' : 'funnel' } : null);

/** A site by key or by domain ('www.' and a trailing slash allowed). null = not one of the six. */
export function siteFor(v) {
  const x = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!x) return null;
  return decorate(FUNNEL_SITE_LIST.find((s) => s.key === x || s.domain === x) || null);
}

/** ?site= value → a valid site key, or null. */
export const siteKeyParam = (v) => siteFor(v)?.key || null;

export function siteUrl(key, env = process.env) {
  const s = siteFor(key);
  if (!s) return null;
  const v = env[`SEO_SITE_URL_${s.key.toUpperCase()}`];
  return String(v || `https://${s.domain}`).replace(/\/+$/, '');
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const slugify = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

export function guidePath(site, cc, slug) {
  const s = typeof site === 'string' ? siteFor(site) : site;
  const c = cc && s?.countries.includes(cc) ? cc : s?.rootCountry;
  return c === s?.rootCountry ? `/${slug}` : `/${COUNTRY_PREFIX[c]}/${slug}`;
}

/** '/bolivia/x' on a PY-root site → { cc: 'bo', slug: 'x' }; '/x' → the root country. */
export function parseGuidePath(site, path) {
  const s = typeof site === 'string' ? siteFor(site) : site;
  const parts = String(path || '').split('?')[0].split('/').filter(Boolean);
  if (parts.length === 1) return { cc: s.rootCountry, slug: parts[0] };
  if (parts.length === 2) {
    const cc = Object.keys(COUNTRY_PREFIX).find((k) => COUNTRY_PREFIX[k] === parts[0]);
    if (cc && cc !== s.rootCountry && s.countries.includes(cc)) return { cc, slug: parts[1] };
  }
  return null;
}

/** The site's UTM tags for a Casa-Libre link (lib/utm.js of the sites). */
export function clLink(site, cc, path = '/', content = '') {
  const s = typeof site === 'string' ? siteFor(site) : site;
  const c = CL_ORIGIN[cc] ? cc : s.rootCountry;
  const u = new URL(path || '/', CL_ORIGIN[c]);
  u.searchParams.set('utm_source', s.domain.replace(/\./g, ''));
  u.searchParams.set('utm_medium', s.medium);
  u.searchParams.set('utm_campaign', `seo-${c}`);
  if (content) u.searchParams.set('utm_content', content);
  return u.toString();
}

/** Which of the site's countries a search is about ("… en bolivia" on the .org site → 'bo'); default the root. */
export function countryOfTerm(site, term, page = '') {
  const s = typeof site === 'string' ? siteFor(site) : site;
  const fromPage = page ? parseGuidePath(s, page)?.cc : null;
  if (fromPage) return fromPage;
  const t = fold(term);
  const hit = s.countries.find((cc) => cc !== s.rootCountry && new RegExp(`\\b${fold(COUNTRY_NAME[cc])}\\b`).test(t));
  return hit || s.rootCountry;
}
