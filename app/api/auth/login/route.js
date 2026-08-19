import { NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/adminAuth';
import { setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  const admin = await verifyAdmin(email, password);
  if (!admin) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }
  setSessionCookie(admin);
  return NextResponse.json({ ok: true, admin: { email: admin.email, name: admin.name } });
}
