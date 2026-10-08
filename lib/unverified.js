// Listings with data we couldn't verify. Roland, Oct 5 2026: a listing whose only
// problems are fields that fail the checks (price, built area, bedrooms, bathrooms,
// parking) goes live; the buyer site shows "Contact seller for …" for each of those
// fields (buyer portal lib/unverified.js). Missing contact, missing location,
// duplicates and unverified sellers still hold a listing back.
//
// All Casa Libre countries (LOOSE_COUNTRIES); an unknown country keeps the strict rules.
// Plain module (no server-only) so the scraper, the API routes and the admin pages
// all use the same rules. Reason codes come from lib/ingest.validateListing + dedupe.
import { dualPrice } from './money';
import { currencyFor } from './currency';

export const LOOSE_COUNTRIES = new Set(['py', 'bo', 'uy', 've']);   // all Casa Libre countries (Oct 7 2026)
export const looseFor = (cc) => LOOSE_COUNTRIES.has(String(cc || '').toLowerCase());

// reason code → the field the buyer site shows as "Contact seller for …"
export const FIXABLE = {
  no_price: 'price',
  price_below_floor: 'price',
  price_above_ceiling: 'price',
  sale_price_as_rent: 'price',
  area_out_of_range: 'area',
  beds_over_cap: 'bedrooms',
  baths_over_cap: 'bathrooms',
  parking_over_cap: 'parking',
};
export const FIXABLE_CODES = Object.keys(FIXABLE);
// Reasons that hold a record back whatever the country.
// images_rejected: a user's listing whose photos the buyer portal's AI check rejected
// (18+, violence, hate or unrelated) — held until an admin approves it or the seller fixes them.
export const BLOCKING_CODES = ['no_contact', 'no_location', 'duplicate', 'unverified_seller', 'images_broken', 'no_images', 'images_rejected'];

// { blocking: reason codes that hold the listing back, unverified: fields to blank }
export function splitReasons(reasons) {
  const rs = Array.isArray(reasons) ? reasons : [];
  const blocking = rs.filter((r) => !FIXABLE[r]);
  const unverified = [...new Set(rs.filter((r) => FIXABLE[r]).map((r) => FIXABLE[r]))];
  return { blocking, unverified };
}

// Can a quarantined record go live under the looser rule in this country?
export function canGoLive(reasons, cc) {
  const rs = Array.isArray(reasons) ? reasons : [];
  return looseFor(cc) && rs.length > 0 && splitReasons(rs).blocking.length === 0;
}

// The USD price to persist: none when the price is one we couldn't verify, so the
// buyer search's price filters skip it and price sorts put it last. Otherwise the
// USD as is, the country's own currency converted at its live rate (rate = local
// units per USD for cc), any other currency → the adapter's own USD figure.
export function persistedPriceUsd(row, rate, unverified = [], cc = 'py') {
  if (unverified.includes('price')) return null;
  const local = currencyFor(cc).code;
  const cur = String(row.currency || '').toUpperCase();
  if (cur !== 'USD' && cur !== local && row.price_usd != null) return row.price_usd;
  return dualPrice(row.price, row.currency, rate, local).usd ?? row.price_usd ?? null;
}

// Field names as the admin reads them.
export const FIELD_LABEL = {
  price: { es: 'Precio', en: 'Price' },
  area: { es: 'Superficie', en: 'Area' },
  bedrooms: { es: 'Dormitorios', en: 'Bedrooms' },
  bathrooms: { es: 'Baños', en: 'Bathrooms' },
  parking: { es: 'Cocheras', en: 'Parking' },
};
export const notVerifiedLabel = (field, lang) => {
  const f = FIELD_LABEL[field];
  if (!f) return field;
  return lang === 'en' ? `${f.en} not verified` : `${f.es} sin verificar`;
};
// What the buyer site shows in place of the field.
export const contactLine = (field, lang) => {
  const en = { price: 'Contact seller for price', area: 'Contact seller for area', bedrooms: 'Contact seller for bedrooms', bathrooms: 'Contact seller for bathrooms', parking: 'Contact seller for parking' };
  const es = { price: 'Consultá el precio con el vendedor', area: 'Consultá la superficie con el vendedor', bedrooms: 'Consultá los dormitorios con el vendedor', bathrooms: 'Consultá los baños con el vendedor', parking: 'Consultá las cocheras con el vendedor' };
  return (lang === 'en' ? en : es)[field] || field;
};

// The value that tripped a reason, so the admin sees exactly what's wrong
// ("US$ 3,000", "25", "9,000 m²"). p = the stored row / quarantine payload.
export function reasonValue(code, p, rate, cc = 'py') {
  if (!p) return '';
  const n = (v) => (v == null || v === '' ? null : Number(v));
  const fmt = (v) => Number(v).toLocaleString('en-US');
  switch (code) {
    case 'price_below_floor':
    case 'price_above_ceiling':
    case 'sale_price_as_rent': {
      if (n(p.price) == null) return '';
      const c = currencyFor(cc);
      const d = dualPrice(p.price, p.currency, rate || c.fallbackRate, c.code);
      const per = p.listing_type === 'rent' ? '/mo' : '';
      return d.usd != null ? `US$ ${fmt(Math.round(d.usd))}${per}` : `${p.currency || ''} ${fmt(p.price)}${per}`.trim();
    }
    case 'area_out_of_range': {
      const a = n(p.covered_area) ?? n(p.floor_area);
      return a == null ? '' : `${fmt(a)} m²`;
    }
    case 'beds_over_cap': return n(p.bedrooms) == null ? '' : String(p.bedrooms);
    case 'baths_over_cap': return n(p.bathrooms) == null ? '' : String(p.bathrooms);
    case 'parking_over_cap': return n(p.parking_spaces) == null ? '' : String(p.parking_spaces);
    default: return '';
  }
}

// Where a pending quarantine record stands (Quarantine page):
//   'live'    — the listing is already in properties; the record is old, just clear it
//   'ready'   — every problem is a field the site shows as "Contact seller for …", it isn't
//               on the site, and no live listing is the same property → can be published
//   'blocked' — a reason that holds it back (no contact, no location, duplicate, unverified
//               seller…), or it's the same property as a live listing (dedupe_key match)
// A "duplicate" only holds a record back while the listing it duplicates is live
// (twinGone = it was held as a duplicate and no live listing is that property any more,
// e.g. InfoCasas, de-listed Sep 2026): it's then judged on its other problems, and with
// none left it's a normal listing.
export function quarantineState({ reasons, onSite, duplicateOfLive, twinGone, cc }) {
  if (onSite) return 'live';
  if (duplicateOfLive) return 'blocked';
  const rs = twinGone ? reasonsNow(reasons, false) : reasons;
  if (twinGone && !rs.length) return 'ready';
  return canGoLive(rs, cc) ? 'ready' : 'blocked';
}

// A record's reasons that still apply: "duplicate" is dropped once no live listing is
// the same property (twinLive false).
export function reasonsNow(reasons, twinLive) {
  const rs = Array.isArray(reasons) ? reasons : [];
  return twinLive ? rs : rs.filter((x) => x !== 'duplicate');
}
