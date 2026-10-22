import { describe, it, expect } from 'vitest';
import { adminKey, unreadSince, unreadCounts, markSeen, NEW_ADMIN_DAYS } from '../lib/unread.js';

// A tiny in-memory PostgREST stand-in: admin_seen rows + created_at lists per table.
function fakeDb(rows) {
  const seen = [];
  const after = (q) => decodeURIComponent((q.match(/created_at=gt\.([^&]+)/) || [])[1] || '');
  return {
    seen,
    select: async (table, q) => {
      const key = decodeURIComponent((q.match(/admin_key=eq\.([^&]+)/) || [])[1] || '');
      const page = decodeURIComponent((q.match(/page=eq\.([^&]+)/) || [])[1] || '');
      return seen.filter((s) => s.admin_key === key && (!page || s.page === page));
    },
    selectWithCount: async (table, q) => ({ rows: [], count: (rows[table] || []).filter((t) => Date.parse(t) > Date.parse(after(q))).length }),
    insert: async (table, [row]) => {
      const i = seen.findIndex((s) => s.admin_key === row.admin_key && s.page === row.page);
      if (i >= 0) seen[i] = row; else seen.push(row);
    },
  };
}

describe('per-admin unread counters', () => {
  it('admin key: id, else email (lower-case)', () => {
    expect(adminKey({ id: 'A1B2', email: 'x@y.com' })).toBe('a1b2');
    expect(adminKey({ id: null, email: 'Admin@Airosofts.com' })).toBe('admin@airosofts.com');
    expect(adminKey(null)).toBe(null);
  });
  it('never opened → the last 14 days count as unread', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(unreadSince(null, now)).toBe(new Date(now - NEW_ADMIN_DAYS * 86400000).toISOString());
    expect(unreadSince('2026-10-20T00:00:00Z', now)).toBe('2026-10-20T00:00:00.000Z');
  });
  it('one admin reading does not clear the badge for another', async () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    const db = fakeDb({
      listing_reports: ['2026-10-21T10:00:00Z', '2026-10-01T10:00:00Z'], // 2nd is older than 14 days
      feedback: ['2026-10-20T10:00:00Z', '2026-10-22T09:00:00Z'],
    });
    expect(await unreadCounts(db, 'omar', now)).toEqual({ reports: 1, feedbacks: 2 });
    expect(await unreadCounts(db, 'roland', now)).toEqual({ reports: 1, feedbacks: 2 });

    const since = await markSeen(db, 'omar', 'feedbacks', now);       // Omar opens Feedback
    expect(since).toBe(new Date(now - NEW_ADMIN_DAYS * 86400000).toISOString()); // both rows were new to him
    expect(await unreadCounts(db, 'omar', now)).toEqual({ reports: 1, feedbacks: 0 });
    expect(await unreadCounts(db, 'roland', now)).toEqual({ reports: 1, feedbacks: 2 }); // untouched

    // a new feedback arrives → unread again for Omar (1) and Roland (3)
    db.selectWithCount = (orig => async (t, q) => (t === 'feedback' ? { count: (await orig(t, q)).count + (Date.parse('2026-10-22T13:00:00Z') > Date.parse(decodeURIComponent(q.match(/gt\.([^&]+)/)[1])) ? 1 : 0) } : orig(t, q)))(db.selectWithCount);
    expect((await unreadCounts(db, 'omar', now)).feedbacks).toBe(1);
    expect((await unreadCounts(db, 'roland', now)).feedbacks).toBe(3);
    expect(await markSeen(db, 'omar', 'feedbacks', now + 3600000)).toBe(new Date(now).toISOString());
  });
});
