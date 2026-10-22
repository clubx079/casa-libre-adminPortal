// Unread counters for the admin sidebar (Reports, Feedback) — PER TEAM MEMBER.
// Each admin has their own "last opened" time per page in the active country's DB
// (table admin_seen, migration 008). Unread = rows created after it, so one person opening
// the page clears only their own badge. Someone who never opened a page sees the last
// NEW_ADMIN_DAYS days as unread, not every row ever. Pure helpers + small db functions
// (db = dbFor(country), passed in). test/unread.test.js.

export const UNREAD_PAGES = {
  reports: { table: 'listing_reports' },
  feedbacks: { table: 'feedback' },
};
export const NEW_ADMIN_DAYS = 14;
const TABLE = 'admin_seen';

// The signed-in admin → their key: control-DB id, or email for the env fallback account.
export function adminKey(session) {
  const k = session?.id || session?.email;
  return k ? String(k).trim().toLowerCase() : null;
}

// Rows created after this count as unread.
export function unreadSince(seenAt, now = Date.now()) {
  const t = Date.parse(seenAt);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(now - NEW_ADMIN_DAYS * 86400000).toISOString();
}

const q = encodeURIComponent;

// → { reports: n, feedbacks: n } for this admin (a page that fails counts as 0).
export async function unreadCounts(db, key, now = Date.now()) {
  const seen = await db.select(TABLE, `select=page,seen_at&admin_key=eq.${q(key)}`);
  const at = Object.fromEntries(seen.map((r) => [r.page, r.seen_at]));
  const out = {};
  await Promise.all(Object.entries(UNREAD_PAGES).map(async ([page, { table }]) => {
    try {
      out[page] = (await db.selectWithCount(table, `select=id&created_at=gt.${q(unreadSince(at[page], now))}&limit=1`)).count || 0;
    } catch { out[page] = 0; }
  }));
  return out;
}

// The admin opened `page`: remember now; → the time it was opened before (what was "new").
export async function markSeen(db, key, page, now = Date.now()) {
  const [prev] = await db.select(TABLE, `select=seen_at&admin_key=eq.${q(key)}&page=eq.${q(page)}&limit=1`);
  await db.insert(TABLE, [{ admin_key: key, page, seen_at: new Date(now).toISOString() }], { upsert: true, onConflict: 'admin_key,page', returning: 'minimal' });
  return unreadSince(prev?.seen_at, now);
}
