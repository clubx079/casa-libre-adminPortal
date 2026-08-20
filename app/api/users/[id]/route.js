import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { update } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only these fields may be patched from the admin Users page. Anything else
// (email, active, role, ...) must go through a different, more deliberate flow.
const EDITABLE = ['blocked', 'suspended'];

// PATCH /api/users/:id -> toggle block/suspend flags
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
