import { describe, it, expect } from 'vitest';
import {
  analystPeriod, fillDays, dimensionTable, compareDimension, findAnomalies, drillDown, hourProfile, groupAnomalies, periodSum, dayList, addDays,
  normPath, normLang, utcOfLocalMidnight,
} from '../lib/analyst/math.js';
import { searchBrief, ANALYST_SCHEMA, CHANNELS } from '../lib/analyst/prompt.js';

const now = new Date('2026-11-15T15:00:00Z');

describe('analystPeriod', () => {
  it('N days ending today, previous period of the same length, 7-day baseline before it', () => {
    const P = analystPeriod({ days: 7 }, { tz: 'America/Asuncion', now });
    expect(P).toMatchObject({ start: '2026-11-09', end: '2026-11-15', days: 7, prevStart: '2026-11-02', prevEnd: '2026-11-08', windowStart: '2026-10-26', partialToday: true });
  });
  it('custom range, clamped to today; bad input → error', () => {
    expect(analystPeriod({ start: '2026-10-20', end: '2026-11-02' }, { now })).toMatchObject({ days: 14, prevStart: '2026-10-06', prevEnd: '2026-10-19' });
    expect(analystPeriod({ start: '2026-11-10', end: '2026-12-30' }, { now }).end).toBe('2026-11-15');
    expect(analystPeriod({ start: 'x', end: '2026-11-02' }, { now }).error).toBeTruthy();
    expect(analystPeriod({ start: '2026-11-02', end: '2026-10-01' }, { now }).error).toBeTruthy();
    expect(analystPeriod({ days: 13 }, { now }).days).toBe(28);
  });
});

// a quiet site (~180 a day) with one big day, like 2026-10-26
const days = dayList('2026-10-13', '2026-11-02');
const visitors = new Map(days.map((d, i) => [d, d === '2026-10-26' ? 569 : 175 + (i % 4) * 3]));

describe('findAnomalies', () => {
  it('flags the spike day against its 7-day average, not the normal days', () => {
    const a = findAnomalies(visitors, { from: '2026-10-20', to: '2026-11-02', minAbs: 30 });
    expect(a.map((x) => x.date)).toEqual(['2026-10-26']);
    expect(a[0]).toMatchObject({ kind: 'spike', value: 569 });
    expect(a[0].ratio).toBeGreaterThan(3);
  });
  it('flags a drop, ignores small absolute swings', () => {
    const m = new Map(days.map((d) => [d, d === '2026-10-28' ? 60 : 180]));
    expect(findAnomalies(m, { minAbs: 30 }).map((x) => [x.date, x.kind])).toEqual([['2026-10-28', 'drop']]);
    const small = new Map(days.map((d) => [d, d === '2026-10-28' ? 9 : 3]));
    expect(findAnomalies(small, { minAbs: 20 })).toEqual([]);
  });
});

describe('breakdowns', () => {
  const P = { start: '2026-10-20', end: '2026-11-02', prevStart: '2026-10-06', prevEnd: '2026-10-19' };
  const rows = [];
  for (const d of days) {
    rows.push([d, 'google', 140]);
    rows.push([d, 'chatgpt', d === '2026-10-26' ? 289 : 13]);
  }
  const t = dimensionTable(rows, P);
  it('drill-down names the source that drove the spike', () => {
    const dd = drillDown(t, '2026-10-26');
    expect(dd[0]).toMatchObject({ key: 'chatgpt', value: 289, avg7: 13, diff: 276 });
  });
  it('period comparison with shares and changes', () => {
    const c = compareDimension(t);
    const gpt = c.top.find((r) => r.key === 'chatgpt');
    expect(gpt.cur).toBe(13 * 13 + 289);
    expect(gpt.prev).toBe(13 * 7);   // only the days of the previous period in the data
  });
  it('hour profile and grouping', () => {
    const h = hourProfile([['2026-10-26', 16, 54], ['2026-10-25', 16, 10]], '2026-10-26', { top: 1 });
    expect(h[0]).toMatchObject({ hour: 16, value: 54 });
    expect(groupAnomalies([{ date: '2026-10-26', metric: 'visitors' }, { date: '2026-10-26', metric: 'signups' }])[0].metrics).toHaveLength(2);
  });
  it('fillDays + periodSum', () => {
    const f = fillDays([['2026-10-20', 5, 1]], '2026-10-06', '2026-11-02', 2);
    expect(f.get('2026-10-21')).toEqual([0, 0]);
    expect(periodSum(f, P, 0)).toMatchObject({ cur: 5, prev: 0 });
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('helpers', () => {
  it('landing pages collapse listing ids; languages normalise', () => {
    expect(normPath('/propiedad/12345-casa?x=1')).toBe('/propiedad/*');
    expect(normPath('/Venta/Casas/Ciudad-del-Este/')).toBe('/venta/casas/ciudad-del-este');
    expect(normLang('pt-br')).toBe('pt-BR');
    expect(normLang('')).toBe('(unknown)');
  });
  it('local midnight in Asunción → UTC', () => {
    expect(utcOfLocalMidnight('2026-10-26', 'America/Asuncion')).toBe('2026-10-26 03:00:00');
  });
  it('search brief carries the anomaly facts; schema covers every channel', () => {
    const pack = { site: 'https://casa-libre.com.py', country: 'py', sections: { anomalies: { days: [{ date: '2026-10-26', metrics: [{ metric: 'visitors', value: 569, baselineAvg7: 178, kind: 'spike' }], whatChanged: { countries: [{ key: 'Brazil', diff: 315 }] } }] } } };
    expect(searchBrief(pack)).toContain('Brazil +315');
    expect(ANALYST_SCHEMA.properties.channels.items.properties.channel.enum).toEqual(CHANNELS);
  });
});
