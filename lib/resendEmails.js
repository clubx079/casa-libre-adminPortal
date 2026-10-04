// Emails the ACTIVE country's site sent, read from Resend's "List sent emails" API
// (no database). Shared by the Email analytics tab and the user page's Emails card.
// Needs a FULL-ACCESS key in RESEND_READ_API_KEY: the sites' own keys are send-only
// and cannot list. Server-only.
//
// Resend allows ~2 requests/second and the account is shared with other products
// (Ableman alone sends thousands a month), so a full read takes ~35s. It is done once
// per country for the whole MAX_DAYS window and kept for 5 minutes; every page (Email
// analytics tab, user Emails card) filters its own window from that one copy, and
// requests arriving while a read is running wait for that same read.
import { SENDER_DOMAIN, fromDomain } from './emailStats.js';

const PAGE = 100;          // Resend max per page
const MAX_PAGES = 60;      // up to 6,000 emails per fetch (Resend keeps ~30 days; the shared account sends ~4,700 a month)
const PAUSE_MS = 550;      // stay under ~2 requests/second
const CACHE_MS = 5 * 60 * 1000;
const MAX_DAYS = 365;      // always read this far back (stops earlier at the page cap)
// country -> { at, promise }. Kept on globalThis: Next bundles each route on its own,
// so a module-level Map would give every page its own cache (and its own 35s read).
const cache = (globalThis.__clResendEmailsCache ||= new Map());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listSince(key, cutoffMs) {
  const out = [];
  let after = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    if (i) await sleep(PAUSE_MS);
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (after) qs.set('after', after);
    const res = await fetch(`https://api.resend.com/emails?${qs}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Resend HTTP ${res.status}`);
    const data = Array.isArray(json.data) ? json.data : [];
    let reachedOld = false;
    for (const e of data) {
      if (new Date(e.created_at).getTime() < cutoffMs) { reachedOld = true; break; }
      out.push(e);
    }
    if (reachedOld || !json.has_more || !data.length) return { rows: out, truncated: false };
    after = data[data.length - 1].id;
  }
  return { rows: out, truncated: true };
}

export const resendReadable = () => !!process.env.RESEND_READ_API_KEY;

// → { domain, rows (this country's emails, newest first), truncated }, or null when
// no read key is configured. Throws on a Resend error.
export async function countryEmails(country, days) {
  const key = process.env.RESEND_READ_API_KEY;
  if (!key) return null;
  const domain = SENDER_DOMAIN[country];
  const cutoffMs = Date.now() - Math.min(days, MAX_DAYS) * 86400000;
  let hit = cache.get(country);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    hit = { at: Date.now(), promise: listSince(key, Date.now() - MAX_DAYS * 86400000) };
    cache.set(country, hit);
    hit.promise.catch(() => { if (cache.get(country) === hit) cache.delete(country); });
  }
  const { rows, truncated } = await hit.promise;
  // "cut" matters only if the page cap stopped before this window's start
  const oldest = rows.length ? new Date(rows[rows.length - 1].created_at).getTime() : Infinity;
  return {
    domain,
    truncated: truncated && oldest > cutoffMs,
    rows: rows.filter((e) => fromDomain(e.from) === domain && new Date(e.created_at).getTime() >= cutoffMs),
  };
}
