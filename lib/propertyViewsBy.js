// Analytics → Property analytics → "Views by source / by user" (Omar, Nov 24): pick a scraper
// (e.g. Habitamia), "Owner listings", or a user's email → EVERY live listing of that scope with its
// views and people in the window (0 included), plus the scope's combined views.
// Listings come from the country DB (the scope decides which), views from PostHog
// (`property_viewed`, the same event and filters as "Most viewed properties"). Pure helpers here;
// the route (app/api/analytics/posthog type=propertiesBy) does the I/O.
export const OWNERS = 'owners';
export const MAX_LISTINGS = 3000;      // a scope larger than this is cut (RE/MAX PY ≈ 1,200)
export const ID_CHUNK = 400;           // property ids per PostHog query

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => UUID.test(String(s || ''));
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

// The scope → the PostgREST filter for properties (live only: published, active, not delisted).
export function scopeFilter({ source = '', userId = '' } = {}) {
  const live = 'status=eq.published&admin_status=eq.active&is_delisted=not.is.true';
  if (userId && isUuid(userId)) return `created_by=eq.${userId}&status=neq.draft`;   // a person: all their listings, any state
  if (source === OWNERS) return `${live}&source_id=is.null`;
  if (isUuid(source)) return `${live}&source_id=eq.${source}`;
  return null;
}

export const chunks = (arr, n = ID_CHUNK) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
export const inList = (ids) => ids.filter(isUuid).map((id) => `'${id}'`).join(',');

// A listing row (DB) + its views → what the page shows.
export function shapeRow(p, v = {}) {
  return {
    propertyId: p.id,
    title: p.address || [p.neighborhood, p.city].filter(Boolean).join(', ') || `${String(p.id).slice(0, 8)}…`,
    neighborhood: p.neighborhood || '',
    city: p.city || '',
    type: p.property_type || '',
    mode: p.listing_type === 'rent' ? 'alquiler' : p.listing_type ? 'venta' : '',
    price: p.price_usd != null ? Number(p.price_usd) : null,
    status: p.status === 'published' && p.admin_status === 'active' && !p.is_delisted ? 'live' : (p.is_delisted ? 'removed at source' : p.admin_status !== 'active' ? (p.admin_status || 'inactive') : p.status),
    createdAt: p.created_at || null,
    views: Number(v.views || 0),
    visitors: Number(v.visitors || 0),
    lastSeen: v.lastSeen || null,
  };
}

// Rows → most viewed first, then newest; totals for the scope.
export function summarize(rows, combined = null) {
  const sorted = [...rows].sort((a, b) => b.views - a.views || b.visitors - a.visitors || String(b.createdAt).localeCompare(String(a.createdAt)));
  const views = sorted.reduce((s, r) => s + r.views, 0);
  return {
    rows: sorted,
    totals: {
      listings: sorted.length,
      viewed: sorted.filter((r) => r.views > 0).length,
      views,
      visitors: combined?.visitors ?? sorted.reduce((s, r) => s + r.visitors, 0),
      visitorsExact: !!combined,
    },
  };
}
