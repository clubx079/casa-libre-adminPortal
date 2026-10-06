import { describe, it, expect, vi } from 'vitest';

// lib/ingest.js is guarded by 'server-only' (a Next build-time check).
vi.mock('server-only', () => ({}));
import { dualPrice, fmtLocal, fmtPyg } from '../lib/money';
import { currencyFor } from '../lib/currency';
import { validateListing } from '../lib/ingest';
import { persistedPriceUsd } from '../lib/unverified';

const row = (o = {}) => ({ contact_phone: '59899000000', city: 'Montevideo', neighborhood: 'Pocitos', listing_type: 'rent', bedrooms: 2, bathrooms: 1, parking_spaces: 1, covered_area: 70, property_type: 'Departamento', ...o });

describe('prices in each country\'s own currency', () => {
  it('Paraguay is unchanged (guaraníes, default)', () => {
    expect(dualPrice(7300000, 'PYG', 7300)).toEqual({ usd: 1000, pyg: 7300000 });
    expect(dualPrice(150000, 'USD', 7300)).toEqual({ usd: 150000, pyg: 1095000000 });
    expect(fmtPyg(7300000)).toBe('Gs. 7.300.000');
    expect(fmtLocal(7300000, 'py')).toBe('Gs. 7.300.000');
  });
  it('Bolivia and Uruguay convert their own currency, not guaraníes', () => {
    expect(dualPrice(4200, 'BOB', 12, 'BOB')).toEqual({ usd: 350, pyg: 4200 });
    expect(dualPrice(22800, 'UYU', 40, 'UYU')).toEqual({ usd: 570, pyg: 22800 });
    expect(dualPrice(1000, 'USD', 12, 'BOB')).toEqual({ usd: 1000, pyg: 12000 });
    expect(fmtLocal(4200, 'bo')).toBe('Bs 4.200');
    expect(fmtLocal(22800, 'uy')).toBe('$U 22.800');
  });
  it('Venezuela is dollars only: no local line', () => {
    expect(dualPrice(85000, 'USD', 1, 'USD')).toEqual({ usd: 85000, pyg: null });
    expect(fmtLocal(85000, 've')).toBe('');
    expect(currencyFor('ve').code).toBe('USD');
  });
});

describe('scraper checks per country', () => {
  it('a normal Uruguay rent in pesos is not "sale price listed as rent" any more', () => {
    const v = validateListing(row({ price: 22800, currency: 'UYU' }), 40, 'uy');
    expect(v.reasons).toEqual([]);
  });
  it('a Bolivia rent in bolivianos passes; a sale price on a rental is still caught', () => {
    expect(validateListing(row({ city: 'Santa Cruz', price: 4200, currency: 'BOB' }), 12, 'bo').reasons).toEqual([]);
    expect(validateListing(row({ city: 'Santa Cruz', price: 310000, currency: 'BOB' }), 12, 'bo').reasons).toContain('sale_price_as_rent');
  });
  it('rent floor: US$ 40 outside Paraguay, ₲300,000 in Paraguay (unchanged)', () => {
    expect(validateListing(row({ price: 1200, currency: 'UYU' }), 40, 'uy').reasons).toContain('price_below_floor');   // US$ 30
    expect(validateListing(row({ city: 'Asunción', price: 250000, currency: 'PYG' }), 7300).reasons).toContain('price_below_floor');
    expect(validateListing(row({ city: 'Asunción', price: 3500000, currency: 'PYG' }), 7300).reasons).toEqual([]);
  });
  it('stored price_usd uses the country\'s own rate', () => {
    expect(persistedPriceUsd({ price: 22800, currency: 'UYU' }, 40, [], 'uy')).toBe(570);
    expect(persistedPriceUsd({ price: 4200, currency: 'BOB', price_usd: 610 }, 12, [], 'bo')).toBe(350);
    expect(persistedPriceUsd({ price: 7300000, currency: 'PYG' }, 7300, [])).toBe(1000);
    expect(persistedPriceUsd({ price: 500, currency: 'EUR', price_usd: 540 }, 7300, [])).toBe(540);   // other currency → adapter's USD
  });
});
