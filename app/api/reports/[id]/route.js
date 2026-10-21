import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'reviewed', 'resolved'];

// DELETE /api/reports/:id -> remove the report (e.g. a test report)
export async function DELETE(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { remove } = dbFor(activeCountry());
  try {
    await remove('listing_reports', `id=eq.${encodeURIComponent(params.id)}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// PATCH /api/reports/:id -> update status only (whitelisted)
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { update } = dbFor(activeCountry());
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
    const [row] = await update('listing_reports', `id=eq.${params.id}`, { status: body.status }, { returning: 'representation' });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
