// AI Analyst — the OUTSIDE WORLD timeline: what happened around us (economy, politics, social,
// disasters / climate) in the analysis period and the 3 weeks before it, in the site's country
// and in the visitor countries that grew. Two kinds of input:
//   (a) free structured data fetched in code, no keys: exchange rates vs USD (fawazahmed0
//       currency-api, daily snapshots), public holidays (date.nager.at), disasters (GDACS),
//       weather extremes in the capital (Open-Meteo);
//   (b) news / politics / social found by ONE web-search model call per analysis (run.js passes
//       the model call in), in Spanish / Portuguese, every event with a source URL that the
//       search really returned.
// Everything is cached (memory + files next to the runs) so a rerun does not refetch.
// Parsers and the impact maths are pure (test/analystOutside.test.js); fetchers take `fetchFn`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { addDays, dayList, daysBetween, r1 } from './math.js';

export const CATEGORIES = ['economy', 'politics', 'social', 'disaster_climate'];
export const LOOKBACK_DAYS = 21;

// Countries we can look up. capital = [lat, lon, name] for the weather check.
export const COUNTRY_META = {
  PY: { name: 'Paraguay', currency: 'PYG', lang: 'es', capital: [-25.28, -57.63, 'Asunción'] },
  BO: { name: 'Bolivia', currency: 'BOB', lang: 'es', capital: [-16.5, -68.15, 'La Paz'] },
  UY: { name: 'Uruguay', currency: 'UYU', lang: 'es', capital: [-34.9, -56.16, 'Montevideo'] },
  VE: { name: 'Venezuela', currency: 'VES', lang: 'es', capital: [10.49, -66.88, 'Caracas'] },
  SV: { name: 'El Salvador', currency: null, lang: 'es', capital: [13.69, -89.22, 'San Salvador'] },   // uses US$
  BR: { name: 'Brazil', currency: 'BRL', lang: 'pt', capital: [-15.79, -47.88, 'Brasília'] },
  AR: { name: 'Argentina', currency: 'ARS', lang: 'es', capital: [-34.6, -58.38, 'Buenos Aires'] },
  CO: { name: 'Colombia', currency: 'COP', lang: 'es', capital: [4.71, -74.07, 'Bogotá'] },
  CL: { name: 'Chile', currency: 'CLP', lang: 'es', capital: [-33.45, -70.67, 'Santiago'] },
  PE: { name: 'Peru', currency: 'PEN', lang: 'es', capital: [-12.05, -77.04, 'Lima'] },
  EC: { name: 'Ecuador', currency: null, lang: 'es', capital: [-0.18, -78.47, 'Quito'] },
  MX: { name: 'Mexico', currency: 'MXN', lang: 'es', capital: [19.43, -99.13, 'Mexico City'] },
  ES: { name: 'Spain', currency: 'EUR', lang: 'es', capital: [40.42, -3.7, 'Madrid'] },
  US: { name: 'United States', currency: null, lang: 'en', capital: [38.9, -77.04, 'Washington'] },
};
const NAME_TO_ISO = Object.fromEntries(Object.entries(COUNTRY_META).map(([iso, m]) => [m.name.toLowerCase(), iso]));
export const isoOfName = (name) => NAME_TO_ISO[String(name || '').trim().toLowerCase()] || null;
export const SITE_ISO = { py: 'PY', bo: 'BO', uy: 'UY', ve: 'VE', sv: 'SV' };

// The countries to look at: the site's own + the visitor countries that moved most (at most 3
// extra). A visitor country counts when it had ≥ minSize visitor-days in one of the two periods
// and changed by ≥ 50% (or is new) and by ≥ minDiff visitor-days — up OR down (a drop can have an
// outside cause too). → [{ iso, name, why }]
export function pickCountries(pack, { minSize = 10, minDiff = 10, maxExtra = 3 } = {}) {
  const own = pack.country === 'all' ? Object.values(SITE_ISO) : [SITE_ISO[pack.country]].filter(Boolean);
  const out = own.map((iso) => ({ iso, name: COUNTRY_META[iso].name, why: 'site country' }));
  const b = pack.sections?.mainSite?.breakdowns?.countries;
  const rows = [...(b?.top || []), ...(b?.otherRisers || [])];
  const seen = new Set(own);
  const risers = rows
    .map((r) => ({ ...r, iso: isoOfName(r.key) }))
    .filter((r) => r.iso && !seen.has(r.iso) && Math.max(r.cur, r.prev) >= minSize && Math.abs(r.diff) >= minDiff && (r.changePct == null || Math.abs(r.changePct) >= 50))
    .sort((a, b2) => Math.abs(b2.diff) - Math.abs(a.diff));
  for (const r of risers) {
    if (seen.has(r.iso)) continue;
    seen.add(r.iso);
    out.push({ iso: r.iso, name: COUNTRY_META[r.iso].name, why: `visitors ${r.prev} → ${r.cur} visitor-days (${r.changePct == null ? 'new' : `${r.changePct > 0 ? '+' : ''}${r.changePct}%`})` });
    if (out.length >= own.length + maxExtra) break;
  }
  return out;
}

export const eventWindow = (period) => ({ start: addDays(period.start, -LOOKBACK_DAYS), end: period.end });

// ─────────────── parsers (pure) ───────────────

// currency-api daily snapshot { date, usd: { pyg: 6236.5, … } } → { date, rates: { PYG: 6236.5 } }
export function parseFxSnapshot(json, currencies) {
  const usd = json?.usd;
  if (!usd || !/^\d{4}-\d{2}-\d{2}$/.test(String(json?.date || ''))) return null;
  const rates = {};
  for (const c of currencies) {
    const v = Number(usd[c.toLowerCase()]);
    if (Number.isFinite(v) && v > 0) rates[c] = v;
  }
  return { date: json.date, rates };
}

// snapshots [{ date, rates }] → the series and the moves worth mentioning. A local currency per
// USD going UP = the local currency got weaker. Flagged: a ≥2% move in one step, or ≥4% over 7
// days. → { dates, series: { PYG: [..] }, changes: { PYG: {...} }, events: [...] }
export function fxSummary(snapshots, currencies, countryOf = {}) {
  const snaps = (snapshots || []).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));
  const dates = snaps.map((s) => s.date);
  const series = {};
  const changes = {};
  const events = [];
  for (const c of currencies) {
    const vals = snaps.map((s) => (s.rates[c] == null ? null : s.rates[c]));
    if (!vals.some((v) => v != null)) continue;
    series[c] = vals.map((v) => (v == null ? null : Number(v.toPrecision(6))));
    const pts = vals.map((v, i) => [dates[i], v]).filter(([, v]) => v != null);
    const first = pts[0];
    const last = pts[pts.length - 1];
    let maxStep = { pct: 0, date: null };
    let max7 = { pct: 0, from: null, to: null };
    for (let i = 1; i < pts.length; i++) {
      const step = ((pts[i][1] - pts[i - 1][1]) / pts[i - 1][1]) * 100;
      if (Math.abs(step) > Math.abs(maxStep.pct)) maxStep = { pct: r1(step), date: pts[i][0], from: pts[i - 1][0] };
      for (let j = i - 1; j >= 0 && daysBetween(pts[j][0], pts[i][0]) <= 8; j--) {
        const w = ((pts[i][1] - pts[j][1]) / pts[j][1]) * 100;
        if (Math.abs(w) > Math.abs(max7.pct)) max7 = { pct: r1(w), from: pts[j][0], to: pts[i][0] };
      }
    }
    changes[c] = {
      first: { date: first[0], rate: Number(first[1].toPrecision(6)) },
      last: { date: last[0], rate: Number(last[1].toPrecision(6)) },
      changePct: r1(((last[1] - first[1]) / first[1]) * 100),
      biggestOneStepMovePct: maxStep.pct, biggestOneStepMoveDate: maxStep.date,
      biggestWeekMovePct: max7.pct, biggestWeekMove: max7.from ? `${max7.from} → ${max7.to}` : null,
      note: 'local currency per 1 US$: up = the local currency got weaker',
    };
    const country = countryOf[c] || null;
    const word = (p) => (p > 0 ? 'weakened' : 'strengthened');
    if (Math.abs(max7.pct) >= 4) {
      events.push({ date: max7.to, country, category: 'economy', source: 'fx', title: `${c} ${word(max7.pct)} ${Math.abs(max7.pct)}% vs US$ in a week`, detail: `${c} per US$ moved ${max7.pct > 0 ? '+' : ''}${max7.pct}% from ${max7.from} to ${max7.to}.`, url: null });
    } else if (Math.abs(maxStep.pct) >= 2) {
      events.push({ date: maxStep.date, country, category: 'economy', source: 'fx', title: `${c} ${word(maxStep.pct)} ${Math.abs(maxStep.pct)}% vs US$ in one day`, detail: `${c} per US$ moved ${maxStep.pct > 0 ? '+' : ''}${maxStep.pct}% between ${maxStep.from} and ${maxStep.date}.`, url: null });
    }
  }
  return { base: 'USD', dates, series, changes, events };
}

// date.nager.at PublicHolidays → national holidays inside the window.
export function parseHolidays(list, iso, win) {
  return (Array.isArray(list) ? list : [])
    .filter((h) => h && h.date >= win.start && h.date <= win.end && h.global !== false)
    .map((h) => ({ date: h.date, country: iso, category: 'social', source: 'holidays', title: `Public holiday: ${h.localName || h.name}`, detail: h.name && h.name !== h.localName ? h.name : '', url: `https://date.nager.at/PublicHoliday/Country/${iso}/${String(h.date).slice(0, 4)}` }));
}

// GDACS event list (GeoJSON) → disasters touching our countries inside the window. Orange / red
// alerts anywhere in our list; green ones only for the site's own country.
export function parseGdacs(json, { isos, siteIsos = [], win }) {
  const want = new Set(isos);
  const out = [];
  for (const f of json?.features || []) {
    const p = f?.properties || {};
    const level = String(p.alertlevel || '').toLowerCase();
    const affected = (p.affectedcountries || []).map((c) => c.iso2).filter((c) => want.has(c));
    if (!affected.length) continue;
    const from = String(p.fromdate || '').slice(0, 10);
    const to = String(p.todate || '').slice(0, 10);
    if (!from || from > win.end || (to && to < win.start)) continue;
    const isSite = affected.some((c) => siteIsos.includes(c));
    if (level === 'green' && !isSite) continue;
    // one event per disaster (a drought can cover 20 countries): ours named, the rest counted
    const all = (p.affectedcountries || []).length;
    const ours = affected.map((c) => COUNTRY_META[c]?.name || c);
    const kind = GDACS_TYPES[p.eventtype] || 'Disaster';
    const name = String(p.name || p.eventname || '').length > 60 || all > 2
      ? `${kind} in ${ours.join(', ')}${all > ours.length ? ` and ${all - ours.length} other countries` : ''}`
      : (p.name || p.eventname || kind);
    out.push({
      date: from < win.start ? win.start : from, endDate: to || null,
      country: affected.find((c) => siteIsos.includes(c)) || affected[0], alsoCountries: affected.filter((c) => c !== (affected.find((x) => siteIsos.includes(x)) || affected[0])),
      category: 'disaster_climate', source: 'gdacs',
      title: `${name} (GDACS ${level || 'n/a'} alert)`,
      detail: `${from < win.start ? `Ongoing since ${from}. ` : ''}${String(p.htmldescription || p.description || '').replace(/\s+/g, ' ').slice(0, 160)}`,
      url: p.url?.report || 'https://www.gdacs.org/',
    });
  }
  return out;
}
const GDACS_TYPES = { FL: 'Flood', DR: 'Drought', TC: 'Tropical cyclone', EQ: 'Earthquake', VO: 'Volcano', WF: 'Wildfire', TS: 'Tsunami' };

// Open-Meteo daily → extreme-weather days in the capital: ≥ 37 °C, ≥ 50 mm rain, gusts ≥ 80 km/h.
export function parseWeather(json, iso, city, win) {
  const d = json?.daily;
  if (!d?.time) return [];
  const out = [];
  d.time.forEach((day, i) => {
    if (day < win.start || day > win.end) return;
    const t = Number(d.temperature_2m_max?.[i]);
    const rain = Number(d.precipitation_sum?.[i]);
    const gust = Number(d.wind_gusts_10m_max?.[i]);
    const bits = [];
    if (t >= 37) bits.push(`heat ${r1(t)} °C`);
    if (rain >= 50) bits.push(`heavy rain ${r1(rain)} mm`);
    if (gust >= 80) bits.push(`wind gusts ${Math.round(gust)} km/h`);
    if (bits.length) out.push({ date: day, country: iso, category: 'disaster_climate', source: 'weather', title: `Extreme weather in ${city}: ${bits.join(', ')}`, detail: 'Open-Meteo daily data for the capital.', url: 'https://open-meteo.com/' });
  });
  return out;
}

// The urls the web-search tool really returned in a message (so an event can cite only those).
export function searchResultUrls(msg) {
  const urls = new Set();
  for (const b of msg?.content || []) {
    if (b?.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r?.url) urls.add(normUrl(r.url));
    for (const c of b?.citations || []) if (c?.url) urls.add(normUrl(c.url));
  }
  return urls;
}
export const normUrl = (u) => String(u || '').trim().replace(/#.*$/, '').replace(/[?&]utm_[^&]*/g, '').replace(/\?$/, '').replace(/\/$/, '').replace(/^http:/, 'https:').toLowerCase();

// The news step's JSON → clean events: a date inside the window, a known category, one of our
// countries, and an http(s) URL. When the search's own result URLs are known, an event whose URL
// is not among them is dropped (the model must cite what it found, not what it remembers).
export function cleanNewsEvents(raw, { win, isos, seenUrls = null }) {
  const out = [];
  const dropped = [];
  for (const e of raw?.events || []) {
    const date = String(e?.date || '').slice(0, 10);
    const url = String(e?.url || '');
    const country = String(e?.country || '').toUpperCase();
    const why = !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'bad date'
      : date < win.start || date > win.end ? 'outside the window'
        : !CATEGORIES.includes(e?.category) ? 'bad category'
          : !isos.includes(country) ? 'other country'
            : !/^https?:\/\//.test(url) ? 'no url'
              : seenUrls && seenUrls.size && !seenUrls.has(normUrl(url)) ? 'url not in the search results' : null;
    if (why) { dropped.push({ title: e?.title || '', why }); continue; }
    out.push({ date, country, category: e.category, source: 'web_search', title: String(e.title || '').slice(0, 160), detail: String(e.description || '').slice(0, 400), url, sourceName: e.sourceName || null });
  }
  return { events: out, dropped };
}

// Ids, order, de-dup (same date + country + title).
export function finalizeEvents(list) {
  const seen = new Set();
  const out = [];
  for (const e of [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const k = `${e.date}|${e.country}|${String(e.title).toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: `ev${out.length + 1}`, ...e });
  }
  return out;
}

// Did our numbers move after an event? Visitors (all) and visitors from the event's country:
// the 7 days before vs days 0–3 and days 4–21 after (lag up to 3 weeks). Days after the data's
// end are not counted (n tells how many days were available). Pure.
// series: { total: Map day → n, byCountry: Map isoName → Map day → n }
export function eventImpact(event, series, { end }) {
  const avg = (m, from, to) => {
    if (!m) return null;
    const days = dayList(from, to < end ? to : end).filter((d) => m.has(d));
    if (!days.length) return null;
    return { avg: r1(days.reduce((s, d) => s + (Number(m.get(d)) || 0), 0) / days.length), n: days.length };
  };
  const one = (m) => {
    const before = avg(m, addDays(event.date, -7), addDays(event.date, -1));
    const d0 = avg(m, event.date, addDays(event.date, 3));
    const d4 = event.date < end ? avg(m, addDays(event.date, 4), addDays(event.date, 21)) : null;
    const pct = (a) => (a && before && before.avg ? Math.round(((a.avg - before.avg) / before.avg) * 100) : null);
    return {
      avgPerDay7Before: before?.avg ?? null,
      avgPerDayDays0to3: d0?.avg ?? null, changePctDays0to3: pct(d0),
      avgPerDayDays4to21: d4?.avg ?? null, changePctDays4to21: pct(d4), daysAvailableAfter: (d0?.n || 0) + (d4?.n || 0),
    };
  };
  const name = COUNTRY_META[event.country]?.name;
  const cm = name ? series.byCountry?.get(name) : null;
  return { allVisitors: one(series.total), ...(cm ? { visitorsFromCountry: { country: name, ...one(cm) } } : {}) };
}

// ─────────────── cache ───────────────
const mem = (globalThis.__clAnalystOutsideCache ||= new Map());
const CACHE_DIR = () => path.join(process.env.ANALYST_RUNS_DIR || path.join(process.cwd(), '.analyst-runs'), 'cache');
const safe = (k) => k.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 150);

export async function cached(key, ttlMs, fn) {
  const hit = mem.get(key);
  if (hit && (!ttlMs || Date.now() - hit.at < ttlMs)) return hit.value;
  const file = path.join(CACHE_DIR(), `${safe(key)}.json`);
  try {
    const j = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!ttlMs || Date.now() - j.at < ttlMs) { mem.set(key, j); return j.value; }
  } catch { /* miss */ }
  const value = await fn();
  const entry = { at: Date.now(), value };
  mem.set(key, entry);
  try { await fs.mkdir(CACHE_DIR(), { recursive: true }); await fs.writeFile(file, JSON.stringify(entry)); } catch { /* memory only */ }
  return value;
}

// ─────────────── fetchers ───────────────
const H6 = 6 * 3600 * 1000;
async function getJson(fetchFn, url, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'casalibre-admin-analyst' } });
    if (!r.ok) throw new Error(`${r.status} ${url.replace(/\?.*/, '')}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const FX_ALL = ['PYG', 'BOB', 'UYU', 'VES', 'BRL', 'ARS', 'COP', 'CLP', 'PEN', 'MXN', 'EUR'];
async function fxSnapshot(fetchFn, date, today) {
  // past days never change → cached for good; today's snapshot for 6 hours
  return cached(`fx-${date}`, date >= today ? H6 : 0, async () => {
    const urls = [`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`, `https://${date}.currency-api.pages.dev/v1/currencies/usd.min.json`];
    for (const u of urls) {
      try { const s = parseFxSnapshot(await getJson(fetchFn, u), FX_ALL); if (s) return s; } catch { /* next */ }
    }
    return null;
  });
}

// Everything structured, in parallel. → { fx, events, errors }
export async function gatherStructured({ countries, win, chartStart, today, siteIsos, fetchFn = fetch }) {
  const isos = countries.map((c) => c.iso);
  const errors = [];
  const guard = async (what, fn) => { try { return await fn(); } catch (e) { errors.push(`${what}: ${String(e?.message || e).slice(0, 120)}`); return null; } };
  const currencies = [...new Set(isos.map((i) => COUNTRY_META[i]?.currency).filter((c) => c && c !== 'EUR'))];
  const countryOf = Object.fromEntries(isos.map((i) => [COUNTRY_META[i]?.currency, i]).filter(([c]) => c));
  // FX over the chart's days (so it lines up with the visitors chart); ~60 points at most
  const fxStart = chartStart && chartStart < win.start ? chartStart : win.start;
  const all = dayList(fxStart, win.end);
  const step = Math.max(1, Math.ceil(all.length / 60));
  const fxDays = all.filter((_, i) => i % step === 0 || i === all.length - 1);
  const years = [...new Set([win.start.slice(0, 4), win.end.slice(0, 4)])];

  const [fxSnaps, holidays, gdacs, weather] = await Promise.all([
    currencies.length ? guard('exchange rates', () => pool(fxDays, 8, (d) => fxSnapshot(fetchFn, d, today).catch(() => null))) : [],
    guard('holidays', () => Promise.all(isos.flatMap((iso) => years.map((y) => cached(`holidays-${iso}-${y}`, 30 * 24 * 3600 * 1000, () => getJson(fetchFn, `https://date.nager.at/api/v3/PublicHolidays/${y}/${iso}`))
      .then((list) => parseHolidays(list, iso, win)).catch((e) => { errors.push(`holidays ${iso}: ${String(e?.message || e).slice(0, 80)}`); return []; }))))),
    guard('disasters (GDACS)', () => cached(`gdacs-${win.start}-${win.end}`, win.end >= today ? H6 : 0, () => getJson(fetchFn, `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=${win.start}&toDate=${win.end}&alertlevel=green;orange;red`, 30000))
      .then((j) => parseGdacs(j, { isos, siteIsos, win }))),
    guard('weather', () => Promise.all(siteIsos.map((iso) => {
      const [lat, lon, city] = COUNTRY_META[iso].capital;
      return cached(`weather-${iso}-${win.start}-${win.end}`, win.end >= today ? H6 : 0, () => getJson(fetchFn, `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,precipitation_sum,wind_gusts_10m_max&timezone=auto&start_date=${win.start}&end_date=${win.end}`))
        .then((j) => parseWeather(j, iso, city, win)).catch((e) => { errors.push(`weather ${iso}: ${String(e?.message || e).slice(0, 80)}`); return []; });
    }))),
  ]);
  const fx = fxSummary(fxSnaps || [], currencies, countryOf);
  if (currencies.length && !fx.dates.length) errors.push('exchange rates: no data');
  return { fx, events: [...fx.events, ...(holidays || []).flat(), ...(gdacs || []), ...(weather || []).flat()], errors };
}

// ─────────────── news via web search (one model call) ───────────────
const sch = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const NEWS_SCHEMA = obj({
  events: { type: 'array', items: obj({ date: sch, country: sch, category: { type: 'string', enum: CATEGORIES }, title: sch, description: sch, url: sch, sourceName: sch }) },
  note: sch,
});
export const NEWS_SYSTEM = `You build a factual timeline of outside events for a real-estate marketplace's traffic analysis. The dates are probably after your training data: do NOT answer from memory — every event must come from a web search result you actually got, with that result's URL.
Search in the local language (Spanish; Portuguese for Brazil) — e.g. "noticias economía Paraguay noviembre 2026", "crisis", "elecciones", "inundaciones", "paro", "dólar", "tasas", "crédito vivienda", "banco". Cover, per country: economy (currency, interest rates, banks, housing credit, prices), politics (elections, government crises, migration rules), social (strikes, protests, big festivals, viral stories about moving/living there), disaster_climate (floods, storms, heat, fires, earthquakes).
Rules: only events dated inside the window; date = the day it happened (YYYY-MM-DD); country = ISO-2 code from the list; description = 1–2 plain sentences with only the facts and numbers the source states (no guesses, no "affects N people" unless the source says so — then say exactly what N counts); title max 12 words; url = the article URL from the search results. Prefer events that could change how many people look for homes or property information (economy, moving abroad, housing). 4–12 events in total; fewer if that is all you can confirm. Put anything you could not confirm in note, not in events.`;

export function newsBrief({ countries, win, site }) {
  return `Website: ${site}. Window: ${win.start} to ${win.end}.\nCountries (ISO-2): ${countries.map((c) => `${c.iso} ${c.name} (${c.why})`).join('; ')}.\nFind the important economic, political, social and disaster/climate events in these countries in this window. Return JSON.`;
}

// callModel(params) → the Claude message (run.js's ask). → { events, dropped, note, searches, usage }
export async function searchNews({ countries, win, site, today, callModel, model, maxUses = 10 }) {
  const isos = countries.map((c) => c.iso);
  const key = `news-${isos.join('')}-${win.start}-${win.end}`;
  let ran = false;
  const value = await cached(key, win.end >= today ? 12 * 3600 * 1000 : 0, async () => {
    ran = true;
    const msg = await callModel({
      model, max_tokens: 16000, system: NEWS_SYSTEM, thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: NEWS_SCHEMA } },
      messages: [{ role: 'user', content: newsBrief({ countries, win, site }) }],
    });
    const searches = Number(msg.usage?.server_tool_use?.web_search_requests) || 0;
    if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') throw new Error(`news search stopped: ${msg.stop_reason}`);
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    let raw = {};
    try { raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { raw = { events: [], note: 'unreadable answer' }; }
    const { events, dropped } = cleanNewsEvents(raw, { win, isos, seenUrls: searchResultUrls(msg) });
    return { events, dropped, note: raw.note || '', searches, usage: msg.usage || {} };
  });
  return { ...value, fromCache: !ran };
}
