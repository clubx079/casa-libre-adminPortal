import { rejectedWhatLabel } from '@/lib/photoFaceAdmin';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { HIDE_DELETED_USERS, userListingStats } from '@/lib/userInsights';
import { selectAll } from '@/lib/selectAll';
import { isInternalEmail } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';
import { listingCounts, countListings } from '@/lib/listingCount';
import { DELETED_EVENT } from '@/lib/listingDeletion';
import { listingPhones } from '@/lib/listingPhones';
import { matchesUser } from '@/lib/userSearch';
import { PHONE_PREFIX } from '@/lib/paidListingsAdmin';
import { savedProfileCompletion } from '@/lib/savedProfileCompletion';
import { typeIndex, TYPE_FILTERS } from '@/lib/userTypeAdmin';

// Profile Personalization (website Settings → Perfil profesional): the 7 items + "personalized"
// (lib/profileCompletion.js — the same rule the "Personalize your profile" emails stop at).
const PROFILE_COLS = 'first_name,last_name,job_title,company_name,company_website,profile_photo_url';
// Counts only what was SAVED in Profile Personalization (never the sign-up name); WhatsApp apart.
const profileOf = (u) => {
  const c = savedProfileCompletion(u);
  return { count: c.count, total: c.total, pct: c.pct, tone: c.tone, missing: c.missing, personalized: c.personalized, whatsapp: c.whatsapp };
};
// What the approved photo shows (website lib/profilePhotoKind.js, migration 013): face / logo / other.
const PHOTO_COLS = 'profile_photo_status,profile_photo_key,profile_photo_kind,profile_photo_kind_key';
// The profile columns exist once website migrations 021/022 ran, the photo kind once 013 ran;
// without them → the older select.
// Turned-down uploads (neither a face nor a logo — website migration 014): the last one + how many.
const REJECT_COLS = 'profile_photo_rejected_at,profile_photo_rejected_what,profile_photo_rejected_count';
async function withProfileCols(run, base) {
  try { return await run(`${base},${PROFILE_COLS},${PHOTO_COLS},${REJECT_COLS}`); } catch { /* 014 not applied */ }
  try { return await run(`${base},${PROFILE_COLS},${PHOTO_COLS}`); } catch { /* 013 not applied */ }
  try { return await run(`${base},${PROFILE_COLS}`); } catch { return run(base); }
}
// The approved photo → { url, kind: 'face' | 'logo' | 'other' | null (not checked yet) } or null.
const photoOf = (u) => {
  if (!u.profile_photo_url || (u.profile_photo_status && u.profile_photo_status !== 'approved')) return null;
  const current = u.profile_photo_kind && (!u.profile_photo_key || u.profile_photo_kind_key === u.profile_photo_key);
  return { url: u.profile_photo_url, kind: current ? u.profile_photo_kind : null };
};
// The last turned-down upload → { at, what, label, count } or null (website lib/profilePhotoKind.js).
const rejectedOf = (u) => (u.profile_photo_rejected_at
  ? { at: u.profile_photo_rejected_at, what: u.profile_photo_rejected_what || 'other', label: rejectedWhatLabel(u.profile_photo_rejected_what), count: Number(u.profile_photo_rejected_count) || 1 }
  : null);
// The Users filter (?profile=…), on the whole country, not just the rows shown.
const PROFILE_FILTERS = {
  personalized: (u) => profileOf(u).personalized,
  not_personalized: (u) => !profileOf(u).personalized,
  photo: (u) => !!photoOf(u),
  face: (u) => photoOf(u)?.kind === 'face',
  logo: (u) => photoOf(u)?.kind === 'logo',
  unknown: (u) => photoOf(u)?.kind === 'other',          // the "?" photos (neither a face nor a logo)
  rejected: (u) => !!u.profile_photo_rejected_at,        // tried to upload a wrong photo (turned down)
  no_photo: (u) => !photoOf(u),
};

// Buyer or seller (lib/userTypeAdmin.js): one whole-country read per request, shared by the
// Type column, the ?type= filter and the summary percentages. Internal accounts left out.
function typesLoader(db) {
  let p = null;
  return () => (p ||= internalEmails(activeCountry())
    .then((extra) => typeIndex(db, { keep: (u) => !isInternalEmail(u.email, extra) }))
    .catch(() => ({ ready: false, byId: new Map(), shares: null })));
}
const withTypes = async (stats, types) => {
  const t = await types();
  return stats ? { ...stats, types: t.shares, typesReady: t.ready } : stats;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Summary tiles: every (non-deleted, non-internal) user of the active country — not
// just the 500 rows / search results the table shows — and every user-created listing,
// counted per owner the same way the Listings column does (lib/listingCount.js).
async function summaryStats(db, extra) {
  const [all, props] = await Promise.all([
    withProfileCols((cols) => selectAll(db, 'users', `select=${cols}&${HIDE_DELETED_USERS}&order=id.asc`), 'id,email,verified,full_name,phone_verified_at'),
    selectAll(db, 'properties', 'select=id,created_by,status&origin=eq.user&created_by=not.is.null&order=id.asc'),
  ]);
  const listings = countListings(props).published;
  const real = all.filter((u) => !isInternalEmail(u.email, extra));
  const verified = real.filter((u) => u && u.verified === true);
  const personalized = verified.filter((u) => profileOf(u).personalized).length;
  return {
    ...userListingStats(real, listings),
    verifiedPersonalized: personalized,
    pctVerifiedPersonalized: verified.length ? Math.round((personalized / verified.length) * 100) : null,
  };
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
  const pf = PROFILE_FILTERS[searchParams.get('profile') || ''] || null;
  const tf = TYPE_FILTERS[searchParams.get('type') || ''] || null;
  const types = typesLoader(dbFor(activeCountry()));

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
      const stats = await withTypes(await summaryStats(db, extra).catch(() => null), types);
      return NextResponse.json({ users: [], count: 0, stats });
    }
    query += `&id=in.(${ids.slice(0, 500).map((id) => `"${id}"`).join(',')})`;
  }
  if (pf) {
    // Profile filter: every account of the country is checked, then the matching ones are loaded
    // (newest first, up to 500; combined with the search when there is one).
    const db = dbFor(activeCountry());
    const everyone = await withProfileCols((c) => selectAll(db, 'users', `select=${c}&${HIDE_DELETED_USERS}&order=id.asc`), 'id,email,full_name,created_at,phone_verified_at,profile_photo_url');
    const ids = everyone.filter(pf).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((u) => String(u.id));
    if (!ids.length) {
      const extra = await internalEmails(activeCountry());
      const stats = await withTypes(await summaryStats(db, extra).catch(() => null), types);
      return NextResponse.json({ users: [], count: 0, stats });
    }
    query += `&id=in.(${ids.slice(0, 500).map((id) => `"${id}"`).join(',')})`;
  }
  if (tf) {
    // Type filter (buyer / seller, listed or not): every account of the country, newest first.
    const db = dbFor(activeCountry());
    const [t, everyone] = await Promise.all([types(), selectAll(db, 'users', `select=id,created_at&${HIDE_DELETED_USERS}&order=id.asc`)]);
    const ids = everyone.filter((u) => tf.includes(t.byId.get(String(u.id))?.group || 'unknown'))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((u) => String(u.id));
    if (!ids.length) {
      const extra = await internalEmails(activeCountry());
      const stats = await withTypes(await summaryStats(db, extra).catch(() => null), types);
      return NextResponse.json({ users: [], count: 0, stats });
    }
    query += `&id=in.(${ids.slice(0, 500).map((id) => `"${id}"`).join(',')})`;
  }

  try {
    const [{ rows, count }, extra] = await Promise.all([
      withProfileCols((c) => selectWithCount('users', query.replace(`select=${cols}`, `select=${c}`)), cols),
      internalEmails(activeCountry()),
    ]);
    // Team / Pakistan accounts never show (lib/internalTraffic + internalAudience).
    const users = rows.filter((u) => !isInternalEmail(u.email, extra));
    for (const u of users) { u.profile = profileOf(u); u.photo = photoOf(u); u.photo_rejected = rejectedOf(u); }
    const statsP = summaryStats(dbFor(activeCountry()), extra).catch((e) => { console.error('[api/users] stats', e); return null; });
    // Buyer or seller of each row (type, how we know, listed or not, group).
    const typeIdx = await types();
    for (const u of users) u.type = typeIdx.byId.get(String(u.id)) || { type: null, source: null, listed: false, group: 'unknown' };
    // How many listings each one published (lib/listingCount.js).
    // Only published ones; a listing waiting for payment is counted apart (listings_waiting).
    const counts = await listingCounts(dbFor(activeCountry()).select, users.map((u) => u.id)).catch(() => ({ published: new Map(), waiting: new Map() }));
    for (const u of users) { u.listings = counts.published.get(String(u.id)) || 0; u.listings_waiting = counts.waiting.get(String(u.id)) || 0; }
    // Listings they deleted (the record kept for each, lib/listingDeletion.js) — shown apart.
    const emails = users.map((u) => String(u.email || '').toLowerCase()).filter(Boolean);
    const delRows = emails.length ? await dbFor(activeCountry()).select('email_log', `select=to_email&automation_id=eq.${DELETED_EVENT}&to_email=in.(${emails.map((e) => `"${e.replace(/"/g, '')}"`).join(',')})&limit=5000`).catch(() => []) : [];
    const delBy = new Map();
    for (const r of delRows) delBy.set(r.to_email, (delBy.get(r.to_email) || 0) + 1);
    for (const u of users) u.listings_deleted = delBy.get(String(u.email || '').toLowerCase()) || 0;
    // No phone on the profile → the one on their newest listing (shown as "from listing").
    const fromListing = await listingPhones(dbFor(activeCountry()).select, users.filter((u) => !u.phone).map((u) => u.id)).catch(() => new Map());
    for (const u of users) if (!u.phone && fromListing.has(String(u.id))) { u.phone = fromListing.get(String(u.id)); u.phone_source = 'listing'; }
    const stats = await withTypes(await statsP, types);
    return NextResponse.json({ users, count: Math.max(0, count - (rows.length - users.length)), stats });
  } catch (err) {
    console.error('[api/users]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
