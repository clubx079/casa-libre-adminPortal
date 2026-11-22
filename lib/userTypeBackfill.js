// Backfill of users.user_type for EXISTING accounts (scripts/backfill-user-type.mjs).
// Pure — tested in test/userTypeBackfill.test.js.
//
// The user's rule:
//   made in the sell wizard                → seller
//   made from Log in, listed at any time   → seller
//   made from Log in, never listed         → buyer
// The DB has no "how was this account made" column, so the evidence is:
//   listed    — a user listing it owns (any status), or a listing email it got (gift,
//               views, ending, deleted …: the listing may be gone)          → backfill_listed
//   sell form — PostHog: sell_otp_verified / sell_google_resumed / sell_otp_sent (the sell
//               wizard's sign-up steps) no later than 15 min after the account was made;
//               or a guest draft saved under its email (lib/guestDrafts.js)  → backfill_sell_funnel
//   draft     — it started a listing draft (listing_drafts, or a draft-reminder email)
//               but never published                                          → backfill_draft (seller)
//   otherwise — made from Log in and never listed                            → backfill_login (buyer)
import crypto from 'node:crypto';

export const LISTED_TEMPLATES = [
  'first-listing-gift', 'first-listing-ending', 'listing-views', 'listing-held-payment', 'paid-listing-ended',
  'duplicate-listing', 'event:listing_deleted', 'listing-deleted-feedback', 'cl_visitas', 'cl_visitas_v2', 'cl_visitas_sin_contacto',
];
export const DRAFT_TEMPLATES = ['draft-reminder', 'cl_borrador', 'manager_stuck_draft'];
export const SELL_SIGNUP_EVENTS = ['sell_otp_verified', 'sell_google_resumed', 'sell_otp_sent'];
export const SELL_EVENT_GRACE_MS = 15 * 60e3;

const norm = (e) => String(e || '').trim().toLowerCase();

// Same id the website gives a logged-out seller's draft (website lib/guestDrafts.js).
const GUEST_NAMESPACE = 'casa-libre:guest-draft';
export function guestOwnerId(email) {
  const h = crypto.createHash('sha1').update(`${GUEST_NAMESPACE}:${norm(email)}`).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const minIso = (...xs) => xs.filter(Boolean).map(String).sort()[0] || null;

// e = {
//   listings: [{ created_at }]          user listings it owns (any status)
//   listedEmails: [created_at]          LISTED_TEMPLATES emails to its address
//   drafts: n                           listing_drafts with user_id = its id
//   guestDrafts: n                      listing_drafts with user_id = guestOwnerId(email)
//   draftEmails: n                      DRAFT_TEMPLATES emails to its address
//   sellEvents: [timestamp]             PostHog SELL_SIGNUP_EVENTS of this person
// }
// → { type, source, first_listed_at }  (first_listed_at only when listed)
export function classifyUser(user = {}, e = {}) {
  const listings = e.listings || [];
  const listedEmails = e.listedEmails || [];
  if (listings.length || listedEmails.length) {
    return {
      type: 'seller', source: 'backfill_listed',
      first_listed_at: minIso(...listings.map((l) => l.created_at), ...listedEmails),
    };
  }
  const made = Date.parse(user.created_at);
  const sellSignup = (e.sellEvents || []).some((t) => {
    const ms = Date.parse(t);
    return Number.isFinite(ms) && (!Number.isFinite(made) || ms <= made + SELL_EVENT_GRACE_MS);
  });
  if (sellSignup || (e.guestDrafts || 0) > 0) return { type: 'seller', source: 'backfill_sell_funnel', first_listed_at: null };
  if ((e.drafts || 0) > 0 || (e.draftEmails || 0) > 0) return { type: 'seller', source: 'backfill_draft', first_listed_at: null };
  return { type: 'buyer', source: 'backfill_login', first_listed_at: null };
}

// What to write for one account. force = replace a type that is already set.
// → patch object or null (nothing to change).
export function backfillPatch(user, verdict, { force = false, now = new Date() } = {}) {
  const patch = {};
  if (!user.user_type || force) {
    if (user.user_type !== verdict.type || force) {
      patch.user_type = verdict.type;
      patch.user_type_source = verdict.source;
      patch.user_type_at = now.toISOString();
    }
  }
  if (verdict.first_listed_at && !user.first_listed_at) patch.first_listed_at = verdict.first_listed_at;
  return Object.keys(patch).length ? patch : null;
}

// Indexes the raw rows the script reads into per-user evidence.
export function buildEvidence({ users = [], props = [], drafts = [], emails = [], phEvents = [] }) {
  const byOwner = new Map();
  for (const p of props) { const k = String(p.created_by); if (!byOwner.has(k)) byOwner.set(k, []); byOwner.get(k).push(p); }
  const draftsBy = new Map();
  for (const d of drafts) { const k = String(d.user_id); draftsBy.set(k, (draftsBy.get(k) || 0) + 1); }
  const listedBy = new Map();
  const draftMailBy = new Map();
  for (const m of emails) {
    const k = norm(m.to_email);
    if (!k) continue;
    if (LISTED_TEMPLATES.includes(m.template_key) || m.automation_id === 'event:listing_deleted') {
      if (!listedBy.has(k)) listedBy.set(k, []);
      listedBy.get(k).push(m.created_at);
    } else if (DRAFT_TEMPLATES.includes(m.template_key)) draftMailBy.set(k, (draftMailBy.get(k) || 0) + 1);
  }
  // phEvents: [{ email, distinct_id, event, ts }]
  const sellBy = new Map();
  for (const ev of phEvents) {
    if (!SELL_SIGNUP_EVENTS.includes(ev.event)) continue;
    for (const k of [ev.email ? `e:${norm(ev.email)}` : null, ev.distinct_id ? `i:${ev.distinct_id}` : null].filter(Boolean)) {
      if (!sellBy.has(k)) sellBy.set(k, []);
      sellBy.get(k).push(ev.ts);
    }
  }
  const out = new Map();
  for (const u of users) {
    const id = String(u.id);
    const email = norm(u.email);
    out.set(id, {
      listings: byOwner.get(id) || [],
      listedEmails: listedBy.get(email) || [],
      drafts: draftsBy.get(id) || 0,
      guestDrafts: email ? draftsBy.get(guestOwnerId(email)) || 0 : 0,
      draftEmails: draftMailBy.get(email) || 0,
      sellEvents: [...(sellBy.get(`i:${id}`) || []), ...(email ? sellBy.get(`e:${email}`) || [] : [])],
    });
  }
  return out;
}
