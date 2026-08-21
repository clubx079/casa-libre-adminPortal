#!/usr/bin/env node
// Re-fetch + re-parse EVERY quarantined Habitamia record and promote the valid
// ones to `properties` (active), with images, clearing them from quarantine.
//
// Why needed: during the initial Habitamia seed the scrape was crunched against
// the serverless 300s limit and Wasi rate-limited it, so many detail-page
// fetches failed → the adapter emitted a data-less fallback record → those got
// wrongly quarantined as no_price / no_contact even though the page clearly has
// both. The fetch-retry added to the adapter stops this recurring; this script
// cleans up the records already stuck in quarantine.
//
//   node --loader ./scripts/_esm-resolver.mjs scripts/rescue-habitamia.mjs --dry-run
//   node --loader ./scripts/_esm-resolver.mjs scripts/rescue-habitamia.mjs
//
// Needs AIROBASE_URL + AIROBASE_SECRET_KEY (from .env.local).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import habitamia, { parseDetail } from '../lib/adapters/habitamia.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvLocal();
const BASE = process.env.AIROBASE_URL, KEY = process.env.AIROBASE_SECRET_KEY;
if (!BASE || !KEY) { console.error('AIROBASE_URL / AIROBASE_SECRET_KEY missing'); process.exit(1); }
const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : null; })();

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(pathq, opts = {}) {
  const res = await fetch(`${BASE}/rest/v1/${pathq}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`REST ${res.status} ${pathq} :: ${(await res.text()).slice(0, 180)}`);
  return res;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchHtml(url, tries = 3) {
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (res.status === 429 || res.status >= 500 || !res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (e) { if (a === tries - 1) throw e; await sleep(1300 * (a + 1)); }
  }
}

// mirror of lib/money.dualPrice + lib/ingest.validateListing (rate-consistent)
function dualPrice(price, currency, rate) {
  if (price == null || !rate) return { usd: null, pyg: null };
  const p = Number(price); if (!Number.isFinite(p)) return { usd: null, pyg: null };
  if (String(currency || '').toUpperCase() === 'PYG') return { usd: Math.round(p / rate), pyg: Math.round(p) };
  return { usd: Math.round(p), pyg: Math.round(p * rate) };
}
const isLandType = (t) => /terreno|campo|loteamiento|lote|chacra|estancia|fracc/i.test(String(t || ''));
function validateListing(row, rate) {
  const reasons = [];
  if (String(row.contact_phone || '').replace(/\D/g, '').length < 6) reasons.push('no_contact');
  if (!row.city && !row.neighborhood) reasons.push('no_location');
  const { usd, pyg } = dualPrice(row.price, row.currency, rate || 7300);
  if (row.listing_type === 'rent') {
    if (!(Number(pyg) > 0)) reasons.push('no_price');
    else if (Number(pyg) < 300000) reasons.push('price_below_floor');
    if (usd != null && Number(usd) > 15000) reasons.push('sale_price_as_rent');
  } else {
    if (!(Number(usd) > 0)) reasons.push('no_price');
    else if (Number(usd) < 5000) reasons.push('price_below_floor');
  }
  const cap = (v, m) => v != null && (Number(v) < 0 || Number(v) > m);
  if (cap(row.bedrooms, 10)) reasons.push('beds_over_cap');
  if (cap(row.bathrooms, 10)) reasons.push('baths_over_cap');
  if (cap(row.parking_spaces, 10)) reasons.push('parking_over_cap');
  const ba = row.covered_area != null ? Number(row.covered_area) : (row.floor_area != null ? Number(row.floor_area) : null);
  if (!isLandType(row.property_type) && ba != null && (ba < 5 || ba > 2000)) reasons.push('area_out_of_range');
  return { ok: reasons.length === 0, reasons };
}
async function getRate() {
  try { return (await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10000) })).json())?.rates?.PYG || 7300; } catch { return 7300; }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  }));
}

async function main() {
  const [src] = await (await rest('scrape_sources?select=id,config&key=eq.habitamia_py')).json();
  if (!src) { console.error('habitamia_py source not found'); process.exit(1); }
  const config = src.config || { base_url: 'https://habitamia.com', sitemap: 'https://habitamia.com/sitemap.xml' };
  const rate = await getRate();
  console.log(`FX USD->PYG = ${rate}${DRY ? '  (dry-run)' : ''}`);

  let q = `ingest_quarantine?select=id,external_id,payload&source_id=eq.${src.id}&status=eq.pending&order=id`;
  if (LIMIT) q += `&limit=${LIMIT}`;
  const rows = await (await rest(q)).json();
  console.log(`loaded ${rows.length} pending Habitamia quarantine records`);

  const stat = { rescued: 0, still_bad: 0, errs: 0 };
  const stillReasons = {};
  await pool(rows, 4, async (qr) => {
    try {
      const p = qr.payload || {};
      const slug = (p.raw_data && p.raw_data.slug) || (p.external_url ? p.external_url.split('/').slice(-2)[0] : null);
      const url = p.external_url || `${config.base_url}/${slug}/${qr.external_id}`;
      const html = await fetchHtml(url);
      const detail = parseDetail(html);
      const it = { id: qr.external_id, url, slug, ...detail };
      const { row, images } = habitamia.mapListing(it, { source: { id: src.id }, config, pygPerUsd: rate });

      const v = validateListing(row, rate);
      if (!v.ok) { stat.still_bad++; for (const r of v.reasons) stillReasons[r] = (stillReasons[r] || 0) + 1; return; }

      if (!DRY) {
        const ts = new Date().toISOString();
        // Upsert the property (on the source_id+external_id unique constraint).
        const [prop] = await (await rest('properties?on_conflict=source_id,external_id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' },
          body: JSON.stringify([{ ...row, source_hash: null, first_scraped_at: ts, last_scraped_at: ts, last_seen_at: ts, is_delisted: false }]),
        })).json();
        const pid = prop && prop.id;
        // Images: serve directly from Wasi's CDN (storage_url = source url); a later
        // full scrape mirrors + screens them. Buyer renders storage_url as-is.
        if (pid && images.length) {
          const imgRows = images.map((im) => ({
            property_id: pid, source_url: im.source_url, storage_url: im.source_url,
            is_feature: im.is_feature, position: im.position, content_type: 'image/jpeg',
          }));
          await rest('property_images?on_conflict=property_id,source_url', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=merge-duplicates' },
            body: JSON.stringify(imgRows),
          }).catch(() => {});
          await rest(`properties?id=eq.${pid}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ feature_image_url: images[0].source_url }),
          }).catch(() => {});
        }
        await rest(`ingest_quarantine?id=eq.${qr.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      }
      stat.rescued++;
      if (stat.rescued % 20 === 0) console.log(`  rescued ${stat.rescued} · still_bad ${stat.still_bad} · errs ${stat.errs}`);
    } catch { stat.errs++; }
  });

  console.log(`\n== DONE ${DRY ? '(dry-run) ' : ''}rescued ${stat.rescued} · still_bad ${stat.still_bad} · errs ${stat.errs} ==`);
  console.log('remaining reasons on still-bad:', stillReasons);
}
main().catch((e) => { console.error(e); process.exit(1); });
