// Active-country state for the shared admin. A cookie (`cl_admin_country`) selects
// which country's DB every screen reads/writes via dbFor(activeCountry()). Defaults
// to Paraguay so, with no cookie, the admin behaves exactly as before.
import 'server-only';
import { cookies } from 'next/headers';
import { getSession } from './auth';

const COOKIE = 'cl_admin_country';
const DEFAULT_COUNTRY = (process.env.DEFAULT_COUNTRY || 'py').toLowerCase();
const CODE_RE = /^[a-z]{2,4}$/;

// The signed-in admin's allowed country codes, or null for ALL (superadmin /
// env-fallback account). Reads the session cookie synchronously (request scope).
export function allowedCountryCodes() {
  try {
    const s = getSession();
    const a = s?.allowed_countries;
    return Array.isArray(a) ? a.map((c) => String(c).toLowerCase()) : null;
  } catch { return null; }
}

// True if the signed-in admin may act on `code` (superadmin => always true).
export function canAccessCountry(code) {
  const allowed = allowedCountryCodes();
  if (!allowed) return true;
  return allowed.includes(String(code || '').toLowerCase());
}

// Filter a registry list down to what the signed-in admin may see (superadmin => all).
export function filterCountriesForSession(countries = []) {
  const allowed = allowedCountryCodes();
  if (!allowed) return countries;
  return countries.filter((c) => allowed.includes(String(c.code).toLowerCase()));
}

// Synchronous — safe inside server components and route handlers (request scope).
// The result is CLAMPED to the admin's allowed countries: an admin can never end
// up acting on a country outside their access, even by forging the cookie — every
// screen/API that resolves the active country through here is protected.
export function activeCountry() {
  let code = DEFAULT_COUNTRY;
  try {
    const c = cookies().get(COOKIE)?.value;
    if (c && CODE_RE.test(c)) code = c.toLowerCase();
  } catch {}
  const allowed = allowedCountryCodes();
  if (allowed && allowed.length && !allowed.includes(code)) return allowed[0];
  return code;
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
