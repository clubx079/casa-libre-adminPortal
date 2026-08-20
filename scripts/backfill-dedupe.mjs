#!/usr/bin/env node
// Standalone CLI: backfill dedupe_key + zone_canonical onto EXISTING properties
// that were scraped before the ingest pipeline existed (audit #4/#13). Without
// this, new inserts can't detect duplicates against the legacy catalogue.
//
//   node scripts/backfill-dedupe.mjs --dry-run --limit 5
//   node scripts/backfill-dedupe.mjs
//
// Needs AIROBASE_URL + AIROBASE_SECRET_KEY (loaded from .env.local). The zone +
// dedupe logic is inlined here to mirror lib/ingest.js exactly.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvLocal();

const URL = process.env.AIROBASE_URL;
const KEY = process.env.AIROBASE_SECRET_KEY;
if (!URL || !KEY) { console.error('[backfill] AIROBASE_URL / AIROBASE_SECRET_KEY missing'); process.exit(1); }

const DRY = process.argv.includes('--dry-run');
const LIMIT_ARG = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : null; })();

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const api = (q) => `${URL}/rest/v1/${q}`;

// ── inlined from lib/ingest.js (kept in sync) ────────────────────────────────
const strip = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const CANONICAL = {
  'asuncion':'Asunción','luque':'Luque','san lorenzo':'San Lorenzo','fernando de la mora':'Fernando de la Mora','lambare':'Lambaré',
  'capiata':'Capiatá','nemby':'Ñemby','mariano roque alonso':'Mariano Roque Alonso','villa elisa':'Villa Elisa','limpio':'Limpio',
  'itaugua':'Itauguá','aregua':'Areguá','ypacarai':'Ypacaraí','san antonio':'San Antonio','villeta':'Villeta','guarambare':'Guarambaré',
  'ita':'Itá','ciudad del este':'Ciudad del Este','encarnacion':'Encarnación','pedro juan caballero':'Pedro Juan Caballero',
  'coronel oviedo':'Coronel Oviedo','caaguazu':'Caaguazú','villarrica':'Villarrica','pilar':'Pilar','concepcion':'Concepción',
  'caacupe':'Caacupé','san bernardino':'San Bernardino','villa morra':'Villa Morra','las mercedes':'Las Mercedes','recoleta':'Recoleta',
  'carmelitas':'Carmelitas','manora':'Manorá','ykua sati':'Ykua Satí','mburicao':'Mburicaó','sajonia':'Sajonia','barrio jara':'Barrio Jara',
  'san vicente':'San Vicente','santisima trinidad':'Santísima Trinidad','trinidad':'Trinidad','molas lopez':'Molas López',
  'los laureles':'Los Laureles','herrera':'Herrera','mariscal lopez':'Mariscal López','santo domingo':'Santo Domingo','san roque':'San Roque',
  'catedral':'Catedral','ciudad nueva':'Ciudad Nueva','tacumbu':'Tacumbú','obrero':'Obrero','san pablo':'San Pablo','madame lynch':'Madame Lynch',
  'jara':'Barrio Jara','ita enramada':'Itá Enramada',
};
const CANON_TOKENS = Object.keys(CANONICAL).sort((a, b) => b.length - a.length);
const NOISE_RE = new RegExp(['\\b(oportunidad|imperdible|oferta|remato?|rebajad[oa]|ganga|promo(cion)?|excelente','|hermos[oa]|lujos[oa]|espectacular|imperdibles|vend[oe]|alquil[oa]|se vende|se alquila','|gran|super|mega|unic[oa]|ideal|financiacion|cuotas?|entrega|estrena?r?)\\b'].join(''), 'gi');
const LAND_RE = /lote|terreno|campo|fracci|parcela/i;
const isLandType = (t) => t != null && LAND_RE.test(String(t));

function cleanZone(raw) {
  let s = String(raw || '');
  if (!s.trim()) return null;
  s = s.replace(/https?:\/\/\S+/gi, ' ').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/(us\$|u\$s|gs\.?|₲|\$)\s?[\d.,]+/gi, ' ').replace(/(\+?595|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ').replace(NOISE_RE, ' ').replace(/[!*¡?¿#|]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '');
  if (!s) return null;
  s = s.toLowerCase().split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
  return s.slice(0, 60).trim() || null;
}
function normalizeZone(row) {
  const neighborhood = cleanZone(row.neighborhood);
  const city = cleanZone(row.city);
  const hay = strip(`${neighborhood || ''} ${city || ''} ${row.address || ''}`);
  let canonical = null;
  for (const tok of CANON_TOKENS) {
    if (new RegExp(`(^|[^a-z])${tok.replace(/ /g, '[ ]')}([^a-z]|$)`).test(hay)) { canonical = CANONICAL[tok]; break; }
  }
  return { zone_canonical: canonical || city || null };
}
function dedupeKey(row, zoneCanonical) {
  const zone = strip(zoneCanonical || row.city || row.neighborhood);
  const type = isLandType(row.property_type) ? 'land' : strip(row.property_type).slice(0, 12);
  const area = Number(row.covered_area) || Number(row.floor_area) || Number(row.land_area) || null;
  const price = Number(row.price) || null;
  const beds = row.bedrooms != null ? Number(row.bedrooms) : null;
  if (!zone || !price || (area == null && beds == null)) return null;
  const areaBucket = area != null ? Math.round(area / 10) * 10 : 'x';
  const priceBucket = Math.round(price / (price >= 100000 ? 5000 : 500));
  const bedKey = beds != null ? beds : 'x';
  return [zone, type, areaBucket, priceBucket, bedKey].join('|');
}

// ── run ──────────────────────────────────────────────────────────────────────
const SELECT = 'id,property_type,city,neighborhood,address,price,bedrooms,covered_area,floor_area,land_area,dedupe_key,zone_canonical';
const PAGE = 500;

async function main() {
  console.log(`[backfill-dedupe] ${DRY ? 'DRY RUN' : 'LIVE'}${LIMIT_ARG ? ` (limit ${LIMIT_ARG})` : ''}`);
  let offset = 0, scanned = 0, patched = 0, keyed = 0, zoned = 0;
  while (true) {
    const res = await fetch(api(`properties?select=${SELECT}&order=id.asc&limit=${PAGE}&offset=${offset}`), { headers: H });
    if (!res.ok) { console.error('[backfill] fetch failed', res.status, await res.text()); break; }
    const rows = await res.json();
    if (!rows.length) break;
    for (const r of rows) {
      scanned++;
      const { zone_canonical } = normalizeZone(r);
      const dk = dedupeKey(r, zone_canonical);
      const patch = {};
      if (dk && r.dedupe_key == null) patch.dedupe_key = dk;
      if (zone_canonical && r.zone_canonical == null) patch.zone_canonical = zone_canonical;
      if (!Object.keys(patch).length) continue;
      if (patch.dedupe_key) keyed++;
      if (patch.zone_canonical) zoned++;
      if (DRY) {
        if (patched < 8) console.log(`  ${r.id.slice(0, 8)}  ${JSON.stringify(patch)}`);
      } else {
        const u = await fetch(api(`properties?id=eq.${r.id}`), { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
        if (!u.ok) console.error(`  PATCH ${r.id} failed`, u.status);
      }
      patched++;
      if (LIMIT_ARG && patched >= LIMIT_ARG) { console.log(`[backfill] done — scanned ${scanned}, patched ${patched} (dedupe_key ${keyed}, zone ${zoned})`); return; }
    }
    offset += PAGE;
    process.stdout.write(`\r  scanned ${scanned}, patched ${patched}...`);
  }
  console.log(`\n[backfill] done — scanned ${scanned}, patched ${patched} (dedupe_key +${keyed}, zone_canonical +${zoned})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
