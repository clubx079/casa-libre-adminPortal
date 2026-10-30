// Deleted listings. The listing row is gone, so the record is an email_log row with channel
// 'event' and automation_id DELETED_EVENT, written by the website when the owner deletes it
// (buyer lib/listingDeleted.js) or by the admin's Properties → Delete (by 'team'). Its
// `error` field holds the details: { user_id, property_id, title, ref, status, paid,
// listed_at, live_days, views, by }. Pure helpers — test/listingDeletion.test.js.

import { listingLabel } from './paywallActivity.js';

export const DELETED_EVENT = 'event_listing_deleted';
// The public reference the seller saw (website lib/listingScan.js listingRef).
export const listingRef = (id, createdAt) =>
  `CL-${new Date(createdAt || Date.now()).getFullYear()}-${String(id || '').replace(/\D/g, '').slice(-5).padStart(5, '0') || '00000'}`;

// The record the admin's Properties → Delete writes for a user's listing (same shape as the
// website's, by 'team'). Not a message: dedupe key ends ':ev' (EMAIL_ONLY skips it).
export function teamDeletionRow(p, { ownerEmail, adminEmail, now = new Date() } = {}) {
  const pl = p.raw_data?.paid_listing || null;
  const d = {
    user_id: p.created_by || null, property_id: p.id, title: listingLabel(p), ref: listingRef(p.id, p.created_at),
    status: p.status || null, paid: pl ? (pl.paid_at ? 'paid' : pl.gift?.claimed_at ? 'gift' : 'unpaid') : 'free',
    listed_at: p.created_at || null,
    live_days: p.created_at ? Math.max(0, Math.round((now.getTime() - Date.parse(p.created_at)) / 86400000)) : null,
    views: null, by: 'team', by_email: adminEmail || null,
  };
  return {
    automation_id: DELETED_EVENT, channel: 'event', run_id: p.id, to_email: String(ownerEmail || '-').toLowerCase(),
    template_key: 'event:listing_deleted', subject: `${d.title} (${d.ref})`, status: 'sent',
    dedupe_key: `deleted:${p.id}:ev`, error: JSON.stringify(d),
  };
}
const parse = (row) => { try { return JSON.parse(row?.error || '{}') || {}; } catch { return {}; } };

// email_log rows → [{ id, title, ref, listedAt, deletedAt, by, views, liveDays, paid, status }], newest first
export function deletedListings(rows = []) {
  return rows
    .map((r) => {
      const d = parse(r);
      return {
        id: d.property_id || r.run_id || null, title: d.title || r.subject || 'Listing', ref: d.ref || '',
        listedAt: d.listed_at || null, deletedAt: r.created_at, by: d.by || 'owner', byEmail: d.by_email || null,
        views: d.views == null ? null : Number(d.views), liveDays: d.live_days == null ? null : Number(d.live_days),
        paid: d.paid || null, status: d.status || null, estimated: !!d.estimated,
      };
    })
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

const PAID = { free: 'a free listing', paid: 'a paid listing', gift: 'published with the free gift', unpaid: 'never paid — it was waiting for payment' };
// A deletion as a step of the person's timeline ("Messages sent").
export function deletionEvent(d) {
  const bits = [
    d.ref ? `Ref ${d.ref}` : '',
    d.paid ? PAID[d.paid] || '' : '',
    d.liveDays != null ? `listed ${d.liveDays === 0 ? 'the same day' : `${d.liveDays} day${d.liveDays === 1 ? '' : 's'} before`}` : '',
    d.views != null ? `${d.views.toLocaleString('en-US')} view${d.views === 1 ? '' : 's'}` : '',
    d.estimated ? 'deletion time estimated' : '',
  ].filter(Boolean);
  return {
    at: d.deletedAt, kind: 'deleted', listingId: d.id,
    title: d.by === 'team' ? `Listing deleted by the team${d.byEmail ? ` (${d.byEmail})` : ''} — ${d.title}` : `Deleted their listing — ${d.title}`,
    detail: bits.length ? `${bits.join(' · ')}.` : '',
  };
}

// Listings that no longer exist but still count for "their Nth listing this month": the
// deletion records, plus free-listing ledger rows whose listing is gone (property_id null —
// deletions from before the records existed). → [{ id, created_by, created_at }]
export function goneListings({ userId, deleted = [], ledger = [] } = {}) {
  const out = deleted.filter((d) => d.listedAt).map((d) => ({ id: `deleted:${d.id}`, created_by: userId, created_at: d.listedAt }));
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) < 5 * 60 * 1000;
  for (const l of ledger) {
    if (l.property_id || !l.created_at) continue;
    if (out.some((o) => near(o.created_at, l.created_at))) continue;   // already a deletion record
    out.push({ id: `ledger:${l.id || l.created_at}`, created_by: userId, created_at: l.created_at });
  }
  return out;
}
