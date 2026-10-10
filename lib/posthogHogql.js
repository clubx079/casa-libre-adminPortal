// PostHog HogQL query, shared by the Analytics routes and the contacts data.
// Server-only. Needs POSTHOG_PERSONAL_API_KEY (query:read) + POSTHOG_PROJECT_ID.
//
// person.properties must be the person's CURRENT properties, not the snapshot
// stored on each event. The website runs PostHog with person_profiles
// 'identified_only': visits before sign-up are stored without a person, so their
// snapshot has no email. When the visitor signs up, posthog.identify() links those
// earlier visits to the account (person_id override), but the snapshot stays empty —
// so they kept showing as an anonymous IP visitor. 'person_id_override_properties_joined'
// reads person.properties from the persons table instead: pre-sign-up visits (and
// their first-touch source, and their WhatsApp contacts) belong to the named user.
import { swr } from './swrCache.js';

export const HOGQL_MODIFIERS = { personsOnEventsMode: 'person_id_override_properties_joined' };

export const posthogConfigured = () => !!(process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID);

// Every query is cached by its text (lib/swrCache.js): the same card asked again within
// 5 minutes costs nothing, and for 30 minutes the last answer shows at once while a fresh
// one loads behind it. "Right now" queries (INTERVAL n MINUTE) stay live: 30 s, no stale.
// Each caller gets its own copy, so sorting / editing the rows can't change the cache.
const LIVE = /INTERVAL\s+\d+\s+MINUTE/i;

export async function hogql(query, { fresh, stale, force } = {}) {
  const live = LIVE.test(query);
  const rows = await swr(`hogql:${query}`, () => runHogql(query), {
    fresh: fresh ?? (live ? 30_000 : 5 * 60_000),
    stale: stale ?? (live ? 0 : 30 * 60_000),
    force,
  });
  return structuredClone(rows);
}

async function runHogql(query) {
  const host = process.env.POSTHOG_HOST || 'https://us.posthog.com';
  const res = await fetch(`${host}/api/projects/${process.env.POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.POSTHOG_PERSONAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query, modifiers: HOGQL_MODIFIERS } }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.results || [];
}
