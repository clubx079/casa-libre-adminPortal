// Stage 2 — Understand: split a search into { op, tipo, ciudad, barrio, extras, question, brand }
// and map it to the website page that should answer it (pure — test/seoMatcher.test.js).
// Reuses the website's search parser (./searchAliases.js: Portuguese spellings → Spanish places,
// operation and type words) and the page matrix slugs (./matrix.js).
import { foldText, ptAlias, parseSearch } from './searchAliases.js';
import { TIPOS, VARIANTS, pathOf, norm, slugify } from './matrix.js';

const word = (p) => new RegExp(`(^|[^a-z0-9])(?:${p})(?=$|[^a-z0-9])`);

const OP_RULES = [
  ['alquiler', word('alquiler(?:es)?|alquilo|alquilar|alquila|en alquiler|renta|rentar|arriendo|arrendar|aluguel|alugar|alugo|locacao|rent|for rent')],
  ['venta', word('venta|ventas|vendo|vende|se vende|comprar|compro|compra|a venda|venda|for sale|sale|buy')],
];

// Most specific first. → TIPOS slug
const TYPE_RULES = [
  ['locales', word('locales? comerciales?|locales?|salon(?:es)? comercial(?:es)?|lojas?|ponto comercial')],
  ['oficinas', word('oficinas?|sala comercial|salas comerciais')],
  ['depositos', word('depositos?|galpon(?:es)?|galpao|galpoes|tinglados?')],
  ['duplex', word('duplex|duplexes|sobrados?')],
  ['departamentos', word('departamentos?|deptos?|dptos?|apartamentos?|aptos?|monoambientes?|flats?|apartments?')],
  ['terrenos', word('terrenos?|lotes?|loteamientos?|parcelas?|fracciones?')],
  ['casas', word('casas?|viviendas?|chalets?|houses?')],
];

const NUM = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, '1': 1, '2': 2, '3': 3, '4': 4 };
const BEDS = /(^|[^a-z0-9])(un|una|uno|dos|tres|cuatro|[1-4])\s*(?:dormitorios?|habitacion(?:es)?|piezas?|cuartos?|quartos?|dorm)(?=$|[^a-z0-9])/;
const EXTRA_RULES = [
  ['baratos', word('baratos?|baratas?|barato|economicos?|economicas?|bajo costo|precio bajo|accesibles?|baratinho|barata')],
  ['piscina', word('con piscina|piscina|pileta')],
  ['amoblado', word('amoblad[oa]s?|amueblad[oa]s?|mobiliad[oa]s?|furnished')],
  ['cochera', word('con cochera|cochera|garage|garaje|garagem')],
  ['patio', word('con patio|patio')],
  ['quincho', word('quincho')],
  ['monoambiente', word('monoambientes?')],
  ['dueño directo', word('dueno directo|dueño directo|sin intermediarios|directo del dueno|particular')],
];

const QUESTION = /^(cuanto|cuantos|cuanta|como|que|donde|cual|cuales|cuando|por que|porque|se puede|es mejor|conviene|vale la pena|requisitos|quanto|onde)\b|\?|\b(requisitos|impuestos?|contrato|escritura|comision|tramites?|precio del m2|precio por metro|cuanto cuesta|cuanto sale)\b/;
// Navigational searches for a brand: never a page of ours to build.
const BRANDS = /\b(infocasas|clasipar|inmuebles24|zonaprop|remax|re max|century ?21|mercadolibre|mercado libre|properati|tu lugar|casa libre|casalibre|casa-libre|fincaraiz|olx|facebook|marketplace|argenprop|toctoc|ultracasas)\b/;

// term → parsed. places: { cities: [{ slug, name }], barrios: [{ slug, name, ciudad }] }
export function parseTerm(term, places = {}) {
  const raw = String(term || '');
  const pt = parseSearch(raw);
  let t = ptAlias(foldText(raw)).replace(/\s+/g, ' ').trim();
  const out = { term: raw, op: null, tipo: null, ciudad: null, barrio: null, extras: [], question: QUESTION.test(t), brand: BRANDS.test(t), pt: !!pt.pt };
  for (const [op, re] of OP_RULES) if (re.test(t)) { out.op = op; break; }
  if (!out.op && pt.op) out.op = pt.op;
  for (const [slug, re] of TYPE_RULES) if (re.test(t)) { out.tipo = slug; break; }
  const b = BEDS.exec(t);
  if (b) { const n = NUM[b[2]]; out.extras.push(n === 1 ? '1-dormitorio' : `${n}-dormitorios`); }
  for (const [extra, re] of EXTRA_RULES) if (re.test(t)) out.extras.push(extra);
  if (out.extras.includes('monoambiente') && !out.extras.some((e) => /dormitorio/.test(e))) out.extras.push('1-dormitorio');
  // place: the longest city name in the text, then a known barrio (of that city if one was found)
  const cities = [...(places.cities || [])].sort((a, b2) => norm(b2.name).length - norm(a.name).length);
  for (const c of cities) {
    const n = norm(c.name);
    if (word(n.replace(/\s+/g, ' +')).test(t) || word(c.slug.replace(/-/g, ' +')).test(t)) { out.ciudad = c.slug; break; }
  }
  // a "barrio" named like a city (listings whose neighbourhood is just "Asunción") is the city itself,
  // never a neighbourhood: it would hijack every search for that city (live PY, Nov 18)
  const cityKeys = new Set((places.cities || []).flatMap((c) => [c.slug, slugify(c.name)]));
  const barrios = [...(places.barrios || [])].filter((x) => !out.ciudad || x.ciudad === out.ciudad)
    .filter((x) => norm(x.name).length >= 4 && !cityKeys.has(x.slug || slugify(x.name)) && !cityKeys.has(slugify(x.name))).sort((a, b2) => norm(b2.name).length - norm(a.name).length);
  for (const x of barrios) {
    if (word(norm(x.name).replace(/[^a-z0-9]+/g, ' +')).test(t)) { out.barrio = x.slug || slugify(x.name); out.ciudad = out.ciudad || x.ciudad; break; }
  }
  out.extras = [...new Set(out.extras)];
  return out;
}

// The page that should answer a parsed search, or null.
//   op + tipo + city (+ barrio | + the first extra that is a page variant)  → matrix page
//   tipo + city, no op                                                      → the venta page (opGuessed)
//   op/city only                                                            → /propiedades-en/{city}
export function urlFor(p) {
  if (!p || p.brand) return { url: null, kind: 'brand' };
  if (p.question && !p.ciudad && !p.tipo) return { url: null, kind: 'question' };
  if (p.tipo && p.ciudad) {
    const op = p.op || 'venta';
    const variant = !p.barrio ? p.extras.find((e) => VARIANTS[e]) || null : null;
    return {
      url: pathOf({ op, tipo: p.tipo, ciudad: p.ciudad, barrio: p.barrio, variant }),
      base: pathOf({ op, tipo: p.tipo, ciudad: p.ciudad }),
      kind: p.barrio ? 'barrio' : variant ? 'variant' : 'city',
      variant, opGuessed: !p.op,
    };
  }
  if (p.ciudad) return { url: `/propiedades-en/${p.ciudad}`, kind: 'city_hub' };
  if (p.op) return { url: p.op === 'alquiler' ? '/alquilar' : '/comprar', kind: 'op_hub' };
  return { url: null, kind: 'unmatched' };
}

export const matchTerm = (term, places) => { const parsed = parseTerm(term, places); return { parsed, ...urlFor(parsed) }; };

// Two searches that read the same ("Alquiler  Departamentos Asunción" = "alquiler departamentos asuncion").
export const termKey = (s) => foldText(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
