import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/leads -> potential leads (prospects we found, e.g. HolaCasa developers).
// Before migration 006 the table doesn't exist → { rows: [], pending: true }.
export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { select } = dbFor(activeCountry());
  try {
    const rows = await select('potential_leads', 'select=*&order=name.asc&limit=5000');
    return NextResponse.json({ rows, country: activeCountry() });
  } catch (e) {
    return NextResponse.json({ rows: [], pending: true, detail: String(e.message || e), country: activeCountry() });
  }
}
