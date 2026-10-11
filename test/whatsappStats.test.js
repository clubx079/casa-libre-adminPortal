import { describe, it, expect } from 'vitest';
import { whatsappStats, change } from '../lib/whatsappStats.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-12T15:00:00Z'); // 12:00 in Asunción (UTC−3)
const at = (daysAgo, hourUtc = 15) => new Date(NOW - daysAgo * DAY + (hourUtc - 15) * 3600e3).toISOString();
let n = 0;
const row = (o) => ({ id: `c${++n}`, token: `t${n}`, channel: 'whatsapp', status: 'sent', ...o });

const props = [
  { id: 'p1', listing_type: 'rent', property_type: 'Departamento', city: 'Asunción', neighborhood: 'Villa Morra', created_by: null },
  { id: 'p2', listing_type: 'sale', property_type: 'Casa', city: 'Luque', created_by: 'u9' },
];

describe('whatsappStats', () => {
  const rows = [
    row({ property_id: 'p1', buyer_user_id: 'b1', created_at: at(0), status: 'opened', opened_at: at(0), listing_ref: 'CL-P1' }),
    row({ property_id: 'p1', buyer_user_id: 'b1', created_at: at(1) }),            // same buyer again
    row({ property_id: 'p2', buyer_ip: '1.2.3.4', created_at: at(2, 23) }),         // 20:00 local
    row({ property_id: 'gone', buyer_email: 'X@Y.com', created_at: at(3) }),        // listing deleted
    row({ property_id: 'p1', channel: 'call', created_at: at(1) }),
    row({ property_id: 'p2', channel: 'copy', created_at: at(2) }),
    row({ property_id: 'p1', buyer_user_id: 'b7', created_at: at(9) }),            // previous window
    row({ property_id: 'p1', buyer_user_id: 'b8', created_at: at(20) }),           // outside both
  ];
  const s = whatsappStats({ rows, props, days: 7, now: NOW, tz: 'America/Asuncion' });

  it('counts this window: taps, people, listings, calls, copies, seller opens', () => {
    expect(s.totals).toMatchObject({ whatsapp: 4, buyers: 3, listings: 3, calls: 1, copies: 1, opened: 1, trackable: 4, openRate: 25 });
  });
  it('counts the previous window for the change', () => {
    expect(s.previous.whatsapp).toBe(1);
    expect(change(s.totals.whatsapp, s.previous.whatsapp)).toBe('+300%');
  });
  it('has one bar per local day, oldest first, zero-filled', () => {
    expect(s.daily).toHaveLength(7);
    expect(s.daily.at(-1)).toEqual({ date: '2026-10-12', n: 1 });
    expect(s.daily.reduce((a, d) => a + d.n, 0)).toBe(4);
  });
  it('puts taps in local hours', () => {
    expect(s.byHour[12]).toBe(3);   // 15:00 UTC = 12:00 Asunción
    expect(s.byHour[20]).toBe(1);   // 23:00 UTC = 20:00
  });
  it('breaks down by listing (rent/sale, type, city, owner/agency) and keeps deleted listings apart', () => {
    expect(s.byMode).toEqual([{ name: 'rent', n: 2 }, { name: 'sale', n: 1 }]);
    expect(s.bySeller).toEqual([{ name: 'agency', n: 2 }, { name: 'owner', n: 1 }]);
    expect(s.byCity[0]).toEqual({ name: 'Asunción', n: 2 });
    expect(s.unknownListing).toBe(1);
  });
  it('lists the most-contacted listings with their seller opens', () => {
    expect(s.topListings[0]).toMatchObject({ property_id: 'p1', ref: 'CL-P1', place: 'Villa Morra, Asunción', whatsapp: 2, opened: 1 });
  });
  it('a window with no taps is all zeros, not an error', () => {
    const e = whatsappStats({ rows: [], props: [], days: 30, now: NOW });
    expect(e.totals.whatsapp).toBe(0);
    expect(e.totals.openRate).toBe(null);
    expect(e.daily).toHaveLength(30);
  });
});

describe('change', () => {
  it('reads like a stat-tile delta', () => {
    expect(change(5, 0)).toBe('new');
    expect(change(0, 0)).toBe(null);
    expect(change(9, 10)).toBe('−10%');
    expect(change(10, 10)).toBe('0%');
  });
});
