// The AI reply's fact sheet about ONE person (Inbox → AI assistant): what we know about them
// on this country's site, the links that fit, and which situation they are in — so the reply
// can be specific ("your draft is missing the price — continue here: <link>") instead of
// generic. Built by the admin from read-only queries (lib/aiContext.js); the AI never touches
// the database and never sees anyone else. Pure — test/aiFacts.test.js.

import { SITE_PAGES } from './aiLinks.js';
import { buildRecentActivity, listingEdits } from './aiActivity.js';
const DAY = 86400000;
const iso10 = (s) => (s ? String(s).slice(0, 10) : null);
const TYPE = { casa: 'house', departamento: 'apartment', duplex: 'duplex', terreno: 'land', local: 'commercial space', oficina: 'office' };

// Which photos failed the photo check and why (the website's moderation record), in words.
const PHOTO_WHY = { text: 'text written on the photo', logo: 'a logo / watermark', watermark: 'a logo / watermark', screenshot: 'a screenshot', people: 'people in the photo', not_property: 'not a photo of the property', low_quality: 'too blurry or dark', duplicate: 'the same photo twice' };
export function photoProblem(p) {
  const photos = Array.isArray(p?.raw_data?.moderation?.photos) ? p.raw_data.moderation.photos : [];
  const failed = photos.filter((x) => x.verdict === 'fail');
  if (!failed.length) return 'some photos did not pass the photo check';
  const why = [...new Set(failed.map((x) => PHOTO_WHY[x.category] || x.category).filter(Boolean))];
  return `${failed.length} of ${photos.length} photos rejected${why.length ? ` (${why.join(', ')})` : ''} — they change those photos and the listing is checked again and published`;
}
const nameOf = (l) => [TYPE[String(l.property_type || '').toLowerCase()] || l.property_type, l.neighborhood || l.city].filter(Boolean).join(' · ') || 'a listing';
const listingName = (listings, id) => { const l = listings.find((x) => String(x.id) === String(id)); return l ? nameOf(l) : null; };

// The paid extras on a listing right now (website lib/billing.js: promotion_plan + promotion_expires_at).
export function promotionOf(p, now = new Date()) {
  const until = Date.parse(p?.promotion_expires_at || 0);
  if (!p?.promotion_plan || !(until > now.getTime())) return 'none (no Verified badge, not on the home page)';
  return `${p.promotion_plan === 'home' ? 'home page display + Verified badge' : 'Verified badge'} until ${iso10(p.promotion_expires_at)}`;
}

// Money in the last 7 days, from the payments rows: what was really charged, and checkouts left open.
const PAY_WHAT = (x) => (x.kind === 'listing' ? 'paid listing (90 days)' : x.kind === 'listing_free' ? 'free listing (no charge)' : x.plan ? `promotion (${x.plan})` : x.kind || 'payment');
export function moneyLately(payments = [], listings = [], now = new Date()) {
  const recent = payments.filter((x) => now.getTime() - Date.parse(x.created_at || 0) < 7 * DAY);
  const line = (x) => `US$${Number(x.amount_usd || 0).toFixed(2)} on ${iso10(x.created_at)} — ${PAY_WHAT(x)}${listingName(listings, x.property_id) ? ` — ${listingName(listings, x.property_id)}` : ''}`;
  const charged = recent.filter((x) => x.status === 'succeeded' && Number(x.amount_usd) > 0).map(line);
  const open = recent.filter((x) => x.status === 'started').map(line);
  return { charged_last_7_days: charged.length ? charged : 'nothing — no charge was made', ...(open.length ? { payment_screens_opened_but_not_paid: open } : {}) };
}

// Why a user listing is or isn't on the site (same rules as the website's "Listing not published").
export function listingState(p, now = new Date()) {
  const gift = p?.raw_data?.paid_listing?.gift;
  if (p.status === 'payment_pending') {
    if (gift?.offered_at && !gift.claimed_at && Date.parse(gift.expires_at || 0) > now.getTime()) return `waiting for payment — a FREE-listing gift is open until ${iso10(gift.expires_at)} (button in their email / My listings)`;
    return 'saved but NOT published: over the free listings of the month, waiting for payment';
  }
  if (p.status === 'rejected') return 'NOT published: some photos were rejected by the photo check — they must change them in My listings';
  if (p.status === 'scanning') return 'photos being checked — goes live in a moment';
  if (p.status === 'duplicate_review') return 'held as a possible duplicate of another of their listings';
  if (p.status === 'expired') return 'paid time ended — off the site until they extend it';
  if (p.admin_status && p.admin_status !== 'active') return 'paused by the Casa Libre team';
  if (p.is_complete === false) return 'NOT published: details missing';
  return 'LIVE on the site';
}

export function draftMissing(data = {}) {
  const miss = [];
  if (!data.price) miss.push('price');
  if (!data.area) miss.push('area');
  if (String(data.contact_phone || '').replace(/\D/g, '').length < 6) miss.push('WhatsApp number');
  if (!(Array.isArray(data.photos) && data.photos.length)) miss.push('photos');
  return miss;
}

// The situation, to steer the reply (most actionable first).
export function situationOf({ user, listings = [], drafts = [], codeRequested = false }) {
  if (!user) return codeRequested ? 'asked this site for a sign-up code but never finished signing up — invite them to finish (sign-in link)' : 'not a Casa Libre account — answer their question; invite them to publish if it fits';
  if (listings.some((p) => p.status === 'payment_pending')) return 'has a listing waiting for payment — help them publish it (My listings), mention the gift if one is open';
  if (listings.some((p) => p.status === 'rejected')) return 'a listing had photos rejected — tell them to change those photos in My listings';
  if (!listings.length && drafts.length) return 'started a listing (draft) but never published it — send the link that continues THAT draft and say what is missing';
  if (!listings.length) return 'has an account but has NOT listed any property yet — invite them to publish (publish link), it is free';
  return 'all set: their listings are live and nothing is pending — next step: invite them to publish ANOTHER property (publish link), it is quick';
}

// → plain JSON for the prompt. site = 'https://casa-libre.com.bo' etc.
// activity = { site: { visitors_last_7_days, … }, byListing: Map(listing id → { views_total, views_last_7_days, buyer_contacts }),
//   areaDemand: [{ city, listing_views_last_30_days, … }] }
// (lib/aiContext.js) — the real numbers the reply sells with.
// link(path) → the URL the reply uses (the Inbox assistant passes a tracked one, lib/aiLinks.js).
export function buildFactSheet({ cc, countryName, site, user = null, listings = [], drafts = [], paid = null, recent = [], codeRequested = false, activity = null, now = new Date(), link = null, payments = [], history = [], photoCounts = null, personEvents = null, tracking = 'ok' }) {
  // photoCounts: Map(listing id → photos on it now); personEvents: what they did on the site / app
  // (lib/aiActivity.js rowsToEvents), or null when the click tracking didn't answer (tracking says why)
  const recentActivity = user ? buildRecentActivity({ events: personEvents, listings, nameOf, now: now.getTime(), tracking }) : null;
  const base = String(site || '').replace(/\/$/, '');
  const L = link || ((path) => (path === '/' ? base : `${base}${path}`));
  const links = Object.fromEntries(Object.entries(SITE_PAGES).map(([k, path]) => [k, L(path)]));
  return {
    site: { country: countryName, url: base },
    situation: situationOf({ user, listings, drafts, codeRequested }),
    account: user ? {
      name: user.full_name || null, email: user.email || null,
      signed_up: iso10(user.created_at), signed_up_with: user.auth_provider || null,
      whatsapp_verified: !!user.phone_verified_at,
      days_since_sign_up: user.created_at ? Math.floor((now.getTime() - Date.parse(user.created_at)) / DAY) : null,
    } : null,
    listings: listings.slice(0, 10).map((p) => ({
      what: [TYPE[String(p.property_type || '').toLowerCase()] || p.property_type, p.listing_type === 'rent' ? 'for rent' : p.listing_type === 'sale' ? 'for sale' : '', p.neighborhood || p.city].filter(Boolean).join(' · '),
      price: p.price ? `${p.currency || ''} ${Number(p.price).toLocaleString('es')}`.trim() : null,
      listed_on: iso10(p.created_at),
      state: listingState(p, now),
      ...(photoCounts?.has(String(p.id)) ? { photos_on_it_now: photoCounts.get(String(p.id)) } : {}),
      promotion: promotionOf(p, now),
      ...(listingEdits(p, now.getTime()).length ? { saved_edits: listingEdits(p, now.getTime()) } : {}),
      // a listing that isn't live has no public page: My listings is where they act on it
      link: listingState(p, now) === 'LIVE on the site' ? L(`/propiedad/${p.slug || p.id}`) : L('/cuenta/publicaciones'),
      ...(p.status === 'payment_pending' ? { pay_link: L(`/cuenta/publicaciones?pay_listing=${p.id}`) } : {}),
      ...(p.status === 'rejected' ? { photo_problem: photoProblem(p), fix_link: L('/cuenta/publicaciones?tab=rechazadas') } : {}),
      ...(p.status === 'duplicate_review' || p.is_complete === false || p.status === 'expired' ? { fix_link: L('/cuenta/publicaciones') } : {}),
      ...(p.status === 'duplicate_review' && p.raw_data?.duplicate_of ? { duplicate_of: listingName(listings, p.raw_data.duplicate_of) || 'another of their listings', duplicate_same_photos: p.raw_data?.moderation?.same_photos || null } : {}),
      ...(activity?.byListing?.get(String(p.id)) || {}),
    })),
    drafts: drafts.slice(0, 5).map((d) => ({
      what: [TYPE[String(d.data?.ptype || '').toLowerCase()] || d.data?.ptype, d.data?.neighborhood || d.data?.city].filter(Boolean).join(' · ') || 'a property',
      last_edited: iso10(d.updated_at),
      missing: draftMissing(d.data || {}),
      continue_link: L(`/cuenta/publicaciones?tab=borradores&draft=${d.id}`),
    })),
    // what they paid (or tried to): Stripe payments of this account
    payments: payments.slice(0, 8).map((x) => ({ date: iso10(x.created_at), what: PAY_WHAT(x), amount: x.amount_usd != null ? `US$${Number(x.amount_usd).toFixed(2)}` : null, status: x.status === 'succeeded' ? 'PAID' : x.status === 'started' ? 'payment screen opened, NOT paid' : x.status, ...(x.failure_reason ? { failure: x.failure_reason } : {}), listing: listingName(listings, x.property_id) })),
    // what they themselves did lately on the site / app, and what was really saved and charged (lib/aiActivity.js)
    ...(user ? { recent_activity: { ...(recentActivity || { lines: [] }), ...moneyLately(payments, listings, now) } } : {}),
    // everything we did with them before, newest first (lib/aiHistory.js) — don't repeat it, build on it
    history,
    paid_listings: paid?.enabled ? { free_listings_per_month: paid.freePerMonth, price_of_an_extra_listing: paid.price, extra_listing_lasts_days: 90, other_portals_charge: 'about US$40 per listing (e.g. InfoCasas)' } : { note: 'every listing is free on this site' },
    site_activity: activity?.site || null,
    area_demand: activity?.areaDemand || [],
    recent_messages_we_sent: recent.slice(0, 8).map((r) => `${iso10(r.created_at)} · ${r.channel === 'whatsapp' ? 'WhatsApp' : 'email'} · ${r.subject || r.automation_id || ''}`.trim()),
    links,
  };
}
