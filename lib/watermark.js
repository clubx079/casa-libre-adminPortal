// Stamps the Casa Libre mascot + wordmark onto a property photo — centered,
// small, and semi-transparent. Pure function of bytes + opts: no network, no DB.
// Server-only in practice (sharp is a native module), but does not import
// 'server-only' itself so it can be unit-tested outside Next/vitest mocks.
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASCOT_PATH = path.join(__dirname, '..', 'assets', 'mascot.png');

// opts:
//   opacity — 0..1, applied to both the mascot glyph and the wordmark (default 0.22, soft)
//   scale   — mascot width as a fraction of the base image width (default 0.18, small/soft)
export async function stampWatermark(inputBytes, opts = {}) {
  const { opacity = 0.22, scale = 0.18 } = opts;

  if (!inputBytes || !(Buffer.isBuffer(inputBytes) || inputBytes instanceof Uint8Array)) {
    throw new Error('stampWatermark: inputBytes must be a Buffer or Uint8Array');
  }

  // Rotate first (respect EXIF orientation) and read the resulting pixel
  // dimensions, so the SVG overlay we build below lines up with the buffer
  // we actually composite onto — not the pre-rotation metadata.
  let rotated;
  try {
    rotated = await sharp(inputBytes, { failOn: 'none' }).rotate().toBuffer({ resolveWithObject: true });
  } catch (err) {
    throw new Error(`stampWatermark: input is not a readable image (${err.message})`);
  }
  const { data: baseBuf, info } = rotated;
  const width = info.width;
  const height = info.height;
  if (!width || !height) {
    throw new Error('stampWatermark: could not determine image dimensions');
  }

  const mascotTargetW = Math.max(24, Math.round(width * scale));
  let mascotBuf, mascotW, mascotH;
  try {
    mascotBuf = await sharp(MASCOT_PATH).resize({ width: mascotTargetW }).png().toBuffer();
    const mascotMeta = await sharp(mascotBuf).metadata();
    mascotW = mascotMeta.width;
    mascotH = mascotMeta.height;
  } catch (err) {
    throw new Error(`stampWatermark: could not load mascot asset at ${MASCOT_PATH} (${err.message})`);
  }
  const mascotB64 = mascotBuf.toString('base64');

  // Centered horizontally; mascot sits a touch above vertical center, wordmark
  // directly beneath it, so the pair reads as one small centered mark.
  const mascotX = Math.round((width - mascotW) / 2);
  const mascotY = Math.round(height / 2 - mascotH * 0.7);

  const fontSize = Math.max(12, Math.round(mascotW * 0.22));
  const textY = Math.round(mascotY + mascotH + fontSize * 1.1);
  const textOpacity = Math.min(1, opacity + 0.08); // wordmark reads slightly stronger than the glyph
  const strokeOpacity = Math.min(1, opacity * 0.7);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <image x="${mascotX}" y="${mascotY}" width="${mascotW}" height="${mascotH}"
         href="data:image/png;base64,${mascotB64}" opacity="${opacity}" />
  <text x="${width / 2}" y="${textY}" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="600" letter-spacing="0.5"
        font-size="${fontSize}"
        fill="#ffffff" fill-opacity="${textOpacity}"
        stroke="#111111" stroke-opacity="${strokeOpacity}" stroke-width="${Math.max(1, fontSize * 0.06)}"
        paint-order="stroke">Casa Libre</text>
</svg>`;

  try {
    // baseBuf is already-rotated, encoded image bytes (same container as the
    // input) — sharp re-decodes it directly, no raw-pixel bookkeeping needed.
    return await sharp(baseBuf)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err) {
    throw new Error(`stampWatermark: failed to composite watermark (${err.message})`);
  }
}
