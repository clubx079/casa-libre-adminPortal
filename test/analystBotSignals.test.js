// AI Analyst bot signals + the claim guard + chart data.
import { describe, it, expect } from 'vitest';
import { botSignals, segmentStats, botVerdict, networkOf } from '../lib/analyst/botSignals.js';
import { guardReport, claimedNumbers, packNumbers, inPack, mentionsBots } from '../lib/analyst/guard.js';
import { sourceBars, funnelSteps, groupOfSource, visitorSeries, fxIndexed } from '../lib/analyst/chartData.js';

// visitor-day rows: [day, source, country, events, pageviews, seconds, fingerprint, ip, browser]
const real = (n, { source = 'social', country = 'Colombia', day = '2026-11-10' } = {}) => Array.from({ length: n }, (_, i) => [
  day, source, country, 6 + (i % 5), 2 + (i % 3), 40 + i * 7, `Mobile Safari|iOS|${360 + (i % 9) * 10}x800`, `181.${i % 50}.${i}.${i % 200}`, 'Mobile Safari',
]);
const bots = (n, day = '2026-11-10') => Array.from({ length: n }, (_, i) => [day, 'social', 'United States', 1, 0, 0, 'Chrome|Linux|1920x1080', `34.12.7.${i}`, 'Chrome']);

describe('bot signals', () => {
  it('real visitors from a Facebook spike are human_like, not bots', () => {
    const b = botSignals([...real(60), ...real(40, { country: 'Argentina' })], { anomalyDates: ['2026-11-10'] });
    const social = b.bySource.find((s) => s.key === 'social');
    expect(social.verdict).toBe('human_like');
    expect(b.byCountry.map((c) => c.verdict)).toEqual(['human_like', 'human_like']);
    expect(b.automatedLikely).toEqual([]);
    expect(b.anomalyDays[0].verdict).toBe('human_like');
  });
  it('one-event, zero-second visits from one network on one device are automated_likely', () => {
    const b = botSignals([...real(30, { source: 'google', country: 'Paraguay' }), ...bots(50)], { anomalyDates: ['2026-11-10'] });
    const us = b.byCountry.find((c) => c.key === 'United States');
    expect(us.verdict).toBe('automated_likely');
    expect(us.topNetworkSharePct).toBe(100);
    expect(b.automatedLikely.some((x) => x.startsWith('country United States'))).toBe(true);
    expect(JSON.stringify(b)).not.toContain('34.12.7.');   // raw IPs never leave the module
  });
  it('small segments are not judged; network prefixes', () => {
    expect(botVerdict(segmentStats(bots(5).map((r) => ({ events: 1, pageviews: 0, seconds: 0, fp: 'x', ip: r[7] })))).verdict).toBe('too_small');
    expect(networkOf('181.12.33.4')).toBe('181.12.33.0/24');
    expect(networkOf('2800:a4:1234:5::1')).toBe('2800:a4:1234::/48');
    expect(networkOf('unknown')).toBe('');
  });
});

describe('claim guard', () => {
  const pack = {
    sections: {
      mainSite: { totals: { uniqueVisitors: { cur: 1890, prev: 1204, changePct: 57 } } },
      botSignals: { automatedLikely: [] },
    },
    outsideWorld: { events: [{ id: 'ev1', date: '2026-11-03', title: 'Ueno Bank resolution' }] },
  };
  it('reads the claimed numbers, skipping dates, years and tiny numbers', () => {
    expect(claimedNumbers('Visitors 1,890 vs 1,204 (+57%) on Nov 10, 2026; 3 sign-ups; 2026-11-03; 1.2k views')).toEqual([1890, 1204, 57, 1200]);
    const nums = packNumbers(pack);
    expect(inPack(1890, nums)).toBe(true);
    expect(inPack(1205, nums)).toBe(true);   // rounding
    expect(inPack(4321, nums)).toBe(false);
  });
  it('marks evidence in / not in the data; a finding with none in the data becomes a guess', () => {
    const out = guardReport({
      headline: 'x', summary: 'y',
      changes: [
        { title: 'Visitors up', change: '1,204 → 1,890 (+57%)', dataShows: '', explanation: '', confidence: 'strong', evidence: [{ value: '1,890 vs 1,204' }] },
        { title: 'Contacts up', change: '', dataShows: '', explanation: '', confidence: 'strong', evidence: [{ value: '4,321 contacts' }] },
      ],
      outsideWorld: [{ eventId: 'ev1' }, { eventId: 'ev99' }],
    }, pack);
    expect(out.changes[0]).toMatchObject({ confidence: 'strong' });
    expect(out.changes[0].evidence[0].inData).toBe(true);
    expect(out.changes[1].confidence).toBe('guess');
    expect(out.changes[1].evidence[0]).toMatchObject({ inData: false, notInData: [4321] });
    expect(out.outsideWorld.map((o) => o.eventId)).toEqual(['ev1']);
    expect(out.guardWarnings.join(' ')).toMatch(/not in the timeline/);
  });
  it('"bot burst" without code-level bot evidence is downgraded and flagged', () => {
    expect(mentionsBots('a likely bot burst on Facebook')).toBe(true);
    expect(mentionsBots('Bolivia about page')).toBe(false);
    const out = guardReport({
      headline: 'Bot traffic on Facebook', summary: '',
      changes: [{ title: 'Facebook bot burst', change: '', dataShows: '', explanation: 'likely a bot burst', confidence: 'possible', evidence: [{ value: '1,890' }] }],
      outsideWorld: [],
    }, pack);
    expect(out.changes[0].confidence).toBe('guess');
    expect(out.changes[0].guardNote).toMatch(/mentions bots/);
    expect(out.guardWarnings.join(' ')).toMatch(/bot \/ automated traffic/);
    // allowed when the code flagged a segment
    const flagged = { ...pack, sections: { ...pack.sections, botSignals: { automatedLikely: ['source social: …'] } } };
    expect(guardReport({ headline: 'Bot traffic', changes: [{ title: 'bots', evidence: [{ value: '1,890' }], confidence: 'possible' }] }, flagged).changes[0].confidence).toBe('possible');
  });
});

describe('chart data', () => {
  const pack = {
    period: { start: '2026-11-10', end: '2026-11-16', endIsToday: true }, previousPeriod: { start: '2026-11-03' },
    sections: {
      mainSite: {
        totals: { uniqueVisitors: { cur: 2000, prev: 1000, changePct: 100 }, sellerContacts: { cur: 40, prev: 23, changePct: 74 }, signups: { cur: 10, prev: 10, changePct: 0 }, listingsCreated: { cur: 5, prev: 4, changePct: 25 } },
        breakdowns: { sources: { totalCur: 1000, totalPrev: 600, top: [{ key: 'google', cur: 500, prev: 300 }, { key: 'chatgpt', cur: 100, prev: 50 }, { key: 'social', cur: 80, prev: 10 }, { key: 'whatsapp campaign', cur: 50, prev: 0 }, { key: 'direct', cur: 200, prev: 200 }], otherRisers: [{ key: 'funnel · vender-mi-casa.com.py', cur: 20, prev: 0 }], otherFallers: [] } },
        daily: { columns: ['date', 'visitors', 'pageviews', 'signups', 'listings', 'contacts', 'propertyViews'], rows: [['2026-11-09', 100, 0, 1, 0, 2, 0], ['2026-11-10', 300, 0, 2, 0, 5, 0]] },
      },
      anomalies: { days: [{ date: '2026-11-10', metrics: [{ metric: 'visitors', value: 300, baselineAvg7: 100 }] }] },
      funnelLeads: { cur: 3, prev: 1 },
    },
    outsideWorld: { events: [{ id: 'ev1', date: '2026-11-10', category: 'economy' }, { id: 'ev2', date: '2026-10-25', category: 'politics' }], fx: { dates: ['a', 'b'], series: { PYG: [6000, 6060] }, changes: { PYG: { changePct: 1 } } } },
  };
  it('groups sources, with Other = the rest of the total', () => {
    expect(groupOfSource('whatsapp campaign')).toBe('whatsapp');
    expect(groupOfSource('perplexity')).toBe('ai');
    const bars = Object.fromEntries(sourceBars(pack).map((b) => [b.key, [b.cur, b.prev]]));
    expect(bars).toMatchObject({ google: [500, 300], ai: [100, 50], social: [80, 10], whatsapp: [50, 0], funnels: [20, 0], direct: [200, 200], other: [50, 40] });
  });
  it('funnel steps with the rate per 1,000 visitors', () => {
    const f = funnelSteps(pack);
    expect(f.map((s) => s.key)).toEqual(['visitors', 'contacts', 'signups', 'listings', 'leads']);
    expect(f[1]).toMatchObject({ cur: 40, prev: 23, per1000: 20, per1000Prev: 23 });
  });
  it('visitor series carries anomalies and same-day events; fx indexed to 100', () => {
    const s = visitorSeries(pack);
    expect(s.points[1].anomaly).toBeTruthy();
    expect(s.points[1].events.map((e) => e.id)).toEqual(['ev1']);
    expect(s.eventsOutside.map((e) => e.id)).toEqual(['ev2']);
    expect(fxIndexed(pack).lines[0].values).toEqual([100, 101]);
  });
});
