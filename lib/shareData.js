// "Listing shares" data for one country. Server-only. PostHog answers are cached by
// lib/posthogHogql.js (5 min fresh, 6 h stale); every part fails on its own (→ null / []), so a
// slow PostHog or a missing table never blanks the page. Counting rules: lib/shareStats.js.
//   sharesFor(cc, days)  the Shares page: totals, this week vs the week before, channels,
//                        most-shared listings, top sharing sellers, rewards granted
//   sharesWeek(cc)       the Overview card: visits from shares + shares, last 7 days vs the 7 before
import 'server-only';
import { dbFor } from './db.js';
import { hogql, posthogConfigured } from './posthogHogql.js';
import { selectAll, selectIn } from './selectAll.js';
import { swr } from './swrCache.js';
import { isInternalEmail } from './internalTraffic.js';
import { internalEmails } from './internalAudience.js';
import { HIDE_DELETED_USERS } from './userInsights.js';
import { SHARE_REWARD_ID, SHARE_NUDGE_ID, shareRewardConfig, shareNudgeConfig } from './shareAdmin.js';
import { shareSql, summarizeShares, summarizeShareRewards, topListings, topSellers, listingIdsOf, listingTitle, flat, SHARE_RANGES } from './shareStats.js';

const safe = (p, fallback = null) => Promise.resolve(p).catch(() => fallback);
const okId = (id) => /^[\w-]{1,64}$/.test(String(id || ''));

async function rewardRows(db) {
  return selectAll(db, 'email_log', `select=id,run_id,to_email,subject,status,channel,dedupe_key,error,created_at&automation_id=eq.${SHARE_REWARD_ID}&order=id.asc`);
}

async function load(cc, days) {
  const db = dbFor(cc);
  const ph = posthogConfigured();
  const q = (sql) => (ph ? safe(hogql(sql)) : Promise.resolve(null));
  const [eventTotals, eventChannels, visitTotals, visitChannels, outcomes, listingRows, sharerRows, rewardLog, autos, extra, bySharerRows] = await Promise.all([
    q(shareSql.eventTotals(cc, days)),
    q(shareSql.eventChannels(cc, days)),
    q(shareSql.visitTotals(cc, days)),
    q(shareSql.visitChannels(cc, days)),
    q(shareSql.outcomes(cc, days)),
    q(shareSql.listings(cc, days)),
    q(shareSql.sharers(cc, days)),
    safe(rewardRows(db), null),
    safe(db.select('automations', `select=*&id=in.(${SHARE_NUDGE_ID},${SHARE_REWARD_ID})`), []),
    safe(internalEmails(cc), new Set()),
    q(shareSql.clicksBySharer(cc, days)),
  ]);
  const summary = summarizeShares({ eventTotals, eventChannels, visitTotals, visitChannels, outcomes });
  const rewards = rewardLog ? summarizeShareRewards(rewardLog, { days }) : null;

  // the listings and owners the tables name (only this country's DB; team / test owners left out)
  const ids = listingIdsOf(listingRows, sharerRows, rewards?.recent || []).filter(okId);
  const props = ids.length ? await safe(selectIn(db.select, 'properties', 'id,created_by,status,property_type,listing_type,neighborhood,city,feature_image_url', 'id', ids), []) : [];
  const sharerIds = flat(bySharerRows || []).map((r) => String(r[0])).filter(okId);
  const ownerIds = [...new Set([...props.map((p) => p.created_by), ...(rewards?.recent || []).map((r) => r.userId), ...sharerIds].filter(okId).map(String))];
  const usersAll = ownerIds.length
    ? await safe(selectIn(db.select, 'users', 'id,email,full_name,profile_photo_url,profile_photo_status', 'id', ownerIds, `&${HIDE_DELETED_USERS}`)
      .catch(() => selectIn(db.select, 'users', 'id,email,full_name', 'id', ownerIds)), [])
    : [];
  const internal = new Set(usersAll.filter((u) => isInternalEmail(u.email, extra)).map((u) => String(u.id)));
  const users = usersAll.filter((u) => !internal.has(String(u.id)));
  const realProps = props.filter((p) => !internal.has(String(p.created_by)));
  const ctx = { props: realProps, users };
  const uById = new Map(users.map((u) => [String(u.id), u]));
  const pById = new Map(realProps.map((p) => [String(p.id), p]));

  const rowsOf = (r) => (r == null ? null : flat(r));
  const settings = {
    nudge: shareNudgeConfig((autos || []).find((a) => a.id === SHARE_NUDGE_ID) || null),
    reward: shareRewardConfig((autos || []).find((a) => a.id === SHARE_REWARD_ID) || null),
  };
  return {
    country: cc,
    days,
    posthog: ph,
    ...summary,
    listings: topListings(rowsOf(listingRows), ctx).slice(0, 12),
    sellers: topSellers(rowsOf(sharerRows), rowsOf(listingRows), ctx, 10),
    // who shared (anyone signed in, owner or not) and the clicks their links brought
    sharedBy: flat(bySharerRows || []).filter((r) => uById.has(String(r[0]))).map((r) => {
      const u = uById.get(String(r[0]));
      return { userId: String(r[0]), name: u.full_name || u.email, email: u.email || null, photo: u.profile_photo_url && (!u.profile_photo_status || u.profile_photo_status === 'approved') ? u.profile_photo_url : null, clicks: Number(r[1]) || 0, listings: Number(r[2]) || 0, channels: (r[3] || []).filter(Boolean) };
    }).slice(0, 15),
    rewards: rewards ? {
      ...rewards,
      recent: rewards.recent.filter((r) => !r.userId || !internal.has(String(r.userId))).map((r) => {
        const u = uById.get(String(r.userId)) || null;
        const p = pById.get(String(r.listingId)) || null;
        return { ...r, name: u ? (u.full_name || u.email) : (r.email || null), listingTitle: p ? listingTitle(p) : null };
      }),
    } : null,
    settings,
  };
}

// Cached per country + range for 5 minutes (6 h stale), like the campaigns page.
export function sharesFor(cc, days = 30, { force = false } = {}) {
  const d = SHARE_RANGES.includes(Number(days)) ? Number(days) : 30;
  return swr(`shares:${cc}:${d}`, () => load(cc, d), { fresh: 5 * 60_000, stale: 6 * 3600_000, force });
}

// The Overview card: only the two cheap queries (cached with the page's 7-day answers).
export async function sharesWeek(cc) {
  if (!posthogConfigured()) return null;
  const [eventTotals, visitTotals] = await Promise.all([safe(hogql(shareSql.eventTotals(cc, 7))), safe(hogql(shareSql.visitTotals(cc, 7)))]);
  if (eventTotals == null && visitTotals == null) return null;
  const s = summarizeShares({ eventTotals, visitTotals });
  return { visitors: s.visitors, shared: s.shared, clicks: s.clicks };
}
