// Keyword Planner for the SEO pipeline — pure helpers (test/seoKeywordPlanner.test.js).
// Once a week per country, Google's Keyword Planner gives real monthly search volumes for the
// country's property searches — including the ones we don't rank or advertise for yet — so the
// pipeline picks pages and guides by real demand. Usage is tiny on purpose: at most 3 calls per
// country per week (the 15,000 operations/day are shared with the Ads MCP).

// Google's location ids (verified with the Ads API, Nov 2026)
export const KP_GEOS = { py: 2600, uy: 2858, bo: 2068, sv: 2222, ve: 2862 };
export const KP_LANGUAGE = '1003';            // Spanish
export const KP_EVERY_DAYS = 7;               // volumes are monthly figures: once a week is plenty
export const KP_MAX_CALLS = 3;                // per country per run (20 seeds each)
export const KP_MIN_VOLUME = 10;              // ideas below this many searches a month are dropped
export const KP_MAX_ROWS = 1500;              // keep the biggest ones

// What people search to rent / buy property (generic seeds, used in every country)
const BASE_SEEDS = [
  'casas en venta', 'casas en alquiler', 'departamentos en venta', 'departamentos en alquiler',
  'terrenos en venta', 'alquiler de casas', 'venta de casas', 'inmobiliaria',
  'duplex en venta', 'duplex en alquiler', 'locales comerciales en alquiler', 'oficinas en alquiler',
  'casas baratas en venta', 'alquiler de departamentos amoblados', 'quintas en venta', 'lotes en venta',
  'vender mi casa', 'publicar propiedad gratis', 'casas de dueño directo', 'propiedades en venta',
];

// Property words: an idea must have one (or a seeded city name) to be kept — Google's "related"
// ideas otherwise drift (cars, jobs…). Accents are folded before matching.
const PROPERTY_RE = /\b(casa|casas|departament\w*|depto\w*|dpto\w*|terren\w*|lote\w*|loteamiento\w*|alquil\w*|arriend\w*|venta|vendo|vender|compr\w*|inmobiliari\w*|inmueble\w*|propiedad\w*|duplex|triplex|quinta\w*|chacra\w*|estancia\w*|campo\w*|local(es)? comercial\w*|oficina\w*|deposito\w*|galpon\w*|monoambiente\w*|penthouse|condominio\w*|barrio cerrado|vivienda\w*|hipotec\w*|credito hipotecario|habitacion\w*|piso\w*|edificio\w*|bienes raices|real estate|infocasas|clasipar|remax|re max|century 21|zonaprop|mercado libre inmuebles)\b/;
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Up to KP_MAX_CALLS groups of ≤20 seeds: generic property searches, then "<type> en <city>" for
// the country's biggest cities, then our own best-performing searches (Ads / Search Console / site).
export function buildSeedGroups({ cities = [], topTerms = [] } = {}) {
  const seen = new Set();
  const all = [];
  const add = (s) => { const k = fold(s); if (k && k.length <= 80 && !seen.has(k)) { seen.add(k); all.push(k); } };
  BASE_SEEDS.forEach(add);
  for (const c of cities.slice(0, 7)) {
    const city = fold(c.name || c);
    if (!city) continue;
    add(`casas en venta ${city}`); add(`departamentos en alquiler ${city}`); add(`terrenos en venta ${city}`);
  }
  topTerms.forEach(add);
  const groups = [];
  for (let i = 0; i < all.length && groups.length < KP_MAX_CALLS; i += 20) groups.push(all.slice(i, i + 20));
  return groups;
}

const num = (v) => (v == null || v === '' ? null : Number(v));
const micros = (v) => (v == null ? null : Math.round((Number(v) / 1e6) * 100) / 100);

// generateKeywordIdeas results → seo_signals rows (source 'keyword_planner'); relevant ideas only,
// one row per search (the biggest reading wins), biggest volumes first.
export function shapeIdeas(results = [], { cc, date, cities = [], seen = new Map() } = {}) {
  const cityWords = cities.map((c) => fold(c.name || c)).filter(Boolean);
  for (const r of results) {
    const term = fold(r.text);
    if (!term || term.length > 120) continue;
    const m = r.keywordIdeaMetrics || {};
    const volume = num(m.avgMonthlySearches) || 0;
    if (volume < KP_MIN_VOLUME) continue;
    if (!PROPERTY_RE.test(term) && !cityWords.some((c) => c.length > 3 && term.includes(c) && /\b(venta|alquiler|casa|terreno|depart)/.test(term))) continue;
    const prev = seen.get(term);
    if (prev && prev.metrics.avg_monthly_searches >= volume) continue;
    const monthly = (m.monthlySearchVolumes || []).slice(-12).map((x) => ({ y: Number(x.year), m: String(x.month || ''), n: num(x.monthlySearches) || 0 }));
    seen.set(term, {
      country: cc, source: 'keyword_planner', term, page: '', date, collected_at: new Date().toISOString(),
      metrics: {
        avg_monthly_searches: volume,
        competition: m.competition || null,                    // LOW / MEDIUM / HIGH (advertisers)
        competition_index: num(m.competitionIndex),
        low_bid: micros(m.lowTopOfPageBidMicros), high_bid: micros(m.highTopOfPageBidMicros),
        trend: monthly,
      },
    });
  }
  return seen;
}

export const topRows = (seen, max = KP_MAX_ROWS) => [...seen.values()]
  .sort((a, b) => b.metrics.avg_monthly_searches - a.metrics.avg_monthly_searches).slice(0, max);

// Run again only when the last reading is a week old (or there is none).
export function isDue(lastDate, now = new Date(), days = KP_EVERY_DAYS) {
  if (!lastDate) return true;
  const age = (now.getTime() - new Date(`${String(lastDate).slice(0, 10)}T00:00:00Z`).getTime()) / 86400000;
  return age >= days - 0.5;
}
