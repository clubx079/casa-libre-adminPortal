import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { countryInfo } from '@/lib/automationAdmin';
import { hogql } from '@/lib/posthogHogql';
import { isInternalEmail } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';
import { CAMPAIGNS, ALIASES } from '@/lib/campaigns';
import { buildLinksReport, clickSlugSql, landingChannelSql, LEGACY_CAMPAIGNS } from '@/lib/linksReport';
import { dbFor } from '@/lib/db';
import { SITE_EXPR, siteClause } from '@/lib/analyticsSite';
import { selectIn } from '@/lib/selectAll';
import { clickSql, applyClicks, OPEN_TRACKING_GAP } from '@/lib/contactsReport';
import { isInternalContact } from '@/lib/internalTraffic';
import { whatsappStats, COUNTRY_TZ } from '@/lib/whatsappStats';
import { UKEY, SOURCE_EXPR, AI_SOURCES, GEO_BASE, CONTACT_IN } from '@/lib/posthogSql';
import { batchNames } from '@/lib/waCampaignStore';

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
//   links      one UTM link per channel: times opened + people landed (UTM Links page)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const POSTHOG_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

// hogql() reads people's CURRENT properties (joined mode) — see lib/posthogHogql.js.

// UKEY, SOURCE_EXPR, AI_SOURCES, GEO_BASE (the investor-facing geo policy) and CONTACT_IN
// live in lib/posthogSql.js (shared with the Admin Manager's data pack).

// Which country site an event came from (country hosts, then site_country, then
// 'py') and the per-country filter live in lib/analyticsSite.js. Any country code
// scopes to that country only — El Salvador (and any later country) used to fall
// through to "all sites", which is ~all Paraguay.

// The country the admin picked in the header switcher. Every query on this page
// is scoped to it, so "Bolivia" means Bolivia everywhere, not just in two cards.
const currentSite = () => { try { return activeCountry(); } catch { return ''; } };

// Every aggregate query filters through this, so the header's country switcher
// scopes the whole page — totals, funnel, trend, map, sources, AI and users.
const geoFilter = () => `${GEO_BASE}${siteClause(currentSite())}`;

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
      countIf(${CONTACT_IN}) AS contacts,
      countIf(event = 'listing_created') AS listings,
      min(timestamp) AS first_seen,
      max(timestamp) AS last_seen
    FROM events
    WHERE timestamp >= now() - INTERVAL 90 DAY AND ${geoFilter()}
    GROUP BY idkey
    ORDER BY last_seen DESC
    LIMIT 300
  `);
  const names = await batchNames();   // WhatsApp campaign batch slug → its name
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
      campaign_label: names.get(r[9]) || '',
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
  // Pakistan events are already filtered out (geoFilter); this also drops team / test
  // accounts that browsed from elsewhere (e.g. the store-review login used from the US).
  const extra = await internalEmails(currentSite() || 'py').catch(() => null);
  return NextResponse.json({ configured: true, users: users.filter((u) => !u.email || !isInternalEmail(u.email, extra)) });
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
      countIf(${CONTACT_IN}) AS contacts,
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
    // Same rows as the list's anonymous IP row: that IP's visits by nobody signed in.
    scope = `properties.$ip = '${ip.replace(/'/g, "''")}' AND coalesce(person.properties.email, '') = ''`;
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
        max(timestamp) AS last_seen,
        argMin(${SOURCE_EXPR}, timestamp) AS source,
        argMin(coalesce(nullIf(properties.utm_campaign, ''), ''), timestamp) AS campaign,
        argMin(coalesce(properties.$referring_domain, ''), timestamp) AS referrer
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
    // where the FIRST visit came from (google, chatgpt, direct, an /r/ campaign tag…)
    source: p[10] || 'direct',
    campaign: p[11] || '',
    campaign_label: (await batchNames()).get(p[11]) || '',   // a WhatsApp campaign batch's name
    referrer: p[12] && p[12] !== '$direct' ? p[12] : '',
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
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 7;
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
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 7;
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
  const names = await batchNames();   // WhatsApp campaign batch slug → its name
  return NextResponse.json({
    configured: true, days: d,
    rows: flat(rows).map((r) => ({
      source: r[0] || 'direct', campaign: r[1] || '', label: names.get(r[1]) || '',
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
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 7;
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
// A real click on an /r/ link comes from a public IP that PostHog can place on the
// map. Clicks with no IP, or a local one (::1, 127.0.0.1 — a developer's own
// machine), have no country: those were tests (curl, probes, localhost).
const REAL_CLICK = "coalesce(properties.$geoip_country_name, '') != ''";

async function linkClicks(days) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 7;
  const rows = flat(await hogql(`
    SELECT coalesce(properties.utm_source, '?') AS source,
           coalesce(properties.slug, '?') AS slug,
           coalesce(nullIf(properties.utm_content, ''), '') AS thread,
           count() AS clicks,
           count(DISTINCT coalesce(nullIf(properties.$ip, ''), distinct_id)) AS people
    FROM events
    WHERE event = 'link_click' AND timestamp >= now() - INTERVAL ${d} DAY
      AND ${geoFilter()} AND ${REAL_CLICK}
    GROUP BY source, slug, thread ORDER BY clicks DESC LIMIT 30`));
  return NextResponse.json({
    configured: true, days: d,
    rows: rows.map((r) => ({ source: r[0], slug: r[1], thread: r[2], clicks: Number(r[3] || 0), people: Number(r[4] || 0) })),
  });
}

// ── UTM Links page: one link per channel — times opened + people who landed ──
// opened = link_click events from the /r/ redirect (old links like /r/rda count under
// their channel); landed = distinct visitors whose page views carried the channel's
// utm tags. Same country + dev-team filters as the rest of Analytics (geoFilter).
async function linksData(days) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 7;
  const where = `timestamp >= now() - INTERVAL ${d} DAY AND ${geoFilter()}`;
  const clicks = flat(await hogql(`
    SELECT ${clickSlugSql(ALIASES)} AS slug, count() AS opened, max(timestamp) AS last
    FROM events WHERE event = 'link_click' AND ${where} AND ${REAL_CLICK}
    GROUP BY slug`));
  const channel = landingChannelSql(CAMPAIGNS, LEGACY_CAMPAIGNS);
  const landings = flat(await hogql(`
    SELECT ${channel} AS slug, count(DISTINCT ${UKEY}) AS people, max(timestamp) AS last
    FROM events WHERE event = '$pageview' AND coalesce(properties.utm_source, '') != '' AND ${where}
    GROUP BY slug HAVING slug != ''`));
  // The link inside a buyer's WhatsApp message to a seller (property page button):
  // its own tags, not a channel link. People who arrived through one of those.
  const [[contactLanded = 0] = []] = flat(await hogql(`
    SELECT count(DISTINCT ${UKEY}) FROM events
    WHERE event = '$pageview' AND lower(coalesce(properties.utm_source, '')) = 'whatsapp'
      AND coalesce(properties.utm_campaign, '') = 'property_share' AND ${where}`));
  const site = countryInfo(currentSite() || 'py').site;
  return NextResponse.json({ configured: true, days: d, links: buildLinksReport({ campaigns: CAMPAIGNS, site, clicks, landings }), contactLanded: Number(contactLanded) || 0 });
}

// What people browse with. "From Google" is a source (above); "from Safari" is a
// browser — different question, so it gets its own cut.
async function techBreakdown(days, site) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 7;
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

// Which properties people actually look at, most-viewed first.
//
// One row per property, from the `property_viewed` event the buyer portal fires
// when a detail page opens. Two different numbers on purpose:
//   views    — every opening, so re-visits count
//   visitors — distinct people, so one person refreshing does not look like demand
// The label fields (address, city, type…) are taken from the most recent event
// rather than the database: it keeps this a single query, and it still reflects
// how the listing looked when people were viewing it.
async function propertyViews(days, limit) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 7;
  const n = [10, 20, 30, 50, 100].includes(Number(limit)) ? Number(limit) : 20;
  const rows = flat(await hogql(`
    SELECT coalesce(nullIf(properties.property_id, ''), 'unknown') AS pid,
           count() AS views,
           count(DISTINCT ${UKEY}) AS visitors,
           argMax(coalesce(properties.address, ''), timestamp) AS address,
           argMax(coalesce(properties.city, ''), timestamp) AS city,
           argMax(coalesce(properties.neighborhood, ''), timestamp) AS neighborhood,
           argMax(coalesce(properties.type, ''), timestamp) AS type,
           argMax(coalesce(properties.mode, ''), timestamp) AS mode,
           argMax(toFloat64OrNull(toString(properties.price)), timestamp) AS price,
           max(timestamp) AS last_seen
    FROM events
    WHERE event = 'property_viewed' AND timestamp >= now() - INTERVAL ${d} DAY
      AND ${geoFilter()}
    GROUP BY pid
    ORDER BY views DESC
    LIMIT ${n}`));

  // Totals across ALL viewed properties, not just the page we return, so the
  // header reads "N views across M properties" honestly.
  // NB: no alias named `properties` here — it would shadow the events table's
  // own `properties` field and break ${UKEY}.
  const [tot] = flat(await hogql(`
    SELECT count() AS views,
           count(DISTINCT coalesce(nullIf(properties.property_id, ''), 'unknown')) AS property_count,
           count(DISTINCT ${UKEY}) AS visitors
    FROM events
    WHERE event = 'property_viewed' AND timestamp >= now() - INTERVAL ${d} DAY
      AND ${geoFilter()}`));

  return NextResponse.json({
    configured: true,
    days: d,
    limit: n,
    totals: {
      views: Number(tot?.[0] || 0),
      properties: Number(tot?.[1] || 0),
      visitors: Number(tot?.[2] || 0),
    },
    rows: rows.map((r) => ({
      propertyId: r[0],
      views: Number(r[1] || 0),
      visitors: Number(r[2] || 0),
      address: r[3] || '',
      city: r[4] || '',
      neighborhood: r[5] || '',
      type: r[6] || '',
      mode: r[7] || '',
      price: r[8] == null ? null : Number(r[8]),
      lastSeen: r[9] || null,
    })),
  });
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

// ── WhatsApp contacts (the card on User analytics) ──
// Counts come from the database's contact taps (website AND app, lib/whatsappStats.js),
// cleaned like the contacts list (api/contacts): buyers who signed in later are filled
// in from PostHog, then the team's own taps are dropped.
async function whatsappData(days) {
  const d = [7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 7;
  const cc = currentSite() || 'py';
  const { select } = dbFor(cc);
  const now = Date.now();
  const gap = OPEN_TRACKING_GAP[cc] || null;
  let rows = [];
  try {
    rows = await select('contact_link_clicks', `select=id,token,buyer_user_id,buyer_name,buyer_email,buyer_ip,buyer_country,buyer_city,property_id,listing_ref,channel,status,created_at,opened_at&created_at=gte.${new Date(now - 2 * d * 86400000).toISOString()}&order=created_at.desc&limit=10000`);
  } catch (e) {
    // table not created in this country yet → an empty card, not an error
    if (!/does not exist|PGRST205|schema cache|not find the table/i.test(String(e?.message || e))) throw e;
  }
  const sql = clickSql(rows);
  if (sql) {
    try { rows = applyClicks(rows, await hogql(sql)); } catch (e) { console.error('[analytics/whatsapp] clicks', e?.message || e); }
  }
  const extra = await internalEmails(cc).catch(() => null);
  rows = rows.filter((r) => !isInternalContact(r, extra));
  const ids = [...new Set(rows.map((r) => r.property_id).filter((v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))))];
  const props = ids.length ? await selectIn(select, 'properties', 'id,address,city,neighborhood,listing_type,property_type,created_by', 'id', ids, '', 100) : [];
  const stats = whatsappStats({ rows, props, days: d, now, tz: COUNTRY_TZ[cc] || 'America/Asuncion', gap });

  return NextResponse.json({ configured: true, country: cc, gap, ...stats });
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
    if (type === 'links') return await linksData(searchParams.get('days') || '');
    if (type === 'tech') return await techBreakdown(searchParams.get('days') || '', searchParams.get('site') || '');
    if (type === 'properties') return await propertyViews(searchParams.get('days') || '', searchParams.get('limit') || '');
    if (type === 'whatsapp') return await whatsappData(searchParams.get('days') || '');

    // ── default: dashboard ──
    // The summary's window (?days=, whitelisted; default the last 7 days).
    const d = [7, 30, 90, 180, 365].includes(Number(searchParams.get('days'))) ? Number(searchParams.get('days')) : 7;
    // ONE scan for the cards + funnel (PostHog queues queries it gets at the same time:
    // 12 separate ones took ~5 s, one takes <1 s). "Active now" stays its own live query.
    const step = (cond) => `uniqExactIf(${UKEY}, ${cond})`;
    const [summary, activeNow] = await Promise.all([
      hogql(`SELECT countIf(event = '$pageview'), uniqExact(${UKEY}),
               countIf(event = '$pageview' AND toDate(timestamp) = today()), ${step('toDate(timestamp) = today()')},
               ${step("event = '$pageview'")}, ${step("event = 'search_applied'")}, ${step("event = 'property_viewed'")},
               ${step("event = 'property_saved'")}, ${step(CONTACT_IN)}, ${step("event = 'listing_created'")}, ${step("event = 'app_badge_clicked'")}
             FROM events WHERE timestamp >= now() - INTERVAL ${d} DAY AND ${geoFilter()}`),
      hogql(`SELECT count(DISTINCT ${UKEY}) AS u FROM events WHERE timestamp >= now() - INTERVAL 5 MINUTE AND ${geoFilter()}`),
    ]);
    const v = (flat(summary)[0] || []).map((x) => Number(x || 0));
    const num = (rows) => Number(flat(rows)[0]?.[0] || 0);

    return NextResponse.json({
      configured: true,
      days: d,
      totals: { pageviews: v[0] || 0, uniqueUsers: v[1] || 0 },
      today: { pageviews: v[2] || 0, uniqueUsers: v[3] || 0 },
      activeNow: num(activeNow),
      funnel: [
        // everyone who used the site in the window — same number as the Unique users card
        { step: 'Visited the site', persons: v[1] || 0 },
        { step: 'Searched', persons: v[5] || 0 },
        { step: 'Viewed a property', persons: v[6] || 0 },
        { step: 'Saved a property', persons: v[7] || 0 },
        { step: 'Contacted a seller', persons: v[8] || 0 },
        { step: 'Listed a property', persons: v[9] || 0 },
        // tapped the App Store / Google Play badge on the website (buyer components/AppBadges.js)
        { step: 'Clicked an app button', persons: v[10] || 0 },
      ],
      project_url: `${POSTHOG_HOST}/project/${POSTHOG_PROJECT_ID}`,
    });
  } catch (err) {
    console.error('[analytics/posthog]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
