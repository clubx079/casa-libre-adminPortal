import { describe, it, expect } from 'vitest';
import { localDay, applyState, countsOf, listDays, saveDay, isStorageRow, DAY_PREFIX } from '../lib/openIssuesDays';

describe('Open issues — one saved list per day', () => {
  it('the local day of each country', () => {
    const t = Date.parse('2026-11-05T02:00:00Z');   // 23:00 on the 4th in Paraguay (UTC-3)
    expect(localDay('py', t)).toBe('2026-11-04');
    expect(localDay('sv', t)).toBe('2026-11-04');
    expect(localDay('py', Date.parse('2026-11-05T04:00:00Z'))).toBe('2026-11-05');
  });
  it('a past day shows what the team decided since', () => {
    const issues = [{ id: 'a', priority: 'urgent' }, { id: 'b', priority: 'high' }, { id: 'c', priority: 'low', followup: true, status: 'open' }];
    const out = applyState(issues, { a: { state: 'done', by: 'omar', at: 'x' } });
    expect(out.map((i) => i.status)).toEqual(['done', 'open', 'open']);
    expect(out[0].handled.by).toBe('omar');
    expect(countsOf(out)).toEqual({ open: 2, urgent: 0, total: 3 });
  });
  it('saves a day with the counts in a small column; lists newest first', async () => {
    const rows = [];
    const db = {
      select: async (t, q) => (/milestones/.test(q) ? [{ id: `${DAY_PREFIX}2026-11-04`, milestones: [3, 1, 5], updated_at: 'u' }, { id: 'open_issues', milestones: null }] : rows.filter((r) => q.includes(encodeURIComponent(r.id)))),
      insert: async (t, r) => { rows.push(...r); return r; },
      update: async () => {},
      remove: async () => {},
    };
    await saveDay(db, '2026-11-04', { issues: [{ id: 'a', status: 'open', priority: 'urgent' }, { id: 'b', status: 'done', priority: 'low' }] });
    expect(rows[0]).toMatchObject({ id: 'open_issues_day:2026-11-04', milestones: [1, 1, 2], enabled: false });
    expect(await listDays(db)).toEqual([{ day: '2026-11-04', open: 3, urgent: 1, total: 5, checkedAt: 'u' }]);
  });
  it('storage rows are kept out of the report data', () => {
    for (const id of ['open_issues', 'open_issues_day:2026-11-04', 'wa_msg_kinds', 'security_watch', 'manager_memory']) expect(isStorageRow(id)).toBe(true);
    expect(isStorageRow('draft_reminders')).toBe(false);
  });
});
