// GET /api/marketing/report?days=7|30|90[&parts=ads,ga4,gsc,own] → the Marketing page reports, read-only:
//   • Google Ads (the one ad account, all campaigns): spend, clicks, conversions, per
//     campaign / day / keyword / search term, and what the conversions are; plus the
//     "From Google Ads" seller contacts / sign-ups Google attributes to ad clicks (ads-only CAC);
//   • GA4 for the active country's website (hostName): visitors, channels, pages, events;
//   • Search Console for the active country: clicks, impressions, top searches / pages;
//   • our own database (active country): sign-ups, owner listings, buyer contacts —
//     so spend can be put next to what it bought.
// Each source fails on its own (an error message instead of numbers), never the page.
// Cached 10 minutes per country + period.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { BUYER_ORIGIN } from '@/lib/buyerSite';
import { HIDE_DELETED_USERS } from '@/lib/userInsights';
import { internalEmails } from '@/lib/internalAudience';
import { isInternalEmail } from '@/lib/internalTraffic';
import { googleSetup, ga4Report, gscQuery, GSC_SITE } from '@/lib/googleApi';
import { rangeFor, ga4Section, gscSection, outcomes } from '@/lib/marketingReport';
import { adsAll } from '@/lib/marketingFetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL = 10 * 60 * 1000;
// The one Google Ads account advertises Paraguay only — other countries get no ads numbers
// (the page shows "no Google Ads for this country") instead of Paraguay's spend.
const ADS_COUNTRIES = ['py'];
const cache = new Map();
const settle = async (fn) => { try { return { ok: true, data: await fn() } } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 300) }; } };

async function ga4All(range, host) {
  const base = {
    dateRanges: [{ startDate: range.start, endDate: range.end }],
    dimensionFilter: { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: host } } },
  };
  const [totals, channels, daily, pages, events] = await Promise.all([
    ga4Report({ ...base, metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' }] }),
    ga4Report({ ...base, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], limit: 12 }),
    ga4Report({ ...base, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }], limit: 400 }),
    ga4Report({ ...base, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 10 }),
    ga4Report({ ...base, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 20 }),
  ]);
  return ga4Section({ totals, channels, daily, pages, events }, range);
}

async function gscAll(range, site) {
  const body = { startDate: range.start, endDate: range.end };
  const [totals, queries, pages] = await Promise.all([
    gscQuery(site, body),
    gscQuery(site, { ...body, dimensions: ['query'], rowLimit: 15 }),
    gscQuery(site, { ...body, dimensions: ['page'], rowLimit: 10 }),
  ]);
  return { site, ...gscSection({ totals, queries, pages }) };
}

async function ownAll(cc, range) {
  const db = dbFor(cc);
  const span = `created_at=gte.${encodeURIComponent(range.startIso)}&created_at=lte.${encodeURIComponent(range.endIso)}`;
  const count = async (table, extra) => (await db.selectWithCount(table, `select=id&${span}${extra ? `&${extra}` : ''}&limit=1`).catch(() => ({ count: 0 }))).count || 0;
  // Sign-ups in the period (team accounts left out): all, and VERIFIED — CAC counts verified only.
  const [users, extra, listings, contacts] = await Promise.all([
    db.select('users', `select=email,verified&${span}&${HIDE_DELETED_USERS}&limit=10000`).catch(() => []),
    internalEmails(cc).catch(() => null),
    count('properties', 'origin=eq.user'),
    count('contact_link_clicks'),
  ]);
  const real = users.filter((u) => !isInternalEmail(u.email, extra));
  return { signups: real.length, verifiedSignups: real.filter((u) => u.verified).length, listings, contacts };
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const range = rangeFor(new URL(req.url).searchParams.get('days'));
  const setup = googleSetup();
  const key = `${cc}|${range.days}|${range.end}|${new URL(req.url).searchParams.get('parts') || 'all'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL && !new URL(req.url).searchParams.get('fresh')) return NextResponse.json(hit.body);

  const host = (BUYER_ORIGIN[cc] || '').replace(/^https?:\/\//, '');
  const site = GSC_SITE[cc] || `sc-domain:${host}`;
  const connected = setup.refreshToken && setup.clientId && setup.clientSecret;
  const notConnected = { ok: false, error: 'Google is not connected yet.' };
  // ?parts=ads (the Marketing dashboard) skips GA4 / Search Console / our DB counts.
  const parts = String(new URL(req.url).searchParams.get('parts') || 'all');
  const want = (k) => parts === 'all' || parts.split(',').includes(k);
  const skipped = { ok: false, error: 'not requested' };
  const [ads, ga4, gsc, own] = await Promise.all([
    !want('ads') ? skipped : !ADS_COUNTRIES.includes(cc) ? { ok: false, noAds: true, error: 'No Google Ads for this country.' } : connected && setup.developerToken && setup.customerId ? settle(() => adsAll(range)) : notConnected,
    !want('ga4') ? skipped : connected && setup.ga4PropertyId ? settle(() => ga4All(range, host)) : notConnected,
    !want('gsc') ? skipped : connected ? settle(() => gscAll(range, site)) : notConnected,
    !want('own') ? skipped : settle(() => ownAll(cc, range)),
  ]);
  const body = {
    country: cc, range, host, generatedAt: new Date().toISOString(),
    ads, ga4, gsc,
    own: own.ok ? { ok: true, data: outcomes(own.data, ads.ok ? ads.data.total : null) } : own,
  };
  cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body);
}
