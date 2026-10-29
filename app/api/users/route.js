import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { HIDE_DELETED_USERS, userListingStats } from '@/lib/userInsights';
import { selectAll } from '@/lib/selectAll';
import { isInternalEmail } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';
import { listingCounts, countListings } from '@/lib/listingCount';
import { listingPhones } from '@/lib/listingPhones';
import { matchesUser } from '@/lib/userSearch';
import { PHONE_PREFIX } from '@/lib/paidListingsAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Summary tiles: every (non-deleted, non-internal) user of the active country — not
// just the 500 rows / search results the table shows — and every user-created listing,
// counted per owner the same way the Listings column does (lib/listingCount.js).
async function summaryStats(db, extra) {
  const [all, props] = await Promise.all([
    selectAll(db, 'users', `select=id,email,verified&${HIDE_DELETED_USERS}&order=id.asc`),
    selectAll(db, 'properties', 'select=id,created_by,status&origin=eq.user&created_by=not.is.null&order=id.asc'),
  ]);
  const listings = countListings(props).published;
  const real = all.filter((u) => !isInternalEmail(u.email, extra));
  return userListingStats(real, listings);
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

  const cols = 'id,email,full_name,phone,phone_verified_at,verified,active,auth_provider,created_at,last_login_at,ip_address,registration_ip,blocked,suspended';
  let query = `select=${cols}&${HIDE_DELETED_USERS}&order=created_at.desc&limit=500`;
  if (q) {
    // Forgiving search (lib/userSearch.js): any part of the name or email, accents and word
    // order ignored, or 3+ digits of their phone / a listing phone — matched here, then the
    // matching accounts are loaded (newest first, up to 500).
    const db = dbFor(activeCountry());
    const [everyone, listed] = await Promise.all([
      selectAll(db, 'users', `select=id,full_name,email,phone,created_at&${HIDE_DELETED_USERS}&order=id.asc`),
      selectAll(db, 'properties', 'select=created_by,contact_phone&origin=eq.user&created_by=not.is.null&contact_phone=not.is.null&order=id.asc').catch(() => []),
    ]);
    const phonesOf = new Map();
    for (const p of listed) { const k = String(p.created_by); if (!phonesOf.has(k)) phonesOf.set(k, []); phonesOf.get(k).push(p.contact_phone); }
    const prefix = PHONE_PREFIX[activeCountry()] || '';
    const ids = everyone.filter((u) => matchesUser(u, q, { phones: phonesOf.get(String(u.id)) || [], prefix }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((u) => String(u.id));
    if (!ids.length) {
      const extra = await internalEmails(activeCountry());
      const stats = await summaryStats(db, extra).catch(() => null);
      return NextResponse.json({ users: [], count: 0, stats });
    }
    query += `&id=in.(${ids.slice(0, 500).map((id) => `"${id}"`).join(',')})`;
  }

  try {
    const [{ rows, count }, extra] = await Promise.all([selectWithCount('users', query), internalEmails(activeCountry())]);
    // Team / Pakistan accounts never show (lib/internalTraffic + internalAudience).
    const users = rows.filter((u) => !isInternalEmail(u.email, extra));
    const statsP = summaryStats(dbFor(activeCountry()), extra).catch((e) => { console.error('[api/users] stats', e); return null; });
    // How many listings each one published (lib/listingCount.js).
    // Only published ones; a listing waiting for payment is counted apart (listings_waiting).
    const counts = await listingCounts(dbFor(activeCountry()).select, users.map((u) => u.id)).catch(() => ({ published: new Map(), waiting: new Map() }));
    for (const u of users) { u.listings = counts.published.get(String(u.id)) || 0; u.listings_waiting = counts.waiting.get(String(u.id)) || 0; }
    // No phone on the profile → the one on their newest listing (shown as "from listing").
    const fromListing = await listingPhones(dbFor(activeCountry()).select, users.filter((u) => !u.phone).map((u) => u.id)).catch(() => new Map());
    for (const u of users) if (!u.phone && fromListing.has(String(u.id))) { u.phone = fromListing.get(String(u.id)); u.phone_source = 'listing'; }
    const stats = await statsP;
    return NextResponse.json({ users, count: Math.max(0, count - (rows.length - users.length)), stats });
  } catch (err) {
    console.error('[api/users]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
