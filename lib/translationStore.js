// Where saved translations live (lib/translationCache.js): the `translation_cache` table of the
// CONTROL DB (migrations/009_translation_cache.sql) — one table for every admin and every
// country, because a translation of a text is the same whichever country it came from.
// PostgREST over HTTPS, the control DB's secret key. Never throws away a request:
//   · control DB not configured            → no store (memory only, as before)
//   · the table doesn't exist yet (SQL not run) → reads/writes are skipped for 10 minutes, then
//     checked again — so nothing breaks before the SQL is run, and it starts saving by itself after
//   · a slow / failed call                 → throws; the cache treats it as "not saved"
const TABLE = 'translation_cache';
const IN_CHUNK = 120;   // keys per read (40 characters each: keeps the URL well under limits)

export function postgrestStore({ url, key, fetchImpl = (...a) => fetch(...a), retryMissingMs = 10 * 60_000, timeoutMs = 4000 } = {}) {
  if (!url || !key) return null;
  const base = `${String(url).replace(/\/$/, '')}/rest/v1/${TABLE}`;
  const headers = (extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });
  let missingUntil = 0;
  const missing = () => Date.now() < missingUntil;
  async function check(res) {
    if (res.ok) return;
    const body = await res.text().catch(() => '');
    // PGRST205 / 42P01 = the table isn't there yet
    if (res.status === 404 || /PGRST205|42P01|does not exist/.test(body)) missingUntil = Date.now() + retryMissingMs;
    throw new Error(`translation_cache ${res.status}`);
  }
  return {
    available: () => !missing(),
    async getMany(keys = []) {
      const out = new Map();
      if (missing() || !keys.length) return out;
      for (let i = 0; i < keys.length; i += IN_CHUNK) {
        const res = await fetchImpl(`${base}?select=key,translation&key=in.(${keys.slice(i, i + IN_CHUNK).join(',')})`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
        await check(res);
        for (const r of await res.json()) out.set(r.key, r.translation);
      }
      return out;
    },
    async putMany(entries = []) {
      if (missing() || !entries.length) return;
      const rows = entries.map((e) => ({ key: e.key, source_lang: e.from || 'es', target_lang: e.to || 'en', purpose: e.purpose || 'general', engine: e.engine || null, source_chars: e.sourceChars ?? null, translation: e.translation }));
      const res = await fetchImpl(`${base}?on_conflict=key`, { method: 'POST', headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(rows), signal: AbortSignal.timeout(timeoutMs) });
      await check(res);
    },
  };
}

export const controlStore = () => postgrestStore({ url: process.env.CONTROL_DB_URL, key: process.env.CONTROL_DB_KEY });
