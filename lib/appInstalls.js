// App installs (Admin → App installs) — pure parsing + merging of the two stores' reports.
// No fetching here: lib/storeReports.js downloads, this turns the files into daily rows.
//
//   Google Play  → monthly "overview" CSVs in the Play bulk-reports bucket
//                  (stats/installs/installs_<package>_<YYYYMM>_overview.csv, UTF-16).
//                  Columns used: Date, Daily Device Installs, Daily Device Uninstalls,
//                  Daily User Installs, Daily User Uninstalls, Active Device Installs.
//   App Store    → Analytics Reports "App Store Installation and Deletion" (daily, tab-
//                  separated): Date, Event (Install / Delete), Counts.

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

const iso = (t) => new Date(t).toISOString().slice(0, 10);
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
    iosDeletions: apple[d] ? apple[d].deletions : null,
  }));
  const sum = (k) => series.reduce((s, r) => s + (r[k] || 0), 0);
  const lastWith = (obj) => Object.keys(obj).sort().pop() || null;
  const activeDay = lastWith(play);
  return {
    series,
    total: {
      android: sum('android'), androidUninstalls: sum('androidUninstalls'),
      ios: sum('ios'), iosDeletions: sum('iosDeletions'),
      androidActive: activeDay ? play[activeDay].active : null,
    },
    latest: { play: lastWith(play), apple: lastWith(apple) },
  };
}
