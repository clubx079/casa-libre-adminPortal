import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['new', 'contacted', 'migrating', 'live', 'discarded'];

// PATCH /api/partners/:id -> update the lead status only (whitelisted)
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

// DELETE /api/partners/:id -> remove a lead for good. Only DISCARDED leads can be
// deleted (test entries, spam), so a live lead can't be wiped by a stray click.
export async function DELETE(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { select, remove } = dbFor(activeCountry());
  try {
    const [row] = await select('partner_inquiries', `select=id,status&id=eq.${encodeURIComponent(params.id)}&limit=1`);
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (row.status !== 'discarded') return NextResponse.json({ error: 'Discard the lead first' }, { status: 409 });
    await remove('partner_inquiries', `id=eq.${encodeURIComponent(params.id)}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
