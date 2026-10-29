// Who hit the paywall and what happened next — for the Paid listings page ("Stopped at the
// paywall") and a user's activity page. Every listing that carries raw_data.paid_listing went
// through the paywall: it was saved as 'payment_pending' because the seller was over the free
// listings of the month (buyer lib/paidListings.js). From there it was paid, taken as a free
// gift ("Waiting for payment → free listing", buyer lib/automations/paymentFollowup.js), or it
// is still waiting — the seller saw the price and stopped. Pure: rows in, rows out.

const H = 3600 * 1000;
const TZ = { py: 'America/Asuncion', bo: 'America/La_Paz', uy: 'America/Montevideo', ve: 'America/Caracas', sv: 'America/El_Salvador' };

const monthKey = (iso, cc) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ[cc] || TZ.py, year: 'numeric', month: '2-digit' }).format(new Date(iso)); } catch { return String(iso).slice(0, 7); }
};
export const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
export const usdText = (cents) => { const v = Number(cents) / 100; return Number.isFinite(v) && v > 0 ? `US$${Number.isInteger(v) ? v : v.toFixed(2)}` : ''; };
export const listingLabel = (p) => [p.property_type, p.listing_type === 'rent' ? 'rent' : p.listing_type === 'sale' ? 'sale' : '', p.neighborhood || p.city].filter(Boolean).join(' · ') || 'Listing';

// Which listing of the (local) month this was for its owner: 3 → "their 3rd listing this month".
export function nthOfMonth(p, ownerListings = [], cc = 'py') {
  const m = monthKey(p.created_at, cc);
  return ownerListings.filter((x) => monthKey(x.created_at, cc) === m && String(x.created_at) <= String(p.created_at)).length || 1;
}

// One paywalled listing → its state now.
//   waiting      still unpaid, no gift (stopped at the payment)
//   gift_open    unpaid, a free-listing gift was offered and is still open
//   gift_lapsed  unpaid, the gift offer expired untaken
//   gift_taken   published for free with the gift
//   paid         paid (after `paidAfterH` hours)
//   ended        paid / gifted and its time ran out (status 'expired')
export function paywallState(p, now = new Date()) {
  const pl = p?.raw_data?.paid_listing || {};
  const g = pl.gift && typeof pl.gift === 'object' ? pl.gift : null;
  if (g?.claimed_at) return p.status === 'expired' ? 'ended' : 'gift_taken';
  if (pl.paid_at) return p.status === 'expired' ? 'ended' : 'paid';
  if (p.status === 'payment_pending') {
    if (g?.offered_at) return Date.parse(g.expires_at || 0) > now.getTime() ? 'gift_open' : 'gift_lapsed';
    return 'waiting';
  }
  return p.status === 'expired' ? 'ended' : 'other';
}

export const STATE_LABEL = {
  waiting: 'Stopped at payment', gift_open: 'Free gift offered', gift_lapsed: 'Gift not taken',
  gift_taken: 'Published free (gift)', paid: 'Paid', ended: 'Ended', other: '—',
};

// Rows for the Paid listings page: every paywalled listing, newest first.
//   listings  user listings (id, created_by, created_at, status, raw_data, …) — all of them, so the
//             "nth of the month" counts the free ones too
//   payments  rows with status 'started' (opened the card form) — optional
//   reminders Map property id → reminders sent (email_log) — optional
export function paywallRows({ listings = [], payments = [], reminders = new Map(), cc = 'py', now = new Date() } = {}) {
  const byOwner = new Map();
  for (const p of listings) { const k = String(p.created_by); if (!byOwner.has(k)) byOwner.set(k, []); byOwner.get(k).push(p); }
  return listings
    .filter((p) => p.raw_data?.paid_listing && p.created_by)
    .map((p) => {
      const pl = p.raw_data.paid_listing;
      const state = paywallState(p, now);
      const tried = payments.filter((x) => String(x.property_id) === String(p.id) && x.status === 'started');
      const n = nthOfMonth(p, byOwner.get(String(p.created_by)) || [], cc);
      return {
        id: p.id, ownerId: p.created_by, at: p.created_at, nth: n, title: listingLabel(p), state,
        price: usdText(pl.price_cents), triedToPay: tried.length > 0, triedAt: tried[0]?.created_at || null,
        paidAt: pl.paid_at || null, paidAfterH: pl.paid_at ? Math.max(0, Math.round((Date.parse(pl.paid_at) - Date.parse(p.created_at)) / H)) : null,
        gift: pl.gift?.offered_at ? { offeredAt: pl.gift.offered_at, expiresAt: pl.gift.expires_at || null, claimedAt: pl.gift.claimed_at || null } : null,
        reminders: reminders.get(String(p.id)) || 0,
        waitingH: state === 'waiting' || state === 'gift_open' || state === 'gift_lapsed' ? Math.round((now.getTime() - Date.parse(p.created_at)) / H) : null,
      };
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// One person's paywall timeline (user activity page), newest first:
//   { at, kind, title, detail, listingId }
export function paywallEvents(row) {
  const ev = [];
  const stopped = row.state === 'waiting' || row.state === 'gift_open' || row.state === 'gift_lapsed';
  ev.push({
    at: row.at, kind: 'paywall', listingId: row.id,
    title: `Wanted to publish their ${ordinal(row.nth)} listing this month — the payment step came up${row.price ? ` (${row.price})` : ''}`,
    detail: stopped
      ? `${row.title}. Saved, not published: ${row.triedToPay ? 'they opened the card form but didn\'t pay' : 'they stopped at the payment — likely didn\'t want to pay'}.`
      : `${row.title}.`,
  });
  if (row.triedToPay && row.triedAt) ev.push({ at: row.triedAt, kind: 'checkout', listingId: row.id, title: 'Opened the card form', detail: row.paidAt ? 'Then paid.' : 'Didn\'t finish paying.' });
  if (row.paidAt) ev.push({ at: row.paidAt, kind: 'paid', listingId: row.id, title: `Paid${row.price ? ` ${row.price}` : ''} — listing published`, detail: row.paidAfterH != null ? `${row.paidAfterH < 1 ? 'Right away' : `${row.paidAfterH} h after the payment step`}.` : '' });
  if (row.gift) {
    ev.push({ at: row.gift.offeredAt, kind: 'gift', listingId: row.id, title: 'Offered this listing for free (gift email)', detail: row.gift.expiresAt ? `Valid until ${String(row.gift.expiresAt).slice(0, 10)}.` : '' });
    if (row.gift.claimedAt) ev.push({ at: row.gift.claimedAt, kind: 'gift_taken', listingId: row.id, title: 'Took the gift — listing published for free', detail: '' });
    else if (row.state === 'gift_lapsed') ev.push({ at: row.gift.expiresAt, kind: 'gift_lapsed', listingId: row.id, title: 'The free-listing gift expired untaken', detail: '' });
  }
  return ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// email_log dedupe keys → reminders per property: payrem:<id>:<n> (payment_followup) and
// held:<id>:payment:<n> (Listing not published).
export function remindersByListing(logs = []) {
  const m = new Map();
  for (const l of logs) {
    const k = String(l?.dedupe_key || '');
    const a = /^payrem:([^:]+):\d+$/.exec(k) || /^held:([^:]+):payment:\d+$/.exec(k);
    if (a) m.set(a[1], (m.get(a[1]) || 0) + 1);
  }
  return m;
}

// PostHog's payment events for one person (website components/ListingPaymentModal.js and the
// free-listing gift) → timeline steps. rows: [[timestamp, event, property_id, kind, via, reason]].
// labelOf(property_id) → "Casa · sale · Luque" (their listing) or ''.
export const PAYMENT_EVENTS = ['payment_screen_opened', 'payment_started', 'payment_succeeded', 'listing_gift_claimed', 'listing_gift_failed'];
const PH_STEP = {
  payment_screen_opened: ['ph_opened', (k) => `Opened the pay screen${k === 'extend' ? ' to extend a listing' : ' to publish a listing'}`],
  payment_started: ['ph_started', () => 'Tapped Pay'],
  payment_succeeded: ['ph_paid', (k) => `Payment went through${k === 'extend' ? ' (extension)' : ''}`],
  listing_gift_claimed: ['ph_gift', () => 'Took the free-listing gift'],
  listing_gift_failed: ['ph_gift_failed', () => 'Tried the free-listing gift — it didn\'t work'],
};
export function posthogPaymentSteps(rows = [], labelOf = () => '') {
  return rows.map(([at, event, pid, kind, via, reason]) => {
    const s = PH_STEP[event];
    if (!s) return null;
    const where = labelOf(pid);
    const bits = [where, via === 'email' ? 'from the gift email' : via === 'my_listings' ? 'from My listings' : '', reason ? `reason: ${reason}` : '', 'PostHog'].filter(Boolean);
    return { at: String(at).replace(' ', 'T'), kind: s[0], listingId: pid || null, title: s[1](kind), detail: `${bits.join(' · ')}.` };
  }).filter(Boolean);
}
