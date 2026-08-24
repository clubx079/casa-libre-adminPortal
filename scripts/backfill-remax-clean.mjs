#!/usr/bin/env node
// Backfill: replace every RE/MAX (GryphTech) image with the watermark-free copy
// the CDN already serves at /Large/ (instead of /LargeWM/). Fixes BOTH failure
// modes at once:
//   · clean-*.webp rows  — the AI "grey box" inpaint  → replaced with clean jpg
//   · /LargeWM/ rows     — stored WITH the RE/MAX mark → replaced with clean jpg
// No inpainting, no quality loss: /Large/ is the identical photo minus the overlay.
//
// Usage:
//   node scripts/backfill-remax-clean.mjs            # dry run (counts only)
//   node scripts/backfill-remax-clean.mjs --apply    # do it
//   node scripts/backfill-remax-clean.mjs --apply --limit 20   # small test batch
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(ROOT, '..', '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i < 0) continue;
  let v = t.slice(i + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(t.slice(0, i).trim() in process.env)) process.env[t.slice(0, i).trim()] = v;
}
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 0; })();
const DB = process.env.AIROBASE_URL, KEY = process.env.AIROBASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const s3 = new S3Client({ endpoint: process.env.B2_S3_ENDPOINT, region: process.env.B2_REGION, credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APP_KEY }, forcePathStyle: true });
const BUCKET = process.env.B2_BUCKET;
const mediaUrl = (k) => `/api/media/${k.split('/').map(encodeURIComponent).join('/')}`;

// Pull every gryphtech row, paginated.
let rows = [];
for (let off = 0; ; off += 1000) {
  const r = await fetch(`${DB}/rest/v1/property_images?source_url=like.%25gryphtech%25&select=id,property_id,source_url,storage_key,is_feature&limit=1000&offset=${off}`, { headers: H });
  const b = await r.json(); if (!Array.isArray(b) || !b.length) break; rows.push(...b); if (b.length < 1000) break;
}
// Needs fixing = boxed (clean-) OR stored watermarked (/LargeWM/ source).
const needsFix = rows.filter((x) => String(x.storage_key || '').includes('clean-') || String(x.source_url || '').includes('/LargeWM/'));
console.log(`[remax] gryphtech images ${rows.length} · need fix ${needsFix.length} (boxed clean-* or /LargeWM/ in storage)`);
if (!APPLY) { console.log('[remax] DRY RUN — pass --apply to write. Sample:', needsFix.slice(0, 3).map((x) => x.source_url)); process.exit(0); }

const work = LIMIT ? needsFix.slice(0, LIMIT) : needsFix;
let done = 0, fixed = 0, miss = 0, errs = 0;
async function one(im) {
  try {
    const cleanSrc = im.source_url.replace('/LargeWM/', '/Large/');
    const dir = im.storage_key.includes('/') ? im.storage_key.split('/').slice(0, -1).join('/') : im.storage_key;
    const fname = cleanSrc.split('/').pop().split('?')[0];        // e.g. L_xxx.jpg
    const newKey = `${dir}/${fname}`;
    const res = await fetch(cleanSrc, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) { miss++; return; }
    const ct = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: newKey, Body: buf, ContentType: ct }));
    const url = mediaUrl(newKey);
    // Repoint the row (source_url normalized to /Large/ so re-scrapes match).
    const pr = await fetch(`${DB}/rest/v1/property_images?id=eq.${im.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ storage_key: newKey, storage_url: url, source_url: cleanSrc, content_type: ct, bytes: String(buf.length) }) });
    if (!pr.ok) { errs++; return; }               // e.g. unique (property_id,source_url) clash — skip
    if (im.is_feature) await fetch(`${DB}/rest/v1/properties?id=eq.${im.property_id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ feature_image_url: url }) });
    // Clean up the old boxed webp object if the key changed.
    if (newKey !== im.storage_key && String(im.storage_key).includes('clean-')) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: im.storage_key })).catch(() => {});
    }
    fixed++;
  } catch { errs++; }
  done++; if (done % 200 === 0) console.log(`[remax] ${done}/${work.length} · fixed ${fixed} · missing ${miss} · errs ${errs}`);
}
const N = 8; let idx = 0;
await Promise.all(Array.from({ length: N }, async () => { while (idx < work.length) await one(work[idx++]); }));
console.log(`[remax] DONE — processed ${done} · fixed ${fixed} · missing(/Large 404) ${miss} · errors ${errs}`);
