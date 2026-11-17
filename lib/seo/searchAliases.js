// COPY of the website's lib/searchAliases.js (casa-libre-buyerPortal) so the SEO matcher parses a
// search exactly like the site's search box does (Portuguese spellings → op / type / place). Keep in sync.
// How Brazilian visitors type a search → what the listing data says.
//
// Brazilians type "Assunção", "assunc", "Cidade do Leste", "apartamento aluguel
// assunção"… while the data says Asunción, Ciudad del Este, property_type
// "Departamento", listing_type rent. Two layers, both on lower-case, accent-free
// text and whole words only:
//
//  - ptAlias(text): place names (and a few PT spellings) → the Spanish names. Runs
//    inside accentRegex (lib/marketplace.js) on every search, Spanish or not; it
//    only rewrites words no Spanish search contains (assuncao, cidade, sao, vila…).
//  - parseSearch(q): only when the query has a Portuguese-only word (aluguel,
//    apartamento, quartos, assunção…). Operation words set the operation filter,
//    property words become a property_type filter, feature words (quartos,
//    garagem…) are dropped because the search does not read descriptions, and the
//    rest is the place text. A Spanish query comes back untouched.
//
// Pure (no imports) so the tests load it directly.
export const foldText = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const word = (pattern, flags = 'g') => new RegExp(`(^|[^a-z0-9])(?:${pattern})(?=$|[^a-z0-9])`, flags);

// --- Places: [Portuguese / misspelling (folded), Spanish (folded)] — most specific first.
export const PT_ALIASES = [
  ['assuncao|asuncao|assuncion|assunsao|assunsion|asunsao|asunsion|assumcao', 'asuncion'],
  ['encarnacao|encarnasao|encarnasion', 'encarnacion'],
  ['concepcao', 'concepcion'],
  ['cidade +d[oe] +leste|cidade +del +este|ciudad +del +leste|ciudad +de +leste|cde', 'ciudad del este'],
  ['salto +do +guaira', 'salto del guaira'],
  ['pjc', 'pedro juan caballero'],
  ['fernando +da +mora|fernando +de +mora', 'fernando de la mora'],
  ['sao +lourenco', 'san lorenzo'],
  ['lourenco', 'lorenzo'],
  ['sao', 'san'],
  ['vila', 'villa'],
  ['apartamentos', 'departamento'],
  ['apartamento', 'departamento'],
];
const PLACE_RULES = PT_ALIASES.map(([pt, es]) => [word(pt), es]);

export function ptAlias(v) {
  let t = foldText(v);
  for (const [re, es] of PLACE_RULES) t = t.replace(re, (m, pre) => pre + es);
  // Half-typed "Assun", "assunc" → "asun", "asunc" (prefix of Asunción).
  t = t.replace(/(^|[^a-z0-9])assun/g, '$1asun');
  // Any other "-ção" word: Portuguese -cao ↔ Spanish -cion (e.g. "Constituição" → "constitucion").
  t = t.replace(/([a-z]{3,})cao(?=$|[^a-z0-9])/g, '$1cion');
  return t;
}

// --- Words only Portuguese searches contain. One of these switches parseSearch on.
const PT_MARKER = word([
  'assun[a-z]*', 'asunsao', 'asunsion', 'encarnacao', 'concepcao', 'cidade', 'leste', 'sao', 'vila', 'lourenco',
  'apartamentos?', 'aptos?', 'kitnets?', 'quitinetes?', 'sobrados?', 'chacaras?', 'sitios?', 'galpao', 'galpoes',
  'barracao', 'lojas?', 'ponto +comercial', 'sala +comercial', 'condominio +fechado', 'terreas?', 'cobertura',
  'imovel', 'imoveis', 'aluguel', 'alugar', 'alugo', 'locacao', 'venda', 'vendo', 'quartos?', 'banheiros?',
  'garagem', 'vagas?', 'mobiliad[oa]s?', '[a-z]{3,}cao',
].join('|'), '');

// --- Operation words → op filter. Order: phrases first.
const OP_RULES = [
  [word('para +alugar|para +aluguel|aluguel|alugar|alugo|locacao|alquiler'), 'alquiler'],
  [word('a +venda|para +venda|venda|vendo|comprar|compra|venta'), 'venta'],
];

// --- Property words → property_type keywords (same values the type filter uses,
// lib/propertyTypeOptions.js, plus a few the scraped data carries).
const TYPE_RULES = [
  [word('condominios? +fechados?'), ['condominio', 'barrio cerrado']],
  [word('casas? +terreas?'), ['casa', 'house']],
  [word('sala +comercial|salas +comerciais'), ['oficina', 'office']],
  [word('pontos? +comercia(?:l|is)|lojas?'), ['comercial', 'local', 'commercial', 'tienda']],
  [word('kitnets?|quitinetes?|studios?'), ['monoambiente']],
  [word('coberturas?'), ['penthouse']],
  [word('apartamentos?|aptos?|aps?|departamentos?'), ['departamento', 'depto', 'apartment', 'flat']],
  [word('sobrados?|duplex'), ['duplex', 'dúplex']],
  [word('terrenos?|lotes?'), ['terreno', 'lote', 'fracci', 'parcela']],
  [word('chacaras?|sitios?'), ['quinta', 'chacra', 'campo']],
  [word('galpao|galpoes|barracao|barracoes|depositos?'), ['deposito', 'depósito', 'warehouse', 'galp']],
  [word('casas?'), ['casa', 'house']],
];

// --- Features: the search does not read descriptions, so these only get in the way
// of the place match ("2 quartos", "com garagem").
const FEATURE_RULES = [
  word('\\d+ *(?:quartos?|dormitorios?|dorms?|banheiros?|vagas?|suites?)'),
  word('quartos?|dormitorios?|banheiros?|garagem|garagens|vagas?|mobiliad[oa]s?|piscina|suites?|imovel|imoveis'),
];
// Little words left at the edges once the rest is gone ("em assunção", "com piscina").
const STOP = '(?:em|no|na|nos|nas|de|do|da|com|para|perto|a|o|e)';
const EDGE_STOP = new RegExp(`^(?:${STOP}\\s+)+|(?:\\s+${STOP})+$|^${STOP}$`, 'g');

const uniq = (a) => [...new Set(a)];

// { text, op, typeKw, pt } — text is the place text for the loose match ('' = none),
// op 'alquiler' | 'venta' | null, typeKw property_type keywords ([] = none).
export function parseSearch(q) {
  const raw = String(q ?? '');
  let t = foldText(raw).replace(/\s+/g, ' ');
  if (!PT_MARKER.test(t)) return { text: raw, op: null, typeKw: [], pt: false };
  let op = null;
  for (const [re, o] of OP_RULES) t = t.replace(re, (m, pre) => { op = op || o; return `${pre} `; });
  let typeKw = [];
  for (const [re, kw] of TYPE_RULES) t = t.replace(re, (m, pre) => { typeKw = typeKw.concat(kw); return `${pre} `; });
  for (const re of FEATURE_RULES) t = t.replace(re, (m, pre) => `${pre} `);
  t = ptAlias(t).replace(/\s+/g, ' ').trim();
  let prev;
  do { prev = t; t = t.replace(EDGE_STOP, '').trim(); } while (t !== prev);
  return { text: t, op, typeKw: uniq(typeKw), pt: true };
}
