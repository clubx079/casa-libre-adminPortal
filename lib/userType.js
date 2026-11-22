// "Buyer or seller" (migration 023_user_type.sql). Pure — shared by the API routes, the
// automations and the tests; the admin keeps an identical copy (admin lib/userType.js).
//
// users.user_type        'seller' | 'buyer' | null (null = not known yet)
// users.user_type_source how we know: 'sell_funnel' (account made in the sell wizard),
//                        'signup_choice' (answered "¿Sos vendedor o comprador?" at sign-up),
//                        'login_choice' (picked on the log-in screen), 'listing' (an
//                        unknown account that published), 'backfill_*' (scripts/backfill-user-type.mjs)
// users.first_listed_at  first time the account published a listing (kept when it is deleted)
//
// The four groups the admin shows:
//   seller_listed · seller_never_listed · buyer · buyer_listed  (+ unknown)
export const USER_TYPES = ['seller', 'buyer'];
export const TYPE_SOURCES = ['sell_funnel', 'signup_choice', 'login_choice', 'listing', 'app_sell', 'backfill_listed', 'backfill_sell_funnel', 'backfill_draft', 'backfill_login'];

// Ask a new account "¿Sos vendedor o comprador?" for this long after it was made.
export const ASK_WINDOW_DAYS = 3;

export const normalizeUserType = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'seller' || s === 'vendedor' || s === 'sell') return 'seller';
  if (s === 'buyer' || s === 'comprador' || s === 'buy') return 'buyer';
  return null;
};

// Has this account ever published? first_listed_at, or a listing count / flag the caller
// already has (listingCount, has_listed).
export const hasListed = (u = {}, listingCount = null) =>
  !!(u && (u.first_listed_at || u.has_listed)) || (Number(listingCount) > 0);

// THE helper for marketing: does this person sell? A seller, or anyone who has listed
// (a buyer who also listed is selling something too). Unknown type → false here; use
// inSellerAudience() for "send seller emails" so unknown accounts keep getting them.
export const isSeller = (u = {}, listingCount = null) =>
  normalizeUserType(u?.user_type) === 'seller' || hasListed(u, listingCount);

export const isBuyer = (u = {}) => normalizeUserType(u?.user_type) === 'buyer';

// Who gets SELLER emails (profile personalization, …): sellers + anyone who listed, and —
// so nothing stops for people we haven't classified yet — accounts with no type.
// Only a buyer who never listed is left out.
export const inSellerAudience = (u = {}, listingCount = null) =>
  !normalizeUserType(u?.user_type) || isSeller(u, listingCount);

// → 'seller_listed' | 'seller_never_listed' | 'buyer' | 'buyer_listed' | 'unknown'
export function userTypeGroup(u = {}, listingCount = null) {
  const t = normalizeUserType(u?.user_type);
  const listed = hasListed(u, listingCount);
  if (t === 'seller') return listed ? 'seller_listed' : 'seller_never_listed';
  if (t === 'buyer') return listed ? 'buyer_listed' : 'buyer';
  return 'unknown';
}

export const GROUP_LABELS = {
  en: { seller_listed: 'Seller · listed', seller_never_listed: 'Seller · never listed', buyer: 'Buyer', buyer_listed: 'Buyer who listed', unknown: 'Not known' },
  es: { seller_listed: 'Vendedor · publicó', seller_never_listed: 'Vendedor · nunca publicó', buyer: 'Comprador', buyer_listed: 'Comprador que publicó', unknown: 'Sin dato' },
};

// Should the site ask this signed-in account "¿Sos vendedor o comprador?"
// Only when the column exists (the key is present in the row), no type yet, and the account
// is new (ASK_WINDOW_DAYS) — old accounts are classified by the backfill, not nagged.
export function shouldAskUserType(u, nowMs = Date.now()) {
  if (!u || !Object.prototype.hasOwnProperty.call(u, 'user_type')) return false;
  if (normalizeUserType(u.user_type)) return false;
  const made = Date.parse(u.created_at);
  if (!Number.isFinite(made)) return false;
  return nowMs - made <= ASK_WINDOW_DAYS * 864e5;
}

// The patch that records a type. onlyIfEmpty is applied by the caller's filter
// (user_type=is.null); this just builds the row.
export function userTypePatch(type, source, now = new Date()) {
  const t = normalizeUserType(type);
  if (!t) return null;
  return { user_type: t, user_type_source: TYPE_SOURCES.includes(source) ? source : null, user_type_at: now.toISOString() };
}

// Percentages for the admin summary: rows = [{ group }] or groups strings.
export function typeShares(groups = []) {
  const c = { seller_listed: 0, seller_never_listed: 0, buyer: 0, buyer_listed: 0, unknown: 0 };
  for (const g of groups) { const k = typeof g === 'string' ? g : g?.group; if (k in c) c[k]++; }
  const known = c.seller_listed + c.seller_never_listed + c.buyer + c.buyer_listed;
  const sellers = c.seller_listed + c.seller_never_listed;
  const buyers = c.buyer + c.buyer_listed;
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  return {
    counts: c, known, total: known + c.unknown,
    pctSellers: pct(sellers, known), pctBuyers: pct(buyers, known),
    pctSellersNeverListed: pct(c.seller_never_listed, sellers),
    pctBuyersListed: pct(c.buyer_listed, buyers),
  };
}

// What a sign-in request says about the type (POST bodies of /api/auth/code/verify,
// /api/auth/whatsapp/verify, /api/auth/apple, /api/auth/verify-otp):
//   signupSource 'sell'     → the website's sell wizard         → seller (sell_funnel)
//   signupSource 'app_sell' → the app's Sell / Publish sign-in → seller (app_sell)
//   userType 'seller'|'buyer' → picked on the log-in screen     → (login_choice)
// → { type, source } or null.
export function typeFromAuthBody(body = {}) {
  const src = String(body?.signupSource || '').trim();
  if (src === 'sell') return { type: 'seller', source: 'sell_funnel' };
  if (src === 'app_sell') return { type: 'seller', source: 'app_sell' };
  const t = normalizeUserType(body?.userType);
  return t ? { type: t, source: 'login_choice' } : null;
}
