// Stale-while-revalidate cache for the slow reads behind admin pages (PostHog,
// Resend, ip-api, big quarantine payloads). Server-only.
//
//   swr(key, loader, { fresh, stale })
//     · younger than `fresh` → the cached value, no call at all
//     · younger than `stale` → the cached value at once, and ONE refresh in the background
//     · older / never loaded → waits for the loader
//   Requests that arrive while a load is running share that same load. A failed
//   background refresh keeps the old value (and is retried on the next request).
//
// `loader(previous)` gets the last value, so a refresh can top up instead of reading
// everything again (lib/resendEmails.js). Kept on globalThis: Next bundles every route
// on its own, and a module-level Map would give each route its own copy.
const store = (globalThis.__clSwrCache ||= new Map()); // key -> { value, at, running }
const MAX_KEYS = 400;

function load(key, entry, loader) {
  if (entry.running) return entry.running;
  entry.running = Promise.resolve()
    .then(() => loader(entry.value))
    .then((value) => {
      entry.value = value;
      entry.at = Date.now();
      entry.loaded = true;
      return value;
    })
    .finally(() => { entry.running = null; });
  return entry.running;
}

export function swr(key, loader, { fresh = 60_000, stale = 30 * 60_000, force = false } = {}) {
  let entry = store.get(key);
  if (!entry) {
    if (store.size >= MAX_KEYS) store.delete(store.keys().next().value); // oldest key first
    entry = { value: undefined, at: 0, loaded: false, running: null };
    store.set(key, entry);
  }
  if (entry.loaded && !force) {
    const age = Date.now() - entry.at;
    if (age < fresh) return Promise.resolve(entry.value);
    if (age < stale) {
      load(key, entry, loader).catch((e) => console.error(`[swr] ${String(key).slice(0, 60)}`, e?.message || e));
      return Promise.resolve(entry.value);
    }
  }
  return load(key, entry, loader);
}

// When a key was last loaded (ms epoch), or null — for "updated N min ago" labels.
export const loadedAt = (key) => store.get(key)?.at || null;

export function forget(prefix = '') {
  for (const k of store.keys()) if (String(k).startsWith(prefix)) store.delete(k);
}
