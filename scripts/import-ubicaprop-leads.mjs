// Import Ubicaprop agents + agencies (CSV from the Ubicaprop scraper) — plus the HolaCasa
// developers — into potential_leads (Admin → Leads, type tabs Agents / Agencies / Developers).
//
//   LEADS_DB_URL=… LEADS_DB_KEY=… node scripts/import-ubicaprop-leads.mjs <folder-with-csvs> [--apply]
//
// The target DB must be given explicitly (no fallback to any country). Default = dry run.
// Rows are keyed by source_url and existing ones are left untouched (ignore-duplicates),
// so statuses set in the admin are never overwritten. Agents: legal_name = their agency.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLeadRow } from '../lib/potentialLeads.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const URL_ = process.env.LEADS_DB_URL, KEY = process.env.LEADS_DB_KEY;
if (!dir || !URL_ || !KEY) { console.error('usage: LEADS_DB_URL=… LEADS_DB_KEY=… node scripts/import-ubicaprop-leads.mjs <dir> [--apply]'); process.exit(1); }

// Minimal CSV parser (quoted fields, commas, newlines in quotes).
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const loc = (...xs) => [...new Set(xs.filter(Boolean))].join(', ');

const rows = [];
for (const a of parseCsv(fs.readFileSync(path.join(dir, 'ubicaprop-agents.csv'), 'utf8'))) {
  const r = toLeadRow({ name: a.name, legal_name: a.agency, phone: a.phone, whatsapp: a.whatsapp, email: a.email, location: loc(a.city, a.department), profile_url: a.profile_url }, { source: 'ubicaprop', category: 'agent' });
  if (r) rows.push(r);
}
for (const g of parseCsv(fs.readFileSync(path.join(dir, 'ubicaprop-agencies.csv'), 'utf8'))) {
  // The agency's OWN contact block (address / email / phone) — never one of its agents'.
  const r = toLeadRow({ name: g.agency, phone: g.phone, whatsapp: g.mobile || g.phone, email: g.email, location: g.address || loc(g.city, g.department), profile_url: g.profile_url }, { source: 'ubicaprop', category: 'agency' });
  if (r) { r.notes = [`${g.agents_on_ubicaprop} agents on Ubicaprop`, g.website, g.social].filter(Boolean).join(' · '); rows.push(r); }
}
const hc = path.join(here, 'data', 'holacasa-desarrolladoras.json');
if (fs.existsSync(hc)) for (const d of JSON.parse(fs.readFileSync(hc, 'utf8'))) { const r = toLeadRow(d, { source: 'holacasa', category: 'developer' }); if (r) rows.push(r); }

for (const r of rows) if (!('notes' in r)) r.notes = null;   // bulk insert takes its columns from the first row
const by = rows.reduce((m, r) => ((m[r.category] = (m[r.category] || 0) + 1), m), {});
console.log(`${rows.length} rows`, by, apply ? '→ inserting' : '(dry run)');
if (!apply) process.exit(0);
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' };
for (let i = 0; i < rows.length; i += 200) {
  const res = await fetch(`${URL_}/rest/v1/potential_leads?on_conflict=source_url`, { method: 'POST', headers: h, body: JSON.stringify(rows.slice(i, i + 200)) });
  if (!res.ok) { console.error('insert failed', res.status, await res.text()); process.exit(1); }
}
const c = await fetch(`${URL_}/rest/v1/potential_leads?select=id`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' } });
console.log('table now has', (c.headers.get('content-range') || '').split('/')[1], 'leads');
