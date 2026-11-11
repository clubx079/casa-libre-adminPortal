import { describe, it, expect } from 'vitest';
import { parseDelimited, decodePlayCsv, playDaily, appleDaily, mergeInstalls, appleDownloadsDaily, latestPerDate, appleFromInstances, territoryList } from '../lib/appInstalls.js';

const PLAY = 'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs\n2026-10-14,py.casalibre.mobile,12,2,0,300,11,1,240\n2026-10-15,py.casalibre.mobile,8,1,3,308,8,1,247\n';
const APPLE = 'Date\tApp Name\tApp Apple Identifier\tEvent\tDownload Type\tCounts\tUnique Devices\n2026-10-15\tCasa Libre\t6822493219\tInstall\tFirst-time download\t5\t5\n2026-10-15\tCasa Libre\t6822493219\tInstall\tRedownload\t2\t2\n2026-10-15\tCasa Libre\t6822493219\tDelete\t\t1\t1\n';

describe('app installs', () => {
  it('reads the Play overview CSV (UTF-16 with BOM)', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(PLAY, 'utf16le')]);
    const d = playDaily(parseDelimited(decodePlayCsv(buf)));
    expect(d['2026-10-14']).toEqual({ installs: 12, uninstalls: 2, userInstalls: 11, userUninstalls: 1, active: 240 });
    expect(Object.keys(d)).toHaveLength(2);
  });
  it('reads the App Store installation & deletion report (TSV)', () => {
    expect(appleDaily(parseDelimited(APPLE, '\t'))['2026-10-15']).toEqual({ installs: 7, deletions: 1 });
  });
  it('merges both stores per day; a day without a report stays null', () => {
    const play = playDaily(parseDelimited(PLAY));
    const apple = appleDaily(parseDelimited(APPLE, '\t'));
    const m = mergeInstalls({ play, apple, days: 3, now: new Date('2026-10-16T10:00:00Z') });
    expect(m.series.map((r) => r.key)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
    expect(m.series[2]).toMatchObject({ android: null, ios: null });
    expect(m.total).toMatchObject({ android: 20, androidUninstalls: 3, ios: 7, iosDeletions: 1, androidActive: 247 });
    expect(m.latest).toEqual({ play: '2026-10-15', apple: '2026-10-15' });
  });
});

// The real "App Downloads Standard" daily instances of Nov 2026 (columns trimmed): each
// instance repeats the day before, so summing every instance doubled the downloads.
const H = 'Date\tApp Name\tApp Apple Identifier\tDownload Type\tApp Version\tDevice\tPlatform Version\tSource Type\tPage Type\tPre-Order\tTerritory\tCounts';
const row = (d, terr, n = 1, type = 'First-time download') => `${d}\tCasa Libre\t6822493219\t${type}\t1.4.0\tiPhone\tiOS 26.6\tWeb referrer\tProduct page\t\t${terr}\t${n}`;
const inst = (processingDate, ...rows) => ({ processingDate, rows: parseDelimited([H, ...rows].join('\n'), '\t') });
const NOV = [
  inst('2026-11-06', row('2026-11-05', 'PY'), row('2026-11-05', 'US')),
  inst('2026-11-07', row('2026-11-06', 'US'), row('2026-11-05', 'US'), row('2026-11-06', 'PY'), row('2026-11-05', 'PY'), row('2026-11-06', 'US'), row('2026-11-06', 'PY'), row('2026-11-06', 'PY'), row('2026-11-06', 'BR')),
  inst('2026-11-08', row('2026-11-07', 'PY'), row('2026-11-06', 'US'), row('2026-11-07', 'PY'), row('2026-11-06', 'US'), row('2026-11-06', 'PY'), row('2026-11-06', 'PY'), row('2026-11-06', 'BR'), row('2026-11-06', 'PY')),
  inst('2026-11-09', row('2026-11-07', 'PY'), row('2026-11-08', 'PY'), row('2026-11-07', 'PY'), row('2026-11-08', 'BR', 2)),
  inst('2026-11-10', row('2026-11-08', 'BR', 2), row('2026-11-08', 'PY'), row('2026-11-09', 'UY'), row('2026-11-09', 'PY'), row('2026-11-09', 'BO')),
];

describe('App Store downloads (App Downloads report)', () => {
  it('counts first-time downloads + redownloads per day and country, not updates or restores', () => {
    const rows = parseDelimited([H, row('2026-11-05', 'PY', 2), row('2026-11-05', 'US', 1, 'Redownload'), row('2026-11-05', 'PY', 7, 'Auto-update'), row('2026-11-05', 'PY', 3, 'Manual update'), row('2026-11-05', 'PY', 1, 'Restore')].join('\n'), '\t');
    expect(appleDownloadsDaily(rows)).toEqual({ '2026-11-05': { firstTime: 2, redownloads: 1, territories: { PY: 2, US: 1 } } });
  });

  it('takes each day from the newest instance only (instances overlap)', () => {
    const d = appleFromInstances({ downloads: NOV });
    expect(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.installs]))).toEqual({
      '2026-11-05': 2, '2026-11-06': 6, '2026-11-07': 2, '2026-11-08': 3, '2026-11-09': 3,
    });
    expect(d['2026-11-06'].territories).toEqual({ US: 2, PY: 3, BR: 1 });
    expect(d['2026-11-06'].deletions).toBeNull();   // the opt-in report had nothing
  });

  it('a processed day with no download rows is 0, not "no report"', () => {
    const d = latestPerDate([{ processingDate: '2026-11-12', daily: {} }], () => ({ n: 0 }));
    expect(d).toEqual({ '2026-11-11': { n: 0 } });
    // …but never replaces real numbers for that day
    expect(latestPerDate([{ processingDate: '2026-11-12', daily: { '2026-11-11': { n: 4 } } }], () => ({ n: 0 }))).toEqual({ '2026-11-11': { n: 4 } });
  });

  it('adds deletions from the installation & deletion report when Apple has them', () => {
    const usage = [{ processingDate: '2026-11-07', rows: parseDelimited('Date\tEvent\tCounts\n2026-11-06\tDelete\t1\n2026-11-06\tInstall\t9\n', '\t') }];
    const d = appleFromInstances({ downloads: NOV, usage });
    expect(d['2026-11-06']).toMatchObject({ installs: 6, deletions: 1 });   // installs stay from the downloads report
    expect(d['2026-11-05'].deletions).toBeNull();
  });

  it('merges into the page totals: 16 iPhone downloads, by country, deletions unknown', () => {
    const m = mergeInstalls({ apple: appleFromInstances({ downloads: NOV }), days: 30, now: new Date('2026-11-11T10:00:00Z') });
    expect(m.total.ios).toBe(16);
    expect(m.total.iosDeletions).toBeNull();
    expect(m.total.iosByTerritory).toEqual({ PY: 8, US: 3, BR: 3, UY: 1, BO: 1 });
    expect(m.latest.apple).toBe('2026-11-09');
    expect(m.series.find((r) => r.key === '2026-11-10').ios).toBeNull();   // not reported yet
  });

  it('lists the App Store countries by downloads, with English names', () => {
    expect(territoryList({ PY: 8, US: 3, BR: 3, UY: 0 })).toEqual([
      { code: 'PY', name: 'Paraguay', n: 8 }, { code: 'BR', name: 'Brazil', n: 3 }, { code: 'US', name: 'United States', n: 3 },
    ]);
    expect(territoryList({ '??': 1 })).toEqual([{ code: '??', name: '??', n: 1 }]);
  });
});
