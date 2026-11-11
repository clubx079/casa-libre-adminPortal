// GET /api/auth/refresh?next=/path → re-issues the signed-in member's session from the control DB
// (role, countries, page access) and goes back to `next`. The dashboard layout sends people here
// when a Super Admin changed their access since they signed in; a removed or deactivated member
// is signed out.
import { NextResponse } from 'next/server';
import { getSession, setSessionCookie, clearSessionCookie } from '@/lib/auth';
import { currentAccess, forgetAccess } from '@/lib/control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const safeNext = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/api/') ? v : '/');

export async function GET(req) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'));
  const session = getSession();
  if (!session) return NextResponse.redirect(new URL('/login', url));
  if (!session.id) return NextResponse.redirect(new URL(next, url));   // env emergency account: nothing to refresh

  forgetAccess(session.id);
  const now = await currentAccess(session.id);
  if (!now) return NextResponse.redirect(new URL(next, url));         // control DB unreachable: keep the session
  if (now.removed || !now.is_active) {
    clearSessionCookie();
    return NextResponse.redirect(new URL('/login', url));
  }
  setSessionCookie({ ...now.row, page_access: now.page_access });
  return NextResponse.redirect(new URL(next, url));
}
