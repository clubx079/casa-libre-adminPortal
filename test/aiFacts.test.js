import { describe, it, expect } from 'vitest';
import { buildFactSheet, listingState, situationOf, draftMissing } from '../lib/aiFacts.js';

const now = new Date('2026-10-30T12:00:00Z');
const base = { cc: 'bo', countryName: 'Bolivia', site: 'https://casa-libre.com.bo', now };
const user = { full_name: 'Griselda Rouss', email: 'g@example.com', created_at: '2026-10-20T10:00:00Z', auth_provider: 'whatsapp', phone_verified_at: '2026-10-20T10:01:00Z' };

describe('AI fact sheet', () => {
  it('no listing yet → invite to publish, with that site\'s links', () => {
    const f = buildFactSheet({ ...base, user });
    expect(f.situation).toMatch(/NOT listed any property yet/);
    expect(f.links.publish_a_property).toBe('https://casa-libre.com.bo/publicar');
    expect(f.account).toMatchObject({ name: 'Griselda Rouss', whatsapp_verified: true, days_since_sign_up: 10 });
  });
  it('unfinished draft → what is missing + the continue link', () => {
    const f = buildFactSheet({ ...base, user, drafts: [{ id: 'd1', updated_at: '2026-10-29T09:00:00Z', data: { ptype: 'casa', neighborhood: 'Equipetrol', area: 120, contact_phone: '+59167988835' } }] });
    expect(f.situation).toMatch(/draft/);
    expect(f.drafts[0]).toEqual({ what: 'house · Equipetrol', last_edited: '2026-10-29', missing: ['price', 'photos'], continue_link: 'https://casa-libre.com.bo/cuenta/publicaciones?tab=borradores&draft=d1' });
  });
  it('listings carry their state and their own link', () => {
    const listings = [
      { id: 'p1', slug: 'casa-equipetrol-x', status: 'published', admin_status: 'active', is_complete: true, property_type: 'casa', listing_type: 'sale', city: 'Santa Cruz', price: 95000, currency: 'USD', created_at: '2026-10-21T00:00:00Z' },
      { id: 'p2', status: 'payment_pending', property_type: 'terreno', listing_type: 'sale', city: 'Santa Cruz', raw_data: { paid_listing: { gift: { offered_at: '2026-10-29T00:00:00Z', expires_at: '2026-11-12T00:00:00Z' } } } },
    ];
    const f = buildFactSheet({ ...base, user, listings, paid: { enabled: true, freePerMonth: 2, price: 'US$5.80' } });
    expect(f.listings[0]).toMatchObject({ state: 'LIVE on the site', link: 'https://casa-libre.com.bo/propiedad/casa-equipetrol-x' });
    expect(f.listings[1].state).toMatch(/FREE-listing gift is open until 2026-11-12/);
    expect(f.listings[1].link).toBe('https://casa-libre.com.bo/cuenta/publicaciones');   // not live → My listings
    expect(f.situation).toMatch(/waiting for payment/);
    expect(f.paid_listings).toEqual({ free_listings_per_month: 2, price_of_an_extra_listing: 'US$5.80' });
  });
  it('no account', () => {
    expect(situationOf({ user: null, codeRequested: true })).toMatch(/sign-up code but never finished/);
    expect(buildFactSheet({ ...base }).account).toBe(null);
  });
  it('states and missing fields', () => {
    expect(listingState({ status: 'rejected' })).toMatch(/photos were rejected/);
    expect(listingState({ status: 'published', admin_status: 'inactive' })).toMatch(/paused/);
    expect(draftMissing({ price: 1, area: 2, contact_phone: '0981123456', photos: [{}] })).toEqual([]);
  });
});
