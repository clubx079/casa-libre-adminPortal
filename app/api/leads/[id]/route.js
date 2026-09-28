import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { LEAD_STATUSES } from '@/lib/potentialLeads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uuidOk = (id) => /^[0-9a-f-]{36}$/i.test(String(id || ''));

// PATCH /api/leads/:id -> change status and/or notes (whitelisted fields only)
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!uuidOk(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const patch = {};
  if (body.status !== undefined) {
    if (!LEAD_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    patch.status = body.status;
  }
  if (body.notes !== undefined) patch.notes = String(body.notes || '').slice(0, 2000) || null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  const { update } = dbFor(activeCountry());
  try {
    const [row] = await update('potential_leads', `id=eq.${params.id}`, { ...patch, updated_at: new Date().toISOString() }, { returning: 'representation' });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// DELETE /api/leads/:id -> only discarded leads, so a stray click can't wipe one.
export async function DELETE(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!uuidOk(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { select, remove } = dbFor(activeCountry());
  try {
    const [row] = await select('potential_leads', `select=id,status&id=eq.${params.id}&limit=1`);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (row.status !== 'discarded') return NextResponse.json({ error: 'Discard the lead first' }, { status: 409 });
    await remove('potential_leads', `id=eq.${params.id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
