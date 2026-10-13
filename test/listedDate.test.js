import { describe, it, expect } from 'vitest';
import { listedDate } from '../lib/listedDate.js';

const now = Date.parse('2026-10-14T15:00:00Z');

describe('listedDate', () => {
  it('date in the country time zone + how long ago', () => {
    expect(listedDate('2026-10-14T14:58:30Z', { now, lang: 'en' })).toMatchObject({ date: '14 Oct 2026', ago: '1 min ago' });
    expect(listedDate('2026-10-14T10:00:00Z', { now, lang: 'es' }).ago).toBe('hace 5 h');
    expect(listedDate('2026-10-13T12:00:00Z', { now, lang: 'en' }).ago).toBe('yesterday');
    expect(listedDate('2026-10-04T12:00:00Z', { now, lang: 'es' }).ago).toBe('hace 10 días');
    expect(listedDate('2026-08-01T12:00:00Z', { now, lang: 'en' }).ago).toBe(null);
    // 02:00 UTC on the 14th is still the 13th in Asunción (UTC-3)
    expect(listedDate('2026-10-14T02:00:00Z', { now, lang: 'en', country: 'py' }).date).toBe('13 Oct 2026');
  });

  it('missing / bad dates → null', () => {
    expect(listedDate(null)).toBe(null);
    expect(listedDate('nope')).toBe(null);
  });
});
