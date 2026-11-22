// Admin Users → "Type" column, filter and summary (buyer or seller, lib/userType.js — a copy
// of the website's, migration 023_user_type.sql on the website).
//   group: seller_listed · seller_never_listed · buyer · buyer_listed · unknown
//   "listed" = users.first_listed_at, or a user-created listing still owned (any status).
// Before the migration the type columns are missing → every account is 'unknown'
// (typeIndex returns { ready: false }).
import { selectAll } from './selectAll.js';
import { userTypeGroup, typeShares, normalizeUserType } from './userType.js';
import { HIDE_DELETED_USERS } from './userInsights.js';

// Filter values of ?type= → which groups match.
export const TYPE_FILTERS = {
  seller: ['seller_listed', 'seller_never_listed'],
  seller_listed: ['seller_listed'],
  seller_never_listed: ['seller_never_listed'],
  buyer: ['buyer', 'buyer_listed'],
  buyer_only: ['buyer'],
  buyer_listed: ['buyer_listed'],
  unknown: ['unknown'],
};

export const SOURCE_LABELS = {
  sell_funnel: 'signed up in the sell form',
  app_sell: 'signed up from the app’s Sell',
  signup_choice: 'answered after sign-up',
  login_choice: 'picked on the log-in screen',
  listing: 'published a listing',
  backfill_listed: 'backfill: has listed',
  backfill_sell_funnel: 'backfill: signed up in the sell form',
  backfill_draft: 'backfill: started a listing draft',
  backfill_login: 'backfill: signed up from Log in, never listed',
};

// owners: Map user id → user-created listings (any status).
export function typeOf(u, owners = new Map()) {
  const owned = owners.get(String(u?.id)) || 0;
  return {
    type: normalizeUserType(u?.user_type),
    source: u?.user_type_source || null,
    listed: !!u?.first_listed_at || owned > 0,
    group: userTypeGroup(u || {}, owned),
  };
}

// Whole country: id → typeOf(...) + the summary shares. keep(u) drops internal accounts.
export async function typeIndex(db, { keep = () => true } = {}) {
  let users;
  try {
    users = await selectAll(db, 'users', `select=id,email,user_type,user_type_source,first_listed_at&${HIDE_DELETED_USERS}&order=id.asc`);
  } catch {
    return { ready: false, byId: new Map(), shares: null };
  }
  const props = await selectAll(db, 'properties', 'select=id,created_by&origin=eq.user&created_by=not.is.null&order=id.asc').catch(() => []);
  const owners = new Map();
  for (const p of props) { const k = String(p.created_by); owners.set(k, (owners.get(k) || 0) + 1); }
  const byId = new Map();
  for (const u of users) if (keep(u)) byId.set(String(u.id), typeOf(u, owners));
  return { ready: true, byId, owners, shares: typeShares([...byId.values()].map((t) => t.group)) };
}
