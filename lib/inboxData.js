// Server side of the Inbox list: every Relay conversation (paged, cached a few seconds per
// mode) with its country (lib/inboxRules.js countryOf) — so the page can filter by country,
// Unread (incl. "marked unread") and Unresponded, which Relay itself doesn't do.
import 'server-only';
import { relay } from './relayInbox';
import { dbFor } from './db';
import { listCountries } from './control';
import { countryOf } from './inboxRules';
import { PHONE_PREFIX } from './paidListingsAdmin';

const LIST_TTL = 4000;
const MAX_PAGES = 20;   // 2,000 conversations
const cache = new Map(); // mode → { at, list }

export async function allConversations(mode, { fresh = false } = {}) {
  const hit = cache.get(mode);
  if (!fresh && hit && Date.now() - hit.at < LIST_TTL) return hit.list;
  const list = [];
  let cursor = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams({ status: 'all', limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const r = await relay(mode, `/conversations?${qs}`);
    if (!r.ok) { const e = new Error(r.data?.error?.message || `Relay ${r.status}`); e.status = r.status; e.data = r.data; throw e; }
    list.push(...(r.data.data || []));
    if (!r.data.has_more || !r.data.next_cursor) break;
    cursor = r.data.next_cursor;
  }
  cache.set(mode, { at: Date.now(), list });
  return list;
}
export const forgetConversations = (mode) => cache.delete(mode);

// Calling code per country (registry first, the code's own table as a fallback).
let prefixCache = null;
export async function countryPrefixes() {
  if (prefixCache && Date.now() - prefixCache.at < 10 * 60 * 1000) return prefixCache.map;
  const map = { ...PHONE_PREFIX };
  try {
    for (const c of await listCountries()) {
      const p = String(c.phone_prefix || c.dial_code || '').replace(/\D/g, '');
      if (c.code && p) map[String(c.code).toLowerCase()] = p;
    }
  } catch { /* the code's table */ }
  prefixCache = { at: Date.now(), map };
  return map;
}

// Numbers with another calling code (a foreigner selling in Paraguay…): the country DB where
// they are a user or a listing phone. Cached 10 minutes.
let dbMatchCache = null;
async function phonesByCountry(codes) {
  if (dbMatchCache && Date.now() - dbMatchCache.at < 10 * 60 * 1000) return dbMatchCache.map;
  const map = new Map();
  for (const cc of codes) {
    try {
      const db = dbFor(cc);
      const [users, props] = await Promise.all([
        db.select('users', 'select=phone&phone=not.is.null&limit=20000').catch(() => []),
        db.select('properties', 'select=contact_phone&origin=eq.user&contact_phone=not.is.null&limit=20000').catch(() => []),
      ]);
      for (const x of [...users.map((u) => u.phone), ...props.map((p) => p.contact_phone)]) {
        const d = String(x || '').replace(/\D/g, '');
        if (d.length >= 8 && !map.has(d)) map.set(d, cc);
      }
    } catch { /* that country stays unknown */ }
  }
  dbMatchCache = { at: Date.now(), map };
  return map;
}

// The conversations with .country set.
export async function conversationsWithCountry(mode, opts) {
  const [list, prefixes] = await Promise.all([allConversations(mode, opts), countryPrefixes()]);
  const known = new Set(Object.values(prefixes).map(String));
  const needDb = list.some((c) => { const d = String(c.phone || '').replace(/\D/g, ''); return ![...known].some((p) => d.startsWith(p)); });
  const dbMatch = needDb ? await phonesByCountry(Object.keys(prefixes)) : null;
  return list.map((c) => ({ ...c, country: countryOf(c.phone, prefixes, dbMatch) }));
}
