import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/partners -> business/partner inquiries (/empresas leads), newest first
export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { select } = dbFor(activeCountry());
  try {
    const rows = await select('partner_inquiries', 'select=*&order=created_at.desc&limit=1000');
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
