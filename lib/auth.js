import 'server-only';
import crypto from 'crypto';
import { cookies } from 'next/headers';

// Stateless HMAC-signed session cookie for the admin portal. Same scheme the
// buyer portal uses, but a distinct cookie name/secret so the sessions never
// collide with the public site.
const COOKIE = 'cl_admin_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret';

const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');

export function makeToken(admin) {
  const payload = {
    email: admin.email,
    name: admin.name || 'Admin',
    exp: Date.now() + MAX_AGE * 1000,
  };
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${p}.${sign(p)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [p, sig] = token.split('.');
  const expected = sign(p);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.exp || payload.exp < Date.now()) return null;
  return payload;
}

export function getSession() {
  const token = cookies().get(COOKIE)?.value;
  return verifyToken(token);
}

export function setSessionCookie(admin) {
  cookies().set(COOKIE, makeToken(admin), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie() {
  cookies().set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export const COOKIE_NAME = COOKIE;
