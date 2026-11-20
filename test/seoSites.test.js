import { describe, it, expect } from 'vitest';
import { scopeOf, siteKeyOf, isSiteScope, siteFor, siteKeyParam, siteUrl, guidePath, parseGuidePath, clLink, countryOfTerm, SITE_KEYS } from '../lib/seoSites/scope.js';
import { isRelevant, isQuestionOrTopic, coveredBy, relatedGuides } from '../lib/seoSites/relevance.js';
import { sanitizeHtml, safeHref, cleanGuide, namesCompetitor, linksCasaLibre, plainText } from '../lib/seoSites/sanitize.js';
import { decideSite, improveSite, slugForSearch, siteTitleFromQuery, knownGuides } from '../lib/seoSites/decide.js';
import { guideToRow, rowToGuide, rowToOverride, buildFeed } from '../lib/seoSites/shape.js';
import { DEFAULT_SETTINGS } from '../lib/seo/settings.js';

const agpy = siteFor('agpy');
const org = siteFor('org');
const agbo = siteFor('agbo');
const libpy = siteFor('libpy');

describe('site scope helpers', () => {
  it('key ↔ country value', () => {
    expect(scopeOf('agpy')).toBe('site:agpy');
    expect(siteKeyOf('site:agpy')).toBe('agpy');
    expect(siteKeyOf('py')).toBe(null);
    expect(isSiteScope('site:nope')).toBe(false);
    expect(SITE_KEYS).toEqual(['org', 'online', 'agpy', 'agbo', 'libpy', 'libbo']);
  });
  it('finds a site by key or domain, rejects the rest', () => {
    expect(siteFor('agenteinmobiliarioparaguay.com').key).toBe('agpy');
    expect(siteFor('https://www.inmobiliariabolivia.org/').key).toBe('libbo');
    expect(siteKeyParam('agents-old')).toBe(null);
    expect(siteKeyParam('evil.com')).toBe(null);
    expect(agbo.rootCountry).toBe('bo');
    expect(libpy.medium).toBe('library');
    expect(agpy.medium).toBe('funnel');
  });
  it('site URL from env, else the domain', () => {
    expect(siteUrl('agpy', { SEO_SITE_URL_AGPY: 'http://localhost:3053/' })).toBe('http://localhost:3053');
    expect(siteUrl('libbo', {})).toBe('https://inmobiliariabolivia.org');
  });
  it('guide paths: root country at /, others under their prefix', () => {
    expect(guidePath(agpy, 'py', 'x')).toBe('/x');
    expect(guidePath(org, 'bo', 'x')).toBe('/bolivia/x');
    expect(guidePath(org, 'sv', 'x')).toBe('/el-salvador/x');
    expect(guidePath(agbo, 'bo', 'x')).toBe('/x');
    expect(guidePath(agbo, 'py', 'x')).toBe('/x');   // not a country of the site → root
    expect(parseGuidePath(org, '/uruguay/vender-casa')).toEqual({ cc: 'uy', slug: 'vender-casa' });
    expect(parseGuidePath(org, '/vender-casa')).toEqual({ cc: 'py', slug: 'vender-casa' });
    expect(parseGuidePath(org, '/a/b/c')).toBe(null);
  });
  it('Casa-Libre links carry the site UTM tags', () => {
    const u = new URL(clLink(org, 'bo', '/publicar', 'x'));
    expect(u.origin).toBe('https://casa-libre.com.bo');
    expect(u.searchParams.get('utm_source')).toBe('comovendermicasarapidoorg');
    expect(u.searchParams.get('utm_medium')).toBe('funnel');
    expect(u.searchParams.get('utm_campaign')).toBe('seo-bo');
    expect(new URL(clLink(libpy, 'py')).searchParams.get('utm_medium')).toBe('library');
  });
  it('the country of a search', () => {
    expect(countryOfTerm(org, 'como vender mi casa en bolivia')).toBe('bo');
    expect(countryOfTerm(org, 'como vender mi casa')).toBe('py');
    expect(countryOfTerm(org, 'x', '/uruguay/y')).toBe('uy');
    expect(countryOfTerm(agpy, 'agente inmobiliario bolivia')).toBe('py');
  });
});

describe('relevance by site kind', () => {
  it('owners / agents / library', () => {
    expect(isRelevant('como vender mi casa rapido', 'owners')).toBe(true);
    expect(isRelevant('alquiler departamento asuncion', 'owners')).toBe(false);
    expect(isRelevant('como captar propiedades', 'agents')).toBe(true);
    expect(isRelevant('comision inmobiliaria paraguay', 'agents')).toBe(true);
    expect(isRelevant('como vender mi casa rapido', 'agents')).toBe(false);
    expect(isRelevant('credito hipotecario paraguay requisitos', 'library')).toBe(true);
    expect(isRelevant('mejores barrios para vivir en asuncion', 'library')).toBe(true);
  });
  it('brand searches never count', () => {
    expect(isRelevant('infocasas vender casa', 'owners')).toBe(false);
    expect(isRelevant('casa libre inmobiliaria', 'agents')).toBe(false);
  });
  it('question or topic', () => {
    expect(isQuestionOrTopic('cuanto cobra un agente inmobiliario')).toBe(true);
    expect(isQuestionOrTopic('captar propiedades exclusiva')).toBe(true);
    expect(isQuestionOrTopic('inmobiliaria')).toBe(false);
  });
  it('coverage by slug/title words', () => {
    const guides = [{ slug: 'como-captar-propiedades', title: 'Cómo captar propiedades: guía para agentes' }, { slug: 'comision-inmobiliaria-paraguay', title: 'Comisión inmobiliaria en Paraguay: cuánto es y quién paga' }];
    expect(coveredBy('como captar propiedades', guides)?.slug).toBe('como-captar-propiedades');
    expect(coveredBy('comision inmobiliaria', guides)?.slug).toBe('comision-inmobiliaria-paraguay');
    expect(coveredBy('cuanto cobra una inmobiliaria de comision', guides)).toBe(null);
    expect(coveredBy('crm para inmobiliarias', guides)).toBe(null);
  });
  it('related guides share words, same country, not itself', () => {
    const gs = [{ path: '/a', cc: 'py', slug: 'captar-propiedades', title: 'Captar propiedades' }, { path: '/b', cc: 'py', slug: 'captar-exclusiva', title: 'Captar en exclusiva' }, { path: '/bolivia/c', cc: 'bo', slug: 'captar', title: 'Captar' }, { path: '/d', cc: 'py', slug: 'impuestos', title: 'Impuestos' }];
    expect(relatedGuides({ path: '/a', cc: 'py', slug: 'captar-propiedades', title: 'Captar propiedades' }, gs).map((g) => g.path)).toEqual(['/b']);
  });
});

describe('sanitizer', () => {
  it('keeps only a/strong/em, escapes the rest', () => {
    expect(sanitizeHtml('<p>Hola <b>mundo</b> <script>alert(1)</script></p>')).toBe('Hola <strong>mundo</strong> alert(1)');
    expect(sanitizeHtml('a < b & c')).toBe('a &lt; b &amp; c');
    expect(sanitizeHtml('<em>x')).toBe('<em>x</em>');
    expect(sanitizeHtml('<a href="/guias" onclick="x()">guías</a>')).toBe('<a href="/guias">guías</a>');
  });
  it('links: internal or Casa-Libre only', () => {
    expect(sanitizeHtml('<a href="https://casa-libre.com.py/publicar?utm_source=x&amp;utm_medium=y">CL</a>')).toBe('<a href="https://casa-libre.com.py/publicar?utm_source=x&amp;utm_medium=y">CL</a>');
    expect(sanitizeHtml('<a href="https://otro.com">otro</a> fin')).toBe('otro fin');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('x');
    expect(safeHref('//evil.com')).toBe(null);
    expect(safeHref('http://casa-libre.com.py')).toBe(null);
    expect(safeHref('https://uy.casa-libre.com/x')).toBe('https://uy.casa-libre.com/x');
  });
  it('is idempotent', () => {
    const once = sanitizeHtml('<a href="https://casa-libre.com.bo/?a=1&b=2">x & y</a>');
    expect(sanitizeHtml(once)).toBe(once);
  });
  it('plain text strips tags', () => {
    expect(plainText('<b>Hola</b> <i>vos</i>')).toBe('Hola vos');
  });
  const raw = {
    title: 'Cómo captar propiedades en exclusiva siendo agente inmobiliario en Paraguay hoy mismo', h1: 'Cómo captar en exclusiva',
    description: 'd', answer: 'Respuesta <script>x</script> <a href="https://casa-libre.com.py/empresas">Casa-Libre</a>',
    summary: ['<b>uno</b>', 'dos'],
    sections: [{ h2: 'Primero', blocks: [{ t: 'p', html: 'Texto <a href="https://x.com">x</a>' }, { t: 'ul', items: ['a', '<em>b</em>'] }, { t: 'table' }] }, { h2: '', blocks: [{ t: 'p', html: 'x' }] }],
    faq: [{ q: '¿Sí?', a: '<b>Sí</b>' }, { q: '', a: 'x' }],
  };
  it('cleans a guide into the site format', () => {
    const g = cleanGuide(raw, agpy, { cc: 'py', slug: 'captar-exclusiva', today: '2026-11-20' });
    expect(g.title.length).toBeLessThanOrEqual(70);
    expect(g).toMatchObject({ cc: 'py', slug: 'captar-exclusiva', published: '2026-11-20', updated: '2026-11-20', source: 'pipeline' });
    expect(g.sections).toHaveLength(1);
    expect(g.sections[0].id).toBe('primero');
    expect(g.sections[0].blocks).toEqual([{ t: 'p', html: 'Texto x' }, { t: 'ul', items: ['a', '<em>b</em>'] }]);
    expect(g.faq).toEqual([{ q: '¿Sí?', a: 'Sí' }]);
    expect(g.summary).toEqual(['uno', 'dos']);
    expect(g.answer).not.toContain('<script');
    expect(linksCasaLibre(g)).toBe(true);
  });
  it('refuses unusable guides', () => {
    expect(() => cleanGuide({ ...raw, sections: [] }, agpy, { slug: 'x-y' })).toThrow();
    expect(() => cleanGuide(raw, agpy, { slug: 'Bad Slug' })).toThrow();
  });
  it('spots competitors', () => {
    const g = cleanGuide(raw, agpy, { slug: 'x-y' });
    expect(namesCompetitor(g)).toBe(false);
    expect(namesCompetitor({ ...g, answer: 'Publicá también en InfoCasas' })).toBe(true);
    expect(namesCompetitor({ ...g, answer: 'Compartí el aviso en Instagram' })).toBe(false);
  });
});

const sig = (term, page, m, source = 'gsc') => ({ source, term, page, date: '2026-11-19', metrics: m });

describe('decide for a site', () => {
  const settings = DEFAULT_SETTINGS;
  const catalog = [{ cc: 'py', slug: 'como-captar-propiedades', path: '/como-captar-propiedades/', title: 'Cómo captar propiedades' }];
  it('write_guide only for relevant, uncovered searches with demand', () => {
    const opps = decideSite({ site: agpy, settings, catalog, signals: [
      sig('crm para inmobiliarias', '/', { clicks: 1, impressions: 80, position: 12 }),
      sig('como captar propiedades', '/como-captar-propiedades', { clicks: 3, impressions: 90, position: 8 }),
      sig('como vender mi casa', '/', { clicks: 2, impressions: 200, position: 30 }),
      sig('crm', '/', { clicks: 0, impressions: 2, position: 40 }),
    ] });
    const guides = opps.filter((o) => o.type === 'write_guide');
    expect(guides.map((o) => o.term)).toEqual(['crm para inmobiliarias']);
    expect(guides[0].url).toBe('/crm-para-inmobiliarias');
    expect(guides[0].parsed).toEqual({ slug: 'crm-para-inmobiliarias', cc: 'py' });
  });
  it('an existing draft (any status) blocks the same guide', () => {
    const opps = decideSite({ site: agpy, settings, catalog, drafts: [{ slug: 'crm-para-inmobiliarias', title: 'CRM para inmobiliarias', status: 'rejected', related: { cc: 'py' } }],
      signals: [sig('crm para inmobiliarias', '/', { clicks: 1, impressions: 80, position: 12 })] });
    expect(opps.filter((o) => o.type === 'write_guide')).toEqual([]);
  });
  it('strengthen_page for a live guide on positions 5–20', () => {
    const opps = decideSite({ site: agpy, settings, catalog, signals: [sig('captar propiedades', '/como-captar-propiedades', { clicks: 3, impressions: 90, position: 8 })] });
    expect(opps.find((o) => o.type === 'strengthen_page')?.url).toBe('/como-captar-propiedades');
  });
  it('ads demand counts; other countries of the .org site get their prefix', () => {
    const opps = decideSite({ site: org, settings, signals: [sig('como vender mi casa en bolivia', '', { clicks: 3, impressions: 40, conversions: 0, cost: 2 }, 'ads')] });
    expect(opps[0]).toMatchObject({ type: 'write_guide', url: '/bolivia/como-vender-mi-casa-en-bolivia', parsed: { cc: 'bo' } });
  });
  it('trend_post: property trends of the site countries, relevant to the kind', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const trends = [
      { geo: 'PY', title: 'credito hipotecario', traffic: 2000, news: [{ title: 'Nuevo crédito hipotecario para viviendas' }], seen_at: '2026-11-20T10:00:00Z' },
      { geo: 'BO', title: 'credito hipotecario', traffic: 2000, news: [{ title: 'crédito hipotecario viviendas' }], seen_at: '2026-11-20T10:00:00Z' },
      { geo: 'PY', title: 'olimpia cerro', traffic: 50000, news: [], seen_at: '2026-11-20T10:00:00Z' },
    ];
    const opps = decideSite({ site: libpy, settings, trends, now });
    expect(opps.filter((o) => o.type === 'trend_post').map((o) => o.url)).toEqual(['/credito-hipotecario']);
  });
  it('knownGuides merges catalog + drafts with their paths', () => {
    const k = knownGuides(org, [{ cc: 'bo', slug: 'a', path: '/bolivia/a/' }], [{ slug: 'b', status: 'draft', related: { cc: 'uy' } }]);
    expect(k.map((g) => [g.path, g.source, g.status])).toEqual([['/bolivia/a', 'static', 'approved'], ['/uruguay/b', 'pipeline', 'draft']]);
  });
  it('slugs from searches', () => {
    expect(slugForSearch('¿Cómo captar propiedades?')).toBe('como-captar-propiedades');
    expect(slugForSearch('???')).toBe(null);
    expect(slugForSearch('a '.repeat(60)).length).toBeLessThanOrEqual(70);
  });
});

describe('improve for a site', () => {
  it('new title on low CTR guides, slip → links; non-guide pages ignored', () => {
    const pages = [
      { page: '/como-captar-propiedades', cur: { impressions: 500, clicks: 2, ctr: 0.004, position: 9 }, prev: { position: 5 }, topQuery: 'como captar propiedades' },
      { page: '/', cur: { impressions: 900, clicks: 1, ctr: 0.001, position: 9 }, prev: null, topQuery: 'agente inmobiliario' },
    ];
    const out = improveSite({ site: agpy, pages, guidePaths: new Set(['/como-captar-propiedades']), settings: DEFAULT_SETTINGS });
    expect(out.map((a) => a.type)).toEqual(['new_title', 'strengthen_page']);
    expect(out[0].title).toBe('¿Cómo captar propiedades? Guía práctica');
    expect(out[0].allowed).toBe(true);
  });
  it('titles from a topic search', () => {
    expect(siteTitleFromQuery('crm inmobiliario', 'bo')).toBe('Crm inmobiliario: guía práctica en Bolivia');
    expect(siteTitleFromQuery('')).toBe(null);
  });
});

describe('feed shaping', () => {
  const guide = cleanGuide({ title: 'CRM para inmobiliarias en Paraguay', h1: 'CRM para inmobiliarias', description: 'd', answer: 'a', navLabel: 'CRM', blurb: 'b', summary: ['s'],
    sections: [{ id: 'uno', h2: 'Uno', blocks: [{ t: 'p', html: '<a href="https://casa-libre.com.py/empresas">x</a>' }] }], faq: [{ q: 'q', a: 'a' }] }, agpy, { cc: 'py', slug: 'crm-para-inmobiliarias', today: '2026-11-20' });
  it('guide → row → guide round trip keeps the site format', () => {
    const row = { ...guideToRow('site:agpy', guide, { term: 'crm para inmobiliarias' }), status: 'approved', approved_at: '2026-11-20T10:00:00Z', created_at: '2026-11-20T09:00:00Z' };
    expect(row.country).toBe('site:agpy');
    expect(row.related).toEqual({ cc: 'py', navLabel: 'CRM', blurb: 'b', summary: ['s'] });
    const back = rowToGuide(row, agpy);
    expect(back).toMatchObject({ cc: 'py', slug: 'crm-para-inmobiliarias', title: guide.title, navLabel: 'CRM', published: '2026-11-20', source: 'pipeline' });
    expect(back.sections).toEqual(guide.sections);
  });
  it('the feed: approved guides only, clean overrides, internal extra links only', () => {
    const row = (status, slug) => ({ ...guideToRow('site:agpy', { ...guide, slug }), status });
    const feed = buildFeed(agpy, [row('approved', 'a-b'), row('draft', 'c-d'), row('approved', 'a-b'), { slug: 'BAD', status: 'approved', title: 'x', h1: 'x', sections: [] }],
      [{ path: '/a-b', title: 'Nuevo <b>título</b> de la guía', h1: null, description: null, extra_links: [{ href: '/c', label: 'C' }, { href: 'https://evil.com', label: 'E' }, { href: 'https://casa-libre.com.py', label: 'CL' }] },
        { path: '/x', title: null, h1: null, description: null, extra_links: [] }], new Date('2026-11-20T00:00:00Z'));
    expect(feed.site).toBe('agenteinmobiliarioparaguay.com');
    expect(feed.updatedAt).toBe('2026-11-20T00:00:00.000Z');
    expect(feed.guides.map((g) => g.slug)).toEqual(['a-b']);
    expect(feed.overrides).toEqual([{ path: '/a-b', title: 'Nuevo título de la guía', h1: null, description: null, extraLinks: [{ href: '/c', label: 'C' }] }]);
  });
  it('rowToOverride ignores rows that change nothing', () => {
    expect(rowToOverride({ path: '/x', extra_links: [] })).toBe(null);
    expect(rowToOverride({ path: 'x', title: 't' })).toBe(null);
  });
});

describe('site guides: one per topic, the right audience, no two sites on the same topic', async () => {
  const { topicKey, isRelevant } = await import('../lib/seoSites/relevance.js');
  const { decideSite } = await import('../lib/seoSites/decide.js');
  it('wording variants of one search are ONE topic', () => {
    const keys = new Set(['departamento en alquiler asuncion', 'alquiler departamento asuncion', 'departamentos en alquiler asuncion', 'alquiler de departamentos asuncion', 'alquiler depto asuncion'].map(topicKey));
    expect(keys.size).toBe(1);
  });
  it('owner sites only take seller searches; .online = hard cases, .org = the rest', () => {
    expect(isRelevant('venta de terrenos asuncion', 'owners', 'org')).toBe(false);   // a buyer search
    expect(isRelevant('casas a estrenar en venta', 'owners', 'online')).toBe(false);
    expect(isRelevant('como vender mi casa rapido', 'owners', 'org')).toBe(true);
    expect(isRelevant('como vender mi casa rapido', 'owners', 'online')).toBe(false);
    expect(isRelevant('vender casa heredada', 'owners', 'online')).toBe(true);
    expect(isRelevant('vender casa heredada', 'owners', 'org')).toBe(false);
  });
  it('decide: four wordings → one guide; a topic another site already wrote → none', () => {
    const site = { key: 'libpy', kind: 'library', rootCountry: 'py', countries: ['py'], domain: 'laparaguayainmobiliaria.com' };
    const sig = (term, clicks) => ({ source: 'ads', term, page: '', date: '2026-11-20', metrics: { clicks, impressions: clicks * 5, conversions: 1, cost: clicks } });
    const signals = [sig('departamento en alquiler asuncion', 20), sig('alquiler departamento asuncion', 15), sig('departamentos en alquiler asuncion', 12), sig('alquiler de departamentos asuncion', 10)];
    const opps = decideSite({ site, signals }).filter((o) => o.type === 'write_guide');
    expect(opps).toHaveLength(1);
    expect(opps[0].term).toBe('departamento en alquiler asuncion');
    const none = decideSite({ site, signals, otherDrafts: [{ term: 'alquiler departamentos asuncion', related: { cc: 'py' } }] }).filter((o) => o.type === 'write_guide');
    expect(none).toHaveLength(0);
  });
});
