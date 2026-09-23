import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';

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

// Unique-visitor key: an identified user counts by their person_id; an
// anonymous visitor counts by their IP address, so many browser sessions from
// the same IP collapse into ONE "person" in every count/funnel below.
const UKEY = `if(coalesce(person.properties.email, '') != '', toString(person_id), coalesce(nullIf(properties.$ip, ''), 'unknown'))`;

// Investor-facing geo policy. Pakistan (the dev team) is NEVER shown. Saudi
// Arabia's historical test traffic is hidden, but any Saudi visits from the
// cutoff date onward DO show. Applied to every aggregate query below. Uses
// coalesce so events with an unresolved country are kept, not dropped.
// Where a visit came from, in priority order: AI engines (they tag their own
// links), then any utm tag, then the referring domain, then 'direct'. Organic
// Google is a google referrer with no tag.
//
// String.raw on purpose: a plain template hands ClickHouse '\.', which it
// unescapes to '.' (any character). '\\.' below reaches it as a literal dot.
const SOURCE_EXPR = String.raw`
  multiIf(
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(chatgpt|openai)'), 'chatgpt',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)perplexity'), 'perplexity',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(gemini|bard\\.google)'), 'gemini',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(claude|anthropic)'), 'claude',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(copilot|bing chat)'), 'copilot',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(grok|x\\.ai|deepseek|mistral)'), 'other ai',
    coalesce(nullIf(properties.utm_source, ''), '') != '', lower(properties.utm_source),
    match(coalesce(properties.$referring_domain, ''), '(?i)^accounts\\.google\\.'), 'direct',
    match(coalesce(properties.$referring_domain, ''), '(?i)^mail\\.google\\.'), 'email',
    match(coalesce(properties.$referring_domain, ''), '(?i)(^|\\.)google\\.'), 'google',
    match(coalesce(properties.$referring_domain, ''), '(?i)bing\\.'), 'bing',
    match(coalesce(properties.$referring_domain, ''), '(?i)duckduckgo\\.'), 'duckduckgo',
    match(coalesce(properties.$referring_domain, ''), '(?i)(yahoo|ecosia|brave)\\.'), 'search',
    match(coalesce(properties.$referring_domain, ''), '(?i)(^|\\.)reddit\\.'), 'reddit',
    match(coalesce(properties.$referring_domain, ''), '(?i)(instagram|facebook|^fb\\.|tiktok|linkedin|twitter|^x\\.com)'), 'social',
    match(coalesce(properties.$referring_domain, ''), '(?i)(whatsapp|wa\\.me)'), 'whatsapp',
    coalesce(properties.$referring_domain, '') IN ('', '$direct'), 'direct',
    match(coalesce(properties.$referring_domain, ''), '(?i)(casa-libre|localhost|airosofts)'), 'direct',
    lower(properties.$referring_domain)
  )`;

// The AI engines, so the admin can show them on their own — this is the number
// Roland's AI-visibility work moves.
const AI_SOURCES = ['chatgpt', 'perplexity', 'gemini', 'claude', 'copilot', 'other ai'];

// Which country site the event came from. New events carry site_country (set by
// the buyer portal); older ones only have $host, so fall back to that — every
// real visit before this was casa-libre.com.py.
const SITE_EXPR = String.raw`
  multiIf(
    coalesce(properties.site_country, '') != '', lower(properties.site_country),
    match(coalesce(properties.$host, ''), '(?i)casa-libre\\.com\\.bo'), 'bo',
    match(coalesce(properties.$host, ''), '(?i)(^|\\.)uy\\.casa-libre\\.com'), 'uy',
    match(coalesce(properties.$host, ''), '(?i)casa-libre\\.com\\.ve'), 've',
    'py'
  )`;

const HIDE_SAUDI_BEFORE = '2026-09-21';
const GEO_BASE = `coalesce(properties.$geoip_country_name, '') != 'Pakistan' AND NOT (coalesce(properties.$geoip_country_name, '') = 'Saudi Arabia' AND timestamp < toDateTime('${HIDE_SAUDI_BEFORE} 00:00:00'))`;

// ?site=py|bo|uy|ve → only that country site's traffic. Anything else = all sites.
const siteClause = (site) => {
  const s = String(site || '').toLowerCase();
  return ['py', 'bo', 'uy', 've'].includes(s) ? ` AND ${SITE_EXPR} = '${s}'` : '';
};

// The country the admin picked in the header switcher. Every query on this page
// is scoped to it, so "Bolivia" means Bolivia everywhere, not just in two cards.
const currentSite = () => { try { return activeCountry(); } catch { return ''; } };

// Every aggregate query filters through this, so the header's country switcher
// scopes the whole page — totals, funnel, trend, map, sources, AI and users.
const geoFilter = () => `${GEO_BASE}${siteClause(currentSite())}`;

const stepQuery = (event) => `
  SELECT count(DISTINCT ${UKEY}) AS c
  FROM events
  WHERE event = '${event}' AND timestamp >= now() - INTERVAL 30 DAY AND ${geoFilter()}
`;

const flat = (rows) => rows.map((r) => (Array.isArray(r) ? r : Object.values(r)));

// ── users list: identified users by person_id, anonymous visitors by IP ──
// Grouped on UKEY, so all same-IP anonymous sessions become one row. Each row
// carries its IP + geo location; identified rows also show their most recent IP.
async function usersList() {
  const rows = await hogql(`
    SELECT
      ${UKEY} AS idkey,
      any(person_id) AS person_id,
      any(person.properties.email) AS email,
      any(person.properties.first_name) AS first_name,
      any(person.properties.last_name) AS last_name,
      argMax(properties.$ip, timestamp) AS ip,
      argMax(properties.$geoip_city_name, timestamp) AS city,
      argMax(properties.$geoip_country_name, timestamp) AS country,
      argMin(${SOURCE_EXPR}, timestamp) AS source,
      argMin(coalesce(nullIf(properties.utm_campaign, ''), ''), timestamp) AS campaign,
      argMax(${SITE_EXPR}, timestamp) AS site,
      count() AS events,
      countIf(event = 'property_viewed') AS views,
      countIf(event = 'property_saved') AS saves,
      countIf(event = 'contact_seller_clicked') AS contacts,
      countIf(event = 'listing_created') AS listings,
      min(timestamp) AS first_seen,
      max(timestamp) AS last_seen
    FROM events
    WHERE timestamp >= now() - INTERVAL 90 DAY AND ${geoFilter()}
    GROUP BY idkey
    ORDER BY last_seen DESC
    LIMIT 300
  `);
  const users = flat(rows).map((r) => {
    const email = r[2] || '';
    return {
      person_id: r[1],
      email,
      is_anon: !email,
      name: [r[3], r[4]].filter(Boolean).join(' '),
      ip: r[5] || '',
      city: r[6] || '',
      country: r[7] || '',
      location: [r[6], r[7]].filter(Boolean).join(', '),
      source: r[8] || 'direct',
      campaign: r[9] || '',
      site: r[10] || 'py',
      events: Number(r[11] || 0),
      views: Number(r[12] || 0),
      saves: Number(r[13] || 0),
      contacts: Number(r[14] || 0),
      listings: Number(r[15] || 0),
      first_seen: r[16],
      last_seen: r[17],
    };
  });
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

// ── single visitor's event timeline (by person_id, or by IP for anonymous) ──
async function userActivity({ personId, ip }) {
  let scope;
  if (ip) {
    if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return NextResponse.json({ error: 'Invalid ip' }, { status: 400 });
    scope = `properties.$ip = '${ip.replace(/'/g, "''")}'`;
  } else {
    if (!/^[0-9a-f-]{16,40}$/i.test(personId)) return NextResponse.json({ error: 'Invalid personId' }, { status: 400 });
    scope = `person_id = '${personId}'`;
  }
  const [profileRows, eventRows] = await Promise.all([
    hogql(`
      SELECT
        any(person.properties.email) AS email,
        any(person.properties.first_name) AS first_name,
        any(person.properties.last_name) AS last_name,
        count() AS events,
        count(DISTINCT properties.$session_id) AS sessions,
        argMax(properties.$ip, timestamp) AS ip,
        argMax(properties.$geoip_city_name, timestamp) AS city,
        argMax(properties.$geoip_country_name, timestamp) AS country,
        min(timestamp) AS first_seen,
        max(timestamp) AS last_seen
      FROM events
      WHERE ${scope} AND timestamp >= now() - INTERVAL 90 DAY
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
      WHERE ${scope} AND timestamp >= now() - INTERVAL 90 DAY
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
    ip: p[5] || (ip || ''),
    city: p[6] || '',
    country: p[7] || '',
    location: [p[6], p[7]].filter(Boolean).join(', '),
    first_seen: p[8],
    last_seen: p[9],
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

// ── geo breakdown for the donut: unique visitors by country, or by city
// within one country when ?country= is given. Honors the geo policy. ──
async function geoBreakdown(country, days) {
  const q = (s) => String(s || '').replace(/'/g, "''");
  // Whitelist the window (7d / 30d / 3mo / 6mo / 12mo) — never interpolate raw input.
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 90;
  if (country) {
    const rows = await hogql(`
      SELECT coalesce(nullIf(properties.$geoip_city_name, ''), 'Unknown') AS name,
             count(DISTINCT ${UKEY}) AS visitors
      FROM events
      WHERE timestamp >= now() - INTERVAL ${d} DAY AND ${geoFilter()}
        AND coalesce(properties.$geoip_country_name, '') = '${q(country)}'
      GROUP BY name ORDER BY visitors DESC LIMIT 30`);
    return NextResponse.json({ level: 'cities', country, days: d, rows: flat(rows).map((r) => ({ name: r[0], visitors: Number(r[1] || 0) })) });
  }
  const rows = await hogql(`
    SELECT coalesce(nullIf(properties.$geoip_country_name, ''), 'Unknown') AS name,
           count(DISTINCT ${UKEY}) AS visitors
    FROM events
    WHERE timestamp >= now() - INTERVAL ${d} DAY AND ${geoFilter()}
    GROUP BY name ORDER BY visitors DESC LIMIT 30`);
  return NextResponse.json({ level: 'countries', days: d, rows: flat(rows).map((r) => ({ name: r[0], visitors: Number(r[1] || 0) })) });
}

// Where visitors came from, first touch, per channel. 'direct' is the honest
// bucket for "arrived with no utm and no referrer"; organic Google shows as
// 'google' via the referrer.
async function sourcesBreakdown(days, site) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 90;
  const rows = await hogql(`
    WITH first_touch AS (
      SELECT ${UKEY} AS idkey,
             argMin(${SOURCE_EXPR}, timestamp) AS source,
             argMin(coalesce(nullIf(properties.utm_campaign, ''), ''), timestamp) AS campaign,
             max(coalesce(person.properties.email, '')) != '' AS known,
             max(timestamp) AS last_seen,
             countIf(event = 'listing_created') AS listings,
             countIf(event = 'contact_whatsapp_click') AS contacts
      FROM events
      WHERE timestamp >= now() - INTERVAL ${d} DAY AND ${geoFilter()}
      GROUP BY idkey
    )
    SELECT source, campaign, count() AS visitors, countIf(known = 0) AS anon, countIf(known = 1) AS signed_in,
           sum(listings) AS listings, sum(contacts) AS contacts
    FROM first_touch GROUP BY source, campaign ORDER BY visitors DESC LIMIT 40`);
  return NextResponse.json({
    configured: true, days: d,
    rows: flat(rows).map((r) => ({
      source: r[0] || 'direct', campaign: r[1] || '',
      visitors: Number(r[2] || 0),
      // anonymous visitors count too — by IP, the same way the rest of this page does
      anon: Number(r[3] || 0), signedIn: Number(r[4] || 0),
      listings: Number(r[5] || 0), contacts: Number(r[6] || 0),
    })),
  });
}

// AI answer engines on their own: which ones send people, and — the useful part
// for the AIEO work — which pages they send them to.
async function aiBreakdown(days, site) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 90;
  const aiList = AI_SOURCES.map((x) => `'${x}'`).join(', ');
  const isAi = `${SOURCE_EXPR} IN (${aiList})`;

  const engines = flat(await hogql(`
    SELECT ${SOURCE_EXPR} AS engine, count(DISTINCT ${UKEY}) AS visitors, count() AS events,
           min(timestamp) AS first_seen, max(timestamp) AS last_seen
    FROM events
    WHERE timestamp >= now() - INTERVAL ${d} DAY AND ${geoFilter()} AND ${isAi}
    GROUP BY engine ORDER BY visitors DESC LIMIT 10`))
    .map((r) => ({ engine: r[0], visitors: Number(r[1] || 0), events: Number(r[2] || 0), firstSeen: r[3], lastSeen: r[4] }));

  const pages = flat(await hogql(`
    SELECT coalesce(nullIf(properties.$pathname, ''), '/') AS page,
           count(DISTINCT ${UKEY}) AS visitors
    FROM events
    WHERE timestamp >= now() - INTERVAL ${d} DAY AND ${geoFilter()} AND ${isAi} AND event = '$pageview'
    GROUP BY page ORDER BY visitors DESC LIMIT 10`))
    .map((r) => ({ page: r[0], visitors: Number(r[1] || 0) }));

  return NextResponse.json({ configured: true, days: d, engines, pages });
}

// Clicks on our own tagged links (/r/<slug>), recorded server-side at the
// redirect. This is deliberately a different number from the visitors the
// sources card shows: a click counts even when the person never reaches the page
// (left early, JavaScript blocked, in-app browser). clicks − landings = the leak.
async function linkClicks(days) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 90;
  const rows = flat(await hogql(`
    SELECT coalesce(properties.utm_source, '?') AS source,
           coalesce(properties.slug, '?') AS slug,
           coalesce(nullIf(properties.utm_content, ''), '') AS thread,
           count() AS clicks,
           count(DISTINCT coalesce(nullIf(properties.$ip, ''), distinct_id)) AS people
    FROM events
    WHERE event = 'link_click' AND timestamp >= now() - INTERVAL ${d} DAY
      ${siteClause(currentSite())}
    GROUP BY source, slug, thread ORDER BY clicks DESC LIMIT 30`));
  return NextResponse.json({
    configured: true, days: d,
    rows: rows.map((r) => ({ source: r[0], slug: r[1], thread: r[2], clicks: Number(r[3] || 0), people: Number(r[4] || 0) })),
  });
}

// What people browse with. "From Google" is a source (above); "from Safari" is a
// browser — different question, so it gets its own cut.
async function techBreakdown(days, site) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 90;
  const one = async (expr) => flat(await hogql(`
    SELECT coalesce(nullIf(${expr}, ''), 'Unknown') AS name, count(DISTINCT ${UKEY}) AS visitors
    FROM events
    WHERE timestamp >= now() - INTERVAL ${d} DAY AND ${geoFilter()}
    GROUP BY name ORDER BY visitors DESC LIMIT 12`)).map((r) => ({ name: r[0], visitors: Number(r[1] || 0) }));

  const [browsers, devices, systems] = await Promise.all([
    one('properties.$browser'),
    one('properties.$device_type'),
    one('properties.$os'),
  ]);
  return NextResponse.json({ configured: true, days: d, browsers, devices, systems });
}

// How much of PostHog's free allowance we are using.
//
// PostHog bills on a CYCLE, not a calendar month — this org's runs 18th → 18th,
// so counting "events this month" reported 5,601 while the billing page said 113.
// The cycle day is configurable; the response carries the cycle start so the
// number can be checked against posthog.com/organization/billing directly.
const CYCLE_DAY = Math.min(28, Math.max(1, Number(process.env.POSTHOG_BILLING_CYCLE_DAY || 18)));
const FREE_MONTHLY_EVENTS = 1000000;

function cycleStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), CYCLE_DAY));
  if (now < d) d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

async function usage() {
  const start = cycleStart();
  const startSql = start.toISOString().slice(0, 19).replace('T', ' ');
  const [cur] = flat(await hogql(`
    SELECT count() AS events, uniq(distinct_id) AS visitors
    FROM events WHERE timestamp >= toDateTime('${startSql}')`));
  const current = Number(cur?.[0] || 0);

  const months = flat(await hogql(`
    SELECT toStartOfMonth(timestamp) AS month, count() AS events, uniq(distinct_id) AS visitors
    FROM events WHERE timestamp >= now() - INTERVAL 180 DAY GROUP BY month ORDER BY month DESC LIMIT 6`))
    .map((r) => ({ month: String(r[0]).slice(0, 7), events: Number(r[1] || 0), visitors: Number(r[2] || 0) }));

  const bySite = flat(await hogql(`
    SELECT ${SITE_EXPR} AS site, count() AS events
    FROM events WHERE timestamp >= toDateTime('${startSql}') GROUP BY site ORDER BY events DESC`))
    .map((r) => ({ site: r[0], events: Number(r[1] || 0) }));

  // pace for the full cycle, from how far into it we are
  const elapsedDays = Math.max(1, (Date.now() - start.getTime()) / 86400000);
  const projected = Math.round((current / elapsedDays) * 30);

  return NextResponse.json({
    configured: true,
    freeMonthlyEvents: FREE_MONTHLY_EVENTS,
    cycleStart: start.toISOString().slice(0, 10),
    current, projected,
    percentOfFree: Math.round((projected / FREE_MONTHLY_EVENTS) * 1000) / 10,
    months, bySite,
  });
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
    if (type === 'activity') return await userActivity({ personId: searchParams.get('personId') || '', ip: searchParams.get('ip') || '' });
    if (type === 'resolve') return await resolveUser({ distinctId: searchParams.get('distinctId') || '', email: searchParams.get('email') || '' });
    if (type === 'geo') return await geoBreakdown(searchParams.get('country') || '', searchParams.get('days') || '');
    if (type === 'sources') return await sourcesBreakdown(searchParams.get('days') || '', searchParams.get('site') || '');
    if (type === 'usage') return await usage();
    if (type === 'ai') return await aiBreakdown(searchParams.get('days') || '', searchParams.get('site') || '');
    if (type === 'clicks') return await linkClicks(searchParams.get('days') || '');
    if (type === 'tech') return await techBreakdown(searchParams.get('days') || '', searchParams.get('site') || '');

    // ── default: dashboard ──
    const [
      totals, todayRow, activeNow, dailyPV,
      fPage, fSearch, fView, fSave, fContact, fListing,
      topEvents, topProps,
    ] = await Promise.all([
      hogql(`SELECT countIf(event = '$pageview') AS pv, count(DISTINCT ${UKEY}) AS uu
             FROM events WHERE timestamp >= now() - INTERVAL 30 DAY AND ${geoFilter()}`),
      hogql(`SELECT countIf(event = '$pageview') AS pv, count(DISTINCT ${UKEY}) AS uu
             FROM events WHERE toDate(timestamp) = today() AND ${geoFilter()}`),
      hogql(`SELECT count(DISTINCT ${UKEY}) AS u FROM events WHERE timestamp >= now() - INTERVAL 5 MINUTE AND ${geoFilter()}`),
      hogql(`SELECT toDate(timestamp) AS day, count() AS c
             FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 30 DAY AND ${geoFilter()}
             GROUP BY day ORDER BY day ASC`),
      hogql(stepQuery('$pageview')),
      hogql(stepQuery('search_applied')),
      hogql(stepQuery('property_viewed')),
      hogql(stepQuery('property_saved')),
      hogql(stepQuery('contact_seller_clicked')),
      hogql(stepQuery('listing_created')),
      hogql(`SELECT event, count() AS c
             FROM events WHERE timestamp >= now() - INTERVAL 30 DAY AND ${geoFilter()}
             GROUP BY event ORDER BY c DESC LIMIT 15`),
      hogql(`SELECT properties.property_id AS pid, count() AS c
             FROM events
             WHERE event = 'property_viewed' AND timestamp >= now() - INTERVAL 30 DAY AND ${geoFilter()}
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
