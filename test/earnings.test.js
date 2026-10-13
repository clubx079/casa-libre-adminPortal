import { describe, it, expect } from 'vitest';
import { summarize, productOf } from '../lib/earnings.js';

describe('earnings', () => {
  it('names each kind of payment', () => {
    expect(productOf({ kind: 'listing' })).toBe('Extra listing');
    expect(productOf({ kind: 'listing_extend' })).toBe('Listing extension');
    expect(productOf({ kind: 'highlight', plan: 'home' })).toBe('Home page');
    expect(productOf({ kind: 'highlight', plan: 'verified' })).toBe('Verified');
    expect(productOf({ kind: 'highlight', plan: null })).toBe('Verified');
    expect(productOf({ kind: 'renewal', plan: 'home' })).toBe('Renewal');
    expect(productOf({ kind: 'listing_free' })).toBe(null);
  });

  it('adds up succeeded payments per month, product and country; ignores failed and free rows', () => {
    const s = summarize([
      { country: 'py', kind: 'listing', amount_usd: 5.8, status: 'succeeded', created_at: '2026-10-03T10:00:00Z' },
      { country: 'py', kind: 'listing_extend', amount_usd: 5, status: 'succeeded', created_at: '2026-10-04T10:00:00Z' },
      { country: 'bo', kind: 'highlight', plan: 'home', amount_usd: 20, status: 'succeeded', created_at: '2026-10-05T10:00:00Z' },
      { country: 'py', kind: 'highlight', plan: 'verified', amount_usd: 5, status: 'succeeded', created_at: '2026-09-20T10:00:00Z' },
      { country: 'py', kind: 'listing', amount_usd: 5.8, status: 'failed', created_at: '2026-10-06T10:00:00Z' },
      { country: 'py', kind: 'listing_free', amount_usd: 0, status: 'free', created_at: '2026-10-06T10:00:00Z' },
    ]);
    expect(s.total).toBe(35.8);
    expect(s.count).toBe(4);
    expect(s.months.map((m) => [m.month, m.total])).toEqual([['2026-10', 30.8], ['2026-09', 5]]);
    expect(s.months[0].byProduct).toMatchObject({ 'Extra listing': 5.8, 'Listing extension': 5, 'Home page': 20 });
    expect(s.byCountry).toEqual({ py: 15.8, bo: 20 });
  });
});
