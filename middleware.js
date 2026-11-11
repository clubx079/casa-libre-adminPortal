import { NextResponse } from 'next/server';
import { canOpenPath, homeFor } from '@/lib/adminPages';

// Perimeter guard: anything outside the public login surface requires the admin
// session cookie to even be present. The cookie's HMAC signature is verified for
// real in the server layout / API routes (Node runtime); here we gate on presence and,
// for members with a ready-made role or custom page list (Team → Page access,
// lib/adminPages.js), on the pages / APIs that role may open.
const COOKIE = 'cl_admin_session';
const SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret';
// /api/media = public image proxy (no session); /api/cron = Bearer CRON_SECRET auth;
// /api/relay/webhook = Relay's signed events (HMAC, RELAY_WEBHOOK_SECRET).
// The invite / password-recovery surface is reachable pre-login (logged-out users
// set/reset their password) — the APIs validate the one-time token themselves.
const PUBLIC = [
  '/login',
  '/api/auth/login',
  '/api/media',
  '/api/cron',
  '/api/relay/webhook',
  // Pre-login account flows (pages + their token-validated APIs):
  '/aceptar-invitacion',
  '/recuperar-clave',
  '/restablecer-clave',
  '/api/auth/accept-invite',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];

// The session cookie's payload when its signature is valid (same scheme as lib/auth.js, Web Crypto
// because middleware runs on the edge). null = unsigned / unreadable / expired.
const enc = new TextEncoder();
let keyPromise = null;
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
async function readSession(token) {
  try {
    if (!token || !token.includes('.')) return null;
    const [p, sig] = token.split('.');
    keyPromise ||= crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await keyPromise, enc.encode(p)));
    if (b64url(mac) !== sig) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    return payload?.exp && payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow Next internals and static assets through.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Page access: a restricted member only reaches the pages (and their APIs) of their role.
  const session = await readSession(token);
  if (session && !canOpenPath(session, pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'forbidden_page', message: 'Your role does not include this page.' }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = homeFor(session);
    url.search = '';
    return NextResponse.redirect(url);
  }

  // The dashboard layout reads the path (to re-check access against the control DB, which can be
  // newer than the cookie).
  const headers = new Headers(request.headers);
  headers.set('x-pathname', pathname + (request.nextUrl.search || ''));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
