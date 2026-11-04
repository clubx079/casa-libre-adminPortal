// Sorting what people send us on WhatsApp — by AI (lib/waClassify.js runs it). Pure parts:
// the kinds, the prompt, the output schema, and what WhatsApp itself already tells us.
// test/waClassify.test.js.
//   button    a quick-reply button tap (WhatsApp marks it) — the website answers SÍ / BAJA / CARTERA / PROYECTO
//   keyword   the same words typed ("si", "baja", "stop", "no recibir más")
//   emoji     a reaction, a sticker, only emojis
//   ack       "gracias", "ok", "dale" — a person, but nothing to answer
//   auto      an automatic message from the other side's business account (auto-responder,
//             away message, welcome menu) — a ROBOT: never answered, never counted as a reply
//   greeting  "hola", "buenas" alone — a person opening a conversation
//   media     a photo / audio / document with no text
//   question  a person asking something
//   text      any other real message from a person (a statement, a complaint, an answer)
export const KINDS = ['button', 'keyword', 'emoji', 'ack', 'auto', 'greeting', 'media', 'question', 'text'];
export const REAL = new Set(['button', 'keyword', 'greeting', 'media', 'question', 'text']);
export const isReal = (kind) => REAL.has(kind);

// What WhatsApp already says about a message — no guessing needed: a button tap, a reaction /
// sticker, a file without text. Everything with text goes to the AI. → kind | null
export function structuralKind(m) {
  const type = String(m?.type || 'text').toLowerCase();
  const text = String(m?.text ?? m?.button?.text ?? '').trim();
  if (type === 'button' || type === 'interactive') return 'button';
  if (type === 'reaction' || type === 'sticker') return 'emoji';
  if (!text) return m?.media || ['image', 'video', 'audio', 'document', 'voice', 'location', 'contacts'].includes(type) ? 'media' : 'emoji';
  return null;
}

export const CLASSIFY_SYSTEM = `You sort incoming WhatsApp messages sent to Casa-Libre, a real-estate marketplace in Latin America. Our messages go to real-estate agents, agencies, developers and property owners; many of them use WhatsApp Business with automatic replies. For EACH message decide its kind:

- auto: written by a machine on the other side, not by the person: auto-responders and away messages ("Gracias por comunicarte con Aldo Zarza Inmobiliaria, en breve te responderemos", "Nuestro horario de atención es…", "Este es un mensaje automático", "Bienvenido a Century 21, ¿en qué podemos ayudarte?", menus "1) Ventas 2) Alquileres", "Hola! Soy el asistente virtual de…", "En este momento no podemos atenderte"). Strong signs: the company's name and a generic welcome, promises to answer later, opening hours, menus, the same text they would send anyone, and arriving within seconds of our message (seconds_after_ours under ~15 with a long text). A human who writes "gracias, en un rato te escribo" one hour later is NOT auto.
- ack: a person acknowledging with nothing to answer: "gracias", "ok", "dale", "listo", "perfecto", "👍 gracias", "muchas gracias!!".
- emoji: only emojis.
- keyword: one of our reply words typed alone: si / sí / baja / cartera / proyecto / stop / no recibir más.
- greeting: only a greeting: "hola", "buenas tardes", "hola buen día".
- question: a person asking something (with or without a question mark): "¿por qué veo un número de EEUU?", "cuánto cuesta publicar", "me pasás info".
- text: any other message written by a person: "Sí, pero me quieren cobrar", "Nadie me llama", "tengo 50 propiedades en InfoCasas", a complaint, an answer to our question.
Any language. When unsure between auto and a person, choose the person (question / text): a real person must never be ignored.
Return JSON only: one item per message, with its id, kind and a reason of at most 8 English words.`;

export const CLASSIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'kind', 'reason'], properties: { id: { type: 'string' }, kind: { type: 'string', enum: KINDS.filter((k) => !['button', 'media'].includes(k)) }, reason: { type: 'string' } } },
    },
  },
};

// items: [{ id, text, seconds_after_ours, our_last_message }] → the user turn
export function classifyAsk(items) {
  return `Messages (JSON):\n${JSON.stringify(items.map((x) => ({ id: x.id, text: String(x.text || '').slice(0, 600), seconds_after_ours: x.secondsAfterOurs ?? null, our_last_message: x.ourLast ? String(x.ourLast).slice(0, 160) : null })))}`;
}

// the model's answer → Map(id → { kind, reason })
export function parseClassified(json, ids = []) {
  const out = new Map();
  const items = Array.isArray(json?.items) ? json.items : [];
  for (const it of items) if (ids.includes(String(it?.id)) && KINDS.includes(it?.kind)) out.set(String(it.id), { kind: it.kind, reason: String(it.reason || '').slice(0, 80) });
  return out;
}

// the cache kept per country ({ id: [kind, savedAtMs] }), newest MAX kept
export const CACHE_MAX = 4000;
export function mergeCache(cache = {}, fresh = new Map(), now = Date.now()) {
  const next = { ...cache };
  for (const [id, v] of fresh) next[id] = [v.kind, now];
  const keys = Object.keys(next);
  if (keys.length > CACHE_MAX) keys.sort((a, b) => (next[a][1] || 0) - (next[b][1] || 0)).slice(0, keys.length - CACHE_MAX).forEach((k) => delete next[k]);
  return next;
}
