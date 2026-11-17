// AI Analyst outside-world timeline: parsers, country pick, impact maths, news clean-up, and the
// fetch layer with a fake fetch (fixtures only — no network in tests).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseFxSnapshot, fxSummary, parseHolidays, parseGdacs, parseWeather, searchResultUrls, cleanNewsEvents, finalizeEvents,
  eventImpact, pickCountries, eventWindow, isoOfName, gatherStructured, searchNews, normUrl,
} from '../lib/analyst/outsideEvents.js';
import { dayList } from '../lib/analyst/math.js';

const fx = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'analyst', f), 'utf8'));
const win = { start: '2026-10-20', end: '2026-11-16' };

beforeAll(() => { process.env.ANALYST_RUNS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'analyst-test-')); });

describe('structured parsers', () => {
  it('fx snapshot: only the asked currencies, upper-case', () => {
    const s = parseFxSnapshot(fx('fx-2026-11-10.json'), ['PYG', 'BRL', 'VES']);
    expect(s.date).toBe('2026-11-10');
    expect(s.rates.PYG).toBeCloseTo(6236.56, 1);
    expect(s.rates.VES).toBeUndefined();
    expect(parseFxSnapshot({ nope: 1 }, ['PYG'])).toBeNull();
  });
  it('fx summary: change %, biggest moves, an event for a ≥4% week', () => {
    const snaps = dayList('2026-11-01', '2026-11-10').map((d, i) => ({ date: d, rates: { PYG: 6200 + i, ARS: i < 5 ? 1450 : 1545 } }));
    const s = fxSummary(snaps, ['PYG', 'ARS'], { ARS: 'AR', PYG: 'PY' });
    expect(s.dates).toHaveLength(10);
    expect(s.changes.PYG.changePct).toBeCloseTo(0.1, 1);
    expect(s.changes.ARS.biggestOneStepMovePct).toBeCloseTo(6.6, 1);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ country: 'AR', category: 'economy', source: 'fx', date: '2026-11-06' });
    expect(s.events[0].title).toMatch(/ARS weakened/);
  });
  it('holidays: national ones inside the window only', () => {
    const h = parseHolidays(fx('holidays-py-2026.json'), 'PY', { start: '2026-09-01', end: '2026-11-16' });
    expect(h.map((x) => x.date)).toEqual(['2026-09-29']);
    expect(h[0]).toMatchObject({ country: 'PY', category: 'social', source: 'holidays' });
  });
  it('GDACS: our countries only; green alerts only for the site country', () => {
    const g = parseGdacs(fx('gdacs.json'), { isos: ['PY', 'BR'], siteIsos: ['PY'], win });
    expect(g.map((e) => [e.country, e.title.match(/(orange|green|red)/i)[0].toLowerCase()])).toEqual([['BR', 'orange'], ['PY', 'green']]);
    expect(g.find((e) => e.country === 'PY').date).toBe('2026-10-20');   // started inside the window
    expect(g.every((e) => e.category === 'disaster_climate' && e.url.startsWith('https://www.gdacs.org/'))).toBe(true);
  });
  it('GDACS: a disaster across many countries is ONE event, our countries named', () => {
    const many = { features: [{ properties: { eventtype: 'DR', name: 'Drought in Aruba, Brazil, Colombia, Costa Rica, French Guiana, Guyana, Panama, Suriname', alertlevel: 'Orange', fromdate: '2026-08-01T00:00:00', todate: '2026-12-01T00:00:00', url: { report: 'https://www.gdacs.org/r' },
      affectedcountries: ['AW', 'BR', 'CO', 'CR', 'GF', 'GY', 'PA', 'SR'].map((iso2) => ({ iso2 })) } }] };
    const g = parseGdacs(many, { isos: ['PY', 'BR', 'CO'], siteIsos: ['PY'], win });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ country: 'BR', alsoCountries: ['CO'], date: win.start, title: 'Drought in Brazil, Colombia and 6 other countries (GDACS orange alert)' });
    expect(g[0].detail).toMatch(/^Ongoing since 2026-08-01/);
  });
  it('weather: heat, heavy rain and gusts become events', () => {
    const w = parseWeather(fx('openmeteo.json'), 'PY', 'Asunción', win);
    expect(w.map((e) => e.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(w[1].title).toMatch(/heavy rain 72.5 mm, wind gusts 85 km\/h/);
  });
});

describe('news clean-up', () => {
  const msg = fx('news-message.json');
  const raw = JSON.parse(msg.content.find((b) => b.type === 'text').text);
  it('collects the search result urls (normalised)', () => {
    const u = searchResultUrls(msg);
    expect(u.size).toBe(2);
    expect(u.has(normUrl('https://www.lanacion.com.py/negocios/2026/11/16/che-roga-pora-cambia-el-sistema/?utm_source=x'))).toBe(true);
  });
  it('keeps only events in the window, with a known category and a url the search returned', () => {
    const { events, dropped } = cleanNewsEvents(raw, { win, isos: ['PY', 'BR'], seenUrls: searchResultUrls(msg) });
    expect(events.map((e) => e.title)).toEqual(['Central bank puts Ueno Bank into resolution', 'Che Róga Porã applications move to banks']);
    expect(dropped.map((d) => d.why).sort()).toEqual(['bad category', 'outside the window', 'url not in the search results']);
  });
  it('searchNews: one model call, cached for the rerun', async () => {
    let calls = 0;
    const callModel = async (params) => { calls++; expect(params.tools[0].name).toBe('web_search'); return msg; };
    const args = { countries: [{ iso: 'PY', name: 'Paraguay', why: 'site country' }], win, site: 'https://casa-libre.com.py', today: '2026-11-17', callModel, model: 'm' };
    const a = await searchNews(args);
    const b = await searchNews(args);
    expect(calls).toBe(1);
    expect(a.events).toHaveLength(2);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(a.searches).toBe(3);
  });
});

describe('timeline + impact', () => {
  it('ids in date order, duplicates removed', () => {
    const e = finalizeEvents([{ date: '2026-11-03', country: 'PY', title: 'B' }, { date: '2026-11-01', country: 'PY', title: 'A' }, { date: '2026-11-03', country: 'PY', title: 'b' }]);
    expect(e.map((x) => [x.id, x.title])).toEqual([['ev1', 'A'], ['ev2', 'B']]);
  });
  it('impact: visitors before vs after, with the lag split, and the event country', () => {
    const days = dayList('2026-10-20', '2026-11-16');
    const total = new Map(days.map((d) => [d, d >= '2026-11-03' && d <= '2026-11-06' ? 300 : 200]));
    const br = new Map(days.map((d) => [d, d >= '2026-11-10' ? 40 : 10]));
    const im = eventImpact({ date: '2026-11-03', country: 'BR' }, { total, byCountry: new Map([['Brazil', br]]) }, { end: '2026-11-16' });
    expect(im.allVisitors).toMatchObject({ avgPerDay7Before: 200, avgPerDayDays0to3: 300, changePctDays0to3: 50, changePctDays4to21: 0 });
    expect(im.visitorsFromCountry.country).toBe('Brazil');
    expect(im.visitorsFromCountry.changePctDays4to21).toBeGreaterThan(100);   // the lagged rise
    const late = eventImpact({ date: '2026-11-16', country: 'PY' }, { total, byCountry: new Map() }, { end: '2026-11-16' });
    expect(late.allVisitors.avgPerDayDays4to21).toBeNull();
    expect(late.visitorsFromCountry).toBeUndefined();
  });
  it('picks the site country + the visitor countries that moved most', () => {
    const pack = { country: 'py', sections: { mainSite: { breakdowns: { countries: {
      top: [{ key: 'Paraguay', cur: 900, prev: 800, diff: 100, changePct: 13 }, { key: 'Brazil', cur: 400, prev: 30, diff: 370, changePct: 1233 }, { key: 'United States', cur: 40, prev: 38, diff: 2, changePct: 5 }, { key: 'Spain', cur: 7, prev: 17, diff: -10, changePct: -59 }],
      otherRisers: [{ key: 'Colombia', cur: 25, prev: 0, diff: 25, changePct: null }, { key: 'Narnia', cur: 99, prev: 0, diff: 99, changePct: null }],
    } } } } };
    expect(pickCountries(pack).map((c) => c.iso)).toEqual(['PY', 'BR', 'CO', 'ES']);   // a big drop counts too
    expect(pickCountries(pack).find((c) => c.iso === 'ES').why).toContain('-59%');
    expect(eventWindow({ start: '2026-11-10', end: '2026-11-16' })).toEqual({ start: '2026-10-20', end: '2026-11-16' });
    expect(isoOfName('argentina')).toBe('AR');
  });
});

describe('gatherStructured (fake fetch)', () => {
  it('fetches each source once, builds fx + events, reports failures', async () => {
    const urls = [];
    const fakeFetch = async (url) => {
      urls.push(url);
      const ok = (j) => ({ ok: true, status: 200, json: async () => j });
      if (url.includes('currency-api')) {
        const d = url.match(/(\d{4}-\d{2}-\d{2})/)[1];
        return ok({ date: d, usd: { pyg: 6200 + Number(d.slice(8)), brl: 5.5 } });
      }
      if (url.includes('nager')) return ok(fx('holidays-py-2026.json'));
      if (url.includes('gdacs')) return ok(fx('gdacs.json'));
      if (url.includes('open-meteo')) return { ok: false, status: 503, json: async () => ({}) };
      throw new Error('unexpected');
    };
    const w = { start: '2026-09-20', end: '2026-10-05' };
    const r = await gatherStructured({ countries: [{ iso: 'PY' }, { iso: 'BR' }], win: w, chartStart: '2026-09-15', today: '2026-11-17', siteIsos: ['PY'], fetchFn: fakeFetch });
    expect(r.fx.dates[0]).toBe('2026-09-15');                 // aligned to the chart's first day
    expect(Object.keys(r.fx.series).sort()).toEqual(['BRL', 'PYG']);
    expect(r.events.some((e) => e.title === 'Public holiday: Victoria de Boquerón')).toBe(true);
    expect(r.errors.some((e) => e.startsWith('weather PY'))).toBe(true);
    const n = urls.length;
    await gatherStructured({ countries: [{ iso: 'PY' }, { iso: 'BR' }], win: w, chartStart: '2026-09-15', today: '2026-11-17', siteIsos: ['PY'], fetchFn: fakeFetch });
    expect(urls.length - n).toBe(1);                          // only the failed weather call is retried
  });
});
