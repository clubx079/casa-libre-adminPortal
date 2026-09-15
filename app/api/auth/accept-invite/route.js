import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { acceptInvite } from '@/lib/control';
import { setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/accept-invite  { token, password }
// Sets the invitee's password, activates the account, clears the invite token,
// and logs them straight in.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: 'weak_password' }, { status: 400 });

  const hash = await bcrypt.hash(password, 10);
  let admin;
  try {
    admin = await acceptInvite(token, hash);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
  if (!admin) return NextResponse.json({ error: 'invalid_or_expired' }, { status: 400 });

  setSessionCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    allowed_countries: admin.allowed_countries ?? null,
  });
  return NextResponse.json({ ok: true });
}
