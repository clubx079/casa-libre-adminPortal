// AI image screening on ingest (audit #28) — same technique as the DeelMap /
// cloudflare-email-inbox `classify-property-images` pipeline: skip logos, icons,
// maps, watermarked/branded images, people, and other non-property pictures so
// only genuine property photos reach the site.
//
// Pipeline (per image URL):
//   1. URL pattern pre-filter   — fast, no network (logos/icons/social/maps)
//   2. Size pre-filter          — HEAD content-length (drop tiny icons)
//   3. Google Cloud Vision      — LABEL + OBJECT + TEXT detection, then:
//        · reject branded/watermarked (phone/URL/heavy text overlay)
//        · reject clearly non-property (map/sign/document/person/food/logo…)
//          when there is NO house cue at all
//        · keep anything with a house/room/exterior/land cue, and keep ambiguous
//          images (lenient — never drop a real photo on a weak signal)
//
// Requires GOOGLE_VISION_API_KEY. With no key it degrades gracefully: URL + size
// filters still run, Vision is skipped, and the rest of the pipeline keeps the
// images (the deterministic broken-image check in scrape.js still applies).
import 'server-only';
import { logApiCall } from './api-usage';

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
const MIN_FILE_SIZE_BYTES = 8000; // 8 KB — icons/spacers are smaller
const TIMEOUT_MS = 8000;
const CONCURRENCY = 5;

const visionKey = () => process.env.GOOGLE_VISION_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_VISION_API_KEY || null;

// ─── 1. URL pre-filter ────────────────────────────────────────────────────────
const SKIP_PATTERNS = [
  /favicon/i, /logo/i, /\bicon\b/i, /avatar/i, /badge/i, /button/i, /arrow/i,
  /spinner/i, /placeholder/i, /coming.?soon/i, /no.?photo/i, /no.?image/i,
  /\.gif(\?|$)/i, /\.svg(\?|$)/i,
  /social/i, /share/i, /twitter/i, /facebook/i, /linkedin/i, /instagram/i, /whatsapp/i,
  /mapbox/i, /maps\.googleapis/i, /staticmap/i, /\bmap\b/i,
  /watermark/i, /marca.?agua/i,
  /[/_-]\d{1,2}x\d{1,2}[./_-]/i, // tiny dimension hints like -16x16-
];
const passUrlFilter = (url) => !!url && url.startsWith('http') && !SKIP_PATTERNS.some((p) => p.test(url));

// ─── 2. Size pre-filter (content-length only; no sharp dependency) ────────────
async function passSize(url) {
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (head?.ok) {
      const len = parseInt(head.headers.get('content-length') || '0', 10);
      if (len > 0 && len < MIN_FILE_SIZE_BYTES) return false; // definitely an icon
    }
    return true; // pass on unknown size — Vision backstops it
  } catch { return true; }
}

// ─── 3. Vision content classification ─────────────────────────────────────────
const HOUSE_CUES = [
  'house','home','building','property','real estate','realty','architecture','residential','estate','cottage','bungalow','apartment','condo','condominium','villa','cabin','mansion','townhouse','duplex',
  'room','kitchen','bathroom','bedroom','living room','dining','interior','interior design','basement','attic','hallway','staircase','stairs','fireplace','closet','laundry',
  'floor','flooring','hardwood','tile','carpet','wall','ceiling','window','door','doorway','roof','countertop','cabinetry','furniture','couch','sofa','bed','sink','bathtub','shower','toilet','appliance','refrigerator','stove',
  'yard','lawn','garden','backyard','front yard','porch','patio','deck','garage','carport','driveway','fence','shed','barn','siding','brick','stucco','facade','chimney','swimming pool','pool',
  'land','lot','field','plot','acreage','tree','sky','grass','plant','vegetation','estancia','terreno',
];
const NON_HOUSE_CUES = [
  'street sign','traffic sign','signage','sign','atlas','diagram','floor plan','plan','chart','graph','infographic',
  'screenshot','document','paperwork','poster','flyer','brochure','banner','business card','menu','receipt','spreadsheet','presentation',
  'logo','brand','trademark','emblem','graphic design','clip art','clipart','illustration','text','font','typography','advertising','advertisement','watermark','icon','symbol',
  'human face','face','portrait','selfie','person','people',
  'food','dish','meal','cuisine','recipe','drink',
  'animal','pet','dog','cat','bird','wildlife',
];
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOUSE_RE = new RegExp('\\b(' + HOUSE_CUES.map(reEsc).join('|') + ')\\b', 'i');
const NON_HOUSE_RE = new RegExp('\\b(' + NON_HOUSE_CUES.map(reEsc).join('|') + ')\\b', 'i');

async function classifyOne(url, apiKey, counter) {
  try {
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!imgRes.ok) return { url, keep: true }; // can't fetch → let the mirror step decide (broken)
    const raw = Buffer.from(await imgRes.arrayBuffer());
    // image dimensions — used to measure how much of the photo the text covers
    let iw = 0, ih = 0;
    try { const m = await (await import('sharp')).default(raw).metadata(); iw = m.width || 0; ih = m.height || 0; } catch { /* dims optional */ }
    const base64 = raw.toString('base64');

    if (counter) counter.vision++; // billed Vision request (4 features)
    const vr = await fetch(`${VISION_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [
            { type: 'LABEL_DETECTION', maxResults: 12 },
            { type: 'OBJECT_LOCALIZATION', maxResults: 8 },
            { type: 'TEXT_DETECTION', maxResults: 1 },
            { type: 'LOGO_DETECTION', maxResults: 3 },
          ],
        }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!vr.ok) return { url, category: 'keep' }; // pass on Vision error — never block a real photo on infra

    const data = await vr.json();
    const r0 = data.responses?.[0] || {};
    const all = [
      ...(r0.labelAnnotations || []).map((l) => String(l.description).toLowerCase()),
      ...(r0.localizedObjectAnnotations || []).map((o) => String(o.name).toLowerCase()),
    ];
    const hasHouse = all.some((d) => HOUSE_RE.test(d));
    const clearlyNon = all.some((d) => NON_HOUSE_RE.test(d));

    // Branded/watermarked signals — a stamped phone number, URL, heavy text
    // overlay, or a detected logo means a competing agency marked the image.
    const fullText = r0.textAnnotations?.[0]?.description || '';
    const hasPhone = /(\+?595|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/.test(fullText) || /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(fullText);
    const hasUrl = /\b(?:www\.|https?:\/\/|\.(com|net|org|py|co)\b)/i.test(fullText);
    const heavyText = fullText.replace(/\s+/g, '').length > 40;
    // A LARGE overlaid text block (a title spanning a big chunk of the image) is a
    // project/agency watermark even when it's short — e.g. "VICINIA BARRIO CERRADO".
    let bigTextOverlay = false;
    const tv = r0.textAnnotations?.[0]?.boundingPoly?.vertices;
    if (tv && iw && ih) {
      const xs = tv.map((v) => v.x || 0), ys = tv.map((v) => v.y || 0);
      const tw = Math.max(...xs) - Math.min(...xs), th = Math.max(...ys) - Math.min(...ys);
      if (tw >= 0.28 * iw && th >= 0.07 * ih) bigTextOverlay = true;
    }
    const branded = hasPhone || hasUrl || heavyText || bigTextOverlay || (r0.logoAnnotations || []).length > 0;

    if (branded) {
      // A watermarked PROPERTY photo → send for cleaning (keep the photo, drop the
      // mark). A branded image with NO property cue is just an ad/logo → reject.
      if (hasHouse || !clearlyNon) return { url, category: 'branded' };
      return { url, category: 'reject', reason: 'branded_ad', labels: all.slice(0, 5) };
    }
    if (hasHouse) return { url, category: 'keep' };                 // clean property photo
    if (clearlyNon) return { url, category: 'reject', reason: 'non_property', labels: all.slice(0, 5) };
    return { url, category: 'keep' };                               // ambiguous → keep (lenient)
  } catch {
    return { url, category: 'keep' };                              // pass through on any error
  }
}

async function batched(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const res = await Promise.allSettled(items.slice(i, i + CONCURRENCY).map(fn));
    res.forEach((r) => out.push(r.status === 'fulfilled' ? r.value : null));
  }
  return out;
}

// Public: given image URLs, return
//   { kept:     [...urls]              — clean property photos (mirror as-is)
//     branded:  [...urls]              — watermarked property photos (clean, then keep)
//     rejected: [{url, reason}]        — logos/maps/ads/non-property (drop) }
export async function screenPropertyImages(urls, source = 'unknown') {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return { kept: [], branded: [], rejected: [] };
  const counter = { vision: 0 };

  // Stage 1 — URL filter
  const rejected = [];
  const urlKept = [];
  for (const u of list) (passUrlFilter(u) ? urlKept.push(u) : rejected.push({ url: u, reason: 'url_pattern' }));

  // Stage 2 — size filter
  const sizeResults = await batched(urlKept, async (u) => ({ url: u, ok: await passSize(u) }));
  const sizeKept = [];
  sizeResults.forEach((r, i) => {
    if (!r) { sizeKept.push(urlKept[i]); return; }  // errored slot → keep (lenient)
    if (r.ok) sizeKept.push(r.url); else rejected.push({ url: r.url, reason: 'too_small' });
  });

  // Stage 3 — Vision (only if a key is configured; without it keep everything)
  const apiKey = visionKey();
  if (!apiKey) return { kept: sizeKept, branded: [], rejected };

  const visionResults = await batched(sizeKept, (u) => classifyOne(u, apiKey, counter));
  const kept = [];
  const branded = [];
  visionResults.forEach((r) => {
    if (!r) return;                                   // errored slot → drop silently (rare)
    if (r.category === 'keep') kept.push(r.url);
    else if (r.category === 'branded') branded.push(r.url);
    else rejected.push({ url: r.url, reason: r.reason || 'non_property', labels: r.labels });
  });
  // Casa Libre Vision = 4 features/image (Label+Object+Text+Logo).
  void logApiCall({ api: 'vision', source, path: 'imageScreen', calls: counter.vision * 4 });
  return { kept, branded, rejected };
}
