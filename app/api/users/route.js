import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { selectWithCount } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// All buyer-portal users who registered / logged in, read from the shared
// Casa Libre `users` table (server-side, secret key — RLS has no policies).
export async function GET(request) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  const cols = 'id,email,full_name,phone,verified,active,auth_provider,created_at,last_login_at,ip_address,registration_ip,blocked,suspended';
  let query = `select=${cols}&order=created_at.desc&limit=500`;
  if (q) {
    // case-insensitive match on email or name
    const safe = encodeURIComponent(`%${q}%`);
    query += `&or=(email.ilike.${safe},full_name.ilike.${safe})`;
  }

  try {
    const { rows, count } = await selectWithCount('users', query);
    return NextResponse.json({ users: rows, count });
  } catch (err) {
    console.error('[api/users]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
