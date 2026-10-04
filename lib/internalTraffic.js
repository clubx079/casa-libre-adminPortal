// Our own team's activity, kept out of the admin's numbers and lists. Analytics
// already hides Pakistan (the dev team, posthog route GEO_BASE); the contacts list
// hides the same, plus the team's own names / emails wherever they appear.
// Add a teammate here. Pure (test/internalTraffic.test.js).
export const INTERNAL_COUNTRIES = ['PK', 'Pakistan'];
export const INTERNAL_NAMES = ['omar faiz', 'omar new'];   // 'Omar New' = omar57new@gmail.com, the app test account
// Team / test addresses. Also hidden: any .pk address, and — at runtime — accounts
// whose sign-up IP or PostHog activity is in Pakistan (lib/internalAudience.js).
export const INTERNAL_EMAILS = [
  'omar@airosofts.com', 'omar@airosofts.con', 'omar57new@gmail.com', 'omarsap6@gmail.com',
  'admin@airosofts.com',
  'review@casa-libre.com.py',   // the store-review login (created from Pakistan)
  // test addresses
  'putin571105@gmail.com', 'siliconpixels.org@gmail.com', 'clubx079@gmail.com', 'info@casa-libre.com',
];

// Emails that go to the team, not to users ("Book a call" / investor leads from the
// website) and admin test sends: never counted in the admin's email numbers.
export const HIDDEN_EMAIL_TYPES = ['Test send', 'Book a call', 'Investor inquiry'];

const norm = (v) => String(v || '').trim().toLowerCase();
const COUNTRIES = new Set(INTERNAL_COUNTRIES.map(norm));

// extra: a Set of more internal emails found at runtime (lower-case).
export function isInternalEmail(email, extra = null) {
  const e = norm(email);
  if (!e || !e.includes('@')) return false;
  return INTERNAL_EMAILS.includes(e) || /\.pk$/.test(e) || !!extra?.has(e);
}

export function isInternalContact(r = {}, extra = null) {
  return INTERNAL_NAMES.includes(norm(r.buyer_name))
    || isInternalEmail(r.buyer_email, extra)
    || COUNTRIES.has(norm(r.buyer_country));
}

// 'PY' → 'Paraguay'; a name stays a name; empty → null.
export function countryName(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^[a-z]{2}$/i.test(s)) {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(s.toUpperCase()) || s.toUpperCase(); } catch { return s.toUpperCase(); }
  }
  return s;
}
