import { describe, it, expect } from 'vitest';
import { parseTerm, urlFor, matchTerm, termKey } from '../lib/seo/matcher.js';
import { scoreOpportunity, closenessOf, availabilityOf, demandOf } from '../lib/seo/score.js';
import { decide, aggregateSignals } from '../lib/seo/decide.js';
import { buildInventory, pageState, median } from '../lib/seo/inventory.js';
import { canChangeTitle, variantState, canEnableVariant, cleanTitle, canPublishDraft } from '../lib/seo/guards.js';
import { parseTrendsRss, parseTraffic, topicOf } from '../lib/seo/trends.js';
import { improveActions, titleFromQuery } from '../lib/seo/improve.js';
import { templateDraft, slugForTerm } from '../lib/seo/draftTemplate.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../lib/seo/settings.js';
import { citiesFor } from '../lib/seo/places.js';
import { parsePath } from '../lib/seo/matrix.js';

const cities = citiesFor('py');
const places = { cities, barrios: [{ slug: 'villa-morra', name: 'Villa Morra', ciudad: 'asuncion' }, { slug: 'carmelitas', name: 'Carmelitas', ciudad: 'asuncion' }] };

describe('SEO matcher (stage 2)', () => {
  it('splits a search into op + type + city + extras and maps it to its page', () => {
    const m = matchTerm('alquiler de departamentos asuncion baratos', places);
    expect(m.parsed).toMatchObject({ op: 'alquiler', tipo: 'departamentos', ciudad: 'asuncion' });
    expect(m.parsed.extras).toContain('baratos');
    expect(m.url).toBe('/alquiler/departamentos/asuncion/baratos');
    expect(m.base).toBe('/alquiler/departamentos/asuncion');
    expect(m.kind).toBe('variant');
  });
  it('reads bedrooms in words or digits, and the typical spellings', () => {
    expect(matchTerm('departamento 2 dormitorios alquiler asunción', places).url).toBe('/alquiler/departamentos/asuncion/2-dormitorios');
    expect(matchTerm('alquilo dpto un dormitorio en asuncion', places).url).toBe('/alquiler/departamentos/asuncion/1-dormitorio');
    expect(matchTerm('monoambiente alquiler asuncion', places).url).toBe('/alquiler/departamentos/asuncion/1-dormitorio');
    expect(parseTerm('casa con piscina en venta luque', places).extras).toContain('piscina');
    expect(parseTerm('departamento amoblado asuncion', places).extras).toContain('amoblado');
  });
  it('Portuguese searches go through the site parser (Assunção → asuncion)', () => {
    const m = matchTerm('apartamento aluguel assunção', places);
    expect(m.parsed).toMatchObject({ op: 'alquiler', tipo: 'departamentos', ciudad: 'asuncion', pt: true });
    expect(m.url).toBe('/alquiler/departamentos/asuncion');
  });
  it('neighbourhoods map to the barrio page (a barrio beats a variant)', () => {
    expect(matchTerm('departamentos villa morra', places).url).toBe('/venta/departamentos/asuncion/villa-morra');
    expect(matchTerm('departamentos villa morra', places).opGuessed).toBe(true);
  });
  it('multi-word cities, brands and questions', () => {
    expect(parseTerm('terrenos en venta ciudad del este', places).ciudad).toBe('ciudad-del-este');
    expect(matchTerm('casas en venta cde', places).url).toBe('/venta/casas/ciudad-del-este');
    expect(matchTerm('infocasas', places)).toMatchObject({ url: null, kind: 'brand' });
    expect(parseTerm('cuanto cuesta alquilar un departamento en asuncion', places).question).toBe(true);
    expect(parseTerm('¿Cuánto cuesta una casa en Paraguay?', places).question).toBe(true);
    expect(urlFor(parseTerm('alquileres en asuncion', places)).url).toBe('/propiedades-en/asuncion');
    expect(termKey('Alquiler  Departamentos Asunción')).toBe('alquiler departamentos asuncion');
  });
});

describe('opportunity scoring (stage 3)', () => {
  it('demand weighs conversions most, then clicks, impressions, site searches', () => {
    expect(demandOf({ ads: { conversions: 1 } })).toBe(10);
    expect(demandOf({ ads: { clicks: 5 }, gsc: { impressions: 100 }, site: { searches: 2 } })).toBe(10 + 10 + 6);
  });
  it('listings below 5 are discounted heavily; no-listing types are neutral', () => {
    expect(availabilityOf(null)).toBe(1);
    expect(availabilityOf(4)).toBe(0.25);
    expect(availabilityOf(0)).toBe(0.05);
    expect(availabilityOf(40)).toBeGreaterThan(availabilityOf(5));
  });
  it('page 1 below the fold is worth most, top-3 least', () => {
    expect(closenessOf(5)).toBeGreaterThan(closenessOf(15));
    expect(closenessOf(15)).toBeGreaterThan(closenessOf(2));
    expect(closenessOf(null)).toBe(0.8);
  });
  it('score = demand × availability × closeness', () => {
    const a = scoreOpportunity({ metrics: { ads: { clicks: 50, conversions: 5 } }, listings: 20, position: 6 });
    const b = scoreOpportunity({ metrics: { ads: { clicks: 50, conversions: 5 } }, listings: 3, position: 6 });
    expect(a).toBeGreaterThan(b * 3);
  });
});

// a small inventory: 12 rental apartments in Asunción (6 cheap, 4 with 2 bedrooms), 3 houses
const rows = [
  ...Array.from({ length: 12 }, (_, i) => ({ listing_type: 'rent', property_type: 'Departamento', city: 'Asunción', neighborhood: i < 6 ? 'Villa Morra' : 'Carmelitas', price_usd: 300 + i * 50, bedrooms: i % 3 === 0 ? 2 : 1, created_at: `2026-11-${10 + i}T00:00:00Z` })),
  ...Array.from({ length: 3 }, () => ({ listing_type: 'sale', property_type: 'Casa', city: 'Luque', neighborhood: '', price_usd: 90000, bedrooms: 3 })),
];

describe('inventory + variant gate (stages 4–5)', () => {
  const inv = buildInventory(rows, cities);
  it('counts pages and live stats', () => {
    const p = inv.get('/alquiler/departamentos/asuncion');
    expect(p.count).toBe(12);
    expect(p.median).toBe(median(rows.slice(0, 12).map((r) => r.price_usd)));
    expect(p.min).toBe(300);
    expect(p.max).toBe(850);
    expect(p.newest).toBe('2026-11-21T00:00:00Z');
    expect(inv.get('/alquiler/departamentos/asuncion/villa-morra').count).toBe(6);
  });
  it('baratos = below the city-page median; bedrooms are exact', () => {
    expect(inv.get('/alquiler/departamentos/asuncion/baratos').count).toBe(6);
    expect(inv.get('/alquiler/departamentos/asuncion/2-dormitorios').count).toBe(4);
    expect(inv.get('/alquiler/departamentos/asuncion/1-dormitorio').count).toBe(8);
  });
  it('a variant exists only when switched on, and is indexed only with ≥5 listings', () => {
    expect(pageState('/alquiler/departamentos/asuncion/baratos', inv).exists).toBe(false);
    const ov = new Map([['/alquiler/departamentos/asuncion', { enabled_variants: ['baratos', '2-dormitorios'], retired_variants: ['1-dormitorio'] }]]);
    expect(pageState('/alquiler/departamentos/asuncion/baratos', inv, ov)).toMatchObject({ exists: true, indexable: true, count: 6 });
    expect(pageState('/alquiler/departamentos/asuncion/2-dormitorios', inv, ov)).toMatchObject({ exists: true, indexable: false });
    expect(pageState('/alquiler/departamentos/asuncion/1-dormitorio', inv, ov)).toMatchObject({ exists: true, indexable: false });
    expect(pageState('/venta/casas/luque', inv)).toMatchObject({ exists: true, indexable: false, count: 3 });
  });
  it('variantState: index / noindex / off', () => {
    expect(variantState({ variant: 'baratos', count: 6, enabled: true })).toBe('index');
    expect(variantState({ variant: 'baratos', count: 4, enabled: true })).toBe('noindex');
    expect(variantState({ variant: 'baratos', count: 9, retired: true })).toBe('noindex');
    expect(variantState({ variant: 'baratos', count: 9 })).toBe('off');
    expect(variantState({ variant: 'piscina', count: 9, enabled: true })).toBe('off');
    expect(variantState({ variant: 'baratos', count: 0, enabled: true })).toBe('off');
    expect(canEnableVariant('/alquiler/departamentos/asuncion/baratos', 6).ok).toBe(true);
    expect(canEnableVariant('/alquiler/departamentos/asuncion/baratos', 4).ok).toBe(false);
    expect(canEnableVariant('/alquiler/departamentos/asuncion', 40).ok).toBe(false);
  });
});

describe('decide (stage 3)', () => {
  const inv = buildInventory(rows, cities);
  const sig = (source, term, metrics, page = '') => ({ source, term, page, date: '2026-11-18', metrics });
  it('proven search for a real filter with ≥5 listings → create_variant', () => {
    const opps = decide({ signals: [sig('ads', 'alquiler departamentos asuncion baratos', { clicks: 51, impressions: 149, conversions: 5.5, cost: 12.8 })], inventory: inv, places });
    expect(opps[0]).toMatchObject({ type: 'create_variant', url: '/alquiler/departamentos/asuncion/baratos' });
    expect(opps[0].evidence.listings).toBe(6);
  });
  it('weak searches for the same variant add up to a proven one', () => {
    const opps = decide({ signals: [
      sig('ads', 'departamentos baratos alquiler asuncion', { clicks: 3 }),
      sig('ads', 'alquiler de departamentos economicos en asuncion', { clicks: 3 }),
      sig('site_search', 'deptos baratos asuncion alquiler', { searches: 1 }),
    ], inventory: inv, places });
    expect(opps).toHaveLength(1);
    expect(opps[0].evidence.terms).toHaveLength(3);
    expect(opps[0].evidence.ads.clicks).toBe(6);   // 3 + 3 ≥ 5: proven together, not alone
  });
  it('no variant when not proven, under 5 listings, or already on', () => {
    expect(decide({ signals: [sig('ads', 'alquiler departamentos asuncion baratos', { clicks: 1 })], inventory: inv, places })).toEqual([]);
    expect(decide({ signals: [sig('ads', 'alquiler departamentos asuncion 2 dormitorios', { clicks: 30 })], inventory: inv, places })).toEqual([]);
    const ov = new Map([['/alquiler/departamentos/asuncion', { enabled_variants: ['baratos'] }]]);
    expect(decide({ signals: [sig('ads', 'alquiler departamentos asuncion baratos', { clicks: 30 })], inventory: inv, overridesByPath: ov, places })).toEqual([]);
  });
  it('positions 5–20 → strengthen; questions → guide; top-3 paid → lower bid; trends → post', () => {
    const opps = decide({
      signals: [
        sig('gsc', 'alquiler departamento asuncion', { clicks: 2, impressions: 80, position: 8.2 }, '/alquiler/departamentos/asuncion'),
        sig('ads', 'cuanto cuesta alquilar un departamento en asuncion', { clicks: 4, conversions: 0 }),
        sig('ads', 'casa libre', { clicks: 20, cost: 3.5 }),
        sig('gsc', 'casa libre', { clicks: 40, impressions: 60, position: 1.3 }, '/'),
      ],
      trends: [{ title: 'credito hipotecario', topic: 'property', traffic: 2000, seen_at: new Date().toISOString(), geo: 'PY' }, { title: 'futbol', topic: 'other', traffic: 9000, seen_at: new Date().toISOString() }],
      inventory: inv, places,
    });
    const types = opps.map((o) => o.type).sort();
    expect(types).toEqual(['lower_bid_suggestion', 'strengthen_page', 'trend_post', 'write_guide']);
    expect(opps.find((o) => o.type === 'write_guide').url).toBe('/guias/cuanto-cuesta-alquilar-un-departamento-en-asuncion');
  });
  it('aggregates the latest snapshot only, summing pages and weighting position by impressions', () => {
    const a = aggregateSignals([
      sig('gsc', 'x y', { clicks: 1, impressions: 10, position: 10 }, '/a'),
      sig('gsc', 'X  Y', { clicks: 1, impressions: 30, position: 2 }, '/b'),
      { ...sig('gsc', 'x y', { clicks: 99, impressions: 999, position: 1 }, '/a'), date: '2026-11-01' },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].gsc).toMatchObject({ clicks: 2, impressions: 40, position: 4 });
  });
});

describe('guards (stage 5)', () => {
  it('title changes: at most once per 14 days per page', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    expect(canChangeTitle(null, now).ok).toBe(true);
    expect(canChangeTitle({ title_changed_at: '2026-11-10T12:00:00Z' }, now)).toMatchObject({ ok: false, nextAt: '2026-11-24T12:00:00.000Z' });
    expect(canChangeTitle({ title_changed_at: '2026-11-04T12:00:00Z' }, now).ok).toBe(true);
    expect(canChangeTitle({ title_changed_at: '2026-11-10T12:00:00Z' }, now, 7).ok).toBe(true);
  });
  it('titles must be real; drafts need approval', () => {
    expect(cleanTitle('short')).toBe(null);
    expect(cleanTitle('Alquiler de departamentos en Asunción — {count} opciones')).toBeTruthy();
    expect(cleanTitle('Precio {{median:/x}} departamentos en Asunción')).toBe(null);
    expect(canPublishDraft({ status: 'draft', title: 't', h1: 'h', sections: [{}] }).ok).toBe(false);
    expect(canPublishDraft({ status: 'approved', title: 't', h1: 'h', sections: [{}] }).ok).toBe(true);
  });
});

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel><title>Daily Search Trends</title>
<item><title>crédito hipotecario</title><ht:approx_traffic>2K+</ht:approx_traffic><pubDate>Tue, 17 Nov 2026 13:40:00 -0800</pubDate>
<ht:news_item><ht:news_item_title>AFD baja la tasa del crédito para la vivienda</ht:news_item_title><ht:news_item_url>https://example.com/a?x=1&amp;y=2</ht:news_item_url><ht:news_item_source>ABC</ht:news_item_source></ht:news_item></item>
<item><title>liga de naciones</title><ht:approx_traffic>200+</ht:approx_traffic><pubDate>Tue, 17 Nov 2026 10:00:00 -0800</pubDate></item>
<item><title><![CDATA[dólar hoy]]></title><ht:approx_traffic>500+</ht:approx_traffic></item>
</channel></rss>`;

describe('Google Trends RSS (stage 1)', () => {
  it('parses items, traffic, news and dates', () => {
    const items = parseTrendsRss(RSS);
    expect(items.map((i) => i.title)).toEqual(['crédito hipotecario', 'liga de naciones', 'dólar hoy']);
    expect(items[0]).toMatchObject({ traffic: 2000, trafficLabel: '2K+', pubDate: '2026-11-17T21:40:00.000Z' });
    expect(items[0].news[0]).toEqual({ title: 'AFD baja la tasa del crédito para la vivienda', url: 'https://example.com/a?x=1&y=2', source: 'ABC' });
    expect(items[2]).toMatchObject({ traffic: 500, pubDate: null, news: [] });
    expect(parseTrendsRss('garbage')).toEqual([]);
  });
  it('traffic labels', () => {
    expect(parseTraffic('200+')).toBe(200);
    expect(parseTraffic('1M+')).toBe(1000000);
    expect(parseTraffic('2 mil+')).toBe(2000);
    expect(parseTraffic('')).toBe(null);
  });
  it('tags topics; one weak news hit is not enough', () => {
    expect(topicOf('crédito hipotecario')).toBe('property');
    expect(topicOf('dólar hoy')).toBe('economy');
    expect(topicOf('liga de naciones', ['España gana'])).toBe('other');
    expect(topicOf('allanamiento', ['Allanan viviendas de los hermanos', 'Allanamiento en la vivienda'])).toBe('other');
    expect(topicOf('x', ['sube el alquiler de departamentos', 'inquilinos protestan'])).toBe('property');
  });
});

describe('improve (stage 8)', () => {
  const now = new Date('2026-11-18T00:00:00Z');
  it('low CTR → a title from the top query, respecting the 14-day limit', () => {
    const acts = improveActions({ pages: [{ page: '/alquiler/departamentos/asuncion', cur: { impressions: 300, clicks: 1, ctr: 0.003, position: 41 }, prev: null, topQuery: 'alquiler departamento asuncion' }], settings: DEFAULT_SETTINGS, cities, now,
      overridesByPath: new Map([['/alquiler/departamentos/asuncion', { title_changed_at: '2026-11-10T00:00:00Z' }]]) });
    expect(acts[0]).toMatchObject({ type: 'new_title', title: 'Alquiler departamento Asunción — {count} opciones', allowed: false });
  });
  it('slipping position → strengthen; silent enabled variant → retire', () => {
    const acts = improveActions({
      pages: [{ page: '/venta/casas/luque', cur: { impressions: 50, clicks: 1, ctr: 0.05, position: 14 }, prev: { position: 9 }, topQuery: 'casas luque' }],
      variants: [{ path: '/alquiler/departamentos/asuncion/baratos', enabledAt: '2026-10-01T00:00:00Z', impressions: 0 }, { path: '/alquiler/departamentos/asuncion/2-dormitorios', enabledAt: '2026-11-15T00:00:00Z', impressions: 0 }],
      settings: DEFAULT_SETTINGS, cities, now,
    });
    expect(acts.map((a) => `${a.type} ${a.url}`)).toEqual(['strengthen_page /venta/casas/luque', 'retire_variant /alquiler/departamentos/asuncion/baratos']);
  });
  it('titleFromQuery restores accents of city names', () => {
    expect(titleFromQuery('casas en venta encarnacion', cities)).toBe('Casas en venta Encarnación — {count} opciones');
  });
});

describe('draft template + settings', () => {
  it('a data-driven Spanish draft with live-number placeholders', () => {
    const parsed = parseTerm('cuanto cuesta alquilar un departamento en asuncion', places);
    const d = templateDraft({ term: 'cuanto cuesta alquilar un departamento en asuncion', parsed, countryName: 'Paraguay', cityName: 'Asunción', capitalSlug: 'asuncion' });
    expect(d.slug).toBe(slugForTerm('cuanto cuesta alquilar un departamento en asuncion'));
    expect(d.answerPath).toBe('/alquiler/departamentos/asuncion');
    expect(d.answer).toContain('{{median:/alquiler/departamentos/asuncion}}');
    expect(d.h1.startsWith('¿')).toBe(true);
    expect(d.faq.length).toBeGreaterThan(1);
    expect(JSON.stringify(d)).not.toMatch(/undefined|null/);
    const t = templateDraft({ term: 'crédito hipotecario', kind: 'trend_post', parsed: {}, countryName: 'Paraguay', capitalSlug: 'asuncion', capitalName: 'Asunción', news: [{ title: 'AFD baja la tasa', source: 'ABC' }] });
    expect(t.kind).toBe('trend_post');
    expect(t.sections[0].paras[0]).toContain('AFD baja la tasa');
  });
  it('settings merge keeps types and ignores unknown keys', () => {
    const s = mergeSettings({ thresholds: { titleDays: '21', bogus: 1 }, improve: { autoTitles: 1 }, nope: true });
    expect(s.thresholds.titleDays).toBe(21);
    expect(s.improve.autoTitles).toBe(true);
    expect(s.nope).toBeUndefined();
    expect(parsePath('/alquiler/departamentos/asuncion/baratos')).toEqual({ op: 'alquiler', tipo: 'departamentos', ciudad: 'asuncion', variant: 'baratos' });
  });
});
