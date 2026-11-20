// AI SEO for the sites — is a search for THIS site, and does the site already answer it?
// (pure — test/seoSites.test.js)
//   isRelevant(term, kind)       owners: selling a property · agents: the agent's trade · library: buying,
//                                renting, investing, places · hub: cross-country / moving / investing in
//                                the Casa-Libre countries (isHubRelevant). A brand/navigational search never is.
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

// ── the hub (casa-libre.com): region-level / cross-country / "which country" searches, people moving to or
// investing in one of the Casa-Libre countries. Never a single-city listing search (those belong to the
// country sites), never a brand search, never a country Casa-Libre is not in (unless one of ours is named too).
const OUR = 'paraguay|bolivia|uruguay|venezuela|el salvador';
export const HUB_COUNTRY_CC = { paraguay: 'py', bolivia: 'bo', uruguay: 'uy', venezuela: 've', 'el salvador': 'sv' };
const HUB_REGION = wordRe('latinoamerica|latam|america latina|sudamerica|suramerica|america del sur|centroamerica|mercosur|paises de la region');
const HUB_CROSS = wordRe('que pais|cual pais|mejor pais|mejores paises|paises (?:para|donde|con|mas|baratos?)|comparar paises|comparacion de paises|comparativa|(?:' + OUR + ') (?:o|vs|versus) (?:' + OUR + '|argentina|brasil|chile|espana)|(?:argentina|brasil|chile|espana) (?:o|vs|versus) (?:' + OUR + ')');
const HUB_FOREIGN = wordRe('extranjer[oa]s?|desde el exterior|desde afuera|expat(?:s|riados?)?|nomada digital');
const HUB_MOVE = wordRe('residencia|radicarse|radicacion|mudarme|mudarse|mudanza a|emigrar|migrar|inmigrar|vivir en|jubilarse en|retirarse en|costo de vida|ciudadania');
const HUB_INVEST = wordRe('invertir|inversion(?:es)?|inversor(?:es)?|rentabilidad|bienes raices|mercado inmobiliario');
const HUB_PORTAL = wordRe('portal(?:es)? (?:inmobiliari[oa]s?|de (?:inmuebles|propiedades|bienes raices))|sitios? (?:web )?(?:para|de) (?:vender|comprar|alquilar|publicar) (?:propiedades|inmuebles|casas)');
const HUB_OURS = wordRe(OUR);
const HUB_OTHER = wordRe('argentina|brasil|chile|colombia|peru|ecuador|mexico|espana|panama|costa rica|guatemala|honduras|nicaragua|republica dominicana|cuba|estados unidos|usa|eeuu|canada|italia|portugal|alemania|francia|miami');
// "casas en venta asuncion", "alquiler santa cruz": a listing search of ONE city — the country sites' job.
const HUB_LISTING = wordRe('en venta|se vende|se alquila|venta de|alquiler de|alquilo|vendo|alquiler|venta');

/** The Casa-Libre countries a text names, as sorted codes (['bo','py']). */
export function countriesIn(s) {
  const t = fold(s).replace(/-/g, ' ');
  return Object.entries(HUB_COUNTRY_CC).filter(([n]) => wordRe(n).test(t)).map(([, cc]) => cc).sort();
}

export function isHubRelevant(term) {
  const t = fold(term).replace(/\s+/g, ' ').trim();
  if (!t || BRAND.test(t)) return false;
  const region = HUB_REGION.test(t);
  const ours = HUB_OURS.test(t);
  if (HUB_OTHER.test(t) && !ours && !region) return false;   // another country only: not ours to answer
  if (region || HUB_CROSS.test(t)) return true;
  const foreign = HUB_FOREIGN.test(t);
  const invest = HUB_INVEST.test(t);
  // a plain listing search ("casas en venta paraguay") is not a hub topic unless the reader is a foreigner or investor
  if (HUB_LISTING.test(t) && !foreign && !invest) return false;
  if (foreign) return true;                                  // "comprar casa en paraguay siendo extranjero"
  if (HUB_MOVE.test(t) || invest) return ours;               // "mudarse a uruguay", "invertir en inmuebles en bolivia"
  return HUB_PORTAL.test(t);                                 // "portal inmobiliario" (never a named one: BRAND above)

}

/** The hub's one-topic key: the topic words AND the countries named ("invertir en paraguay" ≠ "invertir en bolivia"). */
// Hub synonyms on top of CANON: property words, investing, moving and residency are one meaning each.
const HUB_CANON = [[/^(propiedad|inmueb|bienes|raice)/, 'inmueble'], [/^inver/, 'invert'], [/^(residenci|radic)/, 'residencia'], [/^(mud|emigr|migr|inmigr)/, 'mudarse'], [/^(extranjer|expat)/, 'extranjero']];
const hubCanon = (w) => { for (const [re, c] of HUB_CANON) if (re.test(w)) return c; return w; };
export const hubTopicKey = (s) => {
  const words = [...new Set(topicKey(s).split(' ').filter(Boolean).map(hubCanon))].sort();
  return [...words, ...countriesIn(s).map((c) => `@${c}`)].join(' ');
};
/** A hub search is a topic when it has 2+ real words counting the countries it names ("vivir en uruguay"). */
export const isHubTopic = (term) => isQuestionOrTopic(term) || contentWords(term).length + countriesIn(term).length >= 2;

// siteKey splits the owner sites: 'online' takes only HARD_CASE searches, 'org' never does.
export function isRelevant(term, kind, siteKey = null) {
  const t = fold(term);
  if (kind === 'hub') return isHubRelevant(term);
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
