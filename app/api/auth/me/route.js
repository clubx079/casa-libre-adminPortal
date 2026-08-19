import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ admin: null }, { status: 401 });
  return NextResponse.json({ admin: { email: session.email, name: session.name } });
}
