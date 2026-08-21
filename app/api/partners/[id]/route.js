import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { update } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['new', 'contacted', 'migrating', 'live', 'discarded'];

// PATCH /api/partners/:id -> update the lead status only (whitelisted)
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (!STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Estado invalido' }, { status: 400 });
  }
  try {
    const [row] = await update(
      'partner_inquiries',
      `id=eq.${params.id}`,
      { status: body.status, updated_at: new Date().toISOString() },
      { returning: 'representation' },
    );
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
