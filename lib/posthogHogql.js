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
export const HOGQL_MODIFIERS = { personsOnEventsMode: 'person_id_override_properties_joined' };

export const posthogConfigured = () => !!(process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID);

export async function hogql(query) {
  const host = process.env.POSTHOG_HOST || 'https://us.posthog.com';
  const res = await fetch(`${host}/api/projects/${process.env.POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.POSTHOG_PERSONAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query, modifiers: HOGQL_MODIFIERS } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.results || [];
}
