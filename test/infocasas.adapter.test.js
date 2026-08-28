import { describe, it, expect, vi } from 'vitest';
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
  it('returns a window and enriches phones', async () => {
    const spySearch = vi.spyOn(client, 'searchListing').mockResolvedValue({ items: fixture.data.searchListing.data, count: 3 });
    const spyPhone = vi.spyOn(client, 'fetchPhone').mockResolvedValue({ phone: '+595981000000', name: 'Test' });
    const { items } = await infocasas.fetchPage({ shard: { operation_type_id: 1, estate_id: 21 } }, {}, 0, 3);
    expect(items.length).toBe(3);
    expect(items[0].contact_phone).toBe('+595981000000');
    spySearch.mockRestore();
    spyPhone.mockRestore();
  });
});
