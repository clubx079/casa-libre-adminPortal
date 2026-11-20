import { describe, it, expect } from 'vitest';
import { compareRuns, changeOf, windowLabel } from '../lib/seo/runCompare.js';

const run = (id, at, w, pipe, site, pageResults = []) => ({ id, started_at: at, snapshot: { window: w, pipeline: { cur: pipe }, site: { cur: site }, pageResults } });

describe('compareRuns', () => {
  const prev = run('a', '2026-11-18T00:43:00Z', { start: '2026-11-10', end: '2026-11-16' }, { impressions: 99, position: 42.27, clicks: 2 }, { impressions: 435, position: 20.34, clicks: 23 });
  const cur = run('b', '2026-11-20T11:32:00Z', { start: '2026-11-12', end: '2026-11-18' }, { impressions: 161, position: 36.21, clicks: 2 }, { impressions: 692, position: 18.19, clicks: 21 },
    [{ path: '/alquiler/duplex/asuncion', kind: 'extra links', clicks: 1, impressions: 12, position: 13.2 }, { path: '/x', kind: 'new title', clicks: 0, impressions: 64, position: 43.9 }]);
  const c = compareRuns(prev, cur);
  it('builds the six rows with the change', () => {
    expect(c.rows.map((r) => [r.group, r.label, r.prev, r.cur, r.change.text])).toEqual([
      ['pages', 'Times shown in Google', 99, 161, '+62.6%'],
      ['pages', 'Average Google position', 42.3, 36.2, '6.1 places better'],
      ['pages', 'Clicks', 2, 2, 'Same'],
      ['site', 'Times shown in Google', 435, 692, '+59.1%'],
      ['site', 'Average Google position', 20.3, 18.2, '2.1 places better'],
      ['site', 'Clicks', 23, 21, '-2'],
    ]);
    expect(c.rows[5].change.tone).toBe('bad');
  });
  it('lists the touched pages with clicks and flags overlapping windows', () => {
    expect(c.clicked).toEqual([{ path: '/alquiler/duplex/asuncion', kind: 'extra links', clicks: 1, impressions: 12, position: 13.2 }]);
    expect(c.overlap).toBe(true);
    expect(c.prev.label).toBe('Google data Nov 10–Nov 16');
  });
  it('handles missing data', () => {
    expect(compareRuns(null, cur)).toBeNull();
    expect(changeOf('position', null, 3).text).toBe('—');
    expect(changeOf('impressions', 0, 5).text).toBe('+5');
    expect(windowLabel(null)).toBe('Google data');
  });
});
