#!/usr/bin/env node
// Standalone CLI: re-evaluate quarantined ingest records against the NOW-fixed
// adapters and PROMOTE the ones that are valid again into `properties`, clearing
// them from the quarantine queue.
//
// Two fixes are applied to each held payload before re-validating:
//   1. no_contact  -> resolve the agent phone the adapters now capture
//                     (Sotheby's telf:, tulugar SSR JSON-LD, remax agent-search,
//                     inmob123 raw_data/detail).
//   2. remax listing_type inversion -> TransactionTypeUID 260=rent, 261=sale
//                     (fixes sale_price_as_rent + price_below_floor mislabels).
//
// A payload already carries AI property_type + normalized zone + dedupe_key
// (those run BEFORE quarantine), so promotion only lacks images — which the next
// scrape backfills, and which the buyer gate does not require.
//
//   node scripts/rescue-quarantine.mjs --dry-run
//   node scripts/rescue-quarantine.mjs --source remax_py
//   node scripts/rescue-quarantine.mjs
//
// Needs AIROBASE_URL + AIROBASE_SECRET_KEY (loaded from .env.local).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractContact, normalizePyPhone } from '../lib/contactPhone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvLocal();
const BASE = process.env.AIROBASE_URL, KEY = process.env.AIROBASE_SECRET_KEY;
if (!BASE || !KEY) { console.error('AIROBASE_URL / AIROBASE_SECRET_KEY missing'); process.exit(1); }

const DRY = process.argv.includes('--dry-run');
const SRC_ARG = (() => { const i = process.argv.indexOf('--source'); return i > -1 ? process.argv[i + 1] : null; })();
const LIMIT_ARG = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : null; })();

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(pathq, opts = {}) {
  const res = await fetch(`${BASE}/rest/v1/${pathq}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`REST ${res.status} ${pathq} :: ${(await res.text()).slice(0, 160)}`);
  return res;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchHtml(url, tries = 3) {
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(22000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (e) { if (a === tries - 1) throw e; await sleep(1500 * (a + 1)); }
  }
}

// ── mirror of lib/money.dualPrice + lib/ingest.validateListing ──────────────
const roundConverted = (n) => (n == null ? n : Number(n));
function dualPrice(price, currency, rate) {
  if (price == null || !rate) return { usd: null, pyg: null };
  const p = Number(price); if (!Number.isFinite(p)) return { usd: null, pyg: null };
  const cur = String(currency || '').toUpperCase();
  if (cur === 'PYG') return { usd: roundConverted(Math.round(p / rate)), pyg: Math.round(p) };
  return { usd: Math.round(p), pyg: roundConverted(Math.round(p * rate)) };
}
const LAND_RE = /terreno|campo|loteamiento|lote|chacra|estancia|fracc/i;
const isLandType = (t) => LAND_RE.test(String(t || ''));
function validateListing(row, rate) {
  const reasons = [];
  const digits = String(row.contact_phone || '').replace(/\D/g, '');
  if (digits.length < 6) reasons.push('no_contact');
  if (!row.city && !row.neighborhood) reasons.push('no_location');
  const { usd, pyg } = dualPrice(row.price, row.currency, rate || 7300);
  const rent = row.listing_type === 'rent';
  if (rent) {
    if (!(Number(pyg) > 0)) reasons.push('no_price');
    else if (Number(pyg) < 300000) reasons.push('price_below_floor');
    if (usd != null && Number(usd) > 15000) reasons.push('sale_price_as_rent');
  } else {
    if (!(Number(usd) > 0)) reasons.push('no_price');
    else if (Number(usd) < 5000) reasons.push('price_below_floor');
  }
  const overCap = (v, max) => v != null && (Number(v) < 0 || Number(v) > max);
  if (overCap(row.bedrooms, 10)) reasons.push('beds_over_cap');
  if (overCap(row.bathrooms, 10)) reasons.push('baths_over_cap');
  if (overCap(row.parking_spaces, 10)) reasons.push('parking_over_cap');
  const builtArea = row.covered_area != null ? Number(row.covered_area) : (row.floor_area != null ? Number(row.floor_area) : null);
  if (!isLandType(row.property_type) && builtArea != null && (builtArea < 5 || builtArea > 2000)) reasons.push('area_out_of_range');
  return { ok: reasons.length === 0, reasons };
}

// ── per-adapter phone resolvers ─────────────────────────────────────────────
async function resolvePhone(adapter, payload, cfg) {
  const rd = payload.raw_data || {};
  if (adapter === 'inmob123_html') {
    const phone = normalizePyPhone(rd.contactPhone);
    if (phone) return { phone, name: rd.contactName || null };
    if (payload.external_url) { const c = extractContact(await fetchHtml(payload.external_url)); if (c?.phone) return c; }
    return null;
  }
  if (adapter === 'raices_html') {
    if (!payload.external_url) return null;
    const main = (await fetchHtml(payload.external_url)).split('search_result_box')[0];
    const section = (main.match(/property_contact[\s\S]*/) || [main])[0];
    const name = (section.match(/mediumTitle">\s*([^<]+?)\s*<\/h4>/i) || [])[1];
    const c = extractContact(section);
    return c?.phone ? { phone: c.phone, name: (name && name.replace(/\s+/g, ' ').trim()) || c.name || null } : null;
  }
  if (adapter === 'tulugar_api') {
    return payload.external_url ? extractContact(await fetchHtml(payload.external_url)) : null;
  }
  if (adapter === 'remax_gryphtech') {
    const agentId = rd.AgentId; if (!agentId || !cfg?.search_url) return null;
    const agentUrl = String(cfg.search_url).replace('listing-search', 'agent-search');
    const res = await fetch(agentUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://www.remax.com.py', 'User-Agent': UA }, body: JSON.stringify({ count: true, top: 1, searchMode: 'all', queryType: 'simple', search: String(agentId), filter: `content/TenantId eq ${cfg.tenantid}` }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const c = (await res.json()).value?.[0]?.content; if (!c) return null;
    const phone = normalizePyPhone(c.WhatsApp || c.AgentPhone || c.AgentDirectDialPhone || c.OfficePhone);
    const name = c.AgentName || [c.FirstName, c.LastName].filter(Boolean).join(' ') || c.OfficeName || null;
    return phone ? { phone, name: name || null } : null;
  }
  return null;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

async function getRate() {
  try { const r = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10000) })).json(); return r?.rates?.PYG || 7300; } catch { return 7300; }
}

async function main() {
  const rate = await getRate();
  console.log(`FX USD->PYG = ${rate}${DRY ? '  (dry-run)' : ''}`);
  let q = `ingest_quarantine?select=id,source_id,external_id,reasons,payload,dedupe_key,scrape_sources(key,adapter,config)&status=eq.pending&order=id`;
  if (SRC_ARG) q += `&scrape_sources.key=eq.${SRC_ARG}`;
  if (LIMIT_ARG) q += `&limit=${LIMIT_ARG}`;
  const rows = (await (await rest(q)).json()).filter((r) => r.scrape_sources); // only known sources
  console.log(`loaded ${rows.length} pending quarantine rows`);

  const stat = { rescued: 0, still_bad: 0, dup: 0, errs: 0 };
  const stillReasons = {};
  await pool(rows, 5, async (row) => {
    try {
      const adapter = row.scrape_sources.adapter;
      const cfg = row.scrape_sources.config || {};
      const p = { ...row.payload };

      // fix 1: remax listing_type inversion
      if (adapter === 'remax_gryphtech') {
        const uid = Number((p.raw_data || {}).TransactionTypeUID);
        if (uid === 260 || uid === 261) {
          p.listing_type = uid === 260 ? 'rent' : 'sale';
          p.price_period = p.listing_type === 'rent' ? 'month' : null;
        }
      }
      // fix 2: phone
      const digits = String(p.contact_phone || '').replace(/\D/g, '');
      if (digits.length < 6) {
        const c = await resolvePhone(adapter, p, cfg);
        if (c?.phone) { p.contact_phone = c.phone; if (c.name && !p.contact_name) p.contact_name = c.name; }
      }

      const v = validateListing(p, rate);
      if (!v.ok) { stat.still_bad++; for (const r of v.reasons) stillReasons[r] = (stillReasons[r] || 0) + 1; return; }

      // dedup: don't promote a collision with an already-active listing
      if (p.dedupe_key) {
        const dups = await (await rest(`properties?select=id,external_id&dedupe_key=eq.${encodeURIComponent(p.dedupe_key)}&admin_status=eq.active&is_delisted=eq.false&limit=1`)).json();
        if (dups.length && dups[0].external_id !== row.external_id) { stat.dup++; return; }
      }

      if (!DRY) {
        const ts = new Date().toISOString();
        await rest('properties', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify([{ ...p, source_hash: null, first_scraped_at: ts, last_scraped_at: ts, last_seen_at: ts, is_delisted: false }]) });
        await rest(`ingest_quarantine?id=eq.${row.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      }
      stat.rescued++;
      if (stat.rescued % 25 === 0) console.log(`  rescued ${stat.rescued} · still_bad ${stat.still_bad} · dup ${stat.dup} · errs ${stat.errs}`);
    } catch { stat.errs++; }
  });

  console.log(`\n== DONE ${DRY ? '(dry-run) ' : ''}rescued ${stat.rescued} · still_bad ${stat.still_bad} · dup ${stat.dup} · errs ${stat.errs} ==`);
  console.log('remaining reasons on still-bad:', stillReasons);
}
main().catch((e) => { console.error(e); process.exit(1); });
