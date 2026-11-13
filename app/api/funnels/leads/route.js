import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { leadsQuery, filterFunnelLeads, funnelCounts, isMissingTable, normSite, normStatus, normLeadDays } from '@/lib/funnelLeads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/funnels/leads?site=all|owners|agents&status=all|new|…&days=30&q=
// → leads from the funnel sites stored in the ACTIVE country's DB (public.funnel_leads).
// Counts cover the whole date window; rows are filtered by site / status / search.
// Before the migration runs on that DB → { missing: true } (the page shows how to fix it).
export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const country = activeCountry();
  const sp = new URL(req.url).searchParams;
  const site = normSite(sp.get('site'));
  const status = normStatus(sp.get('status'));
  const days = normLeadDays(sp.get('days'));
  const q = String(sp.get('q') || '').slice(0, 100);
  try {
    const all = await dbFor(country).select('funnel_leads', leadsQuery({ days }));
    const list = Array.isArray(all) ? all : [];
    const rows = filterFunnelLeads(list, { site, status, q });
    return NextResponse.json({ country, days, site, status, counts: funnelCounts(list), rows, capped: list.length >= 5000 });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ country, missing: true, rows: [], counts: funnelCounts([]) });
    return NextResponse.json({ country, error: String(e.message || e), rows: [], counts: funnelCounts([]) }, { status: 500 });
  }
}
