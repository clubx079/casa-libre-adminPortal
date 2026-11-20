// Overview page data. Server-only. Every part fails on its own (→ null) so one slow or broken
// source never blanks the page. PostHog answers are cached by lib/posthogHogql.js (5 min fresh).
//   week(cc)       this week vs the week before for the picked country: visitors, people who
//                  opened a home, people who contacted a seller, home views (PostHog, web + app)
//   daily(cc)      the last 14 days, per day, in the country's time zone
//   liveNow(cc)    distinct visitors in the last 30 minutes
//   countries(list) one row per country: visitors + contacts (PostHog), new users, new owner
//                  listings and live listings (each country's DB)
//   local(cc)      newest owner homes (with photo), newest users (with photo), owner listings this week
import 'server-only';
import { dbFor } from './db.js';
import { hogql, posthogConfigured } from './posthogHogql.js';
import { UKEY, GEO_BASE, CONTACT_IN } from './posthogSql.js';
import { SITE_EXPR, siteClause } from './analyticsSite.js';
import { growthSql, buildGrowth } from './growthSeries.js';
import { HIDE_DELETED_USERS } from './userInsights.js';
import { isInternalEmail } from './internalTraffic.js';
import { internalEmails } from './internalAudience.js';
import { COUNTRY_TZ } from './whatsappStats.js';

const DAY = 86400000;
const safe = (p, fallback = null) => Promise.resolve(p).catch(() => fallback);
const flat = (rows) => (rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r)));
const n = (v) => Number(v) || 0;
export const tzOf = (cc) => COUNTRY_TZ[cc] || 'America/Asuncion';

// visitors / openedHome / contacted / views, this week (w) and the week before (p), per site
async function weekBySite() {
  if (!posthogConfigured()) return null;
  const rows = await hogql(`SELECT ${SITE_EXPR} AS site, if(timestamp >= now() - INTERVAL 7 DAY, 'w', 'p') AS wk,
      uniqExact(${UKEY}), uniqExactIf(${UKEY}, event = 'property_viewed'), uniqExactIf(${UKEY}, ${CONTACT_IN}), countIf(event = 'property_viewed')
    FROM events WHERE timestamp >= now() - INTERVAL 14 DAY AND ${GEO_BASE}
    GROUP BY site, wk`);
  const out = {};
  for (const [site, wk, visitors, opened, contacted, views] of flat(rows)) {
    (out[site] ||= { w: null, p: null })[wk] = { visitors: n(visitors), opened: n(opened), contacted: n(contacted), views: n(views) };
  }
  return out;
}

export async function week(cc) {
  const all = await safe(weekBySite());
  if (!all) return null;
  const zero = { visitors: 0, opened: 0, contacted: 0, views: 0 };
  return { now: all[cc]?.w || zero, before: all[cc]?.p || zero, all };
}

export async function daily(cc) {
  if (!posthogConfigured()) return null;
  const tz = tzOf(cc);
  const rows = await safe(hogql(growthSql({ where: `${GEO_BASE}${siteClause(cc)}`, ukey: UKEY, tz, days: 15 })));
  if (!rows) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  return buildGrowth(flat(rows), { today }).days.slice(-14);
}

export async function liveNow(cc) {
  if (!posthogConfigured()) return null;
  const rows = await safe(hogql(`SELECT uniqExact(${UKEY}) FROM events WHERE timestamp >= now() - INTERVAL 30 MINUTE AND ${GEO_BASE}${siteClause(cc)}`));
  return rows ? n(flat(rows)[0]?.[0]) : null;
}

// One country's own-database numbers for the table.
async function dbRow(cc) {
  const { select, selectWithCount } = dbFor(cc);
  const since = new Date(Date.now() - 14 * DAY).toISOString();
  const [users, extra, listings, live] = await Promise.all([
    safe(select('users', `select=email,created_at&${HIDE_DELETED_USERS}&created_at=gte.${since}&limit=5000`)),
    safe(internalEmails(cc), []),
    safe(select('properties', `select=created_at&origin=eq.user&created_at=gte.${since}&limit=5000`)),
    safe(selectWithCount('properties', 'select=id&status=eq.published&limit=1').then((r) => r.count)),
  ]);
  const split = (rows) => {
    if (!rows) return null;
    const cut = Date.now() - 7 * DAY;
    return { w: rows.filter((r) => Date.parse(r.created_at) >= cut).length, p: rows.filter((r) => Date.parse(r.created_at) < cut).length };
  };
  return { users: split(users && users.filter((u) => !isInternalEmail(u.email, extra || []))), listings: split(listings), live };
}

export async function countries(list) {
  const [wk, rows] = await Promise.all([safe(weekBySite()), Promise.all(list.map((c) => safe(dbRow(c.code))))]);
  return list.map((c, i) => ({ code: c.code, label: c.label || c.code.toUpperCase(), isLive: c.is_live !== false, web: wk ? (wk[c.code] || null) : undefined, ...(rows[i] || {}) }));
}

export async function local(cc) {
  const { select, selectWithCount } = dbFor(cc);
  const [homes, users, extra, homesWeek] = await Promise.all([
    safe(select('properties', 'select=id,status,property_type,listing_type,neighborhood,city,price,currency,feature_image_url,created_at&origin=eq.user&order=created_at.desc&limit=20')),
    safe(select('users', `select=id,email,full_name,created_at,verified,profile_photo_url,profile_photo_status&${HIDE_DELETED_USERS}&order=created_at.desc&limit=40`)
      .catch(() => select('users', `select=id,email,full_name,created_at,verified&${HIDE_DELETED_USERS}&order=created_at.desc&limit=40`))),
    safe(internalEmails(cc), []),
    safe(selectWithCount('properties', `select=id&origin=eq.user&created_at=gte.${new Date(Date.now() - 7 * DAY).toISOString()}&limit=1`).then((r) => r.count)),
  ]);
  return {
    homes: homes || [],
    // photo only once approved (or from before photo checks existed) — same rule as the Users page
    users: users ? users.filter((u) => !isInternalEmail(u.email, extra || [])).slice(0, 7)
      .map((u) => ({ ...u, photo: u.profile_photo_url && (!u.profile_photo_status || u.profile_photo_status === 'approved') ? u.profile_photo_url : null })) : [],
    homesWeek,
  };
}
