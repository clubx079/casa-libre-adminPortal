// Downloads the install reports of both stores (read-only). Parsing: lib/appInstalls.js.
//
// Google Play — the Play Console "bulk reports" bucket, read with a Google service
// account that is invited in Play Console → Users and permissions with "View app
// information and download bulk reports". Env:
//   GOOGLE_PLAY_SA_JSON   the service account key JSON (raw, or base64 of it)
//   GOOGLE_PLAY_BUCKET    e.g. pubsite_prod_4735516444389677935
//   GOOGLE_PLAY_PACKAGE   py.casalibre.mobile (default)
//
// App Store — App Store Connect API (Analytics Reports; works for free apps). Env:
//   APPSTORE_ISSUER_ID, APPSTORE_KEY_ID, APPSTORE_P8 (the .p8 file base64-encoded, or its PEM text),
//   APPSTORE_APP_ID (6822493219). The ONGOING report request was created 2026-10-16
//   (1fd08719-…); its reports: "App Downloads Standard" (r3-…) and "App Store Installation and Deletion Standard" (r6-…).
import 'server-only';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { parseDelimited, decodePlayCsv, playDaily, appleFromInstances } from './appInstalls';

const env = (k) => String(process.env[k] || '').trim();
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function storeSetup() {
  return {
    play: !!(env('GOOGLE_PLAY_SA_JSON') && env('GOOGLE_PLAY_BUCKET')),
    apple: !!(env('APPSTORE_ISSUER_ID') && env('APPSTORE_KEY_ID') && env('APPSTORE_P8')),
  };
}

// ---------- Google Play ----------
function serviceAccount() {
  const raw = env('GOOGLE_PLAY_SA_JSON');
  try { return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); } catch { return null; }
}

async function googleToken() {
  const sa = serviceAccount();
  if (!sa?.client_email || !sa?.private_key) throw new Error('GOOGLE_PLAY_SA_JSON is not a valid service account key');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/devstorage.read_only', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const jwt = `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), sa.private_key).toString('base64url')}`;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }), cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`Google token: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}

// The monthly overview files covering the last `months` months.
export async function fetchPlayDaily({ months = 2, now = new Date() } = {}) {
  const token = await googleToken();
  const bucket = env('GOOGLE_PLAY_BUCKET');
  const pkg = env('GOOGLE_PLAY_PACKAGE') || 'py.casalibre.mobile';
  const out = {};
  for (let m = months - 1; m >= 0; m--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const name = `stats/installs/installs_${pkg}_${ym}_overview.csv`;
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (r.status === 404) continue;                       // no report for that month yet
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(r.status === 403 ? 'No access to the Play reports bucket — invite the service account in Play Console (View app information and download bulk reports).' : `Google Play reports: ${r.status} ${t.slice(0, 120)}`);
    }
    Object.assign(out, playDaily(parseDelimited(decodePlayCsv(Buffer.from(await r.arrayBuffer())), ',')));
  }
  return out;
}

// ---------- App Store ----------
function appleJwt() {
  // The .p8 file base64-encoded (one line — safest in env), or its PEM text.
  const raw = env('APPSTORE_P8');
  const key = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'ES256', kid: env('APPSTORE_KEY_ID'), typ: 'JWT' })}.${b64url({ iss: env('APPSTORE_ISSUER_ID'), iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`;
  return `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

// Apple's API is flaky (random 401s, 5xx or a hanging request, especially with a new
// key), so each call is tried up to 3 times; only a steady error is reported.
async function asc(path, jwt) {
  const url = path.startsWith('http') ? path : `https://api.appstoreconnect.apple.com${path}`;
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 800 * attempt));
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      last = new Error(`App Store Connect: ${j.errors?.[0]?.detail || r.status}`); last.status = r.status;
      if (!(r.status === 401 || r.status === 429 || r.status >= 500)) break;   // a real error: don't retry
    } catch (e) { last = e; }                                                   // timeout / network
  }
  throw last;
}

// `fn` over `items`, at most `n` at a time (Apple: one call per instance + one per file).
async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// One report's DAILY instances processed in the last `days` (+3: they run 1–2 days behind)
// → [{ processingDate, rows }]. Null when the request has no such report; [] when Apple has
// produced nothing yet (a brand-new report answers the instances call with a 5xx / 404).
async function reportInstances(reqId, jwt, category, nameRe, days) {
  const reports = await asc(`/v1/analyticsReportRequests/${reqId}/reports?filter[category]=${category}&limit=200`, jwt);
  const named = (reports.data || []).filter((x) => nameRe.test(x.attributes?.name || ''));
  const rep = named.find((x) => !/detailed/i.test(x.attributes?.name || '')) || named[0];
  if (!rep) return null;
  const list = [];
  try {
    let page = `/v1/analyticsReports/${rep.id}/instances?filter[granularity]=DAILY&limit=200`;
    for (let k = 0; page && k < 5; k++) { const j = await asc(page, jwt); list.push(...(j.data || [])); page = j.links?.next || null; }
  } catch (e) { if (e.status >= 500 || e.status === 404) return []; throw e; }
  const since = new Date(Date.now() - (days + 3) * 86400000).toISOString().slice(0, 10);
  const recent = list.filter((i) => String(i.attributes?.processingDate || '') >= since);
  return mapPool(recent, 4, async (i) => {
    const segs = await asc(`/v1/analyticsReportInstances/${i.id}/segments`, jwt);
    const rows = [];
    for (const s of segs.data || []) {
      const url = s.attributes?.url;
      if (!url) continue;
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      let txt; try { txt = zlib.gunzipSync(buf).toString('utf8'); } catch { txt = buf.toString('utf8'); }
      rows.push(...parseDelimited(txt, '\t'));
    }
    return { processingDate: String(i.attributes?.processingDate || ''), rows };
  });
}

// Daily iPhone downloads (+ deletions when Apple has them), see lib/appInstalls.js:
//  • downloads ← "App Downloads Standard" (Commerce): every user, first-time + redownloads
//  • deletions ← "App Store Installation and Deletion Standard" (App usage): only users who
//    share analytics with developers — it had no data at all for weeks after launch, which
//    is why reading installs from it showed 0 iPhone installs.
// Before Apple has produced any report (new app, first 1–2 days) this returns {}.
export async function fetchAppleDaily({ days = 30 } = {}) {
  const jwt = appleJwt();
  const appId = env('APPSTORE_APP_ID') || '6822493219';
  const reqs = await asc(`/v1/apps/${appId}/analyticsReportRequests?filter[accessType]=ONGOING`, jwt);
  const req = (reqs.data || []).find((x) => !x.attributes?.stoppedDueToInactivity) || reqs.data?.[0];
  if (!req) return {};
  const [downloads, usage] = await Promise.all([
    reportInstances(req.id, jwt, 'COMMERCE', /^app downloads/i, days),
    // deletions are a bonus: their report failing must not hide the downloads
    reportInstances(req.id, jwt, 'APP_USAGE', /installation and deletion/i, days).catch(() => null),
  ]);
  return appleFromInstances({ downloads: downloads || [], usage: usage || [] });
}
