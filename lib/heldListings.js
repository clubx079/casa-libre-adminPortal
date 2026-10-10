// Listings held in Quarantine (pending ingest_quarantine records) shaped like properties
// rows, so the Properties page lists them as inactive: they're scraped listings that are
// not on the site, they just never became properties (the scraper held them back first).
// Records whose listing IS already a property are old leftovers and are left out.
//
// The payloads carry the whole scraped page (PY ~8.6 MB for ~560 records, ~2.5 s), and
// the database can't return single payload fields, so only the slim rows are kept per
// country (lib/swrCache.js): fresh 2 minutes, then the last copy is used at once while a
// new one loads behind it. Server-only.
import 'server-only';
import { splitReasons } from './unverified';
import { swr } from './swrCache';

const FRESH_MS = 2 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;
const FIELDS = ['address', 'city', 'neighborhood', 'price', 'currency', 'listing_type', 'property_type', 'bedrooms', 'bathrooms', 'floor_area', 'covered_area', 'land_area', 'parking_spaces', 'contact_phone', 'external_url', 'origin'];
// The three reasons the Quarantine page names first (no contact, duplicate, unverified seller).
const MAIN = ['no_contact', 'duplicate', 'unverified_seller'];
const inList = (vals) => vals.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',');

export function heldListings(select, cc) {
  return swr(`heldListings:${cc}`, () => load(select), { fresh: FRESH_MS, stale: STALE_MS });
}

async function load(select) {
  const recs = [];
  for (let off = 0; ; off += 500) {
    const part = await select('ingest_quarantine', `select=id,source_id,external_id,reasons,payload,created_at&status=eq.pending&order=created_at.desc&limit=500&offset=${off}`);
    recs.push(...part);
    if (part.length < 500) break;
  }
  // "listing:<id>" records (photos rejected by the AI check) are about a property that
  // already exists — it's listed as inactive on its own, so skip the record here.
  for (let i = recs.length - 1; i >= 0; i--) if (String(recs[i].external_id || '').startsWith('listing:')) recs.splice(i, 1);
  const ext = [...new Set(recs.map((r) => r.external_id).filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < ext.length; i += 150) chunks.push(ext.slice(i, i + 150));
  const found = await Promise.all(chunks.map((c) => select('properties', `select=source_id,external_id&external_id=in.(${encodeURIComponent(inList(c))})`)));
  const already = new Set(found.flat().map((p) => `${p.source_id}|${p.external_id}`));

  return recs.filter((r) => !already.has(`${r.source_id}|${r.external_id}`)).map((r) => {
    const p = r.payload || {};
    const { blocking } = splitReasons(r.reasons || []);
    const main = blocking.filter((c) => MAIN.includes(c));
    return {
      ...Object.fromEntries(FIELDS.map((f) => [f, p[f] ?? null])),
      id: `q-${r.id}`,
      source_id: r.source_id,
      external_id: r.external_id,
      created_at: r.created_at,
      admin_status: 'inactive',
      _held: true,
      _live: false,
      _incomplete: true,
      _problems: main.length ? main : blocking.length ? blocking : r.reasons || [],
      _unverified: [],
    };
  });
}
