// Analytics → Growth chart (Roland, Nov 4 2026: "a growth chart from when we started importing
// analytics, so we can see any lag or drop — e.g. after we stopped the competitor ads on Google").
// One PostHog query: per day (country time) the visitors, property views and sellers contacted,
// from the first day with data. buildGrowth fills the empty days with 0 and adds the 7-day
// average (the line that shows the trend; one quiet day doesn't look like a drop). Pure —
// test/growthSeries.test.js.
import { CONTACT_IN } from './posthogSql.js';

export const GROWTH_MAX_DAYS = 400;
export const METRICS = {
  visitors: 'Visitors',
  views: 'Property views',
  contacts: 'Contacted a seller',
};

// where: the page's filter (geo + site + platform) · ukey: who a person is
export const growthSql = ({ where, ukey, tz = 'America/Asuncion', days = GROWTH_MAX_DAYS }) =>
  `SELECT toString(toDate(toTimeZone(timestamp, '${tz}'))) AS d, uniqExact(${ukey}) AS visitors,
          countIf(event = 'property_viewed') AS views, uniqExactIf(${ukey}, ${CONTACT_IN}) AS contacts
     FROM events WHERE timestamp >= now() - INTERVAL ${Number(days)} DAY AND ${where}
     GROUP BY d ORDER BY d`;

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// rows: [[ 'YYYY-MM-DD', visitors, views, contacts ], …] → { days: [{ date, visitors, views,
// contacts, avg: { visitors, views, contacts } }], start, end, totals }
export function buildGrowth(rows = [], { today = iso(Date.now()) } = {}) {
  const by = new Map();
  for (const r of rows) {
    const d = String(r?.[0] || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    by.set(d, { visitors: Number(r[1]) || 0, views: Number(r[2]) || 0, contacts: Number(r[3]) || 0 });
  }
  if (!by.size) return { days: [], start: null, end: null, totals: { visitors: 0, views: 0, contacts: 0 } };
  const start = [...by.keys()].sort()[0];
  const end = today > start ? today : start;
  const days = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY) {
    const date = iso(t);
    days.push({ date, ...(by.get(date) || { visitors: 0, views: 0, contacts: 0 }) });
  }
  // 7-day average ending on that day (fewer days at the very start)
  for (let i = 0; i < days.length; i++) {
    const win = days.slice(Math.max(0, i - 6), i + 1);
    const avg = (k) => Math.round((win.reduce((s, x) => s + x[k], 0) / win.length) * 10) / 10;
    days[i].avg = { visitors: avg('visitors'), views: avg('views'), contacts: avg('contacts') };
  }
  const totals = { visitors: 0, views: 0, contacts: 0 };
  for (const x of days) { totals.views += x.views; totals.contacts += x.contacts; }
  totals.visitors = days.reduce((s, x) => s + x.visitors, 0);   // sum of daily visitors (a person on 2 days counts twice)
  return { days, start, end, totals };
}

// week-over-week change of the 7-day average for a metric: { now, before, pct } (pct null when before is 0)
export function weekChange(days = [], metric = 'visitors') {
  if (days.length < 8) return null;
  const now = days[days.length - 1].avg[metric];
  const before = days[days.length - 8].avg[metric];
  return { now, before, pct: before ? Math.round(((now - before) / before) * 100) : null };
}
