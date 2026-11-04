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
//   offtopic  a person, but nothing to do with using Casa-Libre: where we are based, why our number
//             is from the US, who the founders are, "is this a scam", other businesses, politics,
//             personal chat. Never answered (Roland, Nov 4: we don't justify ourselves).
export const KINDS = ['button', 'keyword', 'emoji', 'ack', 'auto', 'greeting', 'media', 'question', 'text', 'offtopic'];
export const REAL = new Set(['button', 'keyword', 'greeting', 'media', 'question', 'text']);
export const isReal = (kind) => REAL.has(kind);

// Sure without asking the AI (no credits spent): a short message that is ONLY thanks / ok
// ("Gracias muy amable", "ok gracias 🙏", "dale, perfecto") → 'ack'; a short message that ONLY asks
// where we are from / why the number is American / who we are → 'offtopic'. Anything that also
// mentions publishing, a price, a property, a payment… is left to the AI. → kind | null
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const ACK_WORDS = new Set(('gracias muchas mil muy amable amables ok oka oki okey okay dale listo perfecto perfecta genial buenisimo buenisima ' +
  'bueno buena joya excelente de nada igualmente saludos bendiciones thanks thank you vale esta bien ya entendido entiendo claro ' +
  'super todo tanto por la info informacion atencion su tu te lo agradezco agradecido agradecida y a vos usted ustedes ' +
  'hermano hno senor senora seno sr sra que tengas tenga lindo buen dia dias tarde tardes noche noches').split(' '));
const ORIGIN = /\b(eeuu|ee ?uu|usa|estados unidos|norteamerican[oa]s?|american[oa]s?|gringos?|extranjer[oa]s?)\b|\+ ?1\b|\bde donde (son|sos|es|escriben|me escriben|llaman)\b|\bdonde (estan|queda|quedan) (ubicad|la oficina)|\bquien(es)? (son|sos|es|habla|me escribe)\b|\b(es|son) (una )?(estafa|truch|fals|real(es)?|legal(es)?|confiable)|\bcomo (consiguieron|obtuvieron|tienen) mi (numero|contacto)\b/;
const BUSINESS = /\b(public|aviso|anunci|propiedad|casa|depto|departamento|terreno|lote|inmueble|alquil|vend|compr|precio|cuesta|cobr|pag|tarjeta|plan|gratis|cuenta|foto|visita|listing|list|price)/;
export function sureKind(text) {
  const t = fold(text).replace(/[^\p{L}\p{N}+ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const words = t.split(' ');
  if (words.length <= 8 && words.every((w) => ACK_WORDS.has(w)) && /graci|thank|ok|dale|listo|perfect|genial|joya|excelente|agradezc|buenisim|entendid|vale/.test(t)) return 'ack';
  if (words.length <= 14 && ORIGIN.test(t) && !BUSINESS.test(t)) return 'offtopic';
  return null;
}

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
- question: a person asking something about using Casa-Libre (with or without a question mark): "cuánto cuesta publicar", "cómo publico", "me pasás info", "¿alguien vio mi casa?", "¿qué es Casa-Libre?".
- text: any other message written by a person: "Sí, pero me quieren cobrar", "Nadie me llama", "tengo 50 propiedades en InfoCasas", a complaint, an answer to our question.
- offtopic: a person, but NOT about using Casa-Libre: where we are based, why our number is from the United States / "+1", who the founders or the company are, whether we are real / legal / a scam, how we got their number, other businesses or services, politics, jokes, personal chat. If the same message ALSO asks something about publishing, prices, a property, a payment or their account, it is question.
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
