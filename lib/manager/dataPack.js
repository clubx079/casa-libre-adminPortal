// Admin Manager — the weekly DATA PACK: every number the report is built on, collected by
// code (not by Claude reading screens), for the 7 days before the run and the 7 days before
// that. Team / test accounts are left out the same way the rest of the admin does
// (lib/internalTraffic + internalAudience). Each section fails on its own: a broken source
// becomes { error } in the pack and the agent is told, the rest still runs. Server-only.
import { dbFor } from '../db.js';
import { selectAll } from '../selectAll.js';
import { hogql, posthogConfigured } from '../posthogHogql.js';
import { UKEY, SOURCE_EXPR, GEO_BASE, CONTACT_IN } from '../posthogSql.js';
import { siteClause } from '../analyticsSite.js';
import { isInternalEmail, isInternalContact, HIDDEN_EMAIL_TYPES } from '../internalTraffic.js';
import { internalEmails } from '../internalAudience.js';
import { HIDE_DELETED_USERS } from '../userInsights.js';
import { countryEmails } from '../resendEmails.js';
import { summarize, emailType, trackingFor } from '../emailStats.js';
import { googleSetup } from '../googleApi.js';
import { rangeFor, outcomes } from '../marketingReport.js';
import { adsAll } from '../marketingFetch.js';
import { paidConfig, PAID_LISTINGS_ID } from '../paidListingsAdmin.js';
import { countryInfo } from '../automationAdmin.js';
import { cleanRow } from './tools.js';
import { botReason } from '../feedbackBot.js';
import { isPaymentClaim, claimFacts, botFeedback, botAccounts, listingDataFlags, messageTiming } from './checks.js';
import {
  periods, inPeriod, change, countBy, pct, followUpResults, feedbackSummary,
  signupSummary, listingSummary, paymentSummary, scraperHealth,
} from './packMath.js';

const ADS_COUNTRIES = ['py'];   // the one Google Ads account advertises Paraguay only
const UTC_OFFSET = { py: -3, bo: -4, uy: -3, ve: -4, sv: -6 };   // local time, for "sent at what hour"
const enc = encodeURIComponent;
const flat = (rows) => (rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r)));
const cut = (s, n = 500) => { const v = String(s || ''); return v.length > n ? `${v.slice(0, n)}…` : v; };

export async function buildDataPack(country, { now = new Date(), previous = null } = {}) {
  const db = dbFor(country);
  const P = periods(now);
  const site = countryInfo(country).site;
  const pack = {
    country,
    site,
    period: P.cur,
    previousPeriod: P.prev,
    generatedAt: new Date().toISOString(),
    notes: [],
  };
  const section = async (name, fn) => {
    try { pack[name] = await fn(); } catch (e) { pack[name] = { error: String(e?.message || e).slice(0, 300) }; }
  };

  // ── people: who is real (team / test accounts out) ──
  const extra = await internalEmails(country).catch(() => new Set());
  let users = [];
  try {
    users = await selectAll(db, 'users', `select=id,email,full_name,created_at,auth_provider,verified,last_login_at,phone_verified_at&${HIDE_DELETED_USERS}&order=id.asc`);
  } catch (e) { pack.notes.push(`users could not be read: ${String(e?.message || e).slice(0, 160)}`); }
  const internalIds = new Set(users.filter((u) => isInternalEmail(u.email, extra)).map((u) => String(u.id)));
  const real = users.filter((u) => !internalIds.has(String(u.id)));
  const isReal = (userId) => !internalIds.has(String(userId || ''));

  await section('users', async () => {
    const cur = signupSummary(real, P.cur), prev = signupSummary(real, P.prev);
    return {
      totalAccounts: real.length,
      signups: cur, signupsPrevious: prev, signupsChangePct: change(cur.total, prev.total),
      whatsappVerifiedThisWeek: real.filter((u) => inPeriod(u.phone_verified_at, P.cur)).length,
      activeThisWeek: real.filter((u) => inPeriod(u.last_login_at, P.cur)).length,
    };
  });

  // ── owner listings (what sellers published) + the whole catalog ──
  let ownerListings = [];
  await section('listings', async () => {
    ownerListings = (await selectAll(db, 'properties', 'select=id,created_by,created_at,property_type,listing_type,city,status,admin_status,is_complete,promotion_plan,is_delisted,image_status&origin=eq.user&order=id.asc'))
      .filter((l) => isReal(l.created_by));
    const cur = listingSummary(ownerListings, P.cur), prev = listingSummary(ownerListings, P.prev);
    const firstTime = (() => {
      const firstBy = new Map();
      for (const l of ownerListings) {
        const k = String(l.created_by);
        const t = Date.parse(l.created_at);
        if (!firstBy.has(k) || t < firstBy.get(k)) firstBy.set(k, t);
      }
      return [...firstBy.values()].filter((t) => inPeriod(new Date(t).toISOString(), P.cur)).length;
    })();
    return { newThisWeek: cur, newPreviousWeek: prev, changePct: change(cur.total, prev.total), firstTimeSellersThisWeek: firstTime, ownerListingsAllTime: ownerListings.length };
  });

  await section('catalog', async () => {
    const count = async (filters) => (await db.selectWithCount('properties', `select=id&${filters}&limit=1`)).count;
    const [ownerLive, scrapedLive, rentLive, saleLive] = await Promise.all([
      count('origin=eq.user&is_delisted=eq.false'),
      count('origin=neq.user&is_delisted=eq.false'),
      count('is_delisted=eq.false&listing_type=eq.rent'),
      count('is_delisted=eq.false&listing_type=eq.sale'),
    ]);
    const quarantinePending = await db.selectWithCount('ingest_quarantine', 'select=id&status=eq.pending&limit=1').then((r) => r.count).catch(() => null);
    return { liveOwnerListings: ownerLive, liveScrapedListings: scrapedLive, liveRent: rentLive, liveSale: saleLive, quarantinePending };
  });

  // ── unfinished drafts ──
  await section('drafts', async () => {
    const drafts = (await selectAll(db, 'listing_drafts', 'select=id,user_id,created_at,updated_at&order=id.asc')).filter((d) => isReal(d.user_id));
    const listedSince = new Map();
    for (const l of ownerListings) listedSince.set(String(l.created_by), Math.max(listedSince.get(String(l.created_by)) || 0, Date.parse(l.created_at)));
    const stuck = drafts.filter((d) => Date.parse(d.updated_at) < now.getTime() - 3 * 86400000 && !(listedSince.get(String(d.user_id)) > Date.parse(d.updated_at)));
    return {
      open: drafts.length,
      startedThisWeek: drafts.filter((d) => inPeriod(d.created_at, P.cur)).length,
      touchedThisWeek: drafts.filter((d) => inPeriod(d.updated_at, P.cur)).length,
      stuckOver3Days: stuck.length,
      stuckExamples: stuck.slice(0, 8).map((d) => ({ draft_id: d.id, user_id: d.user_id, last_edit: d.updated_at })),
    };
  });

  // ── automations + every message they sent (email and WhatsApp) ──
  let payments = [];
  try {
    payments = (await selectAll(db, 'payments', `select=id,user_id,property_id,kind,plan,amount_usd,status,failure_reason,created_at&created_at=gte.${enc(P.prev.start)}&order=id.asc`)).filter((p) => isReal(p.user_id));
  } catch (e) { pack.notes.push(`payments could not be read: ${String(e?.message || e).slice(0, 160)}`); }

  await section('automations', async () => {
    const [config, messagesRaw, runs] = await Promise.all([
      db.select('automations', 'select=*&order=id.asc'),
      selectAll(db, 'email_log', `select=id,automation_id,template_key,subject,status,channel,to_email,created_at&created_at=gte.${enc(P.prev.start)}&order=id.asc`),
      selectAll(db, 'automation_runs', `select=id,automation_id,status,skip_reason,created_at&created_at=gte.${enc(P.cur.start)}&order=id.asc`).catch(() => []),
    ]);
    const messages = messagesRaw.filter((m) => !isInternalEmail(m.to_email, extra) && m.automation_id !== 'wa_campaign');
    const base = { users: real, listings: ownerListings, payments, now: now.getTime() };
    const channelTotals = (p) => {
      const mine = messages.filter((m) => inPeriod(m.created_at, p) && !['test', 'skipped'].includes(String(m.status)));
      return { email: mine.filter((m) => m.channel !== 'whatsapp').length, whatsapp: mine.filter((m) => m.channel === 'whatsapp').length, failed: mine.filter((m) => m.status === 'failed').length };
    };
    return {
      settings: config.map((c) => {
        const row = cleanRow(c);
        for (const k of Object.keys(row)) if (row[k] === null) delete row[k];
        return row;
      }),
      sentThisWeek: channelTotals(P.cur),
      sentPreviousWeek: channelTotals(P.prev),
      // last week's messages have had their full 7 days — the fair scorecard
      followUpsPreviousWeekFullResults: followUpResults({ ...base, messages, period: P.prev }),
      // this week's are still running (stillOpen = messages younger than 7 days)
      followUpsThisWeekSoFar: followUpResults({ ...base, messages, period: P.cur }),
      runsThisWeek: countBy(runs, (r) => `${r.automation_id} · ${r.status}${r.skip_reason ? ` (${r.skip_reason})` : ''}`, 25),
      howToRead: 'listed/paid/active = the person published a listing / paid / signed in within 7 days after the message (one person counts once per row). matched = messages whose address belongs to an account. There is no control group: compare rows and weeks, do not read a rate as the message\'s own effect.',
    };
  });

  // ── email engagement from Resend (opens / clicks per email type) ──
  await section('emailEngagement', async () => {
    const res = await countryEmails(country, 14);
    if (!res) return { error: 'RESEND_READ_API_KEY not set' };
    const recipients = (e) => (Array.isArray(e.to) ? e.to : [e.to]).map((x) => String(x || '').toLowerCase());
    const mine = res.rows.filter((e) => !HIDDEN_EMAIL_TYPES.includes(emailType(e.subject)) && !recipients(e).some((x) => isInternalEmail(x, extra)));
    const tracking = trackingFor(country);
    const part = (p) => {
      const s = summarize(mine.filter((e) => inPeriod(e.created_at, p)), { trackingSince: tracking.since });
      return { totals: s.totals, byType: s.byType.slice(0, 15).map(({ type, sent, delivered, failed, openRate, clickRate }) => ({ type, sent, delivered, failed, openRate, clickRate })) };
    };
    return { thisWeek: part(P.cur), previousWeek: part(P.prev), note: 'Open rates are inflated by Apple Mail privacy; clicks are the honest signal. Sign-in codes are left out of the rates.' };
  });

  // ── money ──
  await section('payments', async () => {
    const cfgRow = await db.select('automations', `select=*&id=eq.${PAID_LISTINGS_ID}&limit=1`).then((r) => r[0] || null).catch(() => null);
    const cur = paymentSummary(payments, P.cur), prev = paymentSummary(payments, P.prev);
    return { thisWeek: cur, previousWeek: prev, paywall: cfgRow ? paidConfig(cfgRow) : { enabled: false, note: 'paid listings never saved in admin' } };
  });

  // ── what people told us ──
  await section('feedback', async () => {
    const all = (await db.select('feedback', `select=id,user_id,name,email,rating,message,source,created_at&created_at=gte.${enc(P.prev.start)}&order=created_at.desc&limit=500`))
      .filter((r) => !isInternalEmail(r.email, extra) && isReal(r.user_id));
    const rows = all.filter((r) => !botReason(r));   // bots (Play pre-launch robot …) never count in ratings
    const cur = rows.filter((r) => inPeriod(r.created_at, P.cur));
    return {
      botsLeftOut: all.length - rows.length,
      thisWeek: feedbackSummary(cur),
      previousWeek: feedbackSummary(rows.filter((r) => inPeriod(r.created_at, P.prev))),
      items: cur.slice(0, 40).map((r) => ({ id: r.id, user_id: r.user_id || null, first_name: String(r.name || '').split(/\s+/)[0] || null, rating: r.rating, source: r.source, message: cut(r.message), at: r.created_at })),
    };
  });

  // ── checks: complaints vs the records, bots, impossible listing data (last 30 days) ──
  const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  let fb30 = [];
  try {
    fb30 = (await db.select('feedback', `select=id,user_id,name,email,rating,message,source,created_at&created_at=gte.${enc(since30)}&order=created_at.desc&limit=1000`))
      .filter((r) => !isInternalEmail(r.email, extra) && isReal(r.user_id));
  } catch (e) { pack.notes.push(`feedback (30 days) could not be read: ${String(e?.message || e).slice(0, 160)}`); }
  const userById = new Map(users.map((u) => [String(u.id), u]));
  const userByEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));

  await section('claimChecks', async () => {
    const claims = fb30.filter((r) => !botReason(r) && (Number(r.rating) <= 2 || isPaymentClaim(r.message)));
    const items = [];
    for (const fb of claims.slice(0, 15)) {
      const user = (fb.user_id && userById.get(String(fb.user_id))) || userByEmail.get(String(fb.email || '').toLowerCase()) || null;
      const email = String(user?.email || fb.email || '').toLowerCase();
      const uid = user ? enc(user.id) : null;
      const [pays, drafts, listings, messages] = await Promise.all([
        uid ? db.select('payments', `select=status,amount_usd,kind,plan,created_at&user_id=eq.${uid}&order=created_at.asc&limit=50`).catch(() => []) : [],
        uid ? db.select('listing_drafts', `select=id,created_at,updated_at&user_id=eq.${uid}&limit=20`).catch(() => []) : [],
        uid ? db.select('properties', `select=id,admin_status,is_delisted,created_at&created_by=eq.${uid}&limit=50`).catch(() => []) : [],
        email ? db.select('email_log', `select=automation_id,channel,status,created_at&to_email=eq.${enc(email)}&status=neq.test&order=created_at.asc&limit=100`).catch(() => []) : [],
      ]);
      items.push(claimFacts(fb, { user, payments: pays, drafts, listings, messages }));
    }
    return {
      window: 'feedback with 1–2 stars or a payment claim, last 30 days (bots left out)',
      items,
      howToRead: 'signals = what the records say about the claim. likelyFalseFlag = says they paid, but no completed payment and they never published. Decide the verdict yourself; check with the tools when unsure.',
    };
  });

  await section('suspicious', async () => {
    const live = (await selectAll(db, 'properties', `select=id,created_by,created_at,address,neighborhood,city,listing_type,property_type,price,currency,price_usd,description,admin_status&origin=eq.user&is_delisted=eq.false&created_at=gte.${enc(since30)}&order=id.asc`))
      .filter((l) => isReal(l.created_by));
    const STRONG = /mixed up|no price|same text|too short/;
    const listings = live.map((l) => ({ l, flags: listingDataFlags(l) })).filter((x) => x.flags.some((f) => STRONG.test(f))).slice(0, 20)
      .map(({ l, flags }) => ({
        property_id: l.id, user_id: l.created_by, seller_first_name: String(userById.get(String(l.created_by))?.full_name || '').split(/\s+/)[0] || null,
        created_at: l.created_at, status: l.admin_status, address: l.address, neighborhood: l.neighborhood, city: l.city,
        listing_type: l.listing_type, property_type: l.property_type, price: l.price, currency: l.currency, price_usd: l.price_usd,
        description: cut(l.description, 240), flags,
      }));
    return {
      botFeedback: botFeedback(fb30),
      botSignups: botAccounts(users.filter((u) => inPeriod(u.created_at, { start: since30, end: now.toISOString() }))),
      listingsWithImpossibleData: listings,
      howToRead: 'Bots are automated testers/crawlers (e.g. Google Play\'s pre-launch robot, crawlerrobo@gmail.com, random 6-letter names): flag them, never email them, leave them out of ratings. A listing with impossible data is usually a REAL person who made a mistake (e.g. rent vs sale): ask them to fix it.',
    };
  });

  await section('messageTiming', async () => {
    const [msgs, res, draftRows, pays30] = await Promise.all([
      selectAll(db, 'email_log', `select=automation_id,channel,status,to_email,created_at,resend_id,run_id&created_at=gte.${enc(since30)}&automation_id=not.is.null&order=id.asc`),
      countryEmails(country, 31).catch(() => null),
      selectAll(db, 'listing_drafts', 'select=id,created_at&order=id.asc').catch(() => []),
      db.select('payments', `select=user_id,status,created_at&created_at=gte.${enc(since30)}&limit=2000`).catch(() => []),
    ]);
    const mine = msgs.filter((m) => !isInternalEmail(m.to_email, extra) && !['wa_campaign', 'newsletter', 'manager'].includes(m.automation_id));
    return {
      window: 'messages sent by automations in the last 30 days',
      localTime: `UTC${UTC_OFFSET[country] ?? -3}`,
      emailTracking: res ? 'Resend opens/clicks' : 'Resend not readable: no email open/click data',
      rows: messageTiming({
        messages: mine,
        resend: new Map((res?.rows || []).map((e) => [e.id, e.last_event])),
        userByEmail, listings: ownerListings, payments: pays30,
        drafts: new Map(draftRows.map((d) => [String(d.id), d])),
        offsetH: UTC_OFFSET[country] ?? -3, now: now.getTime(),
      }),
      howToRead: 'Per automation and channel. Email: bounceRate/openRate/clickRate from Resend (opens are inflated by Apple Mail; clicks are honest). WhatsApp: readRate from Relay. bySendHourLocal = sent and clicked/read by the local hour it went out. actedAfter = how long people took to publish or pay after the message (within 7 days). draftAgeWhenRemindedHours = how old the draft was when the reminder went out. Small numbers: say so.',
    };
  });

  await section('listingReports', async () => {
    const rows = await db.select('listing_reports', `select=id,property_id,listing_ref,user_id,message,status,created_at&created_at=gte.${enc(P.prev.start)}&order=created_at.desc&limit=200`);
    const cur = rows.filter((r) => inPeriod(r.created_at, P.cur));
    return { thisWeek: cur.length, previousWeek: rows.length - cur.length, items: cur.slice(0, 25).map((r) => ({ ...r, message: cut(r.message, 300) })) };
  });

  // ── buyers contacting sellers (WhatsApp / call / copy number on a listing) ──
  await section('buyerContacts', async () => {
    const rows = (await selectAll(db, 'contact_link_clicks', `select=id,property_id,channel,status,opened_at,created_at,buyer_name,buyer_email,buyer_country&created_at=gte.${enc(P.prev.start)}&order=id.asc`))
      .filter((r) => !isInternalContact(r, extra));
    const part = (p) => {
      const mine = rows.filter((r) => inPeriod(r.created_at, p));
      return { contacts: mine.length, listingsContacted: new Set(mine.map((r) => r.property_id)).size, linkOpenedBySeller: mine.filter((r) => r.opened_at).length, byChannel: countBy(mine, (r) => r.channel, 5) };
    };
    const cur = part(P.cur), prev = part(P.prev);
    return {
      thisWeek: cur, previousWeek: prev, changePct: change(cur.contacts, prev.contacts),
      note: 'linkOpenedBySeller only counts sellers who tapped the listing link inside the buyer\'s WhatsApp message. Sellers who answer the buyer directly never open it, so a low number does NOT mean sellers ignore buyers.',
    };
  });

  // ── scrapers ──
  await section('scrapers', async () => {
    const since = new Date(now.getTime() - 14 * 86400000).toISOString();
    const [sources, runs] = await Promise.all([
      db.select('scrape_sources', 'select=id,key,name,is_active,cron_enabled,last_run_at,last_run_status&order=key.asc'),
      selectAll(db, 'scrape_runs', `select=id,source_id,status,trigger,started_at,inserted_count,updated_count,total_found&started_at=gte.${enc(since)}&order=id.asc`).catch(() => []),
    ]);
    const health = scraperHealth(sources, runs);
    const live = await Promise.all(sources.filter((s) => s.is_active).map(async (s) => [s.key, (await db.selectWithCount('properties', `select=id&source_id=eq.${s.id}&is_delisted=eq.false&limit=1`).catch(() => ({ count: null }))).count]));
    const liveBy = Object.fromEntries(live);
    return { last14Days: health.map((h) => ({ ...h, liveListings: liveBy[h.key] ?? null })) };
  });

  // ── website / app traffic (PostHog) ──
  await section('traffic', async () => {
    if (!posthogConfigured()) return { error: 'PostHog not configured' };
    const where = `${GEO_BASE}${siteClause(country)}`;
    const CUR = 'timestamp >= now() - INTERVAL 7 DAY';
    const step = (cond) => `uniqExactIf(${UKEY}, ${cond})`;
    const both = (cond) => `${step(`${CUR} AND ${cond}`)}, ${step(`timestamp < now() - INTERVAL 7 DAY AND ${cond}`)}`;
    const [summary] = flat(await hogql(`SELECT ${both('1')}, ${both("event = 'search_applied'")}, ${both("event = 'property_viewed'")},
        ${both("event = 'property_saved'")}, ${both(CONTACT_IN)}, ${both("event = 'listing_created'")}, ${both("event = 'app_badge_clicked'")},
        countIf(${CUR} AND event = '$pageview'), countIf(timestamp < now() - INTERVAL 7 DAY AND event = '$pageview')
      FROM events WHERE timestamp >= now() - INTERVAL 14 DAY AND ${where}`));
    const v = (summary || []).map((x) => Number(x) || 0);
    const steps = ['Visited', 'Searched', 'Viewed a property', 'Saved a property', 'Contacted a seller', 'Listed a property', 'Clicked an app button'];
    const funnel = steps.map((s, i) => ({ step: s, thisWeek: v[i * 2], previousWeek: v[i * 2 + 1], changePct: change(v[i * 2], v[i * 2 + 1]) }));
    const [sources, devices, demand, cities, pages] = await Promise.all([
      hogql(`WITH first_touch AS (
          SELECT ${UKEY} AS idkey, argMin(${SOURCE_EXPR}, timestamp) AS source,
                 countIf(event = 'listing_created') AS listings, countIf(${CONTACT_IN}) AS contacts
          FROM events WHERE ${CUR} AND ${where} GROUP BY idkey)
        SELECT source, count() AS visitors, sum(listings), sum(contacts) FROM first_touch GROUP BY source ORDER BY visitors DESC LIMIT 15`),
      hogql(`SELECT coalesce(nullIf(properties.$device_type, ''), 'Unknown') AS d, count(DISTINCT ${UKEY}) FROM events WHERE ${CUR} AND ${where} GROUP BY d ORDER BY 2 DESC LIMIT 6`),
      hogql(`SELECT coalesce(nullIf(toString(properties.mode), ''), '?') AS mode, coalesce(nullIf(toString(properties.type), ''), '?') AS type, count() AS views, count(DISTINCT ${UKEY}) AS people
        FROM events WHERE event = 'property_viewed' AND ${CUR} AND ${where} GROUP BY mode, type ORDER BY views DESC LIMIT 20`),
      hogql(`SELECT coalesce(nullIf(toString(properties.city), ''), '?') AS city, count() AS views FROM events WHERE event = 'property_viewed' AND ${CUR} AND ${where} GROUP BY city ORDER BY views DESC LIMIT 10`),
      hogql(`SELECT coalesce(nullIf(properties.$pathname, ''), '/') AS page, count(DISTINCT ${UKEY}) AS people FROM events WHERE event = '$pageview' AND ${CUR} AND ${where} GROUP BY page ORDER BY people DESC LIMIT 12`),
    ]);
    const deviceRows = flat(devices).map((r) => ({ device: r[0], visitors: Number(r[1]) || 0 }));
    const totalDev = deviceRows.reduce((s, r) => s + r.visitors, 0);
    return {
      pageviews: { thisWeek: v[14], previousWeek: v[15], changePct: change(v[14], v[15]) },
      funnel,
      sourcesFirstTouch: flat(sources).map((r) => ({ source: r[0] || 'direct', visitors: Number(r[1]) || 0, listingsCreated: Number(r[2]) || 0, sellerContacts: Number(r[3]) || 0 })),
      devices: deviceRows.map((r) => ({ ...r, share: pct(r.visitors, totalDev) })),
      demandByOperationAndType: flat(demand).map((r) => ({ mode: r[0], type: r[1], views: Number(r[2]) || 0, people: Number(r[3]) || 0 })),
      demandByCity: flat(cities).map((r) => ({ city: r[0], views: Number(r[1]) || 0 })),
      topPages: flat(pages).map((r) => ({ page: r[0], people: Number(r[1]) || 0 })),
      howToRead: 'Visitors = unique people (signed-in by account, others by IP). Team traffic (Pakistan) is excluded. Sources are first touch in the week.',
    };
  });

  // ── Google Ads (Paraguay only) next to what it bought ──
  await section('googleAds', async () => {
    if (!ADS_COUNTRIES.includes(country)) return { skipped: 'No Google Ads for this country.' };
    const setup = googleSetup();
    if (!(setup.refreshToken && setup.clientId && setup.clientSecret && setup.developerToken && setup.customerId)) return { error: 'Google not connected' };
    const ads = await adsAll(rangeFor(7, now));
    const own = {
      signups: pack.users?.signups?.total || 0,
      verifiedSignups: pack.users?.signups?.verified || 0,
      listings: pack.listings?.newThisWeek?.total || 0,
      contacts: pack.buyerContacts?.thisWeek?.contacts || 0,
    };
    return {
      total: ads.total,
      campaigns: ads.campaigns.slice(0, 8).map(({ name, status, cost, clicks, conversions, cpc }) => ({ name, status, cost, clicks, conversions, cpc })),
      conversionActions: ads.conversionActions,
      googleAttributed: ads.acquisition?.total || null,
      searchTerms: ads.searchTerms.slice(0, 10).map(({ text, cost, clicks, conversions }) => ({ text, cost, clicks, conversions })),
      spendVsOurNumbers: outcomes(own, ads.total),
      note: 'conversionActions marked soft (page view etc.) inflate Google\'s own conversion count; realConversions excludes them. spendVsOurNumbers divides the week\'s spend by ALL sign-ups/listings/contacts, not only the ad-driven ones.',
    };
  });

  // ── last week's report, so the agent can say what changed and what was done ──
  pack.previousReport = previous ? {
    period: previous.period_start ? { start: previous.period_start, end: previous.period_end } : null,
    headline: previous.report?.headline || null,
    negatives: (previous.report?.negatives || []).map((n) => n.title),
    recommendations: (previous.report?.recommendations || []).map((r) => r.title),
    adminFeedback: Object.values(previous.feedback || {}).filter((f) => f && (f.vote || f.note)).map((f) => ({ item: f.item, vote: f.vote, note: f.note || null })),
    draftsSent: (previous.actions || []).filter((a) => a.status === 'sent').length,
  } : null;

  // the deterministic headline numbers (also shown as the page's KPI tiles)
  pack.kpis = kpisFromPack(pack);
  return pack;
}

const kpi = (label, cur, prev, unit = '') => ({ label, value: cur ?? null, previous: prev ?? null, changePct: cur == null || prev == null ? null : change(cur, prev), unit });

export function kpisFromPack(p) {
  const f = (name) => (Array.isArray(p.traffic?.funnel) ? p.traffic.funnel.find((x) => x.step === name) : null);
  return [
    kpi('Visitors', f('Visited')?.thisWeek, f('Visited')?.previousWeek),
    kpi('Sign-ups', p.users?.signups?.total, p.users?.signupsPrevious?.total),
    kpi('New owner listings', p.listings?.newThisWeek?.total, p.listings?.newPreviousWeek?.total),
    kpi('Buyer → seller contacts', p.buyerContacts?.thisWeek?.contacts, p.buyerContacts?.previousWeek?.contacts),
    kpi('Revenue', p.payments?.thisWeek?.revenueUsd, p.payments?.previousWeek?.revenueUsd, 'US$'),
    kpi('Messages sent', p.automations?.sentThisWeek ? p.automations.sentThisWeek.email + p.automations.sentThisWeek.whatsapp : null, p.automations?.sentPreviousWeek ? p.automations.sentPreviousWeek.email + p.automations.sentPreviousWeek.whatsapp : null),
    kpi('Feedback (avg ★)', p.feedback?.thisWeek?.avgRating, p.feedback?.previousWeek?.avgRating),
    kpi('Google Ads spend', p.googleAds?.total?.cost, null, 'US$'),
  ];
}
