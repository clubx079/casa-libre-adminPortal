// Watermark removal (audit #28 v2, "keep the photo, remove the mark").
//
// Google Cloud Vision (LOGO + TEXT detection) locates the mark; a self-hosted
// LaMa inpainting service paints the background back in. The previous version
// filled the region with a stretched strip of adjacent pixels (Sharp), which
// left a visible flat rectangle — the "grey box" bug — on anything bigger than a
// small corner logo. LaMa reconstructs real texture instead.
//
//   download → Vision locates the mark → LaMa inpaints it → upload clean webp to B2
//
// Requires GOOGLE_VISION_API_KEY + sharp + a reachable LAMA_SERVICE_URL. Returns
// null on any failure so the caller can fall back to keeping the original image.
import 'server-only';
import * as b2 from './b2';
import { lamaInpaint } from './lamaClean';

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
  // Large overlaid title (e.g. "VICINIA BARRIO CERRADO") — a watermark even if short.
  let bigTextOverlay = false;
  const fv = r0.textAnnotations?.[0]?.boundingPoly?.vertices;
  if (fv) { const b = vertsToBox(fv); if ((b.right - b.left) >= 0.28 * w && (b.bottom - b.top) >= 0.07 * h) bigTextOverlay = true; }
  if (hasPhone || hasUrl || heavyText || bigTextOverlay) {
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

// Convert a pixel region on the WxH working image to a fractional [l,t,r,b] box.
// Fractions are resolution-independent, so LaMa can apply them to the full-res
// original at sourceUrl even though Vision ran on the downscaled working copy.
function regionToFracBox(region, w, h) {
  const l = Math.max(0, region.left / w);
  const t = Math.max(0, region.top / h);
  const r = Math.min(1, (region.left + region.width) / w);
  const b = Math.min(1, (region.top + region.height) / h);
  return [l, t, r, b];
}

// Download → locate the mark → LaMa inpaint → upload clean webp to B2 at `key`.
// Returns { key, url } on success, or null (caller keeps the original image).
export async function removeWatermark(sourceUrl, key) {
  const apiKey = visionKey();
  if (!apiKey) return null;
  const raw = await download(sourceUrl);
  if (!raw) return null;

  try {
    const sharp = (await import('sharp')).default;
    // Normalize orientation + size so Vision coords match the box we hand LaMa.
    const work = await sharp(raw).rotate().resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const meta = await sharp(work).metadata();
    const w = meta.width, h = meta.height;
    if (!w || !h) return null;

    const region = await detectWatermarkRegion(work, w, h, apiKey);
    if (!region) return null; // nothing brand-like to remove

    // LaMa inpaints the detected region on the original image and returns WebP.
    const cleaned = await lamaInpaint(sourceUrl, [regionToFracBox(region, w, h)]);
    if (!cleaned) return null; // LaMa unavailable / failed → keep original (caller decides)

    // Re-encode + normalize size for consistency with the rest of the pipeline.
    const webp = await sharp(cleaned).rotate().resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    await b2.put(key, webp, 'image/webp');
    return { key, url: b2.storageUrl(key) };
  } catch {
    return null;
  }
}
