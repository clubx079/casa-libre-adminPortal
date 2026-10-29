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
import { phoneCores, phoneMatches } from '@/lib/phoneSearch';
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
    // case-insensitive match on email or name — and, when the search has digits, on the phone:
    // the profile phone or the phone on any of their listings (lib/phoneSearch.js).
    const safe = encodeURIComponent(`%${q}%`);
    const ors = [`email.ilike.${safe}`, `full_name.ilike.${safe}`];
    const cores = phoneCores(q, PHONE_PREFIX[activeCountry()] || '');
    if (cores.length) {
      const db = dbFor(activeCountry());
      const [withPhone, listed] = await Promise.all([
        selectAll(db, 'users', `select=id,phone&phone=not.is.null&${HIDE_DELETED_USERS}&order=id.asc`).catch(() => []),
        selectAll(db, 'properties', 'select=id,created_by,contact_phone&origin=eq.user&created_by=not.is.null&contact_phone=not.is.null&order=id.asc').catch(() => []),
      ]);
      const ids = [...new Set([
        ...withPhone.filter((u) => phoneMatches(u.phone, cores)).map((u) => String(u.id)),
        ...listed.filter((p) => phoneMatches(p.contact_phone, cores)).map((p) => String(p.created_by)),
      ])].slice(0, 300);
      if (ids.length) ors.push(`id.in.(${ids.map((id) => `"${id}"`).join(',')})`);
    }
    query += `&or=(${ors.join(',')})`;
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
