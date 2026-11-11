// App installs (Admin → App installs) — pure parsing + merging of the two stores' reports.
// No fetching here: lib/storeReports.js downloads, this turns the files into daily rows.
//
//   Google Play  → monthly "overview" CSVs in the Play bulk-reports bucket
//                  (stats/installs/installs_<package>_<YYYYMM>_overview.csv, UTF-16).
//                  Columns used: Date, Daily Device Installs, Daily Device Uninstalls,
//                  Daily User Installs, Daily User Uninstalls, Active Device Installs.
//   App Store    → Analytics Reports (daily, tab-separated, gzip):
//                  • "App Downloads Standard" (Commerce) — EVERY download: Date, Download Type
//                    (First-time download / Redownload / Manual update / Auto-update / Restore),
//                    Territory, Counts. Downloads = first-time + redownloads.
//                  • "App Store Installation and Deletion Standard" (App usage) — Event
//                    (Install / Delete), Counts. Only users who agreed to share analytics with
//                    developers, so it stays empty for a small app: used for deletions only.
//                    (Until Nov 2026 the downloads came from this report → iPhone showed 0.)
//                  Apple's daily instances overlap: each one repeats the day before, so a date
//                  is in two instances — the newest one counts (appleFromInstances).

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Minimal CSV/TSV parser (quoted fields, commas or tabs, CRLF).
export function parseDelimited(text, sep = ',') {
  const rows = []; let row = [], cell = '', q = false;
  const t = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.length > 1 || r[0]);
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

// Play CSVs are UTF-16LE with a BOM.
export function decodePlayCsv(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return b.slice(2).toString('utf16le');
  if (b.length > 1 && b[1] === 0x00) return b.toString('utf16le');
  return b.toString('utf8');
}

// Play overview rows → { 'YYYY-MM-DD': { installs, uninstalls, userInstalls, userUninstalls, active } }
export function playDaily(rows = []) {
  const out = {};
  for (const r of rows) {
    const d = String(r.Date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    out[d] = {
      installs: num(r['Daily Device Installs']),
      uninstalls: num(r['Daily Device Uninstalls']),
      userInstalls: num(r['Daily User Installs']),
      userUninstalls: num(r['Daily User Uninstalls']),
      active: num(r['Active Device Installs']),
    };
  }
  return out;
}

// App Store "Installation and Deletion" rows → { date: { installs, deletions } }
export function appleDaily(rows = []) {
  const out = {};
  for (const r of rows) {
    const d = String(r.Date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const ev = String(r.Event || '').toLowerCase();
    const n = num(r.Counts ?? r.Count ?? r['Unique Devices']);
    const cur = out[d] || (out[d] = { installs: 0, deletions: 0 });
    if (ev.startsWith('install')) cur.installs += n;
    else if (ev.startsWith('delet')) cur.deletions += n;
  }
  return out;
}

// App Store "App Downloads" rows → { date: { firstTime, redownloads, territories: { PY: n } } }.
// Updates and restores are not downloads (Apple's "Total downloads" = first-time + redownloads).
export function appleDownloadsDaily(rows = []) {
  const out = {};
  for (const r of rows) {
    const d = String(r.Date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const type = String(r['Download Type'] || '').toLowerCase();
    const first = type.startsWith('first');
    if (!first && !type.includes('redownload')) continue;
    const n = num(r.Counts ?? r.Count);
    const cur = out[d] || (out[d] = { firstTime: 0, redownloads: 0, territories: {} });
    if (first) cur.firstTime += n; else cur.redownloads += n;
    const t = String(r.Territory || '').trim().toUpperCase() || '??';
    cur.territories[t] = (cur.territories[t] || 0) + n;
  }
  return out;
}

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const dayBefore = (d) => iso(Date.parse(`${d}T00:00:00Z`) - 86400000);

// One report's daily instances [{ processingDate, daily: { date: entry } }] → { date: entry }.
// Instances overlap (each repeats the day before): per date the newest instance wins. The
// day before an instance's processing date is always in it, so with no row for it that
// day had nothing (0 = `empty`), not "no report".
export function latestPerDate(instances = [], empty = null) {
  const out = {};
  const sorted = [...instances].filter((i) => /^\d{4}-\d{2}-\d{2}/.test(i?.processingDate || '')).sort((a, b) => a.processingDate.localeCompare(b.processingDate));
  for (const { processingDate, daily = {} } of sorted) {
    for (const [d, v] of Object.entries(daily)) out[d] = v;
    const covered = dayBefore(processingDate.slice(0, 10));
    if (empty && !(covered in out)) out[covered] = empty();
  }
  return out;
}

// Both App Store reports → { date: { installs, firstTime, redownloads, deletions, territories } }.
// downloads / usage = instances [{ processingDate, rows }] of the App Downloads and the
// Installation and Deletion reports. deletions = null when Apple has no number for that day.
export function appleFromInstances({ downloads = [], usage = [] } = {}) {
  const dl = latestPerDate(downloads.map((i) => ({ processingDate: i.processingDate, daily: appleDownloadsDaily(i.rows) })),
    () => ({ firstTime: 0, redownloads: 0, territories: {} }));
  const del = latestPerDate(usage.map((i) => ({ processingDate: i.processingDate, daily: appleDaily(i.rows) })));
  const out = {};
  for (const [d, v] of Object.entries(dl)) {
    out[d] = { installs: v.firstTime + v.redownloads, firstTime: v.firstTime, redownloads: v.redownloads, deletions: del[d] ? del[d].deletions : null, territories: v.territories };
  }
  return out;
}

// { PY: 8, BR: 3 } → [{ code, name, n }], most downloads first (names in English).
export function territoryList(byTerritory = {}) {
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* old runtime: codes */ }
  const name = (c) => { try { return (names && /^[A-Z]{2}$/.test(c) && names.of(c)) || c; } catch { return c; } };
  return Object.entries(byTerritory).filter(([, n]) => n > 0)
    .map(([code, n]) => ({ code, name: name(code), n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

export function lastDays(days = 30, now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) => iso(end - (days - 1 - i) * 86400000));
}

// Both stores → one table for the page (a day with no report = null, not 0).
export function mergeInstalls({ play = {}, apple = {}, days = 30, now = new Date() }) {
  const dates = lastDays(days, now);
  const series = dates.map((d) => ({
    key: d,
    android: play[d] ? play[d].installs : null,
    androidUninstalls: play[d] ? play[d].uninstalls : null,
    ios: apple[d] ? apple[d].installs : null,
    // Apple reports deletions only for users who share analytics → often no number at all
    iosDeletions: apple[d] && apple[d].deletions != null ? apple[d].deletions : null,
  }));
  const sum = (k) => series.reduce((s, r) => s + (r[k] || 0), 0);
  const lastWith = (obj) => Object.keys(obj).sort().pop() || null;
  const activeDay = lastWith(play);
  // iPhone downloads per App Store country (ISO code) in the period
  const iosByTerritory = {};
  for (const d of dates) for (const [t, n] of Object.entries(apple[d]?.territories || {})) iosByTerritory[t] = (iosByTerritory[t] || 0) + n;
  return {
    series,
    total: {
      android: sum('android'), androidUninstalls: sum('androidUninstalls'),
      ios: sum('ios'), iosDeletions: series.some((r) => r.iosDeletions != null) ? sum('iosDeletions') : null,
      iosByTerritory,
      androidActive: activeDay ? play[activeDay].active : null,
    },
    latest: { play: lastWith(play), apple: lastWith(apple) },
  };
}
