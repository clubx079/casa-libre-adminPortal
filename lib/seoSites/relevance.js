// AI SEO for the sites — is a search for THIS site, and does the site already answer it?
// (pure — test/seoSites.test.js)
//   isRelevant(term, kind)       owners: selling a property · agents: the agent's trade · library: buying,
//                                renting, investing, places. A brand/navigational search never is.
//   isQuestionOrTopic(term)      a question ("cómo …", "cuánto …", "?") or a topic of 2+ real words
//   coveredBy(term, guides)      the existing guide (static from the site's catalog, or a pipeline draft)
//                                whose slug/title words already cover the search, else null
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wordRe = (p) => new RegExp(`(^|[^a-z0-9])(?:${p})(?=$|[^a-z0-9])`);

export const KIND_WORDS = {
  // owners = people who want to SELL: a seller verb or a seller's question. Plain "venta de casas" /
  // "se vende" are BUYER searches (they look for listings) and never an owners guide.
  owners: wordRe('vender|vendo|vendes|vende mi|vendiendo|venta de mi|venta de (?:una|la) (?:casa|propiedad) (?:propia|heredada)|tasar|tasacion|tasador|avaluo|valuar|cuanto vale (?:mi|una)|valor de mi|precio de mi|cuanto cobra (?:una )?inmobiliaria por vender|escritura|escriturar|impuestos? (?:a la |por la |de )?venta|herencia|heredad[oa]s?|sucesion|inmobiliaria para vender|publicar (?:mi|una) (?:casa|propiedad|terreno|departamento)|dueno directo|contraoferta|boleto de compraventa|plusvalia|ganancia de capital'),
  agents: wordRe('agentes?|corredor(?:es)?|corretaje|inmobiliarias?|captar|captacion|comision(?:es)?|clientes?|leads?|crm|licencia|matricula|abrir (?:una )?inmobiliaria|asesor(?:es)? inmobiliari[oa]s?|broker|exclusiva|referidos|portal(?:es)? inmobiliari[oa]s?|marketing inmobiliario|bienes raices'),
  library: wordRe('comprar|compro|compra|alquilar|alquiler|alquilo|arriendo|invertir|inversion|credito|creditos|hipoteca|hipotecari[oa]s?|prestamo|escribano|notario|terrenos?|lotes?|casas?|departamentos?|deptos?|duplex|barrios?|zonas?|precio (?:del |por )?m2|metro cuadrado|vivir en|mudarse|expensas|inquilin[oa]s?|garantia|contrato de alquiler|condominio|amoblad[oa]'),
};

// Navigational searches for a portal / brand: never a guide of ours (and never named in one).
export const BRAND = wordRe('casa ?libre|casalibre|infocasas|clasipar|inmuebles24|zonaprop|mercado ?libre|olx|properati|argenprop|remax|re max|century 21|coldwell|keller williams|idealista|facebook|marketplace|instagram|tiktok|youtube|google');

// The two owner sites never compete: .online = the hard cases, .org = everything else.
export const HARD_CASE = wordRe('herencia|heredad[oa]s?|heredero|sucesion|divorcio|separacion|deudas?|embargad[oa]|embargo|hipotecad[oa]|con hipoteca|sin titulo|sin escritura|titulo irregular|urgente|urgencia|desocupar|ocupad[oa]|okupa|inquilino adentro|con inquilino|poder notarial|desde el exterior|vivo afuera|extranjero|copropiedad|condomino|en conflicto|problema');

const QUESTION = /^(como|cuanto|cuantos|cuanta|cuantas|que|donde|cual|cuales|cuando|por que|porque|quien|quienes|se puede|puedo|es mejor|conviene|vale la pena|hay que|requisitos|pasos|guia|tips|consejos)\b|\?/;
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'a', 'en', 'para', 'por', 'un', 'una', 'unos', 'unas', 'con', 'sin', 'mi', 'mis', 'tu', 'su', 'sus', 'se', 'que', 'como', 'cuanto', 'cuanta', 'cuantos', 'cual', 'es', 'al', 'lo', 'le', 'me', 'si', 'mas', 'muy', 'hay', 'paraguay', 'bolivia', 'uruguay', 'venezuela', 'salvador', 'py', 'bo', 'guia', '2024', '2025', '2026', '2027']);

// light stemming: plurals and the common verb/noun endings, so "vender casa" ~ "venta de casas"
const stem = (w) => w.replace(/(ciones|cion)$/, 'cion').replace(/(es|s)$/, '').replace(/(ar|er|ir)$/, '');
export const contentWords = (s) => [...new Set(fold(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem).filter(Boolean))];

// one meaning, one key: plurals and synonyms merged, word order ignored, so "departamento en alquiler
// asuncion", "alquiler de departamentos asuncion" and "alquiler depto asuncion" are ONE topic.
const CANON = [[/^(alquil|arriend|arrend|rent)/, 'alquil'], [/^(vend|venta)/, 'vend'], [/^compr/, 'compr'], [/^(depto|dpto|departament)/, 'depto'], [/^(lote|terreno)/, 'terreno'], [/^(casa)/, 'casa'], [/^inmobiliari/, 'inmobiliaria'], [/^(precio|cost|vale|valor)/, 'precio']];
const canon = (w) => { for (const [re, c] of CANON) if (re.test(w)) return c; return w; };
export const topicKey = (s) => [...new Set(contentWords(s).map(canon))].sort().join(' ');

// siteKey splits the owner sites: 'online' takes only HARD_CASE searches, 'org' never does.
export function isRelevant(term, kind, siteKey = null) {
  const t = fold(term);
  if (!t.trim() || BRAND.test(t)) return false;
  const re = KIND_WORDS[kind];
  if (!re || !re.test(t)) return false;
  if (kind === 'owners' && siteKey === 'online') return HARD_CASE.test(t);
  if (kind === 'owners' && siteKey === 'org') return !HARD_CASE.test(t);
  return true;
}

export function isQuestionOrTopic(term) {
  const t = fold(term).trim();
  return QUESTION.test(t) || contentWords(t).length >= 2;
}

/** guides: [{ slug, title, h1?, path?, source? }] → the guide that covers the term, or null. */
export function coveredBy(term, guides = [], { min = 0.75 } = {}) {
  const tw = contentWords(term);
  if (!tw.length) return null;
  const slugTerm = fold(term).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let best = null;
  for (const g of guides) {
    if (!g) continue;
    if (g.slug && g.slug === slugTerm) return g;
    const gw = new Set([...contentWords(String(g.slug || '').replace(/-/g, ' ')), ...contentWords(g.title), ...contentWords(g.h1)]);
    const common = tw.filter((w) => gw.has(w)).length;
    const share = common / tw.length;
    if (share >= min && common >= Math.min(2, tw.length) && (!best || share > best.share)) best = { g, share };
  }
  return best ? best.g : null;
}

/** Related guides of the same country for internal links: most shared words first. */
export function relatedGuides(target, guides = [], n = 5) {
  const tw = new Set(contentWords(`${target.title || ''} ${String(target.slug || '').replace(/-/g, ' ')}`));
  return guides
    .filter((g) => g.path !== target.path && (!target.cc || !g.cc || g.cc === target.cc))
    .map((g) => ({ g, s: contentWords(`${g.title || ''} ${String(g.slug || '').replace(/-/g, ' ')}`).filter((w) => tw.has(w)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.g);
}
