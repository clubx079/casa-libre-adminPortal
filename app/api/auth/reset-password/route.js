import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { resetPassword } from '@/lib/control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/reset-password  { token, password }
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: 'weak_password' }, { status: 400 });

  const hash = await bcrypt.hash(password, 10);
  let updated;
  try {
    updated = await resetPassword(token, hash);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'invalid_or_expired' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
