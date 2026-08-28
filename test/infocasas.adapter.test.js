import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as client from '../lib/infocasasClient.js';
import infocasas from '../lib/adapters/infocasas.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/infocasas/search-page.json', import.meta.url), 'utf8'));

const ctx = { source: { id: 'SRC', key: 'infocasas', base_url: 'https://www.infocasas.com.py' }, config: {}, pygPerUsd: 7300 };

describe('infocasas.mapListing', () => {
  const raw = fixture.data.searchListing.data[0];
  const m = infocasas.mapListing(raw, ctx);

  it('emits canonical row keys', () => {
    for (const k of ['source_id', 'external_id', 'origin', 'slug', 'address', 'price', 'currency', 'price_usd', 'listing_type', 'property_type', 'admin_status', 'contact_phone', 'raw_data'])
      expect(m.row).toHaveProperty(k);
  });

  it('maps operation_type to listing_type', () => {
    expect(['sale', 'rent']).toContain(m.row.listing_type);
  });

  it('resolves currency to USD or PYG', () => {
    expect(['USD', 'PYG']).toContain(m.row.currency);
  });

  it('builds absolute image urls with feature flag', () => {
    expect(m.images[0].source_url).toMatch(/^https?:\/\//);
    expect(m.images.some((i) => i.is_feature)).toBe(true);
  });

  it('external_id is the InfoCasas id', () => {
    expect(m.external_id).toBe(String(raw.id));
  });
});

describe('infocasas.fetchPage', () => {
  // Restore spies unconditionally so a failing assertion mid-test (expected
  // while these regression tests run against the pre-fix code) can't leak a
  // stale mock into the next test.
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns a window and enriches phones', async () => {
    const spySearch = vi.spyOn(client, 'searchListing').mockResolvedValue({ items: fixture.data.searchListing.data, count: 3 });
    const spyPhone = vi.spyOn(client, 'fetchPhone').mockResolvedValue({ phone: '+595981000000', name: 'Test' });
    const { items } = await infocasas.fetchPage({ shard: { operation_type_id: 1, estate_id: 21 } }, {}, 0, 3);
    expect(items.length).toBe(3);
    expect(items[0].contact_phone).toBe('+595981000000');
    spySearch.mockRestore();
    spyPhone.mockRestore();
  });

  // Regression coverage for the end-of-slice sentinel (Important finding,
  // final-branch review): `total` must be driven ONLY by whether the raw
  // InfoCasas pages were exhausted (a page returning count < PER), never by
  // how many items survived the post-fetch id-filter. Otherwise a single
  // malformed/id-less item in a mid-slice page falsely signals end-of-slice,
  // runJob stops early, and the cron flips the shard to `incremental`,
  // abandoning the rest of the backfill slice.
  const mkItems = (n, { startId = 1, dropIndex = null } = {}) =>
    Array.from({ length: n }, (_, i) => (
      i === dropIndex
        ? { link: `l${startId + i}` } // no id — filtered out by fetchPage
        : { id: startId + i, link: `l${startId + i}` }
    ));

  it('a full page with one id-less item does NOT end the slice (the regression)', async () => {
    // skip=0, top=50, PER=100 → single page fetch; page returns a FULL 100
    // items (count === 100, i.e. NOT exhausted upstream), but one item in
    // the [0,50) window is missing its id.
    const spySearch = vi.spyOn(client, 'searchListing')
      .mockResolvedValue({ items: mkItems(100, { dropIndex: 5 }), count: 100 });
    const spyPhone = vi.spyOn(client, 'fetchPhone').mockResolvedValue({ phone: null, name: null });

    const { items, total } = await infocasas.fetchPage({ shard: {} }, {}, 0, 50);

    expect(items.length).toBe(49); // one item dropped by the id-filter
    // Must remain the "keep going" sentinel — a filtered item must never end the slice.
    expect(total).toBe(Number.MAX_SAFE_INTEGER);

    spySearch.mockRestore();
    spyPhone.mockRestore();
  });

  it('a multi-page window straddling a PER boundary fetches both pages and does not end the slice', async () => {
    // skip=80, top=50, PER=100 → window spans page 1 ([0,100)) and page 2
    // ([100,200)); both pages are full (count === 100), so this is not
    // exhausted and both pages must be fetched.
    const spySearch = vi.spyOn(client, 'searchListing')
      .mockResolvedValueOnce({ items: mkItems(100, { startId: 1 }), count: 100 })
      .mockResolvedValueOnce({ items: mkItems(100, { startId: 101 }), count: 100 });
    const spyPhone = vi.spyOn(client, 'fetchPhone').mockResolvedValue({ phone: null, name: null });

    const { items, total } = await infocasas.fetchPage({ shard: {} }, {}, 80, 50);

    expect(spySearch).toHaveBeenCalledTimes(2);
    expect(items.length).toBe(50);
    expect(total).toBe(Number.MAX_SAFE_INTEGER);

    spySearch.mockRestore();
    spyPhone.mockRestore();
  });

  it('a short page (count < PER) is the true end-of-slice', async () => {
    // skip=0, top=50, PER=100 → single page; the source returns only 30
    // items with count=30 < PER, i.e. genuinely exhausted upstream.
    const spySearch = vi.spyOn(client, 'searchListing')
      .mockResolvedValue({ items: mkItems(30), count: 30 });
    const spyPhone = vi.spyOn(client, 'fetchPhone').mockResolvedValue({ phone: null, name: null });

    const { items, total } = await infocasas.fetchPage({ shard: {} }, {}, 0, 50);

    expect(items.length).toBe(30);
    expect(total).toBe(30); // skip(0) + windowItems.length(30) — finite, runJob stops

    spySearch.mockRestore();
    spyPhone.mockRestore();
  });
});
