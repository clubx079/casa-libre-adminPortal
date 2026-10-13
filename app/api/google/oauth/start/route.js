// GET /api/google/oauth/start — "Connect Google" on the Marketing page: off to Google's
// sign-in (sign in as omar@airosofts.com), back to /api/google/oauth/callback.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { authUrl, makeState, googleSetup } from '@/lib/googleApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.redirect(new URL('/login', req.url));
  const s = googleSetup();
  if (!s.clientId || !s.clientSecret) return NextResponse.redirect(new URL('/marketing?google=missing_client', req.url));
  const state = makeState();
  const res = NextResponse.redirect(authUrl(req, state));
  res.cookies.set('cl_g_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 });
  return res;
}
