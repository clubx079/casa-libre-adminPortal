import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { HIDE_DELETED_USERS, userListingStats } from '@/lib/userInsights';
import { selectAll } from '@/lib/selectAll';
import { isInternalEmail } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';
import { listingCounts } from '@/lib/listingCount';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Summary tiles: every (non-deleted, non-internal) user of the active country — not
// just the 500 rows / search results the table shows — and every user-created listing,
// counted per owner the same way the Listings column does (lib/listingCount.js).
async function summaryStats(db, extra) {
  const [all, props] = await Promise.all([
    selectAll(db, 'users', `select=id,email,verified&${HIDE_DELETED_USERS}&order=id.asc`),
    selectAll(db, 'properties', 'select=id,created_by&origin=eq.user&created_by=not.is.null&order=id.asc'),
  ]);
  const listings = new Map();
  for (const r of props) listings.set(String(r.created_by), (listings.get(String(r.created_by)) || 0) + 1);
  return userListingStats(all.filter((u) => !isInternalEmail(u.email, extra)), listings);
}

// All buyer-portal users who registered / logged in, read from the shared
// Casa Libre `users` table (server-side, secret key — RLS has no policies).
// Accounts removed through "Delete account" are hidden (not real users), and so are
// the team's own / Pakistan accounts.
export async function GET(request) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { selectWithCount } = dbFor(activeCountry());

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  const cols = 'id,email,full_name,phone,verified,active,auth_provider,created_at,last_login_at,ip_address,registration_ip,blocked,suspended';
  let query = `select=${cols}&${HIDE_DELETED_USERS}&order=created_at.desc&limit=500`;
  if (q) {
    // case-insensitive match on email or name
    const safe = encodeURIComponent(`%${q}%`);
    query += `&or=(email.ilike.${safe},full_name.ilike.${safe})`;
  }

  try {
    const [{ rows, count }, extra] = await Promise.all([selectWithCount('users', query), internalEmails(activeCountry())]);
    // Team / Pakistan accounts never show (lib/internalTraffic + internalAudience).
    const users = rows.filter((u) => !isInternalEmail(u.email, extra));
    const statsP = summaryStats(dbFor(activeCountry()), extra).catch((e) => { console.error('[api/users] stats', e); return null; });
    // How many listings each one published (lib/listingCount.js).
    const counts = await listingCounts(dbFor(activeCountry()).select, users.map((u) => u.id)).catch(() => new Map());
    for (const u of users) u.listings = counts.get(String(u.id)) || 0;
    const stats = await statsP;
    return NextResponse.json({ users, count: Math.max(0, count - (rows.length - users.length)), stats });
  } catch (err) {
    console.error('[api/users]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
