import { describe, it, expect } from 'vitest';
import { productOf, sourceOf, periodRange, previousRange, filterRows, totals, productTable, series, bucketKey, topSellers, change, toCsv } from '../lib/earnings.js';

const R = (o) => ({ status: 'succeeded', user_id: 'u1', email: 'a@x.com', ...o, product: productOf(o) });
const rows = [
  R({ kind: 'listing', amount_usd: 5.8, created_at: '2026-10-03T10:00:00Z' }),
  R({ kind: 'listing_extend', amount_usd: 5, created_at: '2026-10-04T10:00:00Z' }),
  R({ kind: 'highlight', plan: 'home', amount_usd: 20, created_at: '2026-10-05T10:00:00Z', user_id: 'u2', email: 'b@x.com' }),
  R({ kind: 'highlight', plan: 'verified', amount_usd: 5, created_at: '2026-09-20T10:00:00Z' }),
  R({ kind: 'listing', amount_usd: 5.8, created_at: '2026-10-06T10:00:00Z', status: 'failed', user_id: 'u3' }),
  R({ kind: 'listing', amount_usd: 5.8, created_at: '2026-10-07T10:00:00Z', user_id: 'u2', email: 'b@x.com' }),
];

describe('earnings', () => {
  it('names products and their source', () => {
    expect(productOf({ kind: 'highlight', plan: null })).toBe('Verified');
    expect(productOf({ kind: 'listing_free' })).toBe(null);
    expect(sourceOf('Extra listing')).toBe('Listing fees');
    expect(sourceOf('Home page')).toBe('Add-ons (visibility)');
  });

  it('totals: earned, payments, sellers, failed apart, success rate, by source', () => {
    const t = totals(rows);
    expect(t.earned).toBe(41.6);
    expect(t.payments).toBe(5);
    expect(t.sellers).toBe(2);
    expect(t.failed).toBe(1);
    expect(t.successRate).toBe(83);
    expect(t.bySource).toEqual({ 'Listing fees': 16.6, 'Add-ons (visibility)': 25 });
  });

  it('per product + price: how many paid, failed, how many people', () => {
    const extra = productTable(rows).find((x) => x.product === 'Extra listing');
    expect(extra).toMatchObject({ price: 5.8, paid: 2, failed: 1, users: 2, earned: 11.6, source: 'Listing fees' });
  });

  it('filters by period, source, product and search', () => {
    const oct = periodRange('custom', new Date('2026-10-13T12:00:00Z'), { from: '2026-10-01', to: '2026-10-31' });
    expect(filterRows(rows, oct).length).toBe(5);
    expect(filterRows(rows, { source: 'Listing fees' }).length).toBe(4);
    expect(filterRows(rows, { product: 'Home page' }).length).toBe(1);
    expect(filterRows(rows, { q: 'b@x' }).length).toBe(2);
  });

  it('periods and the previous period', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(periodRange('month', now)).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' });
    expect(periodRange('last_month', now)).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
    expect(previousRange(periodRange('7d', now))).toEqual({ from: '2026-09-30T00:00:00.000Z', to: '2026-10-07T00:00:00.000Z' });
    expect(previousRange(periodRange('all', now))).toBe(null);
    expect(change(15, 10)).toBe(50);
    expect(change(5, 0)).toBe(null);
  });

  it('buckets by day / week (Monday) / month', () => {
    expect(bucketKey('2026-10-15T10:00:00Z', 'week')).toBe('2026-10-12');
    expect(series(rows, 'month').map((x) => [x.key, x.total])).toEqual([['2026-09', 5], ['2026-10', 36.6]]);
  });

  it('top sellers + CSV', () => {
    expect(topSellers(rows)[0]).toMatchObject({ email: 'b@x.com', total: 25.8, payments: 2 });
    expect(toCsv(rows.slice(4, 5)).split('\n')[1]).toContain('Listing fees,Extra listing,5.8,failed');
  });
});
