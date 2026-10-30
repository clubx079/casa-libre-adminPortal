import { describe, it, expect } from 'vitest';
import { deletedListings, deletionEvent, goneListings, teamDeletionRow, listingRef } from '../lib/listingDeletion.js';
import { paywallRows, paywallEvents } from '../lib/paywallActivity.js';

const rec = (over = {}) => ({ run_id: 'fce9be87-1a3b-43df-b8d0-d91063cef8e9', subject: 'Casa · Capiatá (CL-2026-06389)', created_at: '2026-10-28T15:33:00Z', error: JSON.stringify({ property_id: 'fce9be87-1a3b-43df-b8d0-d91063cef8e9', title: 'Casa · Capiatá', ref: 'CL-2026-06389', listed_at: '2026-10-15T12:11:12Z', live_days: 13, views: 63, paid: 'free', by: 'owner', ...over }) });

describe('deleted listings', () => {
  it('reads the record and shows it as a timeline step', () => {
    const [d] = deletedListings([rec()]);
    expect(d).toMatchObject({ title: 'Casa · Capiatá', ref: 'CL-2026-06389', views: 63, liveDays: 13, by: 'owner' });
    const e = deletionEvent(d);
    expect(e.kind).toBe('deleted');
    expect(e.title).toBe('Deleted their listing — Casa · Capiatá');
    expect(e.detail).toBe('Ref CL-2026-06389 · a free listing · listed 13 days before · 63 views.');
    expect(deletionEvent(deletedListings([rec({ by: 'team', by_email: 'admin@x.com' })])[0]).title).toMatch(/deleted by the team \(admin@x.com\)/);
  });
  it('a deleted listing still counts for "their Nth listing this month" (Daniel, Oct 15)', () => {
    const uid = 'u1';
    const L = (id, at, extra = {}) => ({ id, created_by: uid, created_at: at, status: 'published', raw_data: {}, property_type: 'Terreno', listing_type: 'sale', city: 'Capiatá', ...extra });
    const held = { paid_listing: { state: 'pending', price_cents: 580 } };
    const listings = [
      L('234f', '2026-10-15T12:12:57Z'),
      L('003c', '2026-10-15T12:14:44Z', { status: 'payment_pending', raw_data: held }),
      L('38cb', '2026-10-15T16:57:51Z', { status: 'payment_pending', raw_data: held, property_type: 'Casa' }),
    ];
    const ledger = [{ id: 'l1', property_id: null, created_at: '2026-10-15T12:11:12Z' }, { id: 'l2', property_id: '234f', created_at: '2026-10-15T12:12:59Z' }];
    // without the deleted one: 2nd and 3rd (the old, wrong labels)
    expect(paywallRows({ listings }).map((r) => r.nth).sort()).toEqual([2, 3]);
    // with the deletion record: 3rd and 4th
    const gone = goneListings({ userId: uid, deleted: deletedListings([rec()]), ledger });
    expect(gone).toHaveLength(1);   // the ledger row is the same listing as the record
    const rows = paywallRows({ listings: [...listings, ...gone] });
    expect(rows.map((r) => r.nth).sort()).toEqual([3, 4]);
    expect(paywallEvents(rows.find((r) => r.id === '003c'))[0].title).toMatch(/their 3rd listing this month/);
    // no record yet (older deletions): the orphan ledger row alone fixes the count
    expect(paywallRows({ listings: [...listings, ...goneListings({ userId: uid, deleted: [], ledger })] }).map((r) => r.nth).sort()).toEqual([3, 4]);
  });
  it('the team\'s Properties → Delete writes the same record, never shown as an email', () => {
    const row = teamDeletionRow({ id: 'fce9be87-1a3b-43df-b8d0-d91063cef8e9', created_by: 'u1', created_at: '2026-10-15T12:11:12Z', status: 'published', property_type: 'Casa', listing_type: 'sale', city: 'Capiatá', raw_data: {} }, { ownerEmail: 'Daniel@Mail.com', adminEmail: 'admin@airosofts.com', now: new Date('2026-10-30T12:00:00Z') });
    expect(row).toMatchObject({ automation_id: 'event_listing_deleted', channel: 'event', to_email: 'daniel@mail.com', status: 'sent', dedupe_key: 'deleted:fce9be87-1a3b-43df-b8d0-d91063cef8e9:ev' });
    expect(JSON.parse(row.error)).toMatchObject({ by: 'team', by_email: 'admin@airosofts.com', paid: 'free', live_days: 15, ref: listingRef('fce9be87-1a3b-43df-b8d0-d91063cef8e9', '2026-10-15T12:11:12Z') });
    expect(listingRef('fce9be87-1a3b-43df-b8d0-d91063cef8e9', '2026-10-15T12:11:12Z')).toBe('CL-2026-06389');
  });
});

describe('backfilled deletions (found afterwards)', () => {
  it('say "Listing deleted" with the time marked estimated', () => {
    const r = { run_id: 'x', created_at: '2026-10-28T15:33:00Z', error: JSON.stringify({ property_id: 'x', title: 'Casa · Capiatá', ref: 'CL-2026-06389', listed_at: '2026-10-15T12:11:12Z', live_days: 13, views: 63, paid: 'free', by: 'unknown', estimated: true }) };
    const e = deletionEvent(deletedListings([r])[0]);
    expect(e.title).toBe('Listing deleted — Casa · Capiatá');
    expect(e.detail).toMatch(/deletion time estimated\.$/);
  });
});
