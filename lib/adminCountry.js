// Active-country state for the shared admin. A cookie (`cl_admin_country`) selects
// which country's DB every screen reads/writes via dbFor(activeCountry()). Defaults
// to Paraguay so, with no cookie, the admin behaves exactly as before.
import 'server-only';
import { cookies } from 'next/headers';

const COOKIE = 'cl_admin_country';
const DEFAULT_COUNTRY = (process.env.DEFAULT_COUNTRY || 'py').toLowerCase();
const CODE_RE = /^[a-z]{2,4}$/;

// Synchronous — safe inside server components and route handlers (request scope).
export function activeCountry() {
  try {
    const c = cookies().get(COOKIE)?.value;
    if (c && CODE_RE.test(c)) return c.toLowerCase();
  } catch {}
  return DEFAULT_COUNTRY;
}

export function setActiveCountryCookie(code) {
  const c = String(code || '').toLowerCase();
  cookies().set(COOKIE, CODE_RE.test(c) ? c : DEFAULT_COUNTRY, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export const COUNTRY_COOKIE = COOKIE;
export { DEFAULT_COUNTRY };
