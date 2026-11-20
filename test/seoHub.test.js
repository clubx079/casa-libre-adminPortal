// AI SEO for the casa-libre.com hub (key 'hub', kind 'hub') — scope, relevance, one-topic-once, guide paths, feed.
import { describe, it, expect } from 'vitest';
import { scopeOf, siteKeyOf, isSiteScope, siteFor, siteKeyParam, siteUrl, siteDomain, guidePath, parseGuidePath, clLink, countryOfTerm, SITE_KEYS, HUB_SITE, isHub, gscBody } from '../lib/seoSites/scope.js';
import { isRelevant, isHubRelevant, countriesIn, hubTopicKey } from '../lib/seoSites/relevance.js';
import { decideSite, improveSite, knownGuides, siteTitleFromQuery } from '../lib/seoSites/decide.js';
import { cleanGuide, linksCasaLibre } from '../lib/seoSites/sanitize.js';
import { guideToRow, rowToGuide, buildFeed } from '../lib/seoSites/shape.js';
import { FUNNEL_SITE_LIST, FUNNEL_SITE_KEYS } from '../lib/funnelSites.js';
import { DEFAULT_SETTINGS } from '../lib/seo/settings.js';

const hub = siteFor('hub');
const settings = { ...DEFAULT_SETTINGS, thresholds: { ...DEFAULT_SETTINGS.thresholds, guideMinDemand: 1 } };
const sig = (term, page, m, source = 'gsc') => ({ source, term, page, date: '2026-11-19', metrics: m });

describe('hub scope', () => {
  it('is a pipeline site, not a funnel site', () => {
    expect(SITE_KEYS).toContain('hub');
    expect(FUNNEL_SITE_KEYS).not.toContain('hub');
    expect(FUNNEL_SITE_LIST.some((s) => s.domain === 'casa-libre.com')).toBe(false);
    expect(scopeOf('hub')).toBe('site:hub');
    expect(siteKeyOf('site:hub')).toBe('hub');
    expect(isSiteScope('site:hub')).toBe(true);
    expect(isHub(hub)).toBe(true);
    expect(isHub(siteFor('agpy'))).toBe(false);
  });
  it('found by key or domain (www, scheme, slash), never by a look-alike', () => {
    expect(siteFor('casa-libre.com').key).toBe('hub');
    expect(siteFor('https://www.casa-libre.com/').key).toBe('hub');
    expect(siteKeyParam('HUB')).toBe('hub');
    expect(siteKeyParam('casa-libre.com.py')).toBe(null);
    expect(siteDomain('hub')).toBe('casa-libre.com');
    expect(siteDomain('nope')).toBe('');
  });
  it('kind, countries, medium', () => {
    expect(hub).toMatchObject({ kind: 'hub', countries: ['py', 'bo', 'uy', 've', 'sv'], rootCountry: 'py', medium: 'hub' });
    expect(HUB_SITE.utmSource).toBe('casalibrecom');
  });
  it('site URL: SEO_SITE_URL_HUB, else https://casa-libre.com', () => {
    expect(siteUrl('hub', { SEO_SITE_URL_HUB: 'http://localhost:3005/' })).toBe('http://localhost:3005');
    expect(siteUrl('hub', {})).toBe('https://casa-libre.com');
  });
  it('guides live at /guias/<slug> for every country', () => {
    expect(guidePath(hub, 'py', 'x')).toBe('/guias/x');
    expect(guidePath(hub, 'bo', 'x')).toBe('/guias/x');
    expect(guidePath('hub', undefined, 'vivir-en-uruguay')).toBe('/guias/vivir-en-uruguay');
    expect(parseGuidePath(hub, '/guias/vivir-en-uruguay')).toEqual({ cc: 'py', slug: 'vivir-en-uruguay' });
    expect(parseGuidePath(hub, '/vivir-en-uruguay')).toBe(null);
    expect(parseGuidePath(hub, '/guias')).toBe(null);
    expect(parseGuidePath(hub, '/guias/Bad_Slug')).toBe(null);
  });
  it('Casa-Libre links carry the hub UTM tags on any country site', () => {
    for (const cc of ['py', 'bo', 'uy', 've', 'sv']) {
      const u = new URL(clLink(hub, cc, '/propiedades', 'x'));
      expect(u.searchParams.get('utm_source')).toBe('casalibrecom');
      expect(u.searchParams.get('utm_medium')).toBe('hub');
      expect(u.searchParams.get('utm_campaign')).toBe('seo-hub');
      expect(u.searchParams.get('utm_content')).toBe('x');
    }
    expect(new URL(clLink(hub, 'uy')).origin).toBe('https://uy.casa-libre.com');
    // the funnel sites keep their own tags
    expect(new URL(clLink(siteFor('org'), 'bo')).searchParams.get('utm_campaign')).toBe('seo-bo');
  });
  it('Search Console: the hub reads only its own host, never the country subdomains', () => {
    const b = gscBody(hub, { dimensions: ['query'] });
    const re = new RegExp(b.dimensionFilterGroups[0].filters[0].expression);
    expect(b.dimensions).toEqual(['query']);
    for (const u of ['https://casa-libre.com/', 'https://www.casa-libre.com/guias/x', 'https://casa-libre.com']) expect(re.test(u)).toBe(true);
    for (const u of ['https://uy.casa-libre.com/venta', 'https://sv.casa-libre.com/', 'https://casa-libre.com.py/', 'https://casa-libre.community/']) expect(re.test(u)).toBe(false);
    const body = { dimensions: ['page'] };
    expect(gscBody(siteFor('agpy'), body)).toBe(body);   // the funnel sites: unchanged
  });
  it('country of a search = the first Casa-Libre country it names (else Paraguay)', () => {
    expect(countryOfTerm(hub, 'mudarse a uruguay desde argentina')).toBe('uy');
    expect(countryOfTerm(hub, 'vivir en el salvador')).toBe('sv');
    expect(countryOfTerm(hub, 'invertir en latinoamerica', '/guias/x')).toBe('py');
  });
});

describe('hub relevance', () => {
  const yes = [
    'propiedades en latinoamerica', 'invertir en inmuebles en sudamerica', 'invertir en inmuebles en paraguay',
    'inversion inmobiliaria en bolivia', 'mudarse a paraguay', 'vivir en uruguay', 'residencia en paraguay',
    'costo de vida en bolivia', 'comprar casa en paraguay siendo extranjero', 'comprar casa en españa siendo extranjero y vivir en uruguay',
    'que pais de sudamerica es mas barato para vivir', 'mejor pais para invertir en bienes raices', 'paraguay o uruguay para vivir',
    'jubilarse en el salvador', 'portal inmobiliario', '¿Cuál país conviene para comprar una casa?', 'casas en venta en paraguay para extranjeros',
  ];
  const no = [
    'casa libre', 'casalibre paraguay', 'infocasas paraguay inversion', 'departamento en alquiler asuncion', 'casas en venta santa cruz',
    'alquiler departamento montevideo', 'casas en venta en paraguay', 'mudarse a españa', 'costo de vida en argentina',
    'invertir en bolsa', 'como vender mi casa rapido', 'vivir en miami', '', 'propiedades en uruguay',
  ];
  it.each(yes)('takes "%s"', (t) => { expect(isHubRelevant(t)).toBe(true); expect(isRelevant(t, 'hub')).toBe(true); });
  it.each(no)('skips "%s"', (t) => { expect(isHubRelevant(t)).toBe(false); });
  it('does not change the other kinds', () => {
    expect(isRelevant('mudarse a paraguay', 'owners')).toBe(false);
    expect(isRelevant('como captar propiedades', 'hub')).toBe(false);
  });
  it('countries named and the hub topic key keep the countries apart', () => {
    expect(countriesIn('Paraguay o Uruguay: dónde vivir')).toEqual(['py', 'uy']);
    expect(countriesIn('vivir-en-el-salvador')).toEqual(['sv']);
    expect(hubTopicKey('invertir en paraguay')).not.toBe(hubTopicKey('invertir en bolivia'));
    expect(hubTopicKey('invertir en inmuebles en paraguay')).toBe(hubTopicKey('inmuebles en paraguay invertir'));
  });
});

describe('hub decide: one guide per topic, hub-wide', () => {
  it('writes a guide at /guias/<slug> for a relevant search, skips the country-listing ones', () => {
    const opps = decideSite({ site: hub, settings, signals: [
      sig('vivir en uruguay', '/', { clicks: 2, impressions: 120, position: 14 }),
      sig('departamento en alquiler asuncion', '/', { clicks: 5, impressions: 300, position: 9 }),
      sig('casa libre', '/', { clicks: 30, impressions: 500, position: 1 }),
    ] }).filter((o) => o.type === 'write_guide');
    expect(opps.map((o) => o.term)).toEqual(['vivir en uruguay']);
    expect(opps[0]).toMatchObject({ url: '/guias/vivir-en-uruguay', parsed: { slug: 'vivir-en-uruguay', cc: 'uy' } });
    expect(opps[0].key.startsWith('write_guide|hub|')).toBe(true);
  });
  it('the same topic in other words is one opportunity; different countries are two', () => {
    const opps = decideSite({ site: hub, settings, signals: [
      sig('invertir en inmuebles en paraguay', '', { clicks: 9, impressions: 40, conversions: 1, cost: 3 }, 'ads'),
      sig('inmuebles en paraguay invertir', '', { clicks: 2, impressions: 20, conversions: 0, cost: 1 }, 'ads'),
      sig('invertir en inmuebles en bolivia', '', { clicks: 4, impressions: 30, conversions: 0, cost: 2 }, 'ads'),
    ] }).filter((o) => o.type === 'write_guide');
    expect(opps.map((o) => o.term).sort()).toEqual(['invertir en inmuebles en bolivia', 'invertir en inmuebles en paraguay']);
  });
  it('an existing hub guide (any status, any cc) blocks its topic; a guide of another country does not', () => {
    const drafts = [{ slug: 'invertir-en-inmuebles-en-paraguay', title: 'Invertir en inmuebles en Paraguay', status: 'rejected', related: { cc: 'py' } }];
    const opps = decideSite({ site: hub, settings, drafts, signals: [
      sig('invertir en propiedades en paraguay', '', { clicks: 5, impressions: 30, conversions: 0, cost: 2 }, 'ads'),
      sig('invertir en inmuebles en uruguay', '', { clicks: 5, impressions: 30, conversions: 0, cost: 2 }, 'ads'),
    ] }).filter((o) => o.type === 'write_guide');
    expect(opps.map((o) => o.term)).toEqual(['invertir en inmuebles en uruguay']);
  });
  it('the same slug is never proposed twice even with another country tag', () => {
    const drafts = [{ slug: 'vivir-en-uruguay', title: 'Vivir en Uruguay', status: 'approved', related: { cc: 'py' } }];
    const opps = decideSite({ site: hub, settings, drafts, signals: [sig('vivir en uruguay', '/', { clicks: 2, impressions: 120, position: 14 })] });
    expect(opps.filter((o) => o.type === 'write_guide')).toEqual([]);
  });
  it('strengthen_page for a live hub guide; knownGuides paths', () => {
    const drafts = [{ slug: 'vivir-en-uruguay', title: 'Vivir en Uruguay', status: 'approved', related: { cc: 'uy' } }];
    expect(knownGuides(hub, [], drafts)[0].path).toBe('/guias/vivir-en-uruguay');
    const opps = decideSite({ site: hub, settings, drafts, signals: [sig('vivir en uruguay', '/guias/vivir-en-uruguay', { clicks: 3, impressions: 90, position: 8 })] });
    expect(opps.find((o) => o.type === 'strengthen_page')?.url).toBe('/guias/vivir-en-uruguay');
  });
  it('trend_post: property trends of any of the five countries, hub-relevant only', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const trends = [
      { geo: 'UY', title: 'residencia en uruguay', traffic: 2000, news: [{ title: 'Uruguay: nuevas reglas de residencia para extranjeros que compran viviendas e inmuebles' }], seen_at: '2026-11-20T10:00:00Z' },
      { geo: 'PY', title: 'alquiler asuncion', traffic: 5000, news: [{ title: 'Suben los alquileres de departamentos' }], seen_at: '2026-11-20T10:00:00Z' },
    ];
    const tp = decideSite({ site: hub, settings, trends, now }).filter((o) => o.type === 'trend_post');
    expect(tp.map((o) => o.url)).toEqual(['/guias/residencia-en-uruguay']);
  });
  it('improve: titles without a country tail', () => {
    expect(siteTitleFromQuery('invertir en latinoamerica', null)).toBe('Invertir en latinoamerica: guía práctica');
    const pages = [{ page: '/guias/vivir-en-uruguay', cur: { impressions: 500, clicks: 2, ctr: 0.004, position: 9 }, prev: null, topQuery: 'vivir en uruguay siendo extranjero' }];
    const out = improveSite({ site: hub, pages, guidePaths: new Set(['/guias/vivir-en-uruguay']), settings });
    expect(out[0].type).toBe('new_title');
    expect(out[0].title).not.toMatch(/en Paraguay$/);
  });
});

describe('hub guide + feed', () => {
  const raw = {
    title: 'Vivir en Uruguay: lo que necesitas saber antes de mudarte', h1: 'Vivir en Uruguay',
    answer: 'Respuesta. <a href="https://uy.casa-libre.com/propiedades?utm_source=casalibrecom&utm_medium=hub&utm_campaign=seo-hub">Casa-Libre Uruguay</a> y <a href="https://casa-libre.com.py/propiedades">Paraguay</a>',
    sections: [{ h2: 'Primero', blocks: [{ t: 'p', html: 'Ver <a href="/guias/residencia-en-uruguay">residencia</a>' }] }], faq: [{ q: '¿Sí?', a: 'Sí' }],
  };
  it('cleans with several country links and internal /guias links', () => {
    const g = cleanGuide(raw, hub, { cc: 'uy', slug: 'vivir-en-uruguay', today: '2026-11-20' });
    expect(linksCasaLibre(g)).toBe(true);
    expect(g.answer).toContain('uy.casa-libre.com');
    expect(g.answer).toContain('casa-libre.com.py');
    expect(g.sections[0].blocks[0].html).toContain('href="/guias/residencia-en-uruguay"');
  });
  it('row ↔ guide round-trip and the feed serves approved guides only', () => {
    const g = cleanGuide(raw, hub, { cc: 'uy', slug: 'vivir-en-uruguay', today: '2026-11-20' });
    const row = guideToRow('site:hub', g, { term: 'vivir en uruguay' });
    expect(row.country).toBe('site:hub');
    expect(rowToGuide({ ...row, status: 'approved', approved_at: '2026-11-20T00:00:00Z' }, hub)).toMatchObject({ cc: 'uy', slug: 'vivir-en-uruguay' });
    const feed = buildFeed(hub, [{ ...row, status: 'approved' }, { ...row, slug: 'otra-guia-x', status: 'draft' }], [{ path: '/guias/vivir-en-uruguay', title: 'Nuevo título para vivir en Uruguay', extra_links: [{ href: '/guias/otra', label: 'Otra' }, { href: 'https://evil.com', label: 'x' }] }]);
    expect(feed.site).toBe('casa-libre.com');
    expect(feed.guides.map((x) => x.slug)).toEqual(['vivir-en-uruguay']);
    expect(feed.overrides[0].extraLinks).toEqual([{ href: '/guias/otra', label: 'Otra' }]);
  });
});
