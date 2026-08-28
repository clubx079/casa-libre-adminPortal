import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
