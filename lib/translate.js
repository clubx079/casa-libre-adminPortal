// Spanish → English translation for the template editor's "Preview in English".
// Preview only: nothing is saved and emails are still sent in Spanish.
// {{variables}} and link addresses are swapped for tokens before translating and put
// back after, so they survive untouched. Groq first (GROQ_API_KEY — an AI model: it gets
// casual WhatsApp Spanish right, e.g. "No se cambió nada" = "Nothing changed", where MyMemory
// said "I'm not changing anything", and returned "%0 … %1" leftovers or nothing for some
// messages), then MyMemory (free; texts up to 480 characters; its broken answers are
// rejected), then Google's public endpoint (often 429 from servers).
// Also the Inbox's "English on" (WhatsApp messages: emojis, links and names kept).

export function mask(text) {
  const keep = [];
  const masked = String(text ?? '').replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}|https?:\/\/[^\s)]+/g, (m) => { keep.push(m); return `__V${keep.length - 1}__`; });
  return { masked, keep };
}

export function unmask(text, keep) {
  return String(text ?? '').replace(/__\s*V\s*(\d+)\s*__/gi, (m, i) => (keep[Number(i)] ?? m));
}

import { translateText } from './groqTranslate.js';
import { sharedTranslationCache } from './translationCache.js';
import { controlStore } from './translationStore.js';

export const MYMEMORY_MAX = 480;   // MyMemory refuses queries over 500 characters

const GROQ_SYSTEM = `You translate short messages (WhatsApp chats, emails) into English.
Rules: translate everything into natural English. Keep emojis, numbers, prices (Gs., US$), phone numbers, links, tokens like __V0__, and the names of people, streets, neighbourhoods and cities exactly as written. Keep the line breaks and *bold* markers. Do not add, remove or explain anything.
Reply with the translation only.`;

async function viaGroq(text) {
  const out = await translateText(text, 'en', { system: GROQ_SYSTEM });
  if (!out) throw new Error('groq_failed');
  return out;
}

async function viaMyMemory(text) {
  if (text.length > MYMEMORY_MAX) throw new Error('too_long_for_mymemory');
  const url = `https://api.mymemory.translated.net/get?langpair=es|en&de=omar@airosofts.com&q=${encodeURIComponent(text)}`;
  const j = await fetch(url, { cache: 'no-store' }).then((r) => r.json());
  if (Number(j?.responseStatus) !== 200 || !j?.responseData?.translatedText) throw new Error(j?.responseDetails || 'mymemory_failed');
  if (brokenTranslation(text, j.responseData.translatedText)) throw new Error('mymemory_broken');
  return j.responseData.translatedText;
}

// An answer that isn't a translation: empty, "%0 … %1" leftovers from its translation memory
// that the source doesn't have, or the source handed back unchanged. Pure — test/translate.test.js.
export function brokenTranslation(src, out) {
  const s = String(src || '').trim(); const o = String(out || '').trim();
  if (!o) return true;
  if (/%\d/.test(o) && !/%\d/.test(s)) return true;
  return /[a-záéíóúñ]{3}/i.test(s) && o.toLowerCase() === s.toLowerCase();
}

async function viaGoogle(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=es&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  const t = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }).then((r) => r.text());
  const j = JSON.parse(t);
  return j[0].map((x) => x[0]).join('');
}

// Saved translations (lib/translationCache.js): a text is looked up first (memory, then the
// translation_cache table) and the translation service is only asked when there is none saved.
// What Groq wrote is saved for good; a backup translator's answer (MyMemory / Google, used only
// when Groq didn't answer) is kept in memory for this server but not saved, so Groq gets
// another go later. The version names the prompt + model: change either and texts are
// translated again.
const PURPOSE = 'message-en';
const version = () => `groq1:${process.env.GROQ_MODEL || 'openai/gpt-oss-20b'}`;
const cache = () => sharedTranslationCache(controlStore);

async function translateOne(text) {
  const { masked, keep } = mask(text);
  let out; let engine = 'groq';
  try { out = await viaGroq(masked); } catch {
    engine = 'backup';
    try { out = await viaMyMemory(masked); } catch { out = await viaGoogle(masked); }
  }
  return { text: unmask(out, keep), persist: engine === 'groq', engine };
}

// texts → English, in the same order (null where no service answered). ONE cache lookup for the
// whole list; only the texts with no saved translation are sent out, a few at a time.
export async function translateManyToEnglish(texts = [], { concurrency = 4 } = {}) {
  return cache().translateMany(texts.map((t) => String(t ?? '')), { from: 'es', to: 'en', purpose: PURPOSE, version: version(), translate: translateOne, concurrency });
}

export async function translateToEnglish(text) {
  if (!String(text || '').trim()) return text || '';
  const [out] = await translateManyToEnglish([text]);
  if (out == null) throw new Error('translate_failed');
  return out;
}
