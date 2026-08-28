import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { searchListing, IC_GRAPHQL_URL, GQL_HEADERS } from '../lib/infocasasClient.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/infocasas/search-page.json', import.meta.url), 'utf8'));

describe('infocasasClient.searchListing', () => {
  it('posts with the required headers and returns items+count', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => fixture,
    });
    const { items, count } = await searchListing({ params: { operation_type_id: 1, estate_id: 21 }, first: 3, page: 1 });
    expect(count).toBe(3);
    expect(items).toHaveLength(3);
    const [url, opts] = spy.mock.calls[0];
    expect(url).toBe(IC_GRAPHQL_URL);
    expect(opts.headers.authorization).toBe('Bearer gika');
    expect(opts.headers['x-origin']).toBe('www.infocasas.com.py');
    spy.mockRestore();
  });
});
