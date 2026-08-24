#!/usr/bin/env node
// Per-source watermark removal for marks Google Vision CANNOT detect (graphic
// logos like Habitamia's puzzle, semi-transparent "CENTURY 21" bands). These
// sources stamp the SAME logo in the SAME place on every photo, so we skip
// detection entirely and LaMa-inpaint a fixed per-source region on all of them.
//
// Writes to a NEW lama- key (busts the immutable CDN cache), repoints the row +
// feature_image_url, deletes the old object.
//
// Usage:
//   node scripts/wm-source-clean.mjs habitamia_py --sample 2        # 2 feature imgs, print URLs
//   node scripts/wm-source-clean.mjs habitamia_py --apply           # full source
//   node scripts/wm-source-clean.mjs century21_py --apply --box 0.05,0.42,0.95,0.66
//   node scripts/wm-source-clean.mjs habitamia_py --locate          # just auto-locate + print box
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(ROOT, '..', '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i < 0) continue;
  let v = t.slice(i + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(t.slice(0, i).trim() in process.env)) process.env[t.slice(0, i).trim()] = v;
}
const SOURCE = process.argv[2];
if (!SOURCE || SOURCE.startsWith('--')) { console.error('usage: wm-source-clean.mjs <source_prefix> [--apply|--sample N|--locate] [--box l,t,r,b]'); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const LOCATE_ONLY = process.argv.includes('--locate');
const SAMPLE = (() => { const i = process.argv.indexOf('--sample'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 0; })();
const BOX_OVERRIDE = (() => { const i = process.argv.indexOf('--box'); return i > 0 ? process.argv[i + 1].split(',').map(Number) : null; })();
const DB = process.env.AIROBASE_URL, KEY = process.env.AIROBASE_SECRET_KEY;
const LAMA = (process.env.LAMA_SERVICE_URL || 'https://lama-service.apps.airosofts.com').replace(/\/$/, '');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const s3 = new S3Client({ endpoint: process.env.B2_S3_ENDPOINT, region: process.env.B2_REGION, credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APP_KEY }, forcePathStyle: true });
const BUCKET = process.env.B2_BUCKET, UA = 'Mozilla/5.0', MAX_EDGE = 1280;
const mediaUrl = (k) => `/api/media/${k.split('/').map(encodeURIComponent).join('/')}`;
const SITE = 'https://casa-libre.com.py/propiedad/';

// Fixed watermark boxes [l,t,r,b] fractions, per source (calibrated from the mark).
const SRC_BOX = {
  habitamia_py:   [0.34, 0.38, 0.66, 0.74],   // puzzle logo + text, center
  century21_py:   [0.05, 0.42, 0.95, 0.66],   // "CENTURY 21" wide center band
  c21platinum_py: [0.05, 0.42, 0.95, 0.66],
};

// Auto-locate the fixed watermark by averaging many photos: real content averages
// to flat gray, the constant overlay stays visible → find where the mean image
// deviates most from its global average, in a central region (ignore edge gradients).
async function autoLocate(urls) {
  const W = 320, Hh = 320; const acc = new Float64Array(W * Hh); let n = 0;
  for (const u of urls) {
    try { const buf = Buffer.from(await (await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })).arrayBuffer());
      const raw = await sharp(buf).resize(W, Hh, { fit: 'fill' }).grayscale().raw().toBuffer();
      for (let i = 0; i < W * Hh; i++) acc[i] += raw[i]; n++; } catch { /* skip */ }
    if (n >= 40) break;
  }
  if (n < 8) return null;
  for (let i = 0; i < W * Hh; i++) acc[i] /= n;
  let gm = 0; for (let i = 0; i < W * Hh; i++) gm += acc[i]; gm /= W * Hh;
  let dmax = 0; const dev = new Float64Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) { dev[i] = Math.abs(acc[i] - gm); if (dev[i] > dmax) dmax = dev[i]; }
  const thr = 0.45 * dmax; let l = W, t = Hh, r = 0, b = 0, cnt = 0;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    if (y < Hh * 0.12 || y > Hh * 0.88) continue;   // ignore top/bottom brightness gradients
    if (dev[y * W + x] > thr) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; cnt++; }
  }
  if (cnt < 30) return null;
  const px = W * 0.03, py = Hh * 0.03;
  return [Math.max(0, (l - px) / W), Math.max(0, (t - py) / Hh), Math.min(1, (r + px) / W), Math.min(1, (b + py) / Hh)].map((v) => +v.toFixed(3));
}

async function lama(imageUrl, box) {
  try {
    const res = await fetch(`${LAMA}/clean`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: imageUrl, mask: 'bbox', boxes: [box] }), signal: AbortSignal.timeout(200000) });
    if (!res.ok) return null;
    const { clean_url } = await res.json().catch(() => ({})); if (!clean_url) return null;
    const img = await fetch(clean_url, { signal: AbortSignal.timeout(60000) }); if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  } catch { return null; }
}

const hr = await fetch(`${LAMA}/health`).then((r) => r.ok ? r.json() : null).catch(() => null);
if (!hr?.ok) { console.error(`[wm] LaMa not healthy at ${LAMA}`); process.exit(1); }

// Pull as-is images for the source (not already clean-/lama-'d).
let rows = [];
for (let off = 0; ; off += 1000) {
  const q = `storage_key=like.${SOURCE}/%25&storage_key=not.like.%25clean-%25&storage_key=not.like.%25lama-%25&select=id,property_id,source_url,storage_key,is_feature&limit=1000&offset=${off}`;
  const r = await fetch(`${DB}/rest/v1/property_images?${q}`, { headers: H }); const b = await r.json();
  if (!Array.isArray(b) || !b.length) break; rows.push(...b); if (b.length < 1000) break;
}
console.log(`[wm] ${SOURCE}: ${rows.length} as-is images`);

const box = BOX_OVERRIDE || SRC_BOX[SOURCE];
if (LOCATE_ONLY) {
  const auto = await autoLocate(rows.map((r) => r.source_url));
  console.log(`[wm] configured box: ${box ? box.join(',') : '(none)'}`);
  console.log(`[wm] auto-located box: ${auto ? auto.join(',') : '(failed)'}`);
  process.exit(0);
}
if (!box) { console.error(`[wm] no box configured for ${SOURCE} — pass --box l,t,r,b`); process.exit(1); }
console.log(`[wm] using box ${box.join(',')}`);

// Sample mode: pick N distinct listings' feature images so each is a viewable page.
let workRows;
if (SAMPLE) { const feats = rows.filter((r) => r.is_feature); workRows = (feats.length ? feats : rows).slice(0, SAMPLE); }
else if (!APPLY) { console.log('[wm] DRY — pass --apply or --sample N. Sample sources:', rows.slice(0, 2).map((r) => r.source_url)); process.exit(0); }
else workRows = rows;

let done = 0, ok = 0, fail = 0;
async function one(im) {
  try {
    const cleaned = await lama(im.source_url, box);
    if (!cleaned) { fail++; return; }
    const webp = await sharp(cleaned).rotate().resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    const dir = im.storage_key.includes('/') ? im.storage_key.split('/').slice(0, -1).join('/') : '';
    const fname = 'lama-' + im.storage_key.split('/').pop().replace(/\.[^.]+$/, '') + '.webp';
    const newKey = dir ? `${dir}/${fname}` : fname;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: newKey, Body: webp, ContentType: 'image/webp' }));
    const url = mediaUrl(newKey);
    const pr = await fetch(`${DB}/rest/v1/property_images?id=eq.${im.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ storage_key: newKey, storage_url: url, content_type: 'image/webp', bytes: String(webp.length) }) });
    if (!pr.ok) { fail++; return; }
    if (im.is_feature) await fetch(`${DB}/rest/v1/properties?id=eq.${im.property_id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ feature_image_url: url }) });
    if (newKey !== im.storage_key) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: im.storage_key })).catch(() => {});
    ok++;
    if (SAMPLE) console.log(`  cleaned ${SITE}${im.property_id}`);
  } catch { fail++; }
  done++; if (!SAMPLE && done % 50 === 0) console.log(`[wm] ${SOURCE} ${done}/${workRows.length} · ok ${ok} · fail ${fail}`);
}
const N = 2; let idx = 0;   // CPU LaMa ~112s/call; contention past ~2 concurrent times out
await Promise.all(Array.from({ length: N }, async () => { while (idx < workRows.length) await one(workRows[idx++]); }));
console.log(`[wm] ${SOURCE} DONE — ok ${ok} · fail ${fail}`);
