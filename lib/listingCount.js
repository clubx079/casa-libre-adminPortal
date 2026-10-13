// How many listings each Casa Libre user has published (properties they created,
// origin 'user'). The Users page shows the count and flags it from the free limit on
// (3 by default — the 'Free listings per month' set on the Paid listings page; the
// paywall itself counts per month, lib/paidListingsAdmin.js).
export const LISTING_FREE_LIMIT = 3;

export const overFreeLimit = (n) => Number(n) >= LISTING_FREE_LIMIT;

// select = dbFor(country).select. → Map(user id → listings), only users with ≥ 1.
export async function listingCounts(select, userIds = []) {
  const ids = [...new Set(userIds.map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v)))];
  const parts = [];
  for (let i = 0; i < ids.length; i += 150) parts.push(ids.slice(i, i + 150));
  const rows = (await Promise.all(parts.map((p) => select('properties', `select=created_by&origin=eq.user&created_by=in.(${p.join(',')})&limit=10000`)))).flat();
  const out = new Map();
  for (const r of rows) out.set(String(r.created_by), (out.get(String(r.created_by)) || 0) + 1);
  return out;
}
