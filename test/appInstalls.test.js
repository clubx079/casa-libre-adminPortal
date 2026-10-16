import { describe, it, expect } from 'vitest';
import { parseDelimited, decodePlayCsv, playDaily, appleDaily, mergeInstalls } from '../lib/appInstalls.js';

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
