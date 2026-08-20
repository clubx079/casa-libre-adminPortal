// Watermark removal (audit #28, "keep the photo, remove the mark").
//
// Same two-stage technique as the DeelMap watermark-remover, with the one dead
// part swapped out: DeelMap used Groq Llama-4-Scout (a vision model Groq has
// since RETIRED) to locate the watermark box. We use Google Cloud Vision
// (LOGO + TEXT detection → bounding boxes) instead, then reuse DeelMap's Sharp
// inpaint (sample pixels just outside the box and tile them over it).
//
//   download → Vision locates the mark → Sharp fills it → upload clean webp to B2
//
// Requires GOOGLE_VISION_API_KEY + sharp. Returns null on any failure so the
// caller can fall back to keeping the original image.
import 'server-only';
import * as b2 from './b2';

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
const MAX_EDGE = 1280;   // normalize working image to this max dimension
const PAD_PCT = 10;      // expand the detected box; corner marks tend to under-detect
const MAX_REGION_FRAC = 0.55; // refuse to inpaint if the "mark" covers most of the photo

const visionKey = () => process.env.GOOGLE_VISION_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_VISION_API_KEY || null;

async function download(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

// Vision vertices → {left, top, right, bottom} in pixels (missing x/y default 0).
function vertsToBox(vertices) {
  const xs = vertices.map((v) => v.x || 0);
  const ys = vertices.map((v) => v.y || 0);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

// Ask Google Vision where the logo/branding text is; return a padded pixel
// region {left, top, width, height} or null (nothing brand-like / too large).
async function detectWatermarkRegion(buffer, w, h, apiKey) {
  const vr = await fetch(`${VISION_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: buffer.toString('base64') },
        features: [
          { type: 'LOGO_DETECTION', maxResults: 5 },
          { type: 'TEXT_DETECTION', maxResults: 1 },
        ],
      }],
    }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!vr || !vr.ok) return null;

  const r0 = (await vr.json()).responses?.[0] || {};
  const boxes = [];

  // Every detected logo is a watermark candidate.
  for (const l of r0.logoAnnotations || []) if (l.boundingPoly?.vertices) boxes.push(vertsToBox(l.boundingPoly.vertices));

  // Overlaid text counts only when it looks like agency branding (phone / URL /
  // heavy text) — a lone house number or street sign should not trigger a fill.
  const fullText = r0.textAnnotations?.[0]?.description || '';
  const hasPhone = /(\+?595|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/.test(fullText) || /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(fullText);
  const hasUrl = /\b(?:www\.|https?:\/\/|\.(com|net|org|py|co)\b)/i.test(fullText);
  const heavyText = fullText.replace(/\s+/g, '').length > 40;
  if (hasPhone || hasUrl || heavyText) {
    for (const t of (r0.textAnnotations || []).slice(1)) if (t.boundingPoly?.vertices) boxes.push(vertsToBox(t.boundingPoly.vertices));
  }

  if (!boxes.length) return null;

  // Union all candidate boxes into one region.
  let left = Math.min(...boxes.map((b) => b.left));
  let top = Math.min(...boxes.map((b) => b.top));
  let right = Math.max(...boxes.map((b) => b.right));
  let bottom = Math.max(...boxes.map((b) => b.bottom));

  // Refuse if the union covers most of the image (scattered legit text) — never
  // damage the photo.
  if (((right - left) * (bottom - top)) / (w * h) > MAX_REGION_FRAC) return null;

  // Pad; snap to the edge when the mark sits against one (common for corner/band logos).
  const px = (w * PAD_PCT) / 100, py = (h * PAD_PCT) / 100;
  left = Math.max(0, left - px);
  top = Math.max(0, top - py);
  right = right >= w * 0.85 ? w : Math.min(w, right + px);
  bottom = bottom >= h * 0.85 ? h : Math.min(h, bottom + py);

  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (width <= 0 || height <= 0) return null;
  return { left: Math.round(left), top: Math.round(top), width, height };
}

// Fill the region by sampling pixels from just outside it and tiling them over.
// Ported from the DeelMap watermark-remover: prefer horizontal neighbours (same
// row background — floor/wall), pick the direction with the most room.
async function fillRegion(sharp, buffer, region, imgW, imgH) {
  const safeLeft = Math.max(0, Math.min(region.left, imgW - 1));
  const safeTop = Math.max(0, Math.min(region.top, imgH - 1));
  const safeWidth = Math.min(region.width, imgW - safeLeft);
  const safeHeight = Math.min(region.height, imgH - safeTop);
  if (safeWidth <= 0 || safeHeight <= 0) return buffer;

  const spaceLeft = safeLeft;
  const spaceRight = imgW - (safeLeft + safeWidth);
  const spaceAbove = safeTop;
  const spaceBelow = imgH - (safeTop + safeHeight);

  const MIN = 20;
  const best = [
    { dir: 'left', space: spaceLeft, weight: 4 },
    { dir: 'right', space: spaceRight, weight: 3 },
    { dir: 'above', space: spaceAbove, weight: 2 },
    { dir: 'below', space: spaceBelow, weight: 1 },
  ].filter((c) => c.space >= MIN).sort((a, b) => b.space * b.weight - a.space * a.weight)[0]?.dir;

  let patch;
  if (best === 'left') {
    const sw = Math.min(safeWidth, spaceLeft);
    patch = await sharp(buffer).extract({ left: safeLeft - sw, top: safeTop, width: sw, height: safeHeight }).resize(safeWidth, safeHeight, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
  } else if (best === 'right') {
    const sw = Math.min(safeWidth, spaceRight);
    patch = await sharp(buffer).extract({ left: safeLeft + safeWidth, top: safeTop, width: sw, height: safeHeight }).resize(safeWidth, safeHeight, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
  } else if (best === 'above') {
    const st = Math.max(0, safeTop - safeHeight);
    const sh = Math.max(1, safeTop - st);
    patch = await sharp(buffer).extract({ left: safeLeft, top: st, width: safeWidth, height: sh }).resize(safeWidth, safeHeight, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
  } else if (best === 'below') {
    const sh = Math.min(safeHeight, spaceBelow);
    patch = await sharp(buffer).extract({ left: safeLeft, top: safeTop + safeHeight, width: safeWidth, height: sh }).resize(safeWidth, safeHeight, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
  } else {
    patch = await sharp(buffer).extract({ left: safeLeft, top: safeTop, width: safeWidth, height: safeHeight }).blur(30).toBuffer();
  }
  return sharp(buffer).composite([{ input: patch, left: safeLeft, top: safeTop, blend: 'over' }]).toBuffer();
}

// Download → locate the mark → inpaint → upload clean webp to B2 at `key`.
// Returns { key, url } on success, or null (caller keeps the original image).
export async function removeWatermark(sourceUrl, key) {
  const apiKey = visionKey();
  if (!apiKey) return null;
  const raw = await download(sourceUrl);
  if (!raw) return null;

  try {
    const sharp = (await import('sharp')).default;
    // Normalize orientation + size so Vision coords and inpaint coords match.
    const work = await sharp(raw).rotate().resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const meta = await sharp(work).metadata();
    const w = meta.width, h = meta.height;
    if (!w || !h) return null;

    const region = await detectWatermarkRegion(work, w, h, apiKey);
    if (!region) return null; // nothing brand-like to remove

    const cleaned = await fillRegion(sharp, work, region, w, h);
    const webp = await sharp(cleaned).webp({ quality: 90 }).toBuffer();
    await b2.put(key, webp, 'image/webp');
    return { key, url: b2.storageUrl(key) };
  } catch {
    return null;
  }
}
