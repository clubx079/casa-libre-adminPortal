// Shared reads for the SEO stages: live listings → inventory, places for the matcher. Read-only on
// the country DB. Server-only.
import 'server-only';
import { selectAll } from '../selectAll.js';
import { listingsDb } from './store.js';
import { buildInventory } from './inventory.js';
import { citiesFor } from './places.js';

const cache = (globalThis.__clSeoInv ||= new Map());   // cc → { at, inv }

export async function loadInventory(cc, { fresh = false } = {}) {
  const hit = cache.get(cc);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.inv;
  const rows = await selectAll(listingsDb(cc), 'properties', 'select=id,listing_type,property_type,city,neighborhood,price_usd,bedrooms,created_at&is_complete=eq.true&admin_status=eq.active&order=id.asc');
  const inv = buildInventory(rows, citiesFor(cc));
  cache.set(cc, { at: Date.now(), inv });
  return inv;
}

export function placesFrom(cc, inv) {
  const barrios = [];
  for (const r of inv.values()) if (r.level === 'barrio' && r.barrio !== r.ciudad) barrios.push({ slug: r.barrio, name: r.barrioName || r.barrio, ciudad: r.ciudad });
  return { cities: citiesFor(cc), barrios };
}
