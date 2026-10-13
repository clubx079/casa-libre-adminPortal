// One-off: map pins for the Xitios (El Salvador) listings inserted before the adapter
// geocoded. Reads raw_data (title + place) and writes latitude/longitude. Only rows
// of the xitios_sv source with no coordinates are touched. Run against the SV DB:
//   SV_URL=… SV_KEY=… node scripts/sv-backfill-coords.mjs [--dry]
import { geocodeListing } from '../lib/adapters/xitios.js';

const URL = process.env.SV_URL, KEY = process.env.SV_KEY;
const dry = process.argv.includes('--dry');
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const src = await (await fetch(`${URL}/rest/v1/scrape_sources?select=id&key=eq.xitios_sv`, { headers: h })).json();
if (!src[0]) throw new Error('xitios_sv source not found');
const rows = await (await fetch(`${URL}/rest/v1/properties?select=id,raw_data,city,province&source_id=eq.${src[0].id}&latitude=is.null`, { headers: h })).json();
console.log(`${rows.length} rows without coordinates`);
const tally = {};
for (const r of rows) {
  const c = { ...(r.raw_data || {}) };
  if (!c.place && !c.location) c.place = [r.city, r.province].filter(Boolean).join(', ');
  const g = await geocodeListing(c);
  tally[g ? g.precision : 'none'] = (tally[g ? g.precision : 'none'] || 0) + 1;
  console.log(g ? `${g.precision.padEnd(12)} ${g.lat.toFixed(4)},${g.lng.toFixed(4)}  ${c.title}` : `none          ${c.title}`);
  if (!g || dry) continue;
  const res = await fetch(`${URL}/rest/v1/properties?id=eq.${r.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ latitude: g.lat, longitude: g.lng }) });
  if (!res.ok) console.log('  PATCH failed', res.status, await res.text());
}
console.log(tally);
