// Google connection for the Marketing page: Google Ads + Search Console + GA4, read-only.
// Hamza's setup: one OAuth client (its developer token is tied to that Google Cloud
// project), signed in ONCE as omar@airosofts.com → a refresh token. The admin's
// "Connect Google" button (/api/google/oauth/start → /callback) gets it and shows it once;
// it is then stored as the env var GOOGLE_ADS_REFRESH_TOKEN (never in a database).
// Env:
//   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN,
//   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID (manager 9262829495),
//   GOOGLE_ADS_CUSTOMER_ID (ad account 8746550784), GA4_PROPERTY_ID (556681900),
//   GOOGLE_ADS_API_VERSION (optional, default v22 — Google retires old versions, v21 already 404s), GOOGLE_OAUTH_SCOPES (optional, space-separated).
import 'server-only';
import crypto from 'crypto';

export const SCOPES = (process.env.GOOGLE_OAUTH_SCOPES || [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
].join(' ')).split(/\s+/).filter(Boolean);

// Search Console domain property per country (all verified, Oct 2026).
export const GSC_SITE = {
  py: 'sc-domain:casa-libre.com.py',
  bo: 'sc-domain:casa-libre.com.bo',
  uy: 'sc-domain:uy.casa-libre.com',
  ve: 'sc-domain:casa-libre.com.ve',
  sv: 'sc-domain:casa-libre.com.sv',   // not verified in Search Console until the domain is live
};

const env = (k) => String(process.env[k] || '').trim();
const digits = (v) => String(v || '').replace(/\D/g, '');

// Which settings are present (names only — never the values).
export function googleSetup() {
  const has = (k) => !!env(k);
  return {
    clientId: has('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: has('GOOGLE_ADS_CLIENT_SECRET'),
    developerToken: has('GOOGLE_ADS_DEVELOPER_TOKEN'),
    refreshToken: has('GOOGLE_ADS_REFRESH_TOKEN'),
    loginCustomerId: has('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
    customerId: has('GOOGLE_ADS_CUSTOMER_ID'),
    ga4PropertyId: has('GA4_PROPERTY_ID'),
  };
}

// The exact redirect URL Google must have on the OAuth client, for the host the admin is
// served from (https://admin.casa-libre.com/… live, http://localhost:3110/… locally).
export function redirectUri(req) {
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'admin.casa-libre.com';
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = local ? 'http' : (h.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  return `${proto}://${host}/api/google/oauth/callback`;
}

// CSRF state: random nonce + HMAC, kept in a short-lived cookie and checked on return.
const SECRET = () => process.env.SESSION_SECRET || 'insecure-dev-secret';
export function makeState() {
  const nonce = crypto.randomBytes(16).toString('hex');
  return `${nonce}.${crypto.createHmac('sha256', SECRET()).update(nonce).digest('hex').slice(0, 32)}`;
}
export function checkState(state, cookieVal) {
  if (!state || !cookieVal || state !== cookieVal) return false;
  const [nonce, sig] = String(state).split('.');
  return !!nonce && sig === crypto.createHmac('sha256', SECRET()).update(nonce).digest('hex').slice(0, 32);
}

export function authUrl(req, state) {
  const p = new URLSearchParams({
    client_id: env('GOOGLE_ADS_CLIENT_ID'),
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',            // always return a refresh token
    include_granted_scopes: 'true',
    login_hint: 'omar@airosofts.com',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenCall(body) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_ADS_CLIENT_ID'), client_secret: env('GOOGLE_ADS_CLIENT_SECRET'), ...body }),
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `token ${r.status}`);
  return j;
}

export const exchangeCode = (req, code) => tokenCall({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(req) });

let cached = null;   // { token, exp }
export async function accessToken() {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const j = await tokenCall({ refresh_token: env('GOOGLE_ADS_REFRESH_TOKEN'), grant_type: 'refresh_token' });
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

const json = async (r, what) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${what}: ${j.error?.message || j[0]?.error?.message || r.status}`);
  return j;
};

// Google Ads query (GAQL) on the ad account, through the manager account.
export async function adsSearch(query) {
  const v = env('GOOGLE_ADS_API_VERSION') || 'v22';
  const r = await fetch(`https://googleads.googleapis.com/${v}/customers/${digits(env('GOOGLE_ADS_CUSTOMER_ID'))}/googleAds:search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'),
      'login-customer-id': digits(env('GOOGLE_ADS_LOGIN_CUSTOMER_ID')),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  return json(r, 'Google Ads');
}

export async function gscQuery(site, body) {
  const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  return json(r, 'Search Console');
}

export async function ga4Report(body) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${digits(env('GA4_PROPERTY_ID'))}:runReport`, {
    method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  return json(r, 'GA4');
}
