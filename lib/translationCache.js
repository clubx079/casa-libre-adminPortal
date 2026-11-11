// Saved translations: every place the admin puts text into another language (inbox "English
// on", email / WhatsApp template previews, the user timeline, Open issues, Reports, Feedback,
// the Referrals share message) looks the text up here first and only asks the translation
// service (Groq / Claude) when there is no saved one — then saves it for next time.
//
//   key        hash of (source text, source→target language, purpose, version). A changed text
//              is a different key, so an old translation is never served for new text; a new
//              prompt or model is a new `version`, so it gets a fresh translation too.
//   memory     this server process (instant; lost on restart)
//   store      the `translation_cache` table (lib/translationStore.js) — survives restarts and
//              is shared by every admin and every country. Optional: without the table, or when
//              a read / write fails, everything still works (it just translates again).
//   getMany / putMany   a page of 40 messages is ONE lookup and ONE save, not 40.
//
// Pure apart from the store it is given — test/translationCache.test.js.
import { createHash } from 'node:crypto';

export const CACHE_VERSION = 'v1';
const clean = (t) => String(t ?? '').replace(/\r\n?/g, '\n').trim();

export function translationKey({ text, from = 'es', to = 'en', purpose = 'general', version = '' }) {
  return createHash('sha256').update([CACHE_VERSION, `${from}>${to}`, purpose, version, clean(text)].join('\n')).digest('hex').slice(0, 40);
}

// what a translator may hand back: 'text' | { text, persist?, engine? } | null (failed)
const shape = (r) => {
  if (r == null || r === false) return null;
  if (typeof r === 'string') return r.trim() ? { text: r, persist: true, engine: null } : null;
  return String(r.text || '').trim() ? { text: String(r.text), persist: r.persist !== false, engine: r.engine || null } : null;
};

export function createTranslationCache({ store = null, memoryMax = 5000 } = {}) {
  const memory = new Map();     // key → translation
  const inflight = new Map();   // key → Promise<string|null> (two requests for the same text share one call)
  const stats = { hits: 0, storeHits: 0, misses: 0, saved: 0, storeErrors: 0 };
  const remember = (k, v) => { memory.delete(k); memory.set(k, v); if (memory.size > memoryMax) memory.delete(memory.keys().next().value); };

  // keys → Map(key → translation) for the ones we have (memory first, then ONE store read)
  async function getMany(keys = []) {
    const out = new Map();
    const ask = [];
    for (const k of new Set(keys)) { if (memory.has(k)) { out.set(k, memory.get(k)); stats.hits += 1; } else ask.push(k); }
    if (ask.length && store) {
      try {
        const got = await store.getMany(ask);
        for (const [k, v] of got || []) if (v) { out.set(k, v); remember(k, v); stats.storeHits += 1; }
      } catch { stats.storeErrors += 1; }   // a failed read = not saved: the caller translates
    }
    return out;
  }

  // entries: [{ key, translation, from, to, purpose, engine, sourceChars, persist }] — ONE store write
  async function putMany(entries = []) {
    const rows = [];
    for (const e of entries) {
      if (!e?.key || !String(e.translation || '').trim()) continue;
      remember(e.key, e.translation);
      if (e.persist !== false) rows.push(e);
    }
    if (!rows.length || !store) return;
    try { await store.putMany(rows); stats.saved += rows.length; } catch { stats.storeErrors += 1; }
  }

  // texts → the translations, in the same order ('' for an empty text, null for one that failed).
  //   translate(text)        one text → 'translation' | { text, persist: false } | null
  //   translateBatch(texts)  the missing ones in ONE call → Map(text → same as above) / array in order
  // persist: false = show it now and keep it in memory, but don't save it (a backup translator's answer).
  async function translateMany(texts = [], { from = 'es', to = 'en', purpose = 'general', version = '', translate = null, translateBatch = null, concurrency = 4 } = {}) {
    const src = texts.map(clean);
    const keyOf = new Map();
    for (const t of src) if (t && !keyOf.has(t)) keyOf.set(t, translationKey({ text: t, from, to, purpose, version }));
    const have = await getMany([...keyOf.values()]);
    const result = new Map();   // text → translation | null
    const waits = [];
    const mine = [];            // texts this call translates
    for (const [t, k] of keyOf) {
      if (have.has(k)) { result.set(t, have.get(k)); continue; }
      if (inflight.has(k)) { waits.push(inflight.get(k).then((v) => result.set(t, v))); continue; }
      let done; const p = new Promise((r) => { done = r; });
      inflight.set(k, p);
      mine.push({ t, k, done });
    }
    if (mine.length) {
      stats.misses += mine.length;
      const got = new Map();
      try {
        if (translateBatch) {
          const r = await translateBatch(mine.map((m) => m.t));
          if (Array.isArray(r)) mine.forEach((m, i) => got.set(m.t, shape(r[i])));
          else for (const m of mine) got.set(m.t, shape(r?.get?.(m.t)));
        } else if (translate) {
          let next = 0;
          const worker = async () => { while (next < mine.length) { const m = mine[next++]; got.set(m.t, shape(await Promise.resolve().then(() => translate(m.t)).catch(() => null))); } };
          await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, mine.length)) }, worker));
        }
      } catch { /* the whole batch failed: every text comes back null */ }
      await putMany(mine.filter((m) => got.get(m.t)).map((m) => ({ key: m.k, translation: got.get(m.t).text, persist: got.get(m.t).persist, engine: got.get(m.t).engine, from, to, purpose, sourceChars: m.t.length })));
      for (const m of mine) { const v = got.get(m.t)?.text ?? null; result.set(m.t, v); inflight.delete(m.k); m.done(v); }
    }
    await Promise.all(waits);
    return src.map((t) => (t ? result.get(t) ?? null : ''));
  }

  return { getMany, putMany, translateMany, stats, forget: () => memory.clear() };
}

// The one cache every admin route shares (globalThis: Next bundles each route on its own).
// The store comes from lib/translationStore.js the first time a server module asks for it.
export function sharedTranslationCache(makeStore = null) {
  if (!globalThis.__clTranslationCache) globalThis.__clTranslationCache = createTranslationCache({ store: makeStore ? makeStore() : null });
  return globalThis.__clTranslationCache;
}
