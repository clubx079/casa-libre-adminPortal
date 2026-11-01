// GET /api/app-installs/accounts?days= → from install to account, every country:
//  • tracked: the app's 'app_opened' pings (website /api/mobile/install → PostHog) — installs
//    that opened the app, of those signed in, accounts created IN the app vs existing accounts
//  • before tracking: people whose phone registered for notifications (push_tokens) — an account
//    created within 30 minutes before its first token ≈ signed up in the app. A minimum: only
//    people who allowed notifications.
// Team / test accounts are left out. Read-only. Cached 10 minutes.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';
import { isInternalEmail, INTERNAL_NAMES } from '@/lib/internalTraffic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COUNTRIES = ['py', 'bo', 'uy', 've', 'sv'];
const NAME = { py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela', sv: 'El Salvador' };
const TTL = 10 * 60 * 1000;
const cache = new Map();
const IN_APP_MS = 30 * 60 * 1000;

// a country with its own DB in env (others would fall back to Paraguay's and count twice)
const hasDb = (cc) => cc === (process.env.DEFAULT_COUNTRY || 'py').toLowerCase() || !!process.env[`AIROBASE_URL_${cc.toUpperCase()}`];

async function beforeTracking(cc) {
  const db = dbFor(cc);
  const toks = await db.select('push_tokens', 'select=user_id,platform,created_at&order=created_at.asc&limit=5000');
  const first = new Map();
  for (const t of toks) if (!first.has(String(t.user_id))) first.set(String(t.user_id), t);
  if (!first.size) return { country: cc, name: NAME[cc], people: 0, createdInApp: 0, existingAccounts: 0, android: 0, ios: 0 };
  const users = await db.select('users', `select=id,email,full_name,created_at&id=in.(${[...first.keys()].join(',')})`);
  let createdInApp = 0, existingAccounts = 0, android = 0, ios = 0;
  for (const u of users) {
    if (isInternalEmail(u.email) || INTERNAL_NAMES.includes(String(u.full_name || '').trim().toLowerCase()) || /@casa-libre\./i.test(String(u.email || ''))) continue;   // our own / the store reviewers' accounts
    const t = first.get(String(u.id));
    if (t.platform === 'ios') ios++; else android++;
    if (Date.parse(t.created_at) - Date.parse(u.created_at) <= IN_APP_MS) createdInApp++; else existingAccounts++;
  }
  return { country: cc, name: NAME[cc], people: createdInApp + existingAccounts, createdInApp, existingAccounts, android, ios };
}

async function tracked(days) {
  if (!posthogConfigured()) return { error: 'PostHog not configured' };
  const t = `timestamp >= now() - INTERVAL ${days} DAY`;
  const rows = await hogql(`SELECT toString(properties.site_country) AS cc, toString(properties.platform) AS platform,
      uniqExact(toString(properties.install_id)) AS opened,
      uniqExactIf(toString(properties.install_id), toString(properties.first_open) = 'true') AS first_opens,
      uniqExactIf(toString(properties.install_id), toString(properties.signed_in) = 'true') AS signed_in,
      uniqExactIf(toString(properties.user_id), toString(properties.account_created_in_app) = 'true') AS new_in_app,
      uniqExactIf(toString(properties.user_id), toString(properties.signed_in) = 'true' AND toString(properties.account_created_in_app) != 'true') AS existing,
      min(timestamp) AS since
    FROM events WHERE event = 'app_opened' AND ${t} AND coalesce(properties.$geoip_country_name, '') != 'Pakistan'
    GROUP BY cc, platform`, { fresh: 60_000, stale: 0 });
  const byCountry = (rows || []).map(([cc, platform, opened, firstOpens, signedIn, newInApp, existing, since]) => ({
    country: cc, name: NAME[cc] || cc, platform, opened: Number(opened) || 0, firstOpens: Number(firstOpens) || 0,
    signedIn: Number(signedIn) || 0, newInApp: Number(newInApp) || 0, existing: Number(existing) || 0, since: String(since || '').replace(' ', 'T'),
  }));
  const sum = (k) => byCountry.reduce((s, r) => s + r[k], 0);
  const since = byCountry.map((r) => r.since).filter(Boolean).sort()[0] || null;
  return { opened: sum('opened'), firstOpens: sum('firstOpens'), signedIn: sum('signedIn'), newInApp: sum('newInApp'), existing: sum('existing'), since, byCountry };
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const days = [7, 30, 90, 180, 365].includes(Number(sp.get('days'))) ? Number(sp.get('days')) : 30;
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < TTL && !sp.get('fresh')) return NextResponse.json(hit.body);
  const [live, history] = await Promise.all([
    tracked(days).catch((e) => ({ error: String(e?.message || e).slice(0, 200) })),
    Promise.all(COUNTRIES.filter(hasDb).map((cc) => beforeTracking(cc).catch(() => null))),
  ]);
  const hist = history.filter(Boolean).filter((r) => r.people);
  const body = {
    days, tracked: live,
    beforeTracking: { people: hist.reduce((s, r) => s + r.people, 0), createdInApp: hist.reduce((s, r) => s + r.createdInApp, 0), existingAccounts: hist.reduce((s, r) => s + r.existingAccounts, 0), byCountry: hist },
  };
  cache.set(days, { at: Date.now(), body });
  return NextResponse.json(body);
}
