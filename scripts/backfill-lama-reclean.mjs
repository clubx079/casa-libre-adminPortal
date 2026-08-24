#!/usr/bin/env node
// Backfill: re-clean every NON-RE/MAX clean-*.webp image (the ones the old Sharp
// "stretched strip" fill turned into a grey box) using the LaMa inpainting
// service. Google Vision re-locates the mark on the original source image; LaMa
// paints it out properly; we overwrite the SAME B2 key in place (storage_url
// unchanged, so no DB write and no cache-key churn).
//
// RE/MAX images are handled separately by backfill-remax-clean.mjs (URL swap),
// so they're excluded here.
//
// Usage:
//   node scripts/backfill-lama-reclean.mjs             # dry run (counts only)
//   node scripts/backfill-lama-reclean.mjs --apply
//   node scripts/backfill-lama-reclean.mjs --apply --limit 15
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(ROOT, '..', '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i < 0) continue;
  let v = t.slice(i + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(t.slice(0, i).trim() in process.env)) process.env[t.slice(0, i).trim()] = v;
}
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 0; })();
const DB = process.env.AIROBASE_URL, KEY = process.env.AIROBASE_SECRET_KEY, VK = process.env.GOOGLE_VISION_API_KEY;
const LAMA = (process.env.LAMA_SERVICE_URL || 'https://lama-service.apps.airosofts.com').replace(/\/$/, '');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const s3 = new S3Client({ endpoint: process.env.B2_S3_ENDPOINT, region: process.env.B2_REGION, credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APP_KEY }, forcePathStyle: true });
const BUCKET = process.env.B2_BUCKET;
const V = 'https://vision.googleapis.com/v1/images:annotate';
const MAX_EDGE = 1280;
const toBox = (v) => { const xs = v.map((p) => p.x || 0), ys = v.map((p) => p.y || 0); return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }; };

// Vision LOGO+TEXT → padded pixel region on the WxH working image, or null.
async function detect(buf, w, h) {
  const r = await fetch(`${V}?key=${VK}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [{ image: { content: buf.toString('base64') }, features: [{ type: 'LOGO_DETECTION', maxResults: 5 }, { type: 'TEXT_DETECTION', maxResults: 1 }] }] }) }).catch(() => null);
  if (!r || !r.ok) return null;
  const r0 = (await r.json()).responses?.[0] || {}; const bx = [];
  for (const l of r0.logoAnnotations || []) if (l.boundingPoly?.vertices) bx.push(toBox(l.boundingPoly.vertices));
  const full = r0.textAnnotations?.[0]?.description || '';
  const hasPhone = /(\+?595|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/.test(full), hasUrl = /(www\.|https?:\/\/|\.(com|net|org|py|co)\b)/i.test(full), heavy = full.replace(/\s+/g, '').length > 40;
  let big = false; const fv = r0.textAnnotations?.[0]?.boundingPoly?.vertices;
  if (fv) { const b = toBox(fv); if ((b.right - b.left) >= 0.28 * w && (b.bottom - b.top) >= 0.07 * h) big = true; }
  if (hasPhone || hasUrl || heavy || big) for (const t of (r0.textAnnotations || []).slice(1)) if (t.boundingPoly?.vertices) bx.push(toBox(t.boundingPoly.vertices));
  if (!bx.length) return null;
  let L = Math.min(...bx.map((b) => b.left)), T = Math.min(...bx.map((b) => b.top)), R = Math.max(...bx.map((b) => b.right)), B = Math.max(...bx.map((b) => b.bottom));
  if (((R - L) * (B - T)) / (w * h) > 0.55) return null;   // covers most of the photo → likely misdetect, skip
  const px = w * 0.1, py = h * 0.1; L = Math.max(0, L - px); T = Math.max(0, T - py); R = R >= w * 0.85 ? w : Math.min(w, R + px); B = B >= h * 0.85 ? h : Math.min(h, B + py);
  return [Math.max(0, L / w), Math.max(0, T / h), Math.min(1, R / w), Math.min(1, B / h)];   // fractional box
}

async function lama(imageUrl, box) {
  try {
    const res = await fetch(`${LAMA}/clean`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: imageUrl, mask: 'bbox', boxes: [box] }), signal: AbortSignal.timeout(150000) });
    if (!res.ok) return null;
    const { clean_url } = await res.json().catch(() => ({})); if (!clean_url) return null;
    const img = await fetch(clean_url, { signal: AbortSignal.timeout(60000) }); if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  } catch { return null; }
}

// Fail fast if LaMa is down.
const hr = await fetch(`${LAMA}/health`).then((r) => r.ok ? r.json() : null).catch(() => null);
if (!hr?.ok) { console.error(`[lama] service not healthy at ${LAMA} — aborting`); process.exit(1); }
console.log(`[lama] service OK · storage host ${hr.storage?.host}`);

// Pull every non-gryphtech clean-*.webp row.
let rows = [];
for (let off = 0; ; off += 1000) {
  const r = await fetch(`${DB}/rest/v1/property_images?storage_key=like.%25clean-%25&source_url=not.like.%25gryphtech%25&select=id,property_id,source_url,storage_key,is_feature&limit=1000&offset=${off}`, { headers: H });
  const b = await r.json(); if (!Array.isArray(b) || !b.length) break; rows.push(...b); if (b.length < 1000) break;
}
console.log(`[lama] non-remax clean-* images to re-clean ${rows.length}`);
if (!APPLY) { console.log('[lama] DRY RUN — pass --apply. Sample:', rows.slice(0, 3).map((x) => x.source_url)); process.exit(0); }

const workRows = LIMIT ? rows.slice(0, LIMIT) : rows;
let done = 0, recleaned = 0, noregion = 0, lamafail = 0, errs = 0;
async function one(im) {
  try {
    const rawRes = await fetch(im.source_url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    if (!rawRes.ok) { errs++; return; }
    const raw = Buffer.from(await rawRes.arrayBuffer());
    const wk = await sharp(raw).rotate().resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const m = await sharp(wk).metadata();
    const box = await detect(wk, m.width, m.height);
    if (!box) { noregion++; return; }                       // nothing detectable → leave existing
    const cleaned = await lama(im.source_url, box);
    if (!cleaned) { lamafail++; return; }                   // LaMa failed → leave existing (no worse)
    const webp = await sharp(cleaned).rotate().resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: im.storage_key, Body: webp, ContentType: 'image/webp' }));  // overwrite in place
    recleaned++;
  } catch { errs++; }
  done++; if (done % 50 === 0) console.log(`[lama] ${done}/${workRows.length} · recleaned ${recleaned} · no-region ${noregion} · lama-fail ${lamafail} · errs ${errs}`);
}
const N = 3; let idx = 0;   // LaMa is a single model instance — keep concurrency low
await Promise.all(Array.from({ length: N }, async () => { while (idx < workRows.length) await one(workRows[idx++]); }));
console.log(`[lama] DONE — processed ${done} · recleaned ${recleaned} · no-region ${noregion} · lama-fail ${lamafail} · errors ${errs}`);
