// Listings held in Quarantine (pending ingest_quarantine records) shaped like properties
// rows, so the Properties page lists them as inactive: they're scraped listings that are
// not on the site, they just never became properties (the scraper held them back first).
// Records whose listing IS already a property are old leftovers and are left out.
//
// The payloads carry the whole scraped page (PY ~7 MB for ~430 records), so only the slim
// rows are kept, 2 minutes per country. Server-only.
import 'server-only';
import { splitReasons } from './unverified';

const CACHE_MS = 2 * 60 * 1000;
const cache = (globalThis.__clHeldListingsCache ||= new Map());
const FIELDS = ['address', 'city', 'neighborhood', 'price', 'currency', 'listing_type', 'property_type', 'bedrooms', 'bathrooms', 'floor_area', 'covered_area', 'land_area', 'parking_spaces', 'contact_phone', 'external_url', 'origin'];
// The three reasons the Quarantine page names first (no contact, duplicate, unverified seller).
const MAIN = ['no_contact', 'duplicate', 'unverified_seller'];
const inList = (vals) => vals.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',');

export async function heldListings(select, cc) {
  const hit = cache.get(cc);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  const recs = [];
  for (let off = 0; ; off += 500) {
    const part = await select('ingest_quarantine', `select=id,source_id,external_id,reasons,payload,created_at&status=eq.pending&order=created_at.desc&limit=500&offset=${off}`);
    recs.push(...part);
    if (part.length < 500) break;
  }
  const ext = [...new Set(recs.map((r) => r.external_id).filter(Boolean))];
  const already = new Set();
  for (let i = 0; i < ext.length; i += 150) {
    const rows = await select('properties', `select=source_id,external_id&external_id=in.(${encodeURIComponent(inList(ext.slice(i, i + 150)))})`);
    for (const p of rows) already.add(`${p.source_id}|${p.external_id}`);
  }

  const rows = recs.filter((r) => !already.has(`${r.source_id}|${r.external_id}`)).map((r) => {
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
  cache.set(cc, { at: Date.now(), rows });
  return rows;
}
