// Does a scraped listing belong to the country being scraped? Paraguay's scrapers keep only
// Paraguay, Bolivia's only Bolivia, and so on: anything else is dropped before it is saved
// (lib/scrape.js). Pure, test/inCountry.test.js.
//  - A pin must fall inside the country's outline. The outline is approximate, so a pin up to
//    BORDER_KM beyond it still counts (Asunción, Encarnación and Ciudad del Este sit on the border).
//  - The listing's country text, when it has one, must name this country.
//  - A listing with no pin has nothing to check on the map and depends on its country text.
import { COUNTRY_SHAPES } from './countryShapes.js';

export const COUNTRY_NAME = { py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela', sv: 'El Salvador' };
export const BORDER_KM = 10;

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const KM_PER_DEG = 111.32;

function insideRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function kmToRing(lng, lat, ring) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - lng) * k, ay = ring[j][1] - lat, bx = (ring[i][0] - lng) * k, by = ring[i][1] - lat;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best * KM_PER_DEG;
}

export function pinInCountry(lat, lng, cc) {
  const rings = COUNTRY_SHAPES[cc];
  if (!rings) return true;   // no outline for this country yet, so there is nothing to check against
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return rings.some((r) => insideRing(lng, lat, r)) || rings.some((r) => kmToRing(lng, lat, r) <= BORDER_KM);
}

// → { ok: true } or { ok: false, reason: 'outside_country' | 'other_country' }
export function belongsToCountry(row, cc) {
  const name = COUNTRY_NAME[cc];
  if (name && row?.country && fold(row.country) !== fold(name)) return { ok: false, reason: 'other_country' };
  if (row?.latitude == null || row?.longitude == null) return { ok: true };
  return pinInCountry(Number(row.latitude), Number(row.longitude), cc) ? { ok: true } : { ok: false, reason: 'outside_country' };
}
