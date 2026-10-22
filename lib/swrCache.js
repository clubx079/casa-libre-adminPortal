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
const store = (globalThis.__clSwrCache ||= new Map()); // key -> { value, at, running, runningSince }
const MAX_KEYS = 400;
// A load still "running" after this long is treated as stuck (a request that never
// answered): the next request starts a new one instead of waiting on it forever —
// otherwise the page keeps showing the old copy (Email analytics froze on Oct 21, 2026).
const STUCK_MS = 3 * 60_000;

function load(key, entry, loader) {
  if (entry.running && Date.now() - (entry.runningSince || 0) < STUCK_MS) return entry.running;
  const started = Date.now();
  entry.runningSince = started;
  const mine = Promise.resolve()
    .then(() => loader(entry.value))
    .then((value) => {
      // a stuck load that finally answers must not overwrite what a newer load brought
      if (started >= (entry.valueStarted || 0)) {
        entry.value = value;
        entry.at = Date.now();
        entry.valueStarted = started;
        entry.loaded = true;
      }
      return value;
    })
    .finally(() => { if (entry.running === mine) entry.running = null; });
  entry.running = mine;
  return mine;
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
