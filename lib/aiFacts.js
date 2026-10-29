// The AI reply's fact sheet about ONE person (Inbox → AI assistant): what we know about them
// on this country's site, the links that fit, and which situation they are in — so the reply
// can be specific ("your draft is missing the price — continue here: <link>") instead of
// generic. Built by the admin from read-only queries (lib/aiContext.js); the AI never touches
// the database and never sees anyone else. Pure — test/aiFacts.test.js.

const DAY = 86400000;
const iso10 = (s) => (s ? String(s).slice(0, 10) : null);
const TYPE = { casa: 'house', departamento: 'apartment', duplex: 'duplex', terreno: 'land', local: 'commercial space', oficina: 'office' };

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
  return 'has listings on the site — answer what they ask; share their listing link if relevant';
}

// → plain JSON for the prompt. site = 'https://casa-libre.com.bo' etc.
export function buildFactSheet({ cc, countryName, site, user = null, listings = [], drafts = [], paid = null, recent = [], codeRequested = false, now = new Date() }) {
  const base = String(site || '').replace(/\/$/, '');
  const links = {
    publish_a_property: `${base}/publicar`,
    my_listings: `${base}/cuenta/publicaciones`,
    sign_in_or_sign_up: `${base}/cuenta`,
    home: base,
  };
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
      // a listing that isn't live has no public page: My listings is where they act on it
      link: listingState(p, now) === 'LIVE on the site' ? `${base}/propiedad/${p.slug || p.id}` : `${base}/cuenta/publicaciones`,
    })),
    drafts: drafts.slice(0, 5).map((d) => ({
      what: [TYPE[String(d.data?.ptype || '').toLowerCase()] || d.data?.ptype, d.data?.neighborhood || d.data?.city].filter(Boolean).join(' · ') || 'a property',
      last_edited: iso10(d.updated_at),
      missing: draftMissing(d.data || {}),
      continue_link: `${base}/cuenta/publicaciones?tab=borradores&draft=${d.id}`,
    })),
    paid_listings: paid?.enabled ? { free_listings_per_month: paid.freePerMonth, price_of_an_extra_listing: paid.price } : { note: 'every listing is free on this site' },
    recent_messages_we_sent: recent.slice(0, 8).map((r) => `${iso10(r.created_at)} · ${r.channel === 'whatsapp' ? 'WhatsApp' : 'email'} · ${r.subject || r.automation_id || ''}`.trim()),
    links,
  };
}
