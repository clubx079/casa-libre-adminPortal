// Server side of the Inbox list: every Relay conversation (paged, cached a few seconds per
// mode) with the site(s) it belongs to (lib/inboxRules.js sitesOf) — so the page can filter
// by site, Unread (incl. "marked unread") and Unresponded, which Relay itself doesn't do.
// A site = the "site-xx" tag its verification codes put on the conversation (website
// lib/relay.js); untagged chats are matched against the country DBs.
import 'server-only';
import { relay } from './relayInbox';
import { dbFor } from './db';
import { listCountries } from './control';
import { sitesOf, phoneKey, SITE_TAG } from './inboxRules';
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

// The country sites (registry; the code's list as a fallback).
async function siteCodes() {
  try {
    const rows = await listCountries();
    if (rows.length) return rows.map((c) => String(c.code).toLowerCase());
  } catch { /* the code's list */ }
  return Object.keys(PHONE_PREFIX);
}

// Untagged chats (from before the site tag): the country DB(s) where the number is a user or
// a listing phone. Map last-8-digits → [codes]. Cached 10 minutes.
let dbMatchCache = null;
export async function phonesBySite() {
  if (dbMatchCache && Date.now() - dbMatchCache.at < 10 * 60 * 1000) return dbMatchCache.map;
  const map = new Map();
  const add = (phone, cc) => { const k = phoneKey(phone); if (k.length < 8) return; const v = map.get(k) || []; if (!v.includes(cc)) v.push(cc); map.set(k, v); };
  for (const cc of await siteCodes()) {
    try {
      const db = dbFor(cc);
      const [users, props, codes] = await Promise.all([
        db.select('users', 'select=phone&phone=not.is.null&limit=20000').catch(() => []),
        db.select('properties', 'select=contact_phone&origin=eq.user&contact_phone=not.is.null&limit=20000').catch(() => []),
        // every WhatsApp code that site sent ("wa:+595…", "walisting:<user>:+595…") — people who
        // asked for a sign-up code and never finished have no account or listing yet
        db.select('otp_codes', 'select=identifier&identifier=like.wa%25&order=created_at.desc&limit=20000').catch(() => []),
      ]);
      for (const u of users) add(u.phone, cc);
      for (const p of props) add(p.contact_phone, cc);
      for (const o of codes) for (const part of String(o.identifier || '').split(':')) if (/^\+?\d{8,15}$/.test(part)) add(part, cc);
    } catch { /* that site stays unknown */ }
  }
  dbMatchCache = { at: Date.now(), map };
  return map;
}

const untagged = (c) => !(c.tags || []).some((t) => String(t).startsWith(SITE_TAG));
export async function withSites(c, dbMatch) {
  const match = untagged(c) ? (dbMatch || await phonesBySite()) : null;
  const sites = sitesOf(c, match);
  return { ...c, sites, country: sites[0] };
}

// The conversations with .sites (and .country = the first one).
export async function conversationsWithCountry(mode, opts) {
  const list = await allConversations(mode, opts);
  const dbMatch = list.some(untagged) ? await phonesBySite() : null;
  return list.map((c) => { const sites = sitesOf(c, dbMatch); return { ...c, sites, country: sites[0] }; });
}
