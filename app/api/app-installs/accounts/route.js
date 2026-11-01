// GET /api/app-installs/accounts?days= → from install to account, every country, for the period.
// Two sources, joined per person (country + account), so nobody counts twice:
//  • the app's 'app_opened' pings (website /api/mobile/install → PostHog): installs that opened
//    the app, of those signed in, account created IN the app (created after the install) or not
//  • phones registered for notifications (push_tokens) — how we knew before the pings: an account
//    created at most 30 minutes before its phone's first token ≈ signed up in the app
// accounts = the joined number (Admin → Analytics "App downloads" and App installs show it).
// Team / test / store-review accounts are left out. Read-only. Cached 10 minutes.
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
const UUID = /^[0-9a-f-]{36}$/i;

// a country with its own DB in env (others would fall back to Paraguay's and count twice)
const hasDb = (cc) => cc === (process.env.DEFAULT_COUNTRY || 'py').toLowerCase() || !!process.env[`AIROBASE_URL_${cc.toUpperCase()}`];
const isTeam = (u) => isInternalEmail(u.email) || INTERNAL_NAMES.includes(String(u.full_name || '').trim().toLowerCase()) || /@casa-libre\./i.test(String(u.email || ''));   // our own / the store reviewers'

// The app's pings in the period: totals + every signed-in account with its flag.
async function pings(days) {
  if (!posthogConfigured()) return { error: 'PostHog not configured', people: [] };
  const where = `event = 'app_opened' AND timestamp >= now() - INTERVAL ${days} DAY AND coalesce(properties.$geoip_country_name, '') != 'Pakistan'`;
  const [totals, people] = await Promise.all([
    hogql(`SELECT uniqExact(toString(properties.install_id)), uniqExactIf(toString(properties.install_id), toString(properties.first_open) = 'true'),
        uniqExactIf(toString(properties.install_id), toString(properties.signed_in) = 'true'), min(timestamp)
      FROM events WHERE ${where}`, { fresh: 60_000, stale: 0 }),
    hogql(`SELECT toString(properties.site_country) AS cc, toString(properties.user_id) AS uid, any(toString(properties.platform)) AS platform,
        max(toString(properties.account_created_in_app) = 'true') AS in_app
      FROM events WHERE ${where} AND toString(properties.signed_in) = 'true' GROUP BY cc, uid`, { fresh: 60_000, stale: 0 }),
  ]);
  const [opened, firstOpens, signedIn, since] = totals?.[0] || [];
  return {
    opened: Number(opened) || 0, firstOpens: Number(firstOpens) || 0, signedInInstalls: Number(signedIn) || 0,
    since: opened ? String(since || '').replace(' ', 'T') : null,
    people: (people || []).filter((r) => COUNTRIES.includes(r[0]) && UUID.test(r[1])).map(([cc, uid, platform, inApp]) => ({ cc, uid, platform, inApp: !!Number(inApp) })),
  };
}

// One country: phones registered for notifications in the period + the accounts behind both sources.
async function country(cc, sinceIso, pingPeople) {
  const db = dbFor(cc);
  const toks = await db.select('push_tokens', `select=user_id,platform,created_at&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.asc&limit=5000`).catch(() => []);
  // the first token of each person ever (an older phone means they were already an app user)
  const firstEver = new Map();
  const ids = [...new Set([...toks.map((t) => String(t.user_id)), ...pingPeople.map((p) => p.uid)])].filter((x) => UUID.test(x));
  if (!ids.length) return [];
  const all = await db.select('push_tokens', `select=user_id,platform,created_at&user_id=in.(${ids.join(',')})&order=created_at.asc&limit=5000`).catch(() => []);
  for (const t of all) if (!firstEver.has(String(t.user_id))) firstEver.set(String(t.user_id), t);
  const users = await db.select('users', `select=id,email,full_name,created_at&id=in.(${ids.join(',')})`).catch(() => []);
  const out = [];
  for (const u of users) {
    if (isTeam(u)) continue;
    const id = String(u.id);
    const ping = pingPeople.find((p) => p.uid === id);
    const tok = firstEver.get(id);
    const viaToken = tok ? Date.parse(tok.created_at) - Date.parse(u.created_at) <= IN_APP_MS : false;
    out.push({ cc, id, platform: ping?.platform || tok?.platform || 'android', createdInApp: !!ping?.inApp || viaToken, source: ping && tok ? 'both' : ping ? 'app' : 'notifications' });
  }
  return out;
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const days = [7, 30, 90, 180, 365].includes(Number(sp.get('days'))) ? Number(sp.get('days')) : 30;
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < TTL && !sp.get('fresh')) return NextResponse.json(hit.body);
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
  const live = await pings(days).catch((e) => ({ error: String(e?.message || e).slice(0, 200), people: [] }));
  const people = (await Promise.all(COUNTRIES.filter(hasDb).map((cc) => country(cc, sinceIso, live.people.filter((p) => p.cc === cc)).catch(() => [])))).flat();
  const byCountry = COUNTRIES.map((cc) => {
    const mine = people.filter((p) => p.cc === cc);
    return { country: cc, name: NAME[cc], accounts: mine.length, createdInApp: mine.filter((p) => p.createdInApp).length, existing: mine.filter((p) => !p.createdInApp).length };
  }).filter((r) => r.accounts);
  const body = {
    days,
    // the joined number: people who signed in to the app in the period
    accounts: { total: people.length, createdInApp: people.filter((p) => p.createdInApp).length, existing: people.filter((p) => !p.createdInApp).length, byCountry,
      fromPings: people.filter((p) => p.source !== 'notifications').length, fromNotificationsOnly: people.filter((p) => p.source === 'notifications').length,
      byPlatform: Object.fromEntries(['android', 'ios'].map((pl) => { const m = people.filter((p) => (p.platform === 'ios' ? 'ios' : 'android') === pl); return [pl, { total: m.length, createdInApp: m.filter((p) => p.createdInApp).length }]; })) },
    // the pings on their own (installs that opened the app, signed in or not)
    pings: live.error ? { error: live.error } : { opened: live.opened, firstOpens: live.firstOpens, signedIn: live.signedInInstalls, since: live.since },
  };
  cache.set(days, { at: Date.now(), body });
  return NextResponse.json(body);
}
