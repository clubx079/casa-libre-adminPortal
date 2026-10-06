import { describe, it, expect, vi } from 'vitest';

// lib/ingest.js is guarded by 'server-only' (a Next build-time check).
vi.mock('server-only', () => ({}));
import { looseFor, splitReasons, canGoLive, persistedPriceUsd, reasonValue, notVerifiedLabel, contactLine, FIXABLE_CODES } from '../lib/unverified';
import { validateListing } from '../lib/ingest';

const row = (o = {}) => ({
  contact_phone: '595981000000', city: 'Asunción', neighborhood: 'Villa Morra',
  listing_type: 'sale', price: 150000, currency: 'USD', bedrooms: 3, bathrooms: 2, parking_spaces: 1,
  covered_area: 180, property_type: 'Casa', ...o,
});

describe('looser quarantine rule (Paraguay first)', () => {
  it('applies to Paraguay only', () => {
    expect(looseFor('py')).toBe(true);
    for (const cc of ['bo', 'uy', 've', '', undefined]) expect(looseFor(cc)).toBe(false);
  });

  it('splits reasons into blocking ones and fields to show as "Contact seller for …"', () => {
    expect(splitReasons(['price_below_floor', 'beds_over_cap', 'area_out_of_range'])).toEqual({ blocking: [], unverified: ['price', 'bedrooms', 'area'] });
    expect(splitReasons(['no_price', 'sale_price_as_rent'])).toEqual({ blocking: [], unverified: ['price'] });
    expect(splitReasons(['no_contact', 'price_below_floor'])).toEqual({ blocking: ['no_contact'], unverified: ['price'] });
    expect(splitReasons(['duplicate'])).toEqual({ blocking: ['duplicate'], unverified: [] });
    expect(splitReasons(undefined)).toEqual({ blocking: [], unverified: [] });
  });

  it('only fixable-field records can go live, and only in Paraguay', () => {
    expect(canGoLive(['price_below_floor', 'baths_over_cap'], 'py')).toBe(true);
    expect(canGoLive(['price_below_floor'], 'bo')).toBe(false);
    for (const blocked of [['no_contact'], ['no_location'], ['duplicate'], ['unverified_seller'], ['no_contact', 'no_price']]) {
      expect(canGoLive(blocked, 'py')).toBe(false);
    }
    expect(canGoLive([], 'py')).toBe(false);
  });

  it('every fixable code is one validateListing actually emits', () => {
    const emitted = new Set([
      ...validateListing(row({ price: null }), 7300).reasons,
      ...validateListing(row({ price: 1000 }), 7300).reasons,
      ...validateListing(row({ price: 90000000 }), 7300).reasons,
      ...validateListing(row({ listing_type: 'rent', price: 165000 }), 7300).reasons,
      ...validateListing(row({ bedrooms: 25, bathrooms: 12, parking_spaces: 40, covered_area: 9000 }), 7300).reasons,
    ]);
    for (const code of FIXABLE_CODES) expect(emitted.has(code)).toBe(true);
  });

  it('a price we could not verify is stored without price_usd', () => {
    expect(persistedPriceUsd(row({ price: 3000 }), 7300, ['price'])).toBe(null);
    expect(persistedPriceUsd(row(), 7300, [])).toBe(150000);
    expect(persistedPriceUsd(row({ currency: 'PYG', price: 7300000 }), 7300, ['area'])).toBe(1000);
    expect(persistedPriceUsd(row({ currency: 'BOB', price: 6900, price_usd: 1000 }), 7300, [])).toBe(1000);
  });

  it('shows the value that tripped each reason', () => {
    expect(reasonValue('price_below_floor', row({ price: 3000 }), 7300)).toBe('US$ 3,000');
    expect(reasonValue('sale_price_as_rent', row({ listing_type: 'rent', price: 165000 }), 7300)).toBe('US$ 165,000/mo');
    expect(reasonValue('area_out_of_range', row({ covered_area: 9000 }), 7300)).toBe('9,000 m²');
    expect(reasonValue('beds_over_cap', row({ bedrooms: 25 }), 7300)).toBe('25');
    expect(reasonValue('no_contact', row(), 7300)).toBe('');
  });

  it('labels in English and Spanish', () => {
    expect(notVerifiedLabel('price', 'en')).toBe('Price not verified');
    expect(notVerifiedLabel('area', 'es')).toBe('Superficie sin verificar');
    expect(contactLine('price', 'en')).toBe('Contact seller for price');
    expect(contactLine('bedrooms', 'es')).toBe('Consultá los dormitorios con el vendedor');
  });
});
