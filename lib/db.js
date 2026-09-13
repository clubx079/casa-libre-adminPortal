// Server-side PostgREST client for AiroBase, using the SECRET key (bypasses RLS).
// Thin wrapper over fetch — no SDK dependency. Server-only.
//
// MULTI-COUNTRY: `dbFor(country)` returns a client bound to that country's DB.
// Connection config comes from ENV (secrets never live in the control DB):
//   AIROBASE_URL_<CC>         host for country <CC>        (e.g. AIROBASE_URL_BO)
//   AIROBASE_SECRET_KEY_<CC>  secret key for country <CC>  (e.g. AIROBASE_SECRET_KEY_BO)
// The registry row's `secret_ref` names that key var (see lib/control.js). For the
// default country (py) the legacy AIROBASE_URL / AIROBASE_SECRET_KEY are the fallback,
// so existing callers importing { select, insert, … } keep talking to Paraguay exactly
// as before.
import 'server-only';

const URL = process.env.AIROBASE_URL;
const KEY = process.env.AIROBASE_SECRET_KEY;
const DEFAULT_COUNTRY = (process.env.DEFAULT_COUNTRY || 'py').toLowerCase();

// Build a client (the 6 data functions) bound to a specific url + key.
function makeClient(url, key) {
  function headers(extra = {}) {
    return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
  }
  async function handle(res) {
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(body?.message || `PostgREST ${res.status}`);
      err.status = res.status;
      err.code = body?.code;
      err.details = body?.details;
      throw err;
    }
    return body;
  }

  // GET /rest/v1/<table>?<query>
  async function select(table, query = '') {
    const res = await fetch(`${url}/rest/v1/${table}${query ? '?' + query : ''}`, { headers: headers(), cache: 'no-store' });
    return handle(res);
  }

  // GET with an exact total count (reads the Content-Range header).
  async function selectWithCount(table, query = '') {
    const res = await fetch(`${url}/rest/v1/${table}${query ? '?' + query : ''}`, {
      headers: headers({ Prefer: 'count=exact' }),
      cache: 'no-store',
    });
    const rows = await handle(res);
    const cr = res.headers.get('content-range') || '';
    const count = cr.includes('/') ? Number(cr.split('/')[1]) : rows.length;
    return { rows, count: Number.isFinite(count) ? count : rows.length };
  }

  // DELETE /rest/v1/<table>?<filter>
  async function remove(table, filter) {
    // No JSON body on DELETE — PostgREST rejects Content-Type: application/json
    // when the body is empty. Send only apikey/auth + Prefer.
    const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
    });
    return handle(res);
  }

  // POST insert/upsert. opts: { upsert, onConflict, returning }
  async function insert(table, rows, opts = {}) {
    const prefer = [];
    if (opts.upsert) prefer.push('resolution=merge-duplicates');
    prefer.push(`return=${opts.returning || 'representation'}`);
    const qs = opts.onConflict ? `?on_conflict=${opts.onConflict}` : '';
    const res = await fetch(`${url}/rest/v1/${table}${qs}`, {
      method: 'POST',
      headers: headers({ Prefer: prefer.join(',') }),
      body: JSON.stringify(rows),
    });
    return handle(res);
  }

  // PATCH /rest/v1/<table>?<filter>
  async function update(table, filter, patch, opts = {}) {
    const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: headers({ Prefer: `return=${opts.returning || 'representation'}` }),
      body: JSON.stringify(patch),
    });
    return handle(res);
  }

  // POST /rest/v1/rpc/<fn>
  async function rpc(fn, args = {}) {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(args),
      cache: 'no-store',
    });
    return handle(res);
  }

  return { select, selectWithCount, remove, insert, update, rpc };
}

// Resolve a country's connection from env. Falls back to the legacy AIROBASE_URL/
// AIROBASE_SECRET_KEY (which point at Paraguay) so the default country is unchanged.
function connFor(country) {
  const cc = String(country || DEFAULT_COUNTRY).toLowerCase();
  const UP = cc.toUpperCase();
  const url = process.env[`AIROBASE_URL_${UP}`] || (cc === DEFAULT_COUNTRY ? URL : URL);
  const key = process.env[`AIROBASE_SECRET_KEY_${UP}`] || (cc === DEFAULT_COUNTRY ? KEY : KEY);
  return { url, key, cc };
}

// Per-country client factory (small cache so we don't rebuild per call).
const _clients = new Map();
export function dbFor(country) {
  const { url, key, cc } = connFor(country);
  const k = `${cc}|${url}`;
  let c = _clients.get(k);
  if (!c) { c = makeClient(url, key); _clients.set(k, c); }
  return c;
}

// ---- Back-compat named exports (bound to the default country = Paraguay) ----
// Existing callers `import { select, insert, … } from '@/lib/db'` keep working and
// keep talking to Paraguay, unchanged, during the incremental migration.
const _default = makeClient(URL, KEY);
export const select = _default.select;
export const selectWithCount = _default.selectWithCount;
export const remove = _default.remove;
export const insert = _default.insert;
export const update = _default.update;
export const rpc = _default.rpc;
