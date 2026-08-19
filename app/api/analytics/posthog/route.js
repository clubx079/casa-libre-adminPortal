import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

// Casa Libre buyer-behaviour analytics, read from PostHog via the HogQL query
// API. Protected by the admin session. Returns { configured:false } until the
// server env is set, so the UI can render a "connect PostHog" state.
//
//   POSTHOG_PERSONAL_API_KEY  phx_… (scope: query:read)
//   POSTHOG_PROJECT_ID        e.g. 530284
//   POSTHOG_HOST              https://us.posthog.com   (query host — no "i.")
//
// Modes (?type=):
//   (default)  dashboard — totals, funnel, top events, trend
//   users      one row per identified user with activity counts
//   activity   a single user's event timeline (&personId=<uuid>)
//   resolve    map a DB user (distinctId/email) → a PostHog person
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const POSTHOG_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

async function hogql(query) {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${POSTHOG_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.results || [];
}

const stepQuery = (event) => `
  SELECT count(DISTINCT person_id) AS c
  FROM events
  WHERE event = '${event}' AND timestamp >= now() - INTERVAL 30 DAY
`;

const flat = (rows) => rows.map((r) => (Array.isArray(r) ? r : Object.values(r)));

// ── users list: one row per identified user ──
async function usersList() {
  const rows = await hogql(`
    SELECT
      person_id,
      any(person.properties.email) AS email,
      any(person.properties.first_name) AS first_name,
      any(person.properties.last_name) AS last_name,
      count() AS events,
      countIf(event = 'property_viewed') AS views,
      countIf(event = 'property_saved') AS saves,
      countIf(event = 'contact_seller_clicked') AS contacts,
      countIf(event = 'listing_created') AS listings,
      min(timestamp) AS first_seen,
      max(timestamp) AS last_seen
    FROM events
    WHERE timestamp >= now() - INTERVAL 90 DAY
    GROUP BY person_id
    ORDER BY last_seen DESC
    LIMIT 200
  `);
  const users = flat(rows).map((r) => ({
    person_id: r[0],
    email: r[1] || '',
    name: [r[2], r[3]].filter(Boolean).join(' '),
    events: Number(r[4] || 0),
    views: Number(r[5] || 0),
    saves: Number(r[6] || 0),
    contacts: Number(r[7] || 0),
    listings: Number(r[8] || 0),
    first_seen: r[9],
    last_seen: r[10],
  }));
  return NextResponse.json({ configured: true, users });
}

// Resolve a DB user → their PostHog person + counts. The buyer portal calls
// posthog.identify(user.id, …), so the user's user.id is their distinct_id;
// fall back to matching by email. Lets the admin deep-link from the users list.
async function resolveUser({ distinctId, email }) {
  const q = (s) => String(s || '').replace(/'/g, "''");
  let pid = null;
  if (distinctId && /^[\w-]{6,64}$/.test(distinctId)) {
    const rows = await hogql(`SELECT person_id FROM events WHERE distinct_id = '${q(distinctId)}' AND timestamp >= now() - INTERVAL 365 DAY ORDER BY timestamp DESC LIMIT 1`);
    pid = flat(rows)[0]?.[0] || null;
  }
  if (!pid && email) {
    const rows = await hogql(`SELECT person_id FROM events WHERE person.properties.email = '${q(email)}' AND timestamp >= now() - INTERVAL 365 DAY ORDER BY timestamp DESC LIMIT 1`);
    pid = flat(rows)[0]?.[0] || null;
  }
  if (!pid) return NextResponse.json({ found: false });
  const rows = await hogql(`
    SELECT person_id,
      any(person.properties.email) AS email,
      any(person.properties.first_name) AS first_name,
      any(person.properties.last_name) AS last_name,
      count() AS events,
      countIf(event = 'property_viewed') AS views,
      countIf(event = 'property_saved') AS saves,
      countIf(event = 'contact_seller_clicked') AS contacts,
      max(timestamp) AS last_seen
    FROM events WHERE person_id = '${q(pid)}' AND timestamp >= now() - INTERVAL 90 DAY
    GROUP BY person_id LIMIT 1`);
  const r = flat(rows)[0];
  if (!r) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    user: {
      person_id: r[0], email: r[1] || email || '', name: [r[2], r[3]].filter(Boolean).join(' '),
      events: Number(r[4] || 0), views: Number(r[5] || 0), saves: Number(r[6] || 0), contacts: Number(r[7] || 0), last_seen: r[8],
    },
  });
}

// ── single user's event timeline ──
async function userActivity(personId) {
  if (!/^[0-9a-f-]{16,40}$/i.test(personId)) {
    return NextResponse.json({ error: 'Invalid personId' }, { status: 400 });
  }
  const [profileRows, eventRows] = await Promise.all([
    hogql(`
      SELECT
        any(person.properties.email) AS email,
        any(person.properties.first_name) AS first_name,
        any(person.properties.last_name) AS last_name,
        count() AS events,
        count(DISTINCT properties.$session_id) AS sessions,
        min(timestamp) AS first_seen,
        max(timestamp) AS last_seen
      FROM events
      WHERE person_id = '${personId}' AND timestamp >= now() - INTERVAL 90 DAY
    `),
    hogql(`
      SELECT timestamp, event,
             properties.$current_url AS url,
             properties.property_id AS property_id,
             properties.address AS address,
             properties.city AS city,
             properties.state AS state,
             properties.$session_id AS session_id
      FROM events
      WHERE person_id = '${personId}' AND timestamp >= now() - INTERVAL 90 DAY
        AND event NOT IN ('$autocapture', '$set', '$pageleave')
      ORDER BY timestamp DESC
      LIMIT 500
    `),
  ]);
  const p = flat(profileRows)[0] || [];
  const profile = {
    email: p[0] || '',
    name: [p[1], p[2]].filter(Boolean).join(' '),
    events: Number(p[3] || 0),
    sessions: Number(p[4] || 0),
    first_seen: p[5],
    last_seen: p[6],
  };
  const pathOf = (url) => {
    if (!url) return '';
    try { return new URL(url).pathname || '/'; } catch { return String(url).replace(/^https?:\/\/[^/]+/, '') || '/'; }
  };
  const activity = flat(eventRows).map((r) => ({
    timestamp: r[0], event: r[1], url: r[2] || '', property_id: r[3] || '',
    property_name: [r[4], r[5], r[6]].filter(Boolean).join(', '),
    session_id: r[7] || '',
  }));
  // A property page fires both $pageview and property_viewed on the same URL;
  // only the latter carries city/state. Propagate that location to every event
  // on the same property page.
  const locByPath = {};
  for (const a of activity) {
    if (a.event === 'property_viewed' && a.property_name) locByPath[pathOf(a.url)] = a.property_name;
  }
  for (const a of activity) {
    if (!a.property_name) {
      const loc = locByPath[pathOf(a.url)];
      if (loc) a.property_name = loc;
    }
  }
  return NextResponse.json({ configured: true, profile, activity });
}

export async function GET(request) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!POSTHOG_KEY || !POSTHOG_PROJECT_ID) {
    return NextResponse.json({
      configured: false,
      message: 'Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID to enable user analytics.',
    });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    if (type === 'users') return await usersList();
    if (type === 'activity') return await userActivity(searchParams.get('personId') || '');
    if (type === 'resolve') return await resolveUser({ distinctId: searchParams.get('distinctId') || '', email: searchParams.get('email') || '' });

    // ── default: dashboard ──
    const [
      totals, todayRow, activeNow, dailyPV,
      fPage, fSearch, fView, fSave, fContact, fListing,
      topEvents, topProps,
    ] = await Promise.all([
      hogql(`SELECT countIf(event = '$pageview') AS pv, count(DISTINCT person_id) AS uu
             FROM events WHERE timestamp >= now() - INTERVAL 30 DAY`),
      hogql(`SELECT countIf(event = '$pageview') AS pv, count(DISTINCT person_id) AS uu
             FROM events WHERE toDate(timestamp) = today()`),
      hogql(`SELECT count(DISTINCT person_id) AS u FROM events WHERE timestamp >= now() - INTERVAL 5 MINUTE`),
      hogql(`SELECT toDate(timestamp) AS day, count() AS c
             FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 30 DAY
             GROUP BY day ORDER BY day ASC`),
      hogql(stepQuery('$pageview')),
      hogql(stepQuery('search_applied')),
      hogql(stepQuery('property_viewed')),
      hogql(stepQuery('property_saved')),
      hogql(stepQuery('contact_seller_clicked')),
      hogql(stepQuery('listing_created')),
      hogql(`SELECT event, count() AS c
             FROM events WHERE timestamp >= now() - INTERVAL 30 DAY
             GROUP BY event ORDER BY c DESC LIMIT 15`),
      hogql(`SELECT properties.property_id AS pid, count() AS c
             FROM events
             WHERE event = 'property_viewed' AND timestamp >= now() - INTERVAL 30 DAY
               AND properties.property_id IS NOT NULL AND properties.property_id != ''
             GROUP BY pid ORDER BY c DESC LIMIT 10`),
    ]);

    const num = (rows) => Number(flat(rows)[0]?.[0] || 0);
    const t = flat(totals)[0] || [0, 0];
    const td = flat(todayRow)[0] || [0, 0];

    return NextResponse.json({
      configured: true,
      totals: { pageviews: Number(t[0] || 0), uniqueUsers: Number(t[1] || 0) },
      today: { pageviews: Number(td[0] || 0), uniqueUsers: Number(td[1] || 0) },
      activeNow: num(activeNow),
      dailyPageviews: flat(dailyPV),
      funnel: [
        { step: 'Viewed a page', persons: num(fPage) },
        { step: 'Searched', persons: num(fSearch) },
        { step: 'Viewed a property', persons: num(fView) },
        { step: 'Saved a property', persons: num(fSave) },
        { step: 'Contacted a seller', persons: num(fContact) },
        { step: 'Listed a property', persons: num(fListing) },
      ],
      topEvents: flat(topEvents),
      topProperties: flat(topProps),
      project_url: `${POSTHOG_HOST}/project/${POSTHOG_PROJECT_ID}`,
    });
  } catch (err) {
    console.error('[analytics/posthog]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
