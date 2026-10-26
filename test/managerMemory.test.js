import { describe, it, expect } from 'vitest';
import { addNote, removeNote, notesFromRow, slug, trackerOf, historyForRun, nextTracker, DROP_AFTER } from '../lib/manager/memory.js';

describe('memory notes', () => {
  it('adds, refuses empty and duplicate, removes', () => {
    const a = addNote([], { text: '  Daniel case is closed ', by: 'r@x', id: '1' });
    expect(a.ok).toBe(true);
    expect(a.notes[0]).toMatchObject({ id: '1', text: 'Daniel case is closed', source: 'admin' });
    expect(addNote(a.notes, { text: 'daniel case is closed', id: '2' }).ok).toBe(false);
    expect(addNote(a.notes, { text: 'x', id: '3' }).ok).toBe(false);
    expect(removeNote(a.notes, '1')).toEqual([]);
    expect(notesFromRow({ free_tiers: [{ notes: [{ text: 'hi' }, { nope: 1 }] }] })).toEqual([{ text: 'hi' }]);
  });
});

describe('the loop', () => {
  const now = '2026-10-27T10:00:00Z';
  const prevRow = {
    created_at: '2026-10-24T10:00:00Z',
    report: {
      tracker: [
        { key: 'fix-email', title: 'Fix email', owner: 'Omar', first_seen: '2026-10-20T10:00:00Z', times: 2, status: 'still_open', quiet: 0 },
        { key: 'add-ads', title: 'Add ads', owner: 'Tahir', first_seen: '2026-10-24T10:00:00Z', times: 1, status: 'new', quiet: 0 },
        { key: 'old', title: 'Old', owner: 'Omar', first_seen: '2026-10-01T10:00:00Z', times: 1, status: 'new', quiet: DROP_AFTER - 1 },
        { key: 'gone', title: 'Gone', owner: 'Omar', first_seen: '2026-10-01T10:00:00Z', times: 1, status: 'fixed', quiet: 0 },
      ],
    },
    feedback: {
      'action:add-ads': { item: 'action:add-ads', done: true, note: 'Done by Tahir' },
      'action:fix-email': { item: 'action:fix-email', vote: 'down', note: 'Not a priority' },
    },
  };

  it('tells the next run what is open, what admins marked done and their notes', () => {
    const h = historyForRun([prevRow]);
    expect(h.openActions.map((o) => o.key)).toEqual(['fix-email', 'add-ads', 'old']);
    expect(h.openActions.find((o) => o.key === 'add-ads').marked_done_by_admin).toBe(true);
    expect(h.adminNotes.map((n) => n.note)).toEqual(['Done by Tahir', 'Not a priority']);
  });

  it('carries the tracker: raised again, fixed, done, stale', () => {
    const t = nextTracker({
      previous: trackerOf(prevRow),
      actions: [{ key: 'fix-email', title: 'Fix email', owner: 'Omar', status: 'worse' }, { key: 'new-one', title: 'New one', owner: 'Roland' }],
      checks: [{ key: 'add-ads', status: 'fixed', evidence: 'conversions 0 to 3' }],
      doneKeys: new Set(['add-ads']),
      now,
    });
    const by = Object.fromEntries(t.map((x) => [x.key, x]));
    expect(by['fix-email']).toMatchObject({ status: 'worse', times: 3, first_seen: '2026-10-20T10:00:00Z' });
    expect(by['new-one']).toMatchObject({ status: 'new', times: 1, first_seen: now });
    expect(by['add-ads'].status).toBe('done');
    expect(by.old.status).toBe('stale');
    expect(by.gone).toBeUndefined();
  });

  it('an admin "done" the numbers contradict is reopened', () => {
    const t = nextTracker({ previous: trackerOf(prevRow), actions: [], checks: [{ key: 'add-ads', status: 'still_open', evidence: 'x' }], doneKeys: new Set(['add-ads']), now });
    expect(t.find((x) => x.key === 'add-ads').status).toBe('reopened');
  });

  it('old reports without a tracker use their recommendations', () => {
    expect(trackerOf({ created_at: now, report: { recommendations: [{ title: 'Fix the no-listing email', owner: 'Omar' }] } })[0]).toMatchObject({ key: 'fix-no-listing-email', status: 'new' });
    expect(slug('Arreglá el email de no listing')).toBe('arregla-email-no-listing');
  });
});
