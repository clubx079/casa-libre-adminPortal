import { describe, it, expect } from 'vitest';
import { isFullPassDue, delistBlocker, delistUnseen } from '../lib/delisting.js';

const DAY = 86400000;
const now = Date.parse('2026-10-24T06:00:00Z');

describe('full pass', () => {
  it('weekly on cron runs; forced by the run; never for manual runs', () => {
    expect(isFullPassDue({ config: {}, now })).toBe(true);                                   // never done
    expect(isFullPassDue({ config: { last_full_pass_at: new Date(now - 2 * DAY).toISOString() }, now })).toBe(false);
    expect(isFullPassDue({ config: { last_full_pass_at: new Date(now - 8 * DAY).toISOString() }, now })).toBe(true);
    expect(isFullPassDue({ config: { full_pass_days: 3, last_full_pass_at: new Date(now - 4 * DAY).toISOString() }, now })).toBe(true);
    expect(isFullPassDue({ filters: { fullPass: true }, trigger: 'manual', now })).toBe(true);
    expect(isFullPassDue({ filters: { fullPass: false }, now })).toBe(false);
    expect(isFullPassDue({ trigger: 'manual', now })).toBe(false);
  });
});

describe('safety', () => {
  it('only after a complete pass that found most listings and would not wipe the source', () => {
    expect(delistBlocker({ reachedEnd: true, found: 1000, live: 1100, unseen: 90 })).toBeNull();
    expect(delistBlocker({ reachedEnd: false, found: 1000, live: 1100, unseen: 90 })).toMatch(/whole catalog/);
    expect(delistBlocker({ reachedEnd: true, found: 20, live: 1100, unseen: 1080 })).toMatch(/site problem/);
    expect(delistBlocker({ reachedEnd: true, found: 700, live: 1100, unseen: 700 })).toMatch(/at once/);
  });
});

function fakeDb({ live, unseen }) {
  const calls = [];
  return {
    calls,
    selectWithCount: async (t, q) => ({ count: q.includes('last_seen_at.lt') ? unseen : live }),
    update: async (t, q, patch) => { calls.push({ t, q, patch }); },
  };
}

describe('delistUnseen', () => {
  const source = { id: 's1', config: { full_pass_days: 7 } };
  it('takes unseen live listings off the site and records the pass', async () => {
    const db = fakeDb({ live: 100, unseen: 12 });
    const r = await delistUnseen({ db, source, runStartIso: '2026-10-24T06:00:00Z', reachedEnd: true, found: 95, now: new Date(now) });
    expect(r).toEqual({ delisted: 12, live: 100 });
    const p = db.calls.find((c) => c.t === 'properties');
    expect(p.patch).toEqual({ is_delisted: true, admin_status: 'inactive' });
    expect(p.q).toMatch(/admin_status=eq\.active/);
    expect(db.calls.find((c) => c.t === 'scrape_sources').patch.config).toMatchObject({ full_pass_days: 7, last_full_pass_delisted: 12 });
  });
  it('a broken pass changes no listing', async () => {
    const db = fakeDb({ live: 100, unseen: 95 });
    const r = await delistUnseen({ db, source, runStartIso: '2026-10-24T06:00:00Z', reachedEnd: true, found: 5, now: new Date(now) });
    expect(r.skipped).toMatch(/site problem/);
    expect(db.calls.some((c) => c.t === 'properties')).toBe(false);
  });
});
