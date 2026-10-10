// Emails the ACTIVE country's site sent, read from Resend's "List sent emails" API
// (no database). Shared by the Email analytics tab and the user page's Emails card.
// Needs a FULL-ACCESS key in RESEND_READ_API_KEY: the sites' own keys are send-only
// and cannot list. Server-only.
//
// Resend allows ~2 requests/second and the account is shared with other products
// (Ableman alone sends thousands a month), so a full read takes ~35s. The list is the
// whole account's, so ONE copy serves every country (each filters its own domain), and
// it is kept with lib/swrCache.js:
//   · younger than 5 minutes → served as is
//   · older → served at once, and topped up behind it: only the emails sent since, plus
//     the last 3 days again (their delivered / opened / clicked status still changes)
//   · every 6 hours the top-up is a full read instead, so older statuses catch up too
// Only the very first read after the server starts makes a page wait (~35s), and
// instrumentation.js starts that one at boot.
import { SENDER_DOMAIN, fromDomain } from './emailStats.js';
import { swr } from './swrCache.js';

const PAGE = 100;          // Resend max per page
const MAX_PAGES = 60;      // up to 6,000 emails per fetch (Resend keeps ~30 days; the shared account sends ~4,700 a month)
const PAUSE_MS = 550;      // stay under ~2 requests/second
const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 7 * 24 * 3600 * 1000; // after a week idle, wait for a full read again
const FULL_EVERY_MS = 6 * 3600 * 1000;
const RECHECK_MS = 3 * 86400000;       // statuses of the last 3 days are read again on a top-up
const MAX_DAYS = 365;      // always read this far back (stops earlier at the page cap)
const KEY = 'resend:emails';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const time = (e) => new Date(e.created_at).getTime();

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
      if (time(e) < cutoffMs) { reachedOld = true; break; }
      out.push(e);
    }
    if (reachedOld || !json.has_more || !data.length) return { rows: out, truncated: false };
    after = data[data.length - 1].id;
  }
  return { rows: out, truncated: true };
}

// prev = the copy kept so far (or undefined). → { rows (newest first), truncated, fullAt }
export async function refreshEmails(key, prev, now = Date.now(), list = listSince) {
  if (!prev || !prev.rows.length || now - prev.fullAt > FULL_EVERY_MS) {
    const { rows, truncated } = await list(key, now - MAX_DAYS * 86400000);
    return { rows, truncated, fullAt: now };
  }
  const since = time(prev.rows[0]) - RECHECK_MS;
  const { rows: recent, truncated } = await list(key, since);
  // A top-up that hit the page cap couldn't reach `since`: fall back to a full read.
  if (truncated) return refreshEmails(key, undefined, now, list);
  return { rows: [...recent, ...prev.rows.filter((e) => time(e) < since)], truncated: prev.truncated, fullAt: prev.fullAt };
}

export const resendReadable = () => !!process.env.RESEND_READ_API_KEY;

const read = (key) => swr(KEY, (prev) => refreshEmails(key, prev), { fresh: FRESH_MS, stale: STALE_MS });

// Starts the first read without waiting for it (server start, see instrumentation.js).
export function warmEmails() {
  const key = process.env.RESEND_READ_API_KEY;
  if (key) read(key).catch(() => {});
}

// → { domain, rows (this country's emails, newest first), truncated }, or null when
// no read key is configured. Throws on a Resend error (when there's no copy to show).
export async function countryEmails(country, days) {
  const key = process.env.RESEND_READ_API_KEY;
  if (!key) return null;
  const domain = SENDER_DOMAIN[country];
  const cutoffMs = Date.now() - Math.min(days, MAX_DAYS) * 86400000;
  const { rows, truncated } = await read(key);
  // "cut" matters only if the page cap stopped before this window's start
  const oldest = rows.length ? time(rows[rows.length - 1]) : Infinity;
  return {
    domain,
    truncated: truncated && oldest > cutoffMs,
    rows: rows.filter((e) => fromDomain(e.from) === domain && time(e) >= cutoffMs),
  };
}
