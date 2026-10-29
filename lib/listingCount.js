// How many listings each Casa Libre user has published (properties they created,
// origin 'user'). The Users page shows the count and flags it from the free limit on
// (3 by default — the 'Free listings per month' set on the Paid listings page; the
// paywall itself counts per month, lib/paidListingsAdmin.js).
// Saved but never published don't count: waiting for payment, photos being checked or
// rejected, held as a possible duplicate. Waiting for payment is counted apart, so the
// page can say "+1 waiting for payment".
export const LISTING_FREE_LIMIT = 3;
export const NOT_PUBLISHED = ['payment_pending', 'scanning', 'rejected', 'duplicate_review'];

export const overFreeLimit = (n) => Number(n) >= LISTING_FREE_LIMIT;

// rows: [{ created_by, status }] → { published: Map(id → n), waiting: Map(id → n) }
export function countListings(rows = []) {
  const published = new Map(), waiting = new Map();
  for (const r of rows) {
    const id = String(r.created_by);
    if (r.status === 'payment_pending') waiting.set(id, (waiting.get(id) || 0) + 1);
    if (!NOT_PUBLISHED.includes(r.status)) published.set(id, (published.get(id) || 0) + 1);
  }
  return { published, waiting };
}

// select = dbFor(country).select. → { published, waiting } Maps, only users with ≥ 1.
export async function listingCounts(select, userIds = []) {
  const ids = [...new Set(userIds.map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v)))];
  const parts = [];
  for (let i = 0; i < ids.length; i += 150) parts.push(ids.slice(i, i + 150));
  const rows = (await Promise.all(parts.map((p) => select('properties', `select=created_by,status&origin=eq.user&created_by=in.(${p.join(',')})&limit=10000`)))).flat();
  return countListings(rows);
}
