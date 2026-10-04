// Emails of accounts that belong to the dev team, found at runtime, so a NEW test
// account made from Pakistan is hidden without anyone adding it to a list:
//   · its sign-up or last IP is in Pakistan (users.registration_ip / ip_address), or
//   · PostHog saw that person browsing from Pakistan.
// The fixed list (+ any .pk address) is lib/internalTraffic.js. Server-only; kept 10
// minutes per country on globalThis (shared by every route bundle). Never throws: a
// failed lookup just finds nothing extra.
import { dbFor } from './db.js';
import { hogql, posthogConfigured } from './posthogHogql.js';

const TTL_MS = 10 * 60 * 1000;
const cache = (globalThis.__clInternalAudience ||= new Map()); // country -> { at, promise }

async function pakistanIps(ips) {
  const out = new Set();
  for (let i = 0; i < ips.length; i += 100) {
    // ip-api.com batch (the Users page already uses it for locations). Free tier is http only.
    const res = await fetch('http://ip-api.com/batch?fields=query,countryCode', { method: 'POST', body: JSON.stringify(ips.slice(i, i + 100)), cache: 'no-store' });
    if (!res.ok) continue;
    for (const g of await res.json()) if (g?.countryCode === 'PK') out.add(g.query);
  }
  return out;
}

async function load(country) {
  const emails = new Set();
  try {
    const users = await dbFor(country).select('users', 'select=email,registration_ip,ip_address&limit=5000');
    const ips = [...new Set(users.flatMap((u) => [u.registration_ip, u.ip_address]).filter(Boolean))];
    const pk = ips.length ? await pakistanIps(ips) : new Set();
    for (const u of users) if (u.email && (pk.has(u.registration_ip) || pk.has(u.ip_address))) emails.add(String(u.email).toLowerCase());
  } catch (e) { console.error('[internalAudience] users', e?.message || e); }
  try {
    if (posthogConfigured()) {
      const rows = await hogql(`SELECT DISTINCT lower(person.properties.email) FROM events
        WHERE coalesce(person.properties.email, '') != '' AND properties.$geoip_country_name = 'Pakistan' LIMIT 5000`);
      for (const [e] of rows) if (e) emails.add(String(e));
    }
  } catch (e) { console.error('[internalAudience] posthog', e?.message || e); }
  return emails;
}

// → Set of lower-case emails (in addition to lib/internalTraffic.js's fixed list).
export async function internalEmails(country = 'py') {
  let hit = cache.get(country);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    hit = { at: Date.now(), promise: load(country) };
    cache.set(country, hit);
  }
  return hit.promise;
}
