import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { select } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/feedbacks -> user feedback (rating + message), newest first.
export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const rows = await select('feedback', 'select=*&order=created_at.desc&limit=1000');
    return NextResponse.json({ rows });
  } catch (e) {
    const msg = String(e?.message || e);
    // Table not registered yet (migration/schema-cache pending) → render empty
    // instead of a 500 that breaks the page.
    if (/does not exist|PGRST205|schema cache|not find the table/i.test(msg)) return NextResponse.json({ rows: [], pending: true });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
