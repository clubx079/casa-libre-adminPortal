// Import scraped prospects into potential_leads (Admin → Leads).
//
//   node scripts/import-potential-leads.mjs [--country=py] [--apply]
//
// Default is a DRY RUN (prints what would be inserted). --apply writes. Re-running
// is safe: rows are keyed by source_url and existing ones are left untouched
// (ignore-duplicates), so statuses/notes set in the admin are never overwritten.
// Data: scripts/data/holacasa-desarrolladoras.json (from holacasa.com.py/desarrolladoras).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLeadRow } from '../lib/potentialLeads.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const country = ([...args].find((a) => a.startsWith('--country=')) || '--country=py').split('=')[1].toUpperCase();

// Read .env.local without extra deps.
const env = {};
for (const line of fs.readFileSync(path.join(here, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env[`AIROBASE_URL_${country}`] || (country === 'PY' ? env.AIROBASE_URL : '');
const KEY = env[`AIROBASE_SECRET_KEY_${country}`] || (country === 'PY' ? env.AIROBASE_SECRET_KEY : '');
if (!URL_ || !KEY) { console.error(`No DB configured for ${country}`); process.exit(1); }

const SOURCES = [
  { file: 'holacasa-desarrolladoras.json', source: 'holacasa', category: 'developer' },
];

const rows = [];
let skipped = 0;
for (const s of SOURCES) {
  const raw = JSON.parse(fs.readFileSync(path.join(here, 'data', s.file), 'utf8'));
  for (const r of raw) {
    const row = toLeadRow(r, { source: s.source, category: s.category });
    if (row) rows.push(row); else skipped++;
  }
}
const withPhone = rows.filter((r) => r.phone || r.whatsapp).length;
console.log(`${country}: ${rows.length} leads ready (${withPhone} with phone/WhatsApp), ${skipped} skipped (no name/link)`);
console.log('sample:', rows.slice(0, 2));

if (!apply) { console.log('\nDRY RUN — nothing written. Re-run with --apply to insert.'); process.exit(0); }

const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const before = await fetch(`${URL_}/rest/v1/potential_leads?select=id`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } });
if (!before.ok) { console.error('potential_leads not reachable — has migration 006 been applied?', before.status, await before.text()); process.exit(1); }
const countOf = (res) => Number((res.headers.get('content-range') || '/0').split('/')[1]) || 0;
const n0 = countOf(before);

const res = await fetch(`${URL_}/rest/v1/potential_leads?on_conflict=source_url`, {
  method: 'POST',
  headers: { ...h, Prefer: 'resolution=ignore-duplicates,return=minimal' },
  body: JSON.stringify(rows),
});
if (!res.ok) { console.error('insert failed', res.status, await res.text()); process.exit(1); }
const after = await fetch(`${URL_}/rest/v1/potential_leads?select=id`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } });
const n1 = countOf(after);
console.log(`\nDone: ${n1 - n0} new, ${rows.length - (n1 - n0)} already there. Table now has ${n1} leads.`);
