// LaMa inpainting client (audit #28 v2, "keep the photo, remove the mark").
//
// The old Sharp "sample-adjacent-pixels" fill stretched one neighbouring strip
// over the whole watermark region — fine for a tiny corner logo, but for a large
// or centered mark it left an obvious flat rectangle (the "grey box" bug). We now
// send the detected region to a self-hosted LaMa inpainting service, which paints
// the background back in convincingly.
//
//   Vision locates the mark → this sends {image_url, mask:'bbox', boxes} to LaMa
//   → LaMa returns a clean WebP URL → we fetch the bytes back for re-upload to B2.
//
// The service (FastAPI + simple_lama_inpainting) uploads its result to its own
// AiroBase storage bucket and returns { clean_url }; we only use it as a transport
// and immediately mirror the bytes into our own B2 bucket, so nothing depends on
// that intermediate URL staying alive.
import 'server-only';

const LAMA_URL = (process.env.LAMA_SERVICE_URL || 'https://lama-service.apps.airosofts.com').replace(/\/$/, '');

// boxes: array of [left, top, right, bottom] as fractions 0-1 of the image.
// Returns clean WebP bytes (Buffer) or null on any failure (caller falls back).
export async function lamaInpaint(imageUrl, boxes, { cleanTimeoutMs = 120000, fetchTimeoutMs = 60000 } = {}) {
  if (!imageUrl || !Array.isArray(boxes) || !boxes.length) return null;
  try {
    const res = await fetch(`${LAMA_URL}/clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, mask: 'bbox', boxes }),
      signal: AbortSignal.timeout(cleanTimeoutMs),
    });
    if (!res.ok) return null;
    const { clean_url } = await res.json().catch(() => ({}));
    if (!clean_url) return null;
    const img = await fetch(clean_url, { signal: AbortSignal.timeout(fetchTimeoutMs) });
    if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  } catch {
    return null;
  }
}

// Is the LaMa service reachable? (used by scripts to fail fast before a big run)
export async function lamaHealthy(timeoutMs = 10000) {
  try {
    const r = await fetch(`${LAMA_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return !!j.ok;
  } catch {
    return false;
  }
}
