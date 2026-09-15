import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { getAdminById, changePassword } from '@/lib/control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/change-password  { current, next }
// Any logged-in admin can change their own password. Verifies `current` via bcrypt.
export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // The env-fallback superadmin isn't a DB row → nothing to update here.
  if (!session.id) return NextResponse.json({ error: 'env_account' }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }
  const current = String(body.current || '');
  const next = String(body.next || '');
  if (next.length < 8) return NextResponse.json({ error: 'weak_password' }, { status: 400 });

  const admin = await getAdminById(session.id);
  if (!admin || !admin.password_hash) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ok = await bcrypt.compare(current, admin.password_hash);
  if (!ok) return NextResponse.json({ error: 'wrong_current' }, { status: 400 });

  try {
    const hash = await bcrypt.hash(next, 10);
    await changePassword(session.id, hash);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
