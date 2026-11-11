import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTranslationCache, translationKey } from '../lib/translationCache.js';
import { postgrestStore } from '../lib/translationStore.js';

// a store like the translation_cache table: a Map, counting the calls
function fakeStore({ failGet = false, failPut = false } = {}) {
  const rows = new Map();
  const calls = { get: 0, put: 0 };
  return {
    rows, calls,
    async getMany(keys) { calls.get += 1; if (failGet) throw new Error('db down'); return new Map(keys.filter((k) => rows.has(k)).map((k) => [k, rows.get(k)])); },
    async putMany(entries) { calls.put += 1; if (failPut) throw new Error('db down'); for (const e of entries) rows.set(e.key, e.translation); },
  };
}
const groq = () => vi.fn(async (t) => `EN(${t})`);

describe('translation key', () => {
  it('changes with the text, the languages, the purpose and the version', () => {
    const base = { text: 'Hola', from: 'es', to: 'en', purpose: 'message-en', version: 'groq1:m' };
    const k = translationKey(base);
    expect(k).toMatch(/^[0-9a-f]{40}$/);
    expect(translationKey({ ...base })).toBe(k);
    expect(translationKey({ ...base, text: 'Hola!' })).not.toBe(k);
    expect(translationKey({ ...base, to: 'pt' })).not.toBe(k);
    expect(translationKey({ ...base, purpose: 'user-text-en' })).not.toBe(k);
    expect(translationKey({ ...base, version: 'groq1:other-model' })).not.toBe(k);
    expect(translationKey({ ...base, text: '  Hola\r\n' })).toBe(k);   // same text, other line ends / spaces around
  });
});

describe('saved translations', () => {
  it('the second request for the same text makes no translation call', async () => {
    const store = fakeStore(); const t = groq();
    const cache = createTranslationCache({ store });
    expect(await cache.translateMany(['No me deja subir'], { translate: t })).toEqual(['EN(No me deja subir)']);
    expect(await cache.translateMany(['No me deja subir'], { translate: t })).toEqual(['EN(No me deja subir)']);
    expect(t).toHaveBeenCalledTimes(1);
  });

  it('a new server (empty memory) reads the saved one from the table: still no call', async () => {
    const store = fakeStore(); const t = groq();
    await createTranslationCache({ store }).translateMany(['Hola'], { translate: t });
    const afterRestart = createTranslationCache({ store });
    expect(await afterRestart.translateMany(['Hola'], { translate: t })).toEqual(['EN(Hola)']);
    expect(t).toHaveBeenCalledTimes(1);
    expect(afterRestart.stats.storeHits).toBe(1);
  });

  it('a changed text is translated again (never a stale one)', async () => {
    const store = fakeStore(); const t = groq();
    const cache = createTranslationCache({ store });
    await cache.translateMany(['Invitá a un colega y ganá'], { translate: t });
    expect(await cache.translateMany(['Invitá a un colega y ganá un mes gratis'], { translate: t })).toEqual(['EN(Invitá a un colega y ganá un mes gratis)']);
    expect(t).toHaveBeenCalledTimes(2);
    expect(store.rows.size).toBe(2);
  });

  it('a new prompt / model version translates again', async () => {
    const store = fakeStore(); const t = groq();
    const cache = createTranslationCache({ store });
    await cache.translateMany(['Hola'], { version: 'groq1:a', translate: t });
    await cache.translateMany(['Hola'], { version: 'groq1:b', translate: t });
    expect(t).toHaveBeenCalledTimes(2);
  });

  it('a page of messages is ONE lookup and ONE save; only the missing ones are translated', async () => {
    const store = fakeStore(); const t = groq();
    const cache = createTranslationCache({ store });
    const page1 = Array.from({ length: 40 }, (_, i) => `mensaje ${i}`);
    await cache.translateMany(page1, { translate: t });
    expect(store.calls).toEqual({ get: 1, put: 1 });
    expect(t).toHaveBeenCalledTimes(40);
    // the same chat opened again on a fresh server, with 2 new messages
    const fresh = createTranslationCache({ store });
    const out = await fresh.translateMany([...page1, 'nuevo 1', 'nuevo 2', '', 'mensaje 3'], { translate: t });
    expect(t).toHaveBeenCalledTimes(42);
    expect(store.calls).toEqual({ get: 2, put: 2 });
    expect(out.slice(-4)).toEqual(['EN(nuevo 1)', 'EN(nuevo 2)', '', 'EN(mensaje 3)']);   // order kept, empty stays empty, repeats share one
  });

  it('translateBatch gets only the missing texts, in one call', async () => {
    const store = fakeStore();
    const cache = createTranslationCache({ store });
    const batch = vi.fn(async (texts) => new Map(texts.map((x) => [x, { text: x.toUpperCase(), engine: 'claude' }])));
    await cache.translateMany(['uno', 'dos'], { translateBatch: batch });
    expect(await cache.translateMany(['uno', 'dos', 'tres'], { translateBatch: batch })).toEqual(['UNO', 'DOS', 'TRES']);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1][0]).toEqual(['tres']);
  });

  it('a failed cache READ falls back to translating', async () => {
    const store = fakeStore({ failGet: true }); const t = groq();
    const cache = createTranslationCache({ store });
    expect(await cache.translateMany(['Hola'], { translate: t })).toEqual(['EN(Hola)']);
    expect(t).toHaveBeenCalledTimes(1);
    expect(cache.stats.storeErrors).toBe(1);
  });

  it('a failed cache WRITE still returns the translation (and memory keeps it)', async () => {
    const store = fakeStore({ failPut: true }); const t = groq();
    const cache = createTranslationCache({ store });
    expect(await cache.translateMany(['Hola'], { translate: t })).toEqual(['EN(Hola)']);
    expect(await cache.translateMany(['Hola'], { translate: t })).toEqual(['EN(Hola)']);
    expect(t).toHaveBeenCalledTimes(1);
    expect(store.rows.size).toBe(0);
  });

  it('no store at all (table not created) works from memory', async () => {
    const t = groq();
    const cache = createTranslationCache({ store: null });
    await cache.translateMany(['Hola'], { translate: t });
    await cache.translateMany(['Hola'], { translate: t });
    expect(t).toHaveBeenCalledTimes(1);
  });

  it('a failed translation is null and is NOT saved: it is tried again next time', async () => {
    const store = fakeStore();
    const cache = createTranslationCache({ store });
    const t = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('429')).mockResolvedValue('Hello');
    expect(await cache.translateMany(['Hola'], { translate: t })).toEqual([null]);
    expect(await cache.translateMany(['Hola'], { translate: t })).toEqual([null]);
    expect(await cache.translateMany(['Hola'], { translate: t })).toEqual(['Hello']);
    expect(store.rows.size).toBe(1);
  });

  it('a backup translator\'s answer (persist: false) is shown but not saved to the table', async () => {
    const store = fakeStore();
    const cache = createTranslationCache({ store });
    expect(await cache.translateMany(['Hola'], { translate: async () => ({ text: 'Hi', persist: false }) })).toEqual(['Hi']);
    expect(store.rows.size).toBe(0);
    const t = groq();
    expect(await createTranslationCache({ store }).translateMany(['Hola'], { translate: t })).toEqual(['EN(Hola)']);   // a fresh server asks the real one
  });

  it('two requests for the same text at the same moment share one call', async () => {
    const cache = createTranslationCache({ store: fakeStore() });
    let release; const gate = new Promise((r) => { release = r; });
    const t = vi.fn(async (x) => { await gate; return `EN(${x})`; });
    const a = cache.translateMany(['Hola'], { translate: t });
    const b = cache.translateMany(['Hola'], { translate: t });
    await new Promise((r) => setTimeout(r, 5));
    release();
    expect(await Promise.all([a, b])).toEqual([['EN(Hola)'], ['EN(Hola)']]);
    expect(t).toHaveBeenCalledTimes(1);
  });
});

describe('translation_cache table (PostgREST)', () => {
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  it('no control DB → no store', () => { expect(postgrestStore({ url: '', key: '' })).toBe(null); });

  it('reads many keys in one request and upserts many rows in one request', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => { calls.push({ url, init }); return init.method === 'POST' ? res(201, null) : res(200, [{ key: 'k1', translation: 'Hello' }]); });
    const store = postgrestStore({ url: 'https://ctrl.example', key: 'secret', fetchImpl });
    expect([...(await store.getMany(['k1', 'k2']))]).toEqual([['k1', 'Hello']]);
    expect(calls[0].url).toBe('https://ctrl.example/rest/v1/translation_cache?select=key,translation&key=in.(k1,k2)');
    await store.putMany([{ key: 'k2', translation: 'Bye', from: 'es', to: 'en', purpose: 'message-en', engine: 'groq', sourceChars: 5 }, { key: 'k3', translation: 'Yes' }]);
    expect(calls[1].url).toBe('https://ctrl.example/rest/v1/translation_cache?on_conflict=key');
    expect(calls[1].init.headers.Prefer).toMatch(/merge-duplicates/);
    expect(JSON.parse(calls[1].init.body)).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('table not created yet (404 PGRST205): the cache still translates, and stops asking the DB for a while', async () => {
    const fetchImpl = vi.fn(async () => res(404, { message: 'relation "translation_cache" does not exist', code: 'PGRST205' }));
    const store = postgrestStore({ url: 'https://ctrl.example', key: 'secret', fetchImpl });
    const cache = createTranslationCache({ store }); const t = groq();
    expect(await cache.translateMany(['Hola', 'Chau'], { translate: t })).toEqual(['EN(Hola)', 'EN(Chau)']);
    expect(await cache.translateMany(['Otra'], { translate: t })).toEqual(['EN(Otra)']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);   // one read found the table missing; no write, no second read
    expect(store.available()).toBe(false);
  });
});

describe('translateToEnglish (lib/translate.js) uses the saved translations', () => {
  beforeEach(() => { delete globalThis.__clTranslationCache; });
  it('Groq is called once for a text, zero times the second time, again when the text changes', async () => {
    const { translateToEnglish, translateManyToEnglish } = await import('../lib/translate.js');
    const orig = globalThis.fetch; const key = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'test-key';
    const groqCalls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      if (!String(url).includes('api.groq.com')) throw new Error(`unexpected call ${url}`);
      const text = JSON.parse(init.body).messages[1].content; groqCalls.push(text);
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: `EN: ${text}` } }] }) };
    });
    try {
      expect(await translateToEnglish('Hola {{name}}, tu aviso está activo')).toBe('EN: Hola {{name}}, tu aviso está activo');
      expect(groqCalls).toEqual(['Hola __V0__, tu aviso está activo']);   // the {{tag}} never leaves
      await translateToEnglish('Hola {{name}}, tu aviso está activo');
      expect(groqCalls).toHaveLength(1);
      await translateToEnglish('Hola {{name}}, tu aviso ya está activo');
      expect(groqCalls).toHaveLength(2);
      // a list: only the new text goes out
      expect(await translateManyToEnglish(['Hola {{name}}, tu aviso está activo', 'Gracias', ''])).toEqual(['EN: Hola {{name}}, tu aviso está activo', 'EN: Gracias', '']);
      expect(groqCalls).toHaveLength(3);
    } finally { globalThis.fetch = orig; if (key == null) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = key; }
  });
});
