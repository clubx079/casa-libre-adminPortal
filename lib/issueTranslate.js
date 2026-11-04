// Open issues are read and written in ENGLISH by the team (admins don't read Spanish):
//   toEnglishMany(texts)   what people wrote / the assistant's messages → English, for display
//                          (one Claude call for the lot; Groq / the free translator as backups;
//                          cached per text on this server)
//   toCustomerLanguage(en, sample)   the team's English message → the person's language before it
//                          is sent (the language of `sample` = what they wrote / our draft to them;
//                          Spanish as spoken in Paraguay, with "vos", when unsure). Claude, Groq backup.
// Server only.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { translateText } from './groqTranslate';
import { translateToEnglish } from './translate';

const MODEL = process.env.INBOX_TRANSLATE_MODEL || 'claude-opus-5-5';
const cache = (globalThis.__clIssueEn ||= new Map());   // original text → English
const MAX = 3000;
const remember = (k, v) => { cache.set(k, v); if (cache.size > MAX) cache.delete(cache.keys().next().value); };
// Already English? Only when it has common English words and nothing Spanish. Short Spanish
// ("Y la de encarnacion", "Nadie me llama", "Si pero me quieren cobrar") must be translated;
// no letters at all (a code, a number, emojis) is left as it is.
const SPANISH = /[áéíóúñ¿¡]|\b(que|para|por|con|una|uno|los|las|del|tu|mi|hola|gracias|quiero|como|el|la|de|y|en|me|te|pero|si|nadie|es|un|lo|se|al|mas|buenas|buenos|dias|tardes|noches|precio|casa|cuanto|donde|esta|tengo|hay|vendo|alquilo|terreno|departamento|podes|puedo)\b/i;
const ENGLISH = /\b(the|and|is|are|you|your|my|to|of|for|how|what|why|where|hi|hello|thanks|thank|please|yes|can|do|does|it|this|that|with|have|want|need|would|will)\b/i;
export const looksEnglish = (t) => { const x = String(t || ''); if (!/\p{L}/u.test(x)) return true; return !SPANISH.test(x) && ENGLISH.test(x); };

const EN_SCHEMA = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'en'], properties: { i: { type: 'number' }, en: { type: 'string' } } } } } };

async function claudeJson(system, content, schema) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45000, maxRetries: 1 });
  const msg = await client.messages.create({ model: MODEL, max_tokens: 4000, system, output_config: { effort: 'low', format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content }] });
  return JSON.parse((msg.content || []).filter((x) => x.type === 'text').map((x) => x.text).join(''));
}

// → Map(original → English). English text and empty strings come back as they are.
export async function toEnglishMany(texts = []) {
  const out = new Map();
  const todo = [];
  for (const t of [...new Set(texts.map((x) => String(x || '').trim()).filter(Boolean))]) {
    if (cache.has(t)) out.set(t, cache.get(t));
    else if (looksEnglish(t)) out.set(t, t);
    else todo.push(t);
  }
  if (!todo.length) return out;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const j = await claudeJson(
        'Translate each WhatsApp / website message to natural English. Keep names, numbers, prices, links and line breaks. Do not add or remove anything. Return JSON {"items":[{"i":number,"en":string}]} only.',
        JSON.stringify(todo.map((text, i) => ({ i, text: text.slice(0, 1500) }))), EN_SCHEMA);
      for (const it of j.items || []) if (todo[it.i] != null && it.en) { out.set(todo[it.i], it.en); remember(todo[it.i], it.en); }
    } catch (e) { console.error('[issueTranslate] claude', String(e?.message || e).slice(0, 120)); }
  }
  for (const t of todo.filter((x) => !out.has(x))) {
    const en = (await translateText(t, 'en').catch(() => null)) || (await translateToEnglish(t).catch(() => null));
    if (en) { out.set(t, en); remember(t, en); } else out.set(t, t);
  }
  return out;
}

const OUT_SYSTEM = `You translate a message that the Casa-Libre team wrote in English into the language of the customer they are writing to. LANGUAGE SAMPLE (a message in the customer's language) is given; if it is empty or Spanish, write Spanish as spoken in Paraguay, using "vos" (vos tenés, publicá, escribinos). Keep the meaning, tone and length; keep names, numbers, prices, currencies, links and line breaks exactly; write the brand as "Casa-Libre" (with the hyphen); no emojis. Return only the translated message.`;

// → { text, via } or { error }
export async function toCustomerLanguage(english, sample = '') {
  const src = String(english || '').trim();
  if (!src) return { error: 'empty' };
  const user = `LANGUAGE SAMPLE: ${String(sample || '').slice(0, 400) || '(none)'}\n\nMESSAGE TO TRANSLATE:\n${src}`;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45000, maxRetries: 1 });
      const msg = await client.messages.create({ model: MODEL, max_tokens: 2000, system: OUT_SYSTEM, output_config: { effort: 'low' }, messages: [{ role: 'user', content: user }] });
      const text = (msg.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('').trim();
      if (text) return { text, via: 'claude' };
    } catch (e) { console.error('[issueTranslate] out', String(e?.message || e).slice(0, 120)); }
  }
  if (sample && looksEnglish(sample)) return { text: src, via: 'english' };
  const es = await translateText(src, 'es', { system: OUT_SYSTEM }).catch(() => null);
  return es ? { text: es, via: 'groq' } : { error: 'The message could not be translated. Try again in a moment.' };
}

// The issues list in English: every “quoted text” in the evidence and the draft.
// Keeps the person's language reference in issue.data.sample (for the send).
export async function issuesInEnglish(issues = []) {
  const quotes = [];
  const Q = /“([^”]+)”/g;
  for (const i of issues) {
    for (const e of i.evidence || []) for (const m of e.matchAll(Q)) quotes.push(m[1]);
    if (i.draft?.es && !i.draft.en) quotes.push(i.draft.es);
    for (const x of [...(i.track?.items || []), ...(i.track?.their || [])]) for (const m of String(x.what || '').matchAll(Q)) quotes.push(m[1]);
  }
  const en = await toEnglishMany(quotes);
  return issues.map((i) => {
    const firstQuote = (i.evidence || []).map((e) => (Q.lastIndex = 0, /“([^”]+)”/.exec(e)?.[1])).find(Boolean) || '';
    return {
      ...i,
      evidence: (i.evidence || []).map((e) => e.replace(Q, (all, q) => `“${en.get(q.trim()) || q}”`)),
      draft: i.draft ? { es: i.draft.es, en: i.draft.en || en.get(String(i.draft.es).trim()) || i.draft.es } : null,
      ...(i.track ? { track: { ...i.track, items: (i.track.items || []).map((x) => ({ ...x, what: String(x.what || '').replace(Q, (all, q) => `“${en.get(q.trim()) || q}”`) })) } } : {}),
      data: { ...(i.data || {}), sample: i.draft?.es || firstQuote },
    };
  });
}
