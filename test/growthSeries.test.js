import { describe, it, expect } from 'vitest';
import { buildGrowth, growthSql, weekChange } from '../lib/growthSeries';

describe('growth chart series', () => {
  it('fills empty days with 0, from the first day with data up to today', () => {
    const g = buildGrowth([['2026-11-01', 10, 30, 1], ['2026-11-03', 20, 50, 2]], { today: '2026-11-04' });
    expect(g.start).toBe('2026-11-01');
    expect(g.end).toBe('2026-11-04');
    expect(g.days.map((d) => [d.date, d.visitors])).toEqual([['2026-11-01', 10], ['2026-11-02', 0], ['2026-11-03', 20], ['2026-11-04', 0]]);
    expect(g.totals).toEqual({ visitors: 30, views: 80, contacts: 3 });
  });
  it('the 7-day average uses the days so far at the start, then the last 7', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, (i + 1) * 10, 0, 0]);
    const g = buildGrowth(rows, { today: '2026-10-10' });
    expect(g.days[0].avg.visitors).toBe(10);
    expect(g.days[1].avg.visitors).toBe(15);
    expect(g.days[9].avg.visitors).toBe(70);   // days 4..10 → 40..100 → 70
    expect(weekChange(g.days, 'visitors')).toEqual({ now: 70, before: 20, pct: 250 });   // day 3: (10+20+30)/3
  });
  it('no data → empty', () => {
    expect(buildGrowth([], { today: '2026-11-06' }).days).toEqual([]);
  });
  it('one query per day in the country time zone', () => {
    const sql = growthSql({ where: 'W', ukey: 'K', tz: 'America/Asuncion' });
    expect(sql).toContain("toTimeZone(timestamp, 'America/Asuncion')");
    expect(sql).toContain('uniqExact(K)');
    expect(sql).toContain("countIf(event = 'property_viewed')");
    expect(sql).toContain('GROUP BY d ORDER BY d');
  });
});
