// WhatsApp short-link codec — kept byte-identical to the buyer portal's
// lib/shortcode.js so scraped and user-published listings share one format.
// The scrape pipeline uses genShortCode() to stamp properties.short_code on
// insert (PY only); the buyer portal's /s/<code> route resolves it. Pure.

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// Generate a fresh, random per-property short code (default 6 base62 chars =
// ~56.8B combinations). Stored in properties.short_code; uniqueness is enforced
// by the DB's partial unique index (a collision fails the insert; the scrape
// loop records it as an item error and a later run retries with a new code).
export function genShortCode(len = 6) {
  let s = '';
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const b = new Uint8Array(len);
      crypto.getRandomValues(b);
      for (const x of b) s += B62[x % 62];
      return s;
    }
  } catch { /* fall through */ }
  for (let i = 0; i < len; i++) s += B62[Math.floor(Math.random() * 62)];
  return s;
}
