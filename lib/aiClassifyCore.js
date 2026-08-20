// Pure AI property-type classification logic (Groq chat completions).
// No 'server-only' import here on purpose: this module is shared between the
// Next.js server code (lib/aiClassify.js) and the standalone backfill script
// (scripts/backfill-ai-types.mjs), which runs under plain node and cannot
// import 'server-only'.

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export const TYPES = [
  'Casa',
  'Departamento',
  'Dúplex',
  'Terreno',
  'Campo',
  'Local comercial',
  'Oficina',
  'Depósito',
  'Edificio',
  'Condominio',
  'Loteamiento',
];

const SYSTEM_PROMPT = `You are a real-estate listing classifier for a Paraguay property marketplace. Given a listing's raw data (which may be in Spanish, mislabeled, or missing a type), classify it into EXACTLY ONE of these internal types: Casa, Departamento, Dúplex, Terreno, Campo, Local comercial, Oficina, Depósito, Edificio, Condominio, Loteamiento. Guidance: an empty lot / plot -> Terreno; a subdivided plot / 'loteamiento' -> Loteamiento; rural land, farm, ranch, 'estancia'/'chacra' -> Campo; a standalone house / 'casa'/'chalet'/'residencia' -> Casa; a flat / 'departamento'/'depto'/'monoambiente'/'penthouse' -> Departamento; a two-level joined unit / 'dúplex' -> Dúplex; a unit in a gated community / 'condominio'/'barrio cerrado' -> Condominio; an office -> Oficina; a warehouse / 'depósito'/'galpón'/industrial -> Depósito; a shop / retail / 'local comercial' -> Local comercial; a whole multi-unit building -> Edificio. Weigh the description and attributes over the source's own label (e.g. an 'industrial warehouse with commercial potential' is Depósito or Local comercial, not the source's generic label; a listing with 0 bedrooms and only a large land area is Terreno/Campo). Respond with ONLY the exact type label from the list - no punctuation, no explanation.`;

// Strip accents for tolerant matching (e.g. "Duplex" vs "Dúplex").
function foldAccents(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Extra synonyms / english terms the model might return instead of the exact label.
const SYNONYMS = [
  [/^apartment$|^flat$|^apto?$/i, 'Departamento'],
  [/^house$|^home$/i, 'Casa'],
  [/^land$|^lot$|^plot$/i, 'Terreno'],
  [/^commercial$|^retail$|^shop$|^store$/i, 'Local comercial'],
  [/^warehouse$|^industrial$/i, 'Depósito'],
  [/^office$/i, 'Oficina'],
  [/^building$/i, 'Edificio'],
  [/^farm$|^ranch$/i, 'Campo'],
  [/^duplex$/i, 'Dúplex'],
  [/^condo(minium)?$/i, 'Condominio'],
  [/^subdivision$/i, 'Loteamiento'],
];

// Parse/normalize raw model output into a canonical TYPES entry (or 'Inmueble').
// Pure, reusable by both the classifier and any test/backfill code.
export function normalizeToType(text) {
  if (!text) return 'Inmueble';
  const trimmed = String(text).trim().replace(/^["'.]+|["'.]+$/g, '');
  const folded = foldAccents(trimmed).toLowerCase();

  for (const t of TYPES) {
    if (foldAccents(t).toLowerCase() === folded) return t;
  }
  // Try matching just the first line/word in case the model added extra text.
  const firstToken = trimmed.split(/[\n,.;]/)[0].trim();
  const foldedFirst = foldAccents(firstToken).toLowerCase();
  for (const t of TYPES) {
    if (foldAccents(t).toLowerCase() === foldedFirst) return t;
  }
  for (const [re, type] of SYNONYMS) {
    if (re.test(trimmed) || re.test(firstToken)) return type;
  }
  return 'Inmueble';
}

// Compact rendering of a deal's fields for the user message.
function renderDeal(deal) {
  const d = deal || {};
  const desc = (d.description || '').toString().slice(0, 1500);
  const lines = [
    `source_type: ${d.property_type ?? ''}`,
    `title: ${d.title ?? ''}`,
    `address: ${d.address ?? ''}`,
    `city: ${d.city ?? ''}`,
    `neighborhood: ${d.neighborhood ?? ''}`,
    `listing_type: ${d.listing_type ?? ''}`,
    `bedrooms: ${d.bedrooms ?? ''}`,
    `bathrooms: ${d.bathrooms ?? ''}`,
    `parking_spaces: ${d.parking_spaces ?? ''}`,
    `covered_area: ${d.covered_area ?? ''}`,
    `floor_area: ${d.floor_area ?? ''}`,
    `land_area: ${d.land_area ?? ''}`,
    `price: ${d.price ?? ''} ${d.currency ?? ''}`,
    `description: ${desc}`,
  ];
  return lines.join('\n');
}

// Calls Groq to classify a deal. Returns a canonical TYPES entry (or 'Inmueble'),
// or null if the AI could not be reached / any error occurred. Never throws.
export async function classifyPropertyTypeCore(deal, { apiKey, model } = {}) {
  const key = apiKey ?? process.env.GROQ_API_KEY;
  if (!key) return null;
  const useModel = model ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';

  // Reasoning models (gpt-oss/qwen) spend tokens on hidden reasoning, so they
  // need a larger budget; instruct models answer in a couple of tokens.
  const reasoning = /gpt-oss|qwen/i.test(useModel);
  const body = {
    model: useModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: renderDeal(deal) },
    ],
    temperature: 0,
    max_tokens: reasoning ? 1024 : 12,
  };
  if (reasoning) body.reasoning_effort = 'low';

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    return normalizeToType(content);
  } catch {
    return null;
  }
}
