import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/reports -> all no-response reports, newest first
export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { select } = dbFor(activeCountry());
  try {
    const rows = await select('listing_reports', 'select=*&order=created_at.desc');
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
