// AI Analyst — the deterministic part: periods, day series, period-vs-period changes, anomaly
// days and the "what changed that day" drill-down. Everything the model is told about a spike
// is computed here first (Claude explains the numbers; it never has to find them).
// Pure — test/analystMath.test.js.

export const ANALYST_DAYS = [7, 28, 90];
export const ANALYST_COUNTRIES = ['py', 'bo', 'uy', 've', 'sv'];
export const TZ = { py: 'America/Asuncion', bo: 'America/La_Paz', uy: 'America/Montevideo', ve: 'America/Caracas', sv: 'America/El_Salvador', all: 'America/Asuncion' };
const DAY = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => isoDay(Date.parse(`${d}T12:00:00Z`) + n * DAY);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY) + 1;
export function dayList(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// The local calendar day of `now` in a time zone (YYYY-MM-DD).
export function localToday(tz = TZ.py, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch { return isoDay(now); }
}

// { days } (7/28/90, ending today) or { start, end } (custom, max 120 days) → the period, the
// one before it (same length) and the baseline window (7 days before the previous period, so
// the first days of the window also get a 7-day average). Returns { error } on bad input.
export function analystPeriod({ days, start, end } = {}, { tz = TZ.py, now = new Date() } = {}) {
  const today = localToday(tz, now);
  let s, e;
  if (start || end) {
    if (!ISO.test(String(start || '')) || !ISO.test(String(end || ''))) return { error: 'start and end must be YYYY-MM-DD' };
    s = start; e = end > today ? today : end;
    if (s > e) return { error: 'start is after end' };
    if (daysBetween(s, e) > 120) return { error: 'at most 120 days' };
  } else {
    const n = ANALYST_DAYS.includes(Number(days)) ? Number(days) : 28;
    e = today; s = addDays(today, -(n - 1));
  }
  const n = daysBetween(s, e);
  const prevEnd = addDays(s, -1);
  const prevStart = addDays(s, -n);
  return { start: s, end: e, days: n, prevStart, prevEnd, windowStart: addDays(prevStart, -7), today, partialToday: e === today };
}

export const num = (x) => Number(x) || 0;
export const r1 = (x) => Math.round(x * 10) / 10;
export const changePct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : cur ? null : 0);
export const sum = (arr) => arr.reduce((s, x) => s + num(x), 0);
const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);
const std = (arr) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (num(x) - m) ** 2, 0) / (arr.length - 1));
};

// rows [[day, v1, v2, …]] → Map day → [v1, v2 …] with every day of the window (missing = 0)
export function fillDays(rows = [], start, end, width = 1) {
  const by = new Map();
  for (const r of rows || []) {
    const d = String(r?.[0] || '').slice(0, 10);
    if (ISO.test(d)) by.set(d, r.slice(1, 1 + width).map(num));
  }
  const out = new Map();
  for (const d of dayList(start, end)) out.set(d, by.get(d) || Array(width).fill(0));
  return out;
}

// rows [[day, key, value]] → { totals: Map key → { cur, prev }, byDay: Map key → Map day → v }
// cur / prev = the sum of the daily values inside each period ("visitor-days").
export function dimensionTable(rows = [], P) {
  const byDay = new Map();
  const totals = new Map();
  for (const r of rows || []) {
    const d = String(r?.[0] || '').slice(0, 10);
    const key = r?.[1] == null || r[1] === '' ? '(none)' : String(r[1]);
    const v = num(r?.[2]);
    if (!ISO.test(d)) continue;
    if (!byDay.has(key)) byDay.set(key, new Map());
    byDay.get(key).set(d, (byDay.get(key).get(d) || 0) + v);
    if (!totals.has(key)) totals.set(key, { cur: 0, prev: 0 });
    if (d >= P.start && d <= P.end) totals.get(key).cur += v;
    else if (d >= P.prevStart && d <= P.prevEnd) totals.get(key).prev += v;
  }
  return { totals, byDay };
}

// The period comparison of one dimension: top keys by this period, with the change, and the
// biggest movers (up and down) — so a source that tripled shows even if it is not in the top.
export function compareDimension(table, { top = 10, movers = 5 } = {}) {
  const rows = [...table.totals.entries()].map(([key, t]) => ({ key, cur: t.cur, prev: t.prev, diff: t.cur - t.prev, changePct: changePct(t.cur, t.prev) }));
  const totalCur = sum(rows.map((r) => r.cur));
  const totalPrev = sum(rows.map((r) => r.prev));
  for (const r of rows) {
    r.shareCur = totalCur ? r1((r.cur / totalCur) * 100) : 0;
    r.sharePrev = totalPrev ? r1((r.prev / totalPrev) * 100) : 0;
  }
  const byCur = [...rows].sort((a, b) => b.cur - a.cur);
  const topRows = byCur.slice(0, top);
  const inTop = new Set(topRows.map((r) => r.key));
  const up = [...rows].sort((a, b) => b.diff - a.diff).filter((r) => r.diff > 0 && !inTop.has(r.key)).slice(0, movers);
  const down = [...rows].sort((a, b) => a.diff - b.diff).filter((r) => r.diff < 0 && !inTop.has(r.key)).slice(0, movers);
  return { totalCur, totalPrev, top: topRows, otherRisers: up, otherFallers: down };
}

// Day series of the top keys, as compact arrays aligned with `days`.
export function seriesFor(table, keys, days) {
  const out = {};
  for (const k of keys) {
    const m = table.byDay.get(k);
    out[k] = days.map((d) => num(m?.get(d)));
  }
  return out;
}

// Anomaly days of one daily metric. Baseline = the 7 days before the day (from the window, so
// the first days of the period have one too). A day is flagged when it is at least `ratio`×
// (spike) or at most 1/ratio× (drop) of its baseline average, or |z| ≥ zMin — and the absolute
// difference is at least minAbs (3 → 7 is not news).
export function findAnomalies(daily, { from, to, ratio = 2, zMin = 3, minAbs = 20, metric = 'visitors' } = {}) {
  const days = [...daily.keys()].sort();
  const out = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if ((from && d < from) || (to && d > to)) continue;
    const base = days.slice(Math.max(0, i - 7), i).map((x) => daily.get(x));
    if (base.length < 4) continue;
    const v = num(daily.get(d));
    const avg = mean(base);
    const sd = std(base);
    const z = sd > 0 ? (v - avg) / sd : (v === avg ? 0 : null);
    const x = avg > 0 ? v / avg : null;
    const big = Math.abs(v - avg) >= minAbs;
    const spike = big && v > avg && ((x != null && x >= ratio) || (z != null && z >= zMin) || (avg === 0 && v >= minAbs));
    const drop = big && v < avg && ((x != null && x <= 1 / ratio) || (z != null && z <= -zMin));
    if (spike || drop) out.push({ metric, date: d, value: v, baselineAvg7: r1(avg), ratio: x == null ? null : r1(x), z: z == null ? null : r1(z), kind: spike ? 'spike' : 'drop' });
  }
  return out;
}

// What changed on an anomaly day in one dimension: each key's value that day vs its average
// over the 7 days before, sorted by the size of the difference (the drivers of the spike).
export function drillDown(table, date, { top = 6 } = {}) {
  const before = dayList(addDays(date, -7), addDays(date, -1));
  const rows = [];
  for (const [key, m] of table.byDay.entries()) {
    const v = num(m.get(date));
    const avg = mean(before.map((d) => num(m.get(d))));
    if (!v && !avg) continue;
    rows.push({ key, value: v, avg7: r1(avg), diff: r1(v - avg) });
  }
  const dayTotal = sum(rows.map((r) => r.value));
  return rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, top).map((r) => ({ ...r, shareOfDay: dayTotal ? r1((r.value / dayTotal) * 100) : 0 }));
}

// Hours of an anomaly day vs the same hour's average on the 7 days before. rows [[day, hour, v]].
export function hourProfile(rows = [], date, { top = 5 } = {}) {
  const by = new Map();
  for (const r of rows || []) by.set(`${String(r[0]).slice(0, 10)}|${num(r[1])}`, num(r[2]));
  const before = dayList(addDays(date, -7), addDays(date, -1));
  const out = [];
  for (let h = 0; h < 24; h++) {
    const v = by.get(`${date}|${h}`) || 0;
    const avg = mean(before.map((d) => by.get(`${d}|${h}`) || 0));
    out.push({ hour: h, value: v, avg7: r1(avg), diff: r1(v - avg) });
  }
  return out.sort((a, b) => b.diff - a.diff).slice(0, top);
}

// Merge anomalies of several metrics that fall on the same day.
export function groupAnomalies(list = []) {
  const by = new Map();
  for (const a of list) {
    if (!by.has(a.date)) by.set(a.date, { date: a.date, metrics: [] });
    by.get(a.date).metrics.push(a);
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Period totals of a filled daily Map of [v…] arrays (index i).
export function periodSum(daily, P, i = 0) {
  let cur = 0, prev = 0;
  for (const [d, v] of daily.entries()) {
    if (d >= P.start && d <= P.end) cur += num(v[i]);
    else if (d >= P.prevStart && d <= P.prevEnd) prev += num(v[i]);
  }
  return { cur, prev, changePct: changePct(cur, prev) };
}

// Local midnight of `day` in `tz`, as a UTC 'YYYY-MM-DD HH:MM:SS' for HogQL.
export function utcOfLocalMidnight(day, tz) {
  const guess = Date.parse(`${day}T00:00:00Z`);
  let offsetMin = 0;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    offsetMin = Math.round((local - guess) / 60000);
  } catch { /* UTC */ }
  return new Date(guess - offsetMin * 60000).toISOString().replace('T', ' ').slice(0, 19);
}

// Landing pages, grouped: listing / id paths collapse to a pattern so 200 listings are one row.
export function normPath(p) {
  let s = String(p || '/').split('?')[0].split('#')[0].toLowerCase() || '/';
  s = s.replace(/\/(propiedad|property|p|perfil|agencia|inmobiliaria|r)\/[^/]+.*$/, '/$1/*');
  s = s.replace(/\/[0-9a-f]{8}-[0-9a-f-]{20,}/g, '/*').replace(/\/\d{3,}(?=\/|$)/g, '/*');
  if (s.length > 1) s = s.replace(/\/$/, '');
  return s.length > 70 ? `${s.slice(0, 70)}…` : s;
}
export const normLang = (l) => {
  const s = String(l || '').trim();
  if (!s) return '(unknown)';
  const [a, b] = s.split(/[-_]/);
  return b ? `${a.toLowerCase()}-${b.toUpperCase()}` : a.toLowerCase();
};
