// "Listing shares" — the HogQL the Shares page and the Overview card run, and the pure functions
// that turn the answers (and the share_reward email_log rows) into the page's numbers.
// Pure (no fetch, no DB) — test/shareStats.test.js. Server data: lib/shareData.js.
//
// What is counted (PostHog, same filters as Analytics: GEO_BASE = no Pakistan, and only this
// country's site):
//   share sheet opens   listing_share_opened {listing_id, channel}        website + app
//   shares              listing_shared       {listing_id, channel}        website + app
//   link clicks         share_link_click     {listing_id, channel, owner_id, country} — recorded by
//                       the /l/<code> redirect on the server, so it is scoped by its `country`
//                       property (falling back to the site when a click has none)
//   visits from shares  $pageview with utm_medium=share (utm_source = the channel name)
//   contacts / sign-ups people who came through a share link (a visit with utm_medium=share in
//                       the window) and then contacted a seller / signed up in the window
import { UKEY, GEO_BASE, CONTACT_IN } from './posthogSql.js';
import { SITE_EXPR, siteClause } from './analyticsSite.js';
import { channelOf, channelLabel, CHANNEL_ORDER, SHARE_EVENTS, SHARE_MEDIUM } from './shareChannels.js';

export const SHARE_RANGES = [7, 30, 90];
const cc2 = (cc) => (/^[a-z]{2}$/.test(String(cc || '').toLowerCase()) ? String(cc).toLowerCase() : 'py');
const windowDays = (days) => Math.max(14, Number(days) || 30);
const EVENTS_IN = `event IN ('${SHARE_EVENTS.opened}', '${SHARE_EVENTS.shared}', '${SHARE_EVENTS.click}')`;
const W = 'timestamp >= now() - INTERVAL 7 DAY';
const P = '(timestamp < now() - INTERVAL 7 DAY AND timestamp >= now() - INTERVAL 14 DAY)';
const R = (days) => `timestamp >= now() - INTERVAL ${Number(days) || 30} DAY`;
const LID = `toString(coalesce(properties.listing_id, ''))`;

// The share events of one country: the click (server-side) by its `country` property, the share
// sheet events (browser / app) by the site they came from.
export function shareEventScope(cc) {
  const c = cc2(cc);
  return `${GEO_BASE} AND (lower(coalesce(toString(properties.country), '')) = '${c}' OR (coalesce(toString(properties.country), '') = '' AND ${SITE_EXPR} = '${c}'))`;
}
const shareVisit = (cc) => `event = '$pageview' AND lower(coalesce(toString(properties.utm_medium), '')) = '${SHARE_MEDIUM}' AND ${GEO_BASE}${siteClause(cc2(cc))}`;

export const shareSql = {
  // per event: [event, rangeCount, rangePeople, wCount, pCount, wPeople, pPeople]
  eventTotals: (cc, days) => `SELECT event, countIf(${R(days)}), uniqExactIf(${UKEY}, ${R(days)}), countIf(${W}), countIf(${P}), uniqExactIf(${UKEY}, ${W}), uniqExactIf(${UKEY}, ${P})
    FROM events WHERE timestamp >= now() - INTERVAL ${windowDays(days)} DAY AND ${EVENTS_IN} AND ${shareEventScope(cc)}
    GROUP BY event`,
  // per event and channel, in the range: [event, channel, count]
  eventChannels: (cc, days) => `SELECT event, lower(toString(coalesce(properties.channel, ''))) AS ch, count()
    FROM events WHERE ${R(days)} AND ${EVENTS_IN} AND ${shareEventScope(cc)}
    GROUP BY event, ch`,
  // visits from shares: [rangePeople, wPeople, pPeople, rangeVisits]
  visitTotals: (cc, days) => `SELECT uniqExactIf(${UKEY}, ${R(days)}), uniqExactIf(${UKEY}, ${W}), uniqExactIf(${UKEY}, ${P}), countIf(${R(days)})
    FROM events WHERE timestamp >= now() - INTERVAL ${windowDays(days)} DAY AND ${shareVisit(cc)}`,
  // visits per channel, in the range: [utm_source, people, visits]
  visitChannels: (cc, days) => `SELECT lower(toString(coalesce(properties.utm_source, ''))) AS ch, uniqExact(${UKEY}), count()
    FROM events WHERE ${R(days)} AND ${shareVisit(cc)}
    GROUP BY ch`,
  // people who came through a share and then contacted / signed up:
  // [contactRange, contactW, contactP, signupRange, signupW, signupP]
  outcomes: (cc, days) => {
    const win = windowDays(days);
    const C = (when) => `uniqExactIf(${UKEY}, ${CONTACT_IN} AND ${when})`;
    const S = (when) => `uniqExactIf(${UKEY}, event = 'user_signed_up' AND ${when})`;
    return `SELECT ${C(R(days))}, ${C(W)}, ${C(P)}, ${S(R(days))}, ${S(W)}, ${S(P)}
    FROM events WHERE timestamp >= now() - INTERVAL ${win} DAY AND (${CONTACT_IN} OR event = 'user_signed_up') AND ${GEO_BASE}${siteClause(cc2(cc))}
      AND ${UKEY} IN (SELECT ${UKEY} FROM events WHERE timestamp >= now() - INTERVAL ${win} DAY AND ${shareVisit(cc)})`;
  },
  // per listing, in the range: [listing_id, shares, opens, clicks, sharers]
  listings: (cc, days, limit = 40) => `SELECT ${LID} AS lid, countIf(event = '${SHARE_EVENTS.shared}') AS shares, countIf(event = '${SHARE_EVENTS.opened}'), countIf(event = '${SHARE_EVENTS.click}') AS clicks, uniqExactIf(${UKEY}, event = '${SHARE_EVENTS.shared}')
    FROM events WHERE ${R(days)} AND ${EVENTS_IN} AND ${shareEventScope(cc)} AND ${LID} != ''
    GROUP BY lid ORDER BY shares DESC, clicks DESC LIMIT ${Number(limit) || 40}`,
  // who shared which listing (signed-in sharers), in the range: [email, listing_id, shares]
  sharers: (cc, days) => `SELECT lower(coalesce(toString(person.properties.email), '')) AS email, ${LID} AS lid, count() AS n
    FROM events WHERE ${R(days)} AND event = '${SHARE_EVENTS.shared}' AND ${shareEventScope(cc)} AND ${LID} != ''
    GROUP BY email, lid ORDER BY n DESC LIMIT 1000`,
};

const n = (v) => Number(v) || 0;
export const flat = (rows) => (rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r)));
const blank = () => ({ range: 0, people: 0, w: 0, p: 0, wPeople: 0, pPeople: 0 });

// The answers of eventTotals / eventChannels / visitTotals / visitChannels / outcomes → the page's
// numbers. Any answer may be null (that query failed): its numbers stay 0 and `missing` names it.
export function summarizeShares({ eventTotals, eventChannels, visitTotals, visitChannels, outcomes } = {}) {
  const ev = { opened: blank(), shared: blank(), clicks: blank() };
  const key = { [SHARE_EVENTS.opened]: 'opened', [SHARE_EVENTS.shared]: 'shared', [SHARE_EVENTS.click]: 'clicks' };
  for (const [event, range, people, w, p, wp, pp] of flat(eventTotals)) {
    const k = key[event];
    if (k) ev[k] = { range: n(range), people: n(people), w: n(w), p: n(p), wPeople: n(wp), pPeople: n(pp) };
  }
  const ch = new Map(CHANNEL_ORDER.map((c) => [c, { code: c, label: channelLabel(c), opened: 0, shared: 0, clicks: 0, visitors: 0, visits: 0 }]));
  for (const [event, channel, count] of flat(eventChannels)) {
    const k = key[event];
    if (k) ch.get(channelOf(channel))[k] += n(count);
  }
  for (const [source, people, visits] of flat(visitChannels)) {
    const c = ch.get(channelOf(source));
    c.visitors += n(people); c.visits += n(visits);
  }
  const [vRange, vW, vP, vCount] = flat(visitTotals)[0] || [];
  const [cR, cW, cP, sR, sW, sP] = flat(outcomes)[0] || [];
  const visitors = { range: n(vRange), w: n(vW), p: n(vP), visits: n(vCount) };
  const contacts = { range: n(cR), w: n(cW), p: n(cP) };
  const signups = { range: n(sR), w: n(sW), p: n(sP) };
  const channels = [...ch.values()].filter((c) => c.opened || c.shared || c.clicks || c.visitors)
    .sort((a, b) => (b.shared + b.visitors) - (a.shared + a.visitors) || CHANNEL_ORDER.indexOf(a.code) - CHANNEL_ORDER.indexOf(b.code));
  const missing = Object.entries({ eventTotals, eventChannels, visitTotals, visitChannels, outcomes }).filter(([, v]) => v == null).map(([k]) => k);
  return { ...ev, visitors, contacts, signups, channels, missing };
}

// share_reward rows in email_log → granted rewards. A grant is an 'event' row (channel 'event' or a
// dedupe key ending ':ev'); when a country only has the "you earned it" emails, each sent email
// counts as one grant. Revoked / skipped / failed rows don't count.
const DEAD = new Set(['revoked', 'skipped', 'failed', 'bounced', 'test']);
export function summarizeShareRewards(rows = [], { days = 30, now = Date.now() } = {}) {
  const isEvent = (r) => r.channel === 'event' || /:ev$/.test(String(r.dedupe_key || ''));
  const live = rows.filter((r) => !DEAD.has(String(r.status || '').toLowerCase()) && !DEAD.has(String(r.subject || '').toLowerCase()));
  const events = live.filter(isEvent);
  const grants = events.length ? events : live.filter((r) => r.channel !== 'whatsapp');
  const seen = new Set();
  const uniq = grants.filter((r) => {
    const k = r.dedupe_key || r.id;
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const age = (r) => now - Date.parse(r.created_at);
  const inRange = uniq.filter((r) => age(r) < days * 86400000);
  return {
    total: uniq.length,
    range: inRange.length,
    w: uniq.filter((r) => age(r) < 7 * 86400000).length,
    p: uniq.filter((r) => age(r) >= 7 * 86400000 && age(r) < 14 * 86400000).length,
    recent: inRange.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 10)
      .map((r) => ({ at: r.created_at, userId: r.run_id || null, email: r.to_email && r.to_email !== '-' ? r.to_email : null, listingId: listingOfReward(r) })),
  };
}
// the listing a reward was for: in the row's JSON (error column, like the referral records) or in its dedupe key
export function listingOfReward(r) {
  try {
    const d = typeof r.error === 'string' && r.error.startsWith('{') ? JSON.parse(r.error) : null;
    if (d?.listing_id) return String(d.listing_id);
  } catch { /* not JSON */ }
  // e.g. share:reward:<listing id>:ev — the first id in the key
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(r.dedupe_key || ''));
  return m ? m[1] : null;
}

// "Casa for sale · Villa Morra" from a properties row.
export function listingTitle(p) {
  if (!p) return 'Listing';
  const t = String(p.property_type || 'Home');
  const kind = p.listing_type === 'rent' ? 'for rent' : p.listing_type === 'sale' ? 'for sale' : '';
  const head = `${t.charAt(0).toUpperCase()}${t.slice(1).toLowerCase()} ${kind}`.trim();
  const where = p.neighborhood || p.city;
  return where ? `${head} · ${where}` : head;
}

// listings answer + DB rows → the most-shared listings (only listings of this country's DB).
export function topListings(listingRows, { props = [], users = [] } = {}) {
  const pById = new Map(props.map((p) => [String(p.id), p]));
  const uById = new Map(users.map((u) => [String(u.id), u]));
  return flat(listingRows).map(([lid, shares, opens, clicks, sharers]) => ({ id: String(lid), shares: n(shares), opens: n(opens), clicks: n(clicks), sharers: n(sharers) }))
    .filter((r) => pById.has(r.id))
    .map((r) => {
      const p = pById.get(r.id);
      const u = uById.get(String(p.created_by)) || null;
      return { ...r, title: listingTitle(p), photo: p.feature_image_url || null, status: p.status || null, ownerId: p.created_by || null, owner: u ? (u.full_name || u.email || null) : null, ownerEmail: u?.email || null };
    });
}

// Owners whose listings were shared, ranked by the shares they made themselves, then all shares of
// their listings, then clicks on their links. sharerRows = sharers answer; listingRows = listings.
export function topSellers(sharerRows, listingRows, { props = [], users = [] } = {}, limit = 10) {
  const pById = new Map(props.map((p) => [String(p.id), p]));
  const uById = new Map(users.map((u) => [String(u.id), u]));
  const per = new Map();
  const row = (ownerId) => {
    if (!per.has(ownerId)) per.set(ownerId, { ownerId, own: 0, shares: 0, clicks: 0, listings: new Set() });
    return per.get(ownerId);
  };
  for (const [email, lid, cnt] of flat(sharerRows)) {
    const p = pById.get(String(lid));
    if (!p?.created_by) continue;
    const r = row(String(p.created_by));
    const ownerEmail = String(uById.get(String(p.created_by))?.email || '').toLowerCase();
    if (email && ownerEmail && String(email).toLowerCase() === ownerEmail) r.own += n(cnt);
  }
  for (const [lid, shares, , clicks] of flat(listingRows)) {
    const p = pById.get(String(lid));
    if (!p?.created_by) continue;
    const r = row(String(p.created_by));
    r.shares += n(shares); r.clicks += n(clicks); r.listings.add(String(lid));
  }
  return [...per.values()]
    .map((r) => {
      const u = uById.get(r.ownerId) || {};
      return { ownerId: r.ownerId, name: u.full_name || u.email || 'Unknown owner', email: u.email || null, photo: u.profile_photo_url && (!u.profile_photo_status || u.profile_photo_status === 'approved') ? u.profile_photo_url : null, ownShares: r.own, shares: r.shares, clicks: r.clicks, listings: r.listings.size };
    })
    .filter((r) => r.shares || r.clicks || r.ownShares)
    .sort((a, b) => b.ownShares - a.ownShares || b.shares - a.shares || b.clicks - a.clicks)
    .slice(0, limit);
}

// The listing ids the DB must be asked about (listings answer ∪ sharers answer ∪ rewards).
export function listingIdsOf(listingRows, sharerRows, rewards = []) {
  const ids = new Set();
  for (const [lid] of flat(listingRows)) if (lid) ids.add(String(lid));
  for (const [, lid] of flat(sharerRows)) if (lid) ids.add(String(lid));
  for (const r of rewards) if (r.listingId) ids.add(String(r.listingId));
  return [...ids];
}
