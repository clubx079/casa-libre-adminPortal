#!/usr/bin/env node
// STAGED TEST ONLY — stamps the Casa Libre mascot+wordmark onto ONE property's
// images so a human can eyeball the look before this is wired into ingest or
// backfilled across the catalog. Does NOT touch any other property.
//
// Reversible: the original object is left in the bucket (never deleted) and
// `source_url` (the true external origin) is never modified, so a row can be
// restored either by re-PATCHing storage_key/storage_url/content_type back to
// the "before" values this script prints, or by re-mirroring from source_url
// the way scripts/wm-restore-origin.mjs does.
//
// Usage:
//   node scripts/wm-brand-test.mjs <propertyId>
//   node scripts/wm-brand-test.mjs <propertyId> --opacity 0.22 --scale 0.30
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { stampWatermark } from '../lib/watermark.js';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(ROOT, '..', '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i < 0) continue;
  let v = t.slice(i + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(t.slice(0, i).trim() in process.env)) process.env[t.slice(0, i).trim()] = v;
}

const PROPERTY_ID = process.argv[2];
if (!PROPERTY_ID || PROPERTY_ID.startsWith('--')) {
  console.error('usage: wm-brand-test.mjs <propertyId> [--opacity 0.22] [--scale 0.30]');
  process.exit(1);
}
const OPACITY = (() => { const i = process.argv.indexOf('--opacity'); return i > 0 ? parseFloat(process.argv[i + 1]) : 0.22; })();
const SCALE = (() => { const i = process.argv.indexOf('--scale'); return i > 0 ? parseFloat(process.argv[i + 1]) : 0.30; })();

const DB = process.env.AIROBASE_URL, KEY = process.env.AIROBASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const s3 = new S3Client({ endpoint: process.env.B2_S3_ENDPOINT, region: process.env.B2_REGION, credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APP_KEY }, forcePathStyle: true });
const BUCKET = process.env.B2_BUCKET;
const mediaUrl = (k) => `/api/media/${k.split('/').map(encodeURIComponent).join('/')}`;
const publicUrl = (k) => `${process.env.B2_PUBLIC_HOST}/file/${BUCKET}/${encodeURI(k)}`;
// Mirrors lib/b2.js storageUrl(): private bucket -> proxy path, public bucket -> direct URL.
const storageUrlFor = (k) => (process.env.B2_PUBLIC_READS === 'true' ? publicUrl(k) : mediaUrl(k));
const SITE = 'https://casa-libre.com.py/propiedad/';

function wmKeyFor(storageKey) {
  const m = storageKey.match(/^(.*)(\.[^./]+)$/);
  return m ? `${m[1]}-wm${m[2]}` : `${storageKey}-wm`;
}

// Read the current object straight out of the bucket by its storage_key —
// storage_url is a relative /api/media/... proxy path (private bucket, no
// APP_PUBLIC_URL configured), so it isn't directly fetchable from a
// standalone script without a running Next server.
async function getObjectBytes(key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const q = `property_id=eq.${PROPERTY_ID}&select=id,property_id,source_url,storage_key,storage_url,content_type,is_feature,position&order=position.asc`;
const res = await fetch(`${DB}/rest/v1/property_images?${q}`, { headers: H });
if (!res.ok) { console.error(`[wm-brand-test] property_images query failed: ${res.status} ${await res.text().catch(() => '')}`); process.exit(1); }
const rows = await res.json();
if (!Array.isArray(rows) || !rows.length) { console.error(`[wm-brand-test] no property_images rows for property_id=${PROPERTY_ID}`); process.exit(1); }

console.log(`[wm-brand-test] property ${PROPERTY_ID}: ${rows.length} image row(s) · opacity=${OPACITY} scale=${SCALE}`);
console.log(`[wm-brand-test] detail page: ${SITE}${PROPERTY_ID}`);

const report = [];
for (const im of rows) {
  if (/-wm\.[^./]+$/.test(im.storage_key)) {
    console.log(`  [skip] id=${im.id} already stamped (${im.storage_key})`);
    continue;
  }
  try {
    const bytes = await getObjectBytes(im.storage_key);
    const stamped = await stampWatermark(bytes, { opacity: OPACITY, scale: SCALE });
    const newKey = wmKeyFor(im.storage_key);
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: newKey, Body: stamped, ContentType: 'image/webp' }));
    const newUrl = storageUrlFor(newKey);

    const patch = { storage_key: newKey, storage_url: newUrl, content_type: 'image/webp' };
    const pr = await fetch(`${DB}/rest/v1/property_images?id=eq.${im.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    if (!pr.ok) throw new Error(`row patch failed: ${pr.status} ${await pr.text().catch(() => '')}`);

    report.push({ id: im.id, is_feature: im.is_feature, before_key: im.storage_key, before_url: im.storage_url, after_key: newKey, after_url: newUrl });
    console.log(`  [ok]   id=${im.id}${im.is_feature ? ' (feature)' : ''}`);
  } catch (err) {
    console.log(`  [fail] id=${im.id}: ${err.message || err}`);
  }
}

console.log('\n[wm-brand-test] before -> after (original object left in bucket, source_url untouched):');
for (const r of report) {
  console.log(`  id=${r.id}${r.is_feature ? ' *feature*' : ''}`);
  console.log(`    before: ${r.before_url}  (key: ${r.before_key})`);
  console.log(`    after:  ${r.after_url}  (key: ${r.after_key})`);
}
console.log(`\n[wm-brand-test] review at: ${SITE}${PROPERTY_ID}`);
console.log('[wm-brand-test] to revert a row: PATCH property_images set storage_key/storage_url/content_type back to the "before" values above (the original object is still in the bucket, untouched).');
