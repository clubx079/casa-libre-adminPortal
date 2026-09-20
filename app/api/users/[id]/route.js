import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only these fields may be patched from the admin Users page. Anything else
// (email, active, role, ...) must go through a different, more deliberate flow.
const EDITABLE = ['blocked', 'suspended'];

// PATCH /api/users/:id -> toggle block/suspend flags
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { update } = dbFor(activeCountry());

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const patch = {};
  for (const k of EDITABLE) {
    if (k in body) patch[k] = body[k] === true || body[k] === 'true';
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  try {
    const [row] = await update('users', `id=eq.${params.id}`, patch, { returning: 'representation' });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// DELETE /api/users/:id -> permanently remove a buyer user (admin cleanup of test
// accounts). Best-effort clears the user's own dependent rows first so a foreign-key
// constraint doesn't block the delete; each dependent table is optional (ignored if
// it doesn't exist on this country's DB). Self-published PROPERTIES are intentionally
// left in place (properties.created_by has no FK to users) — deleting an account
// should not silently pull its live listings.
export async function DELETE(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { remove } = dbFor(activeCountry());
  const id = params.id;
  // Dependent rows keyed by the user id, cleared before the user row itself.
  for (const [table, col] of [
    ['saved_properties', 'user_id'],
    ['otp_codes', 'user_id'],
    ['sessions', 'user_id'],
    ['feedback', 'user_id'],
  ]) {
    try { await remove(table, `${col}=eq.${id}`); } catch { /* table may not exist / no rows — ignore */ }
  }
  try {
    await remove('users', `id=eq.${id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
