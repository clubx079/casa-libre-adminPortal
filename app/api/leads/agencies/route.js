// GET /api/leads/agencies → the Leads page's "Agency websites" tab: the leads of the active
// country grouped one row per agency (lib/agencySites.js), with the website check results
// (data/agencySiteChecks.json, written by the site checker) and whether each one is already
// on Casa-Libre (an account or a listing with the same phone / email / email domain).
import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { groupAgencies, matchCasaLibre } from '@/lib/agencySites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function selectAll(select, table, query, size = 1000) {
  const out = [];
  for (let off = 0; off < 100000; off += size) {
    const rows = await select(table, `${query}&limit=${size}&offset=${off}`);
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

async function siteChecks() {
  try { return JSON.parse(await fs.readFile(path.join(process.cwd(), 'data', 'agencySiteChecks.json'), 'utf8')); } catch { return {}; }
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const country = activeCountry();
  const { select } = dbFor(country);
  let rows;
  try {
    rows = await selectAll(select, 'potential_leads', 'select=id,name,legal_name,category,phone,whatsapp,email,location,source,source_url&order=name.asc');
  } catch (e) {
    return NextResponse.json({ agencies: [], pending: true, detail: String(e.message || e), country });
  }
  const { agencies, independent } = groupAgencies(rows);
  const [users, listings, checks] = await Promise.all([
    selectAll(select, 'users', 'select=phone,email&order=id.asc').catch(() => []),
    selectAll(select, 'properties', 'select=contact_phone&origin=eq.user&status=eq.published&contact_phone=not.is.null&order=id.asc').catch(() => []),
    siteChecks(),
  ]);
  matchCasaLibre(agencies, { users, listings });
  for (const a of agencies) {
    const c = a.host ? checks[a.host] : null;
    a.site = c ? { checkedAt: c.checkedAt, ok: !!c.ok, listings: c.listings ?? null, page: c.page || null, status: c.status || 0 } : null;
    delete a.leadIds;
  }
  return NextResponse.json({ agencies, independent, leads: rows.length, country, checkedSites: Object.keys(checks).length });
}
