import { NextResponse } from 'next/server';

// Perimeter guard: anything outside the public login surface requires the admin
// session cookie to even be present. The cookie's HMAC signature is verified for
// real in the server layout / API routes (Node runtime); here we only gate on
// presence so unauthenticated traffic never reaches a protected page.
const COOKIE = 'cl_admin_session';
// /api/media = public image proxy (no session); /api/cron = Bearer CRON_SECRET auth.
const PUBLIC = ['/login', '/api/auth/login', '/api/media', '/api/cron'];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow Next internals and static assets through.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(COOKIE)?.value);
  if (!hasSession) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
