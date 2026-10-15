import { describe, it, expect } from 'vitest';
import { RANGES, DEFAULT_DAYS, rangeLabel, sectionDays, pickSection, optionsWith } from '../lib/analyticsRange.js';

describe('analytics master range', () => {
  it('defaults to 7 days', () => {
    expect(DEFAULT_DAYS).toBe(7);
    expect(rangeLabel(7)).toBe('last 7 days');
    expect(rangeLabel(90)).toBe('last 3 months');
    expect(rangeLabel(1, [{ v: 1, l: '24 hours' }])).toBe('last 24 hours');
  });

  it('a section follows the master when it has no override', () => {
    expect(sectionDays(30, null)).toBe(30);
  });

  it('a section keeps its own pick while the master is unchanged', () => {
    const o = pickSection(7, 90);
    expect(o).toEqual({ master: 7, days: 90 });
    expect(sectionDays(7, o)).toBe(90);
  });

  it('changing the master resets every section to it', () => {
    const o = pickSection(7, 90);
    expect(sectionDays(30, o)).toBe(30);
  });

  it('picking the master value clears the override', () => {
    expect(pickSection(30, 30)).toBeNull();
  });

  it('section options always include the shown value', () => {
    expect(optionsWith(RANGES, 30)).toBe(RANGES);
    const withDay = optionsWith([{ v: 7, l: '7 days' }], 1);
    expect(withDay.map((o) => o.v)).toEqual([1, 7]);
  });
});
