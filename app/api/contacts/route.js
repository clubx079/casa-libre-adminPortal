import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { select } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/contacts -> WhatsApp contact-link events (who contacted which seller
// about which property, and whether the seller opened the link), newest first.
export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const rows = await select('contact_link_clicks', 'select=*&order=created_at.desc&limit=1000');
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
