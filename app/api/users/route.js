import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { HIDE_DELETED_USERS } from '@/lib/userInsights';
import { isInternalEmail } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// All buyer-portal users who registered / logged in, read from the shared
// Casa Libre `users` table (server-side, secret key — RLS has no policies).
// Accounts removed through "Delete account" are hidden (not real users), and so are
// the team's own / Pakistan accounts.
export async function GET(request) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { selectWithCount } = dbFor(activeCountry());

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  const cols = 'id,email,full_name,phone,verified,active,auth_provider,created_at,last_login_at,ip_address,registration_ip,blocked,suspended';
  let query = `select=${cols}&${HIDE_DELETED_USERS}&order=created_at.desc&limit=500`;
  if (q) {
    // case-insensitive match on email or name
    const safe = encodeURIComponent(`%${q}%`);
    query += `&or=(email.ilike.${safe},full_name.ilike.${safe})`;
  }

  try {
    const [{ rows, count }, extra] = await Promise.all([selectWithCount('users', query), internalEmails(activeCountry())]);
    // Team / Pakistan accounts never show (lib/internalTraffic + internalAudience).
    const users = rows.filter((u) => !isInternalEmail(u.email, extra));
    return NextResponse.json({ users, count: Math.max(0, count - (rows.length - users.length)) });
  } catch (err) {
    console.error('[api/users]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
