// Pure helpers for the admin's per-user views (Users page, user analytics page).
// No fetch here, so they run under vitest (test/userInsights.test.js).

// "Delete account" (buyer portal lib/accountDeletion.js) keeps the users row but
// switches it off and renames the email to deleted-<id>@deleted.invalid. Those rows
// are not real users, so the Users page and the dashboard counts hide them.
export const DELETED_EMAIL_DOMAIN = 'deleted.invalid';
// PostgREST filter for "not a deleted account". AiroBase's `like` takes % as the
// wildcard (* does nothing there), sent URL-encoded.
export const HIDE_DELETED_USERS = `email=not.like.${encodeURIComponent(`%@${DELETED_EMAIL_DOMAIN}`)}`;

export function isDeletedEmail(email) {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${DELETED_EMAIL_DOMAIN}`);
}

// One plain email address, lowercased (how the buyer portal stores them), or null.
export function normalizeEmail(raw) {
  const e = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!e || e.length > 254) return null;
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(e) ? e : null;
}

// A listing row → what the user page shows. "live" follows the Properties page:
// admin_status 'active' (incompleteness is not checked here).
export function listingSummary(r = {}) {
  // neighborhood + city, trimmed, without repeating a name (Encarnación, Encarnación)
  const parts = [];
  for (const v of [r.neighborhood, r.city]) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t && !parts.some((p) => p.toLowerCase() === t.toLowerCase())) parts.push(t);
  }
  const place = parts.join(', ');
  return {
    id: r.id,
    title: r.address || place || r.city || 'Listing',
    place: place || r.city || '',
    operation: r.listing_type || '',
    type: r.property_type || '',
    price: r.price ?? null,
    currency: r.currency || '',
    live: r.admin_status === 'active',
    image: r.feature_image_url || null,
    created_at: r.created_at || null,
  };
}
