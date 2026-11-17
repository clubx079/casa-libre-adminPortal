#!/usr/bin/env node
// Publish the scraped listings that are held back ONLY because they have no photo
// (Roland, Nov 17 2026). The website shows the "Todavía no tengo foto" placeholder for
// them. Rules in lib/noPhotoRelease.js: only-"no_images" Quarantine record, contact +
// location, in the country, and never the same property as a live listing.
//
//   node scripts/release-no-photo.mjs --country py            # DRY RUN: counts only, no writes
//   node scripts/release-no-photo.mjs --country py --apply    # writes (owner's decision!)
//   node scripts/release-no-photo.mjs --country sandbox --apply
//
// Reads AIROBASE_URL_<CC> + AIROBASE_SECRET_KEY_<CC> from .env.local
// (--country sandbox → SANDBOX_AIROBASE_URL + SANDBOX_AIROBASE_SECRET_KEY).
// --apply on a production country also needs --yes-production.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pickReleasable } from '../lib/noPhotoRelease.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const cc = String(arg('--country') || '').toLowerCase();
const APPLY = process.argv.includes('--apply');
if (!cc) { console.error('--country py|bo|uy|ve|sv|sandbox is required'); process.exit(1); }
const sandbox = cc === 'sandbox';
const BASE = String((sandbox ? process.env.SANDBOX_AIROBASE_URL : process.env[`AIROBASE_URL_${cc.toUpperCase()}`]) || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const KEY = sandbox ? process.env.SANDBOX_AIROBASE_SECRET_KEY : process.env[`AIROBASE_SECRET_KEY_${cc.toUpperCase()}`];
if (!BASE || !KEY) { console.error(`No DB url/key for ${cc}`); process.exit(1); }
if (APPLY && !sandbox && !process.argv.includes('--yes-production')) {
  console.error(`Refusing to write to the ${cc.toUpperCase()} production DB without --yes-production.`); process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function rest(q, opts = {}) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`REST ${r.status} ${q.slice(0, 120)} :: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}
async function all(table, q) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const part = await rest(`${table}?${q}&limit=1000&offset=${off}`);
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}
const inList = (vals) => vals.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',');

const records = await all('ingest_quarantine', 'select=id,source_id,external_id,reasons&status=eq.pending&reasons=cs.%7Bno_images%7D&order=created_at.asc');
const exts = [...new Set(records.map((r) => r.external_id).filter(Boolean))];
const properties = [];
for (let i = 0; i < exts.length; i += 100) {
  properties.push(...await rest(`properties?select=id,source_id,external_id,admin_status,is_delisted,feature_image_url,contact_phone,city,neighborhood,latitude,longitude,country,dedupe_key&external_id=in.(${encodeURIComponent(inList(exts.slice(i, i + 100)))})`));
}
const live = await all('properties', 'select=id,dedupe_key&admin_status=eq.active&is_delisted=eq.false&dedupe_key=not.is.null&order=id.asc');
const liveByKey = new Map(); for (const p of live) if (!liveByKey.has(p.dedupe_key)) liveByKey.set(p.dedupe_key, p.id);

const geoCc = sandbox ? 'py' : cc;   // the sandbox mirrors Paraguay
const { release, skipped } = pickReleasable({ records, properties, liveByKey, cc: geoCc });
console.log(JSON.stringify({ country: cc, mode: APPLY ? 'APPLY' : 'dry-run', no_images_records: records.length, releasable: release.length, skipped }, null, 1));
if (!APPLY) process.exit(0);

const ts = new Date().toISOString();
let done = 0;
for (const r of release) {
  await rest(`properties?id=eq.${r.property_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ admin_status: 'active', is_complete: true }) });
  if (r.record_id) await rest(`ingest_quarantine?id=eq.${r.record_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'released', reviewed_at: ts, reviewed_by: 'release-no-photo' }) });
  done++;
}
console.log(`released ${done}`);
