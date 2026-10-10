// Emails of accounts that belong to the dev team, found at runtime, so a NEW test
// account made from Pakistan is hidden without anyone adding it to a list:
//   · its sign-up or last IP is in Pakistan (users.registration_ip / ip_address), or
//   · PostHog saw that person browsing from Pakistan.
// The fixed list (+ any .pk address) is lib/internalTraffic.js. Server-only. Never
// throws: a failed lookup just finds nothing extra.
//
// Kept per country with lib/swrCache.js: fresh for 10 minutes, after that the last list
// is used at once while a new one loads behind it (so the Overview / Users pages never
// wait for it again). IP locations are remembered (lib/ipGeo.js), so a refresh only
// looks up IPs it hasn't seen.
import { dbFor } from './db.js';
import { hogql, posthogConfigured } from './posthogHogql.js';
import { ipGeo } from './ipGeo.js';
import { swr } from './swrCache.js';

const FRESH_MS = 10 * 60 * 1000;
const STALE_MS = 24 * 3600 * 1000;

async function load(country) {
  const emails = new Set();
  const [users, phRows] = await Promise.all([
    dbFor(country).select('users', 'select=email,registration_ip,ip_address&limit=5000')
      .catch((e) => { console.error('[internalAudience] users', e?.message || e); return []; }),
    posthogConfigured()
      ? hogql(`SELECT DISTINCT lower(person.properties.email) FROM events
        WHERE coalesce(person.properties.email, '') != '' AND properties.$geoip_country_name = 'Pakistan' LIMIT 5000`, { fresh: FRESH_MS, stale: 0 })
        .catch((e) => { console.error('[internalAudience] posthog', e?.message || e); return []; })
      : [],
  ]);
  try {
    const geo = await ipGeo(users.flatMap((u) => [u.registration_ip, u.ip_address]));
    const pk = (ip) => !!ip && geo[ip]?.country === 'PK';
    for (const u of users) if (u.email && (pk(u.registration_ip) || pk(u.ip_address))) emails.add(String(u.email).toLowerCase());
  } catch (e) { console.error('[internalAudience] ip', e?.message || e); }
  for (const [e] of phRows) if (e) emails.add(String(e));
  return emails;
}

// → Set of lower-case emails (in addition to lib/internalTraffic.js's fixed list).
export async function internalEmails(country = 'py') {
  try {
    return await swr(`internalAudience:${country}`, () => load(country), { fresh: FRESH_MS, stale: STALE_MS });
  } catch {
    return new Set();
  }
}
