// Deeper ingest pipeline (audit #2 / #4 / #13 / #28).
//
// Pure, side-effect-free transforms + validators the scrape loop runs on every
// mapped listing BEFORE it touches `properties`, plus the quarantine helpers
// that hold rejected/duplicate records for admin review. The completeness gate
// on the buyer portal hides bad data from users; this fixes/holds it at the
// source so it never enters the live table in the first place.
import 'server-only';
import { dualPrice } from './money';
import { isLandType } from './land';
import { select, insert, update } from './db';

// ─── Reason codes (machine) → human labels for the review UI ──────────────────
export const REASON_LABELS = {
  no_contact: 'Sin teléfono de contacto',
  no_location: 'Sin ciudad ni barrio',
  no_price: 'Sin precio',
  price_below_floor: 'Precio por debajo del mínimo plausible',
  sale_price_as_rent: 'Precio de venta publicado como alquiler',
  beds_over_cap: 'Dormitorios fuera de rango (>10)',
  baths_over_cap: 'Baños fuera de rango (>10)',
  parking_over_cap: 'Cocheras fuera de rango (>10)',
  area_out_of_range: 'Superficie construida fuera de rango (5–2.000 m²)',
  duplicate: 'Duplicado de una propiedad ya publicada',
  images_broken: 'Todas las imágenes están rotas',
};

// ─── #13 Zone taxonomy ────────────────────────────────────────────────────────
const strip = (s) =>
  String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '') // drop accents
    .toLowerCase().trim();

// Controlled taxonomy: canonical Display name keyed by its normalized token.
// Order matters only for readability; matching prefers the longest token hit.
const CANONICAL = {
  // Gran Asunción + major cities
  'asuncion': 'Asunción', 'luque': 'Luque', 'san lorenzo': 'San Lorenzo',
  'fernando de la mora': 'Fernando de la Mora', 'lambare': 'Lambaré',
  'capiata': 'Capiatá', 'nemby': 'Ñemby', 'mariano roque alonso': 'Mariano Roque Alonso',
  'villa elisa': 'Villa Elisa', 'limpio': 'Limpio', 'itaugua': 'Itauguá',
  'aregua': 'Areguá', 'ypacarai': 'Ypacaraí', 'san antonio': 'San Antonio',
  'villeta': 'Villeta', 'guarambare': 'Guarambaré', 'ita': 'Itá',
  'ciudad del este': 'Ciudad del Este', 'encarnacion': 'Encarnación',
  'pedro juan caballero': 'Pedro Juan Caballero', 'coronel oviedo': 'Coronel Oviedo',
  'caaguazu': 'Caaguazú', 'villarrica': 'Villarrica', 'pilar': 'Pilar',
  'concepcion': 'Concepción', 'caacupe': 'Caacupé', 'san bernardino': 'San Bernardino',
  // Asunción barrios
  'villa morra': 'Villa Morra', 'las mercedes': 'Las Mercedes', 'recoleta': 'Recoleta',
  'carmelitas': 'Carmelitas', 'manora': 'Manorá', 'ykua sati': 'Ykua Satí',
  'mburicao': 'Mburicaó', 'sajonia': 'Sajonia', 'barrio jara': 'Barrio Jara',
  'san vicente': 'San Vicente', 'santisima trinidad': 'Santísima Trinidad',
  'trinidad': 'Trinidad', 'molas lopez': 'Molas López', 'los laureles': 'Los Laureles',
  'herrera': 'Herrera', 'mariscal lopez': 'Mariscal López', 'santo domingo': 'Santo Domingo',
  'san roque': 'San Roque', 'catedral': 'Catedral', 'ciudad nueva': 'Ciudad Nueva',
  'tacumbu': 'Tacumbú', 'obrero': 'Obrero', 'san pablo': 'San Pablo',
  'madame lynch': 'Madame Lynch', 'jara': 'Barrio Jara', 'ita enramada': 'Itá Enramada',
};
const CANON_TOKENS = Object.keys(CANONICAL).sort((a, b) => b.length - a.length);

// Marketing / non-location noise that pollutes scraped zone fields (#13).
const NOISE_RE = new RegExp(
  [
    '\\b(oportunidad|imperdible|oferta|remato?|rebajad[oa]|ganga|promo(cion)?|excelente',
    '|hermos[oa]|lujos[oa]|espectacular|imperdibles|vend[oe]|alquil[oa]|se vende|se alquila',
    '|gran|super|mega|unic[oa]|ideal|financiacion|cuotas?|entrega|estrena?r?)\\b',
  ].join(''),
  'gi'
);

// Clean a raw zone string: drop prices, phones, urls, emojis, marketing shouting,
// repeated punctuation; collapse whitespace; title-case; cap length.
export function cleanZone(raw) {
  let s = String(raw || '');
  if (!s.trim()) return null;
  s = s
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ')       // emoji
    .replace(/(us\$|u\$s|gs\.?|₲|\$)\s?[\d.,]+/gi, ' ')            // prices
    .replace(/(\+?595|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g, ' ')  // PY phones
    .replace(/\b\d{6,}\b/g, ' ')                                    // long digit runs
    .replace(NOISE_RE, ' ')
    .replace(/[!*¡?¿#|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '');
  if (!s) return null;
  // Title case with accents preserved (word-split, so leading ñ/á are handled).
  s = s.toLowerCase().split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
  return s.slice(0, 60).trim() || null;
}

// Resolve a canonical zone from the cleaned neighborhood/city, else the cleaned
// city. Returns { neighborhood, city, zone_canonical }.
export function normalizeZone(row) {
  const neighborhood = cleanZone(row.neighborhood);
  const city = cleanZone(row.city);
  const hay = strip(`${neighborhood || ''} ${city || ''} ${row.address || ''}`);
  let canonical = null;
  for (const tok of CANON_TOKENS) {
    // word-boundary-ish containment on the normalized haystack
    if (new RegExp(`(^|[^a-z])${tok.replace(/ /g, '[ ]')}([^a-z]|$)`).test(hay)) {
      canonical = CANONICAL[tok];
      break;
    }
  }
  return { neighborhood, city, zone_canonical: canonical || city || null };
}

// ─── #4 De-duplication ────────────────────────────────────────────────────────
// Fuzzy signature: zone + normalized type + area bucket + price bucket + beds.
// Returns null when the row is too sparse to dedupe confidently (never collapse
// unrelated thin rows).
export function dedupeKey(row, zoneCanonical) {
  const zone = strip(zoneCanonical || row.city || row.neighborhood);
  const type = isLandType(row.property_type) ? 'land' : strip(row.property_type).slice(0, 12);
  const area = Number(row.covered_area) || Number(row.floor_area) || Number(row.land_area) || null;
  const price = Number(row.price) || null;
  const beds = row.bedrooms != null ? Number(row.bedrooms) : null;
  // Need a location + a price + (area or beds) to form a trustworthy signature.
  if (!zone || !price || (area == null && beds == null)) return null;
  const areaBucket = area != null ? Math.round(area / 10) * 10 : 'x';   // ±10 m²
  const priceBucket = Math.round(price / (price >= 100000 ? 5000 : 500)); // ~1–5% bands
  const bedKey = beds != null ? beds : 'x';
  return [zone, type, areaBucket, priceBucket, bedKey].join('|');
}

// True if another ACTIVE property (any source) already carries this dedupe key.
export async function isDuplicate(key) {
  if (!key) return null;
  const enc = encodeURIComponent(key);
  const rows = await select(
    'properties',
    `select=id&dedupe_key=eq.${enc}&admin_status=eq.active&is_delisted=eq.false&limit=1`
  );
  return rows[0]?.id || null;
}

// ─── #2 Validation (mirrors the buyer completeness gate, on raw columns) ──────
export function validateListing(row, rate) {
  const reasons = [];
  const digits = String(row.contact_phone || '').replace(/\D/g, '');
  if (digits.length < 6) reasons.push('no_contact');
  if (!row.city && !row.neighborhood) reasons.push('no_location');

  const { usd, pyg } = dualPrice(row.price, row.currency, rate || 7300);
  const rent = row.listing_type === 'rent';
  if (rent) {
    if (!(Number(pyg) > 0)) reasons.push('no_price');
    else if (Number(pyg) < 300000) reasons.push('price_below_floor');
    if (usd != null && Number(usd) > 15000) reasons.push('sale_price_as_rent');
  } else {
    if (!(Number(usd) > 0)) reasons.push('no_price');
    else if (Number(usd) < 5000) reasons.push('price_below_floor');
  }

  const overCap = (v, max) => v != null && (Number(v) < 0 || Number(v) > max);
  if (overCap(row.bedrooms, 10)) reasons.push('beds_over_cap');
  if (overCap(row.bathrooms, 10)) reasons.push('baths_over_cap');
  if (overCap(row.parking_spaces, 10)) reasons.push('parking_over_cap');

  const builtArea = row.covered_area != null ? Number(row.covered_area)
    : (row.floor_area != null ? Number(row.floor_area) : null);
  if (!isLandType(row.property_type) && builtArea != null && (builtArea < 5 || builtArea > 2000)) {
    reasons.push('area_out_of_range');
  }
  return { ok: reasons.length === 0, reasons };
}

// ─── #28 Image screening ──────────────────────────────────────────────────────
// srcCount = image URLs the adapter produced; mirroredFeatureUrl = a usable
// stored image (or null). 'broken' = had URLs but none mirrored.
export function imageStatus(srcCount, mirroredFeatureUrl) {
  if (mirroredFeatureUrl) return 'ok';
  return srcCount > 0 ? 'broken' : 'none';
}

// ─── #2 Quarantine store ──────────────────────────────────────────────────────
// Hold a rejected/duplicate mapped row for admin review (upsert per source+ext).
export async function quarantine({ sourceId, externalId, row, reasons, dedupeKey: dk, duplicateOf }) {
  await insert('ingest_quarantine', [{
    source_id: sourceId,
    external_id: externalId,
    reasons,
    payload: row,
    dedupe_key: dk || null,
    duplicate_of: duplicateOf || null,
    status: 'pending',
    created_at: new Date().toISOString(),
  }], { upsert: true, onConflict: 'source_id,external_id', returning: 'minimal' });
}
