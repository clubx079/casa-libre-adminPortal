// Server-side PostgREST client for AiroBase, using the SECRET key (bypasses RLS).
// Thin wrapper over fetch — no SDK dependency. Server-only.
import 'server-only';

const URL = process.env.AIROBASE_URL;
const KEY = process.env.AIROBASE_SECRET_KEY;

function headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
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
export async function select(table, query = '') {
  const res = await fetch(`${URL}/rest/v1/${table}${query ? '?' + query : ''}`, {
    headers: headers(),
    cache: 'no-store',
  });
  return handle(res);
}

// GET with an exact total count (reads the Content-Range header).
export async function selectWithCount(table, query = '') {
  const res = await fetch(`${URL}/rest/v1/${table}${query ? '?' + query : ''}`, {
    headers: headers({ Prefer: 'count=exact' }),
    cache: 'no-store',
  });
  const rows = await handle(res);
  const cr = res.headers.get('content-range') || '';
  const count = cr.includes('/') ? Number(cr.split('/')[1]) : rows.length;
  return { rows, count: Number.isFinite(count) ? count : rows.length };
}

// DELETE /rest/v1/<table>?<filter>
export async function remove(table, filter) {
  // No JSON body on DELETE — PostgREST rejects Content-Type: application/json
  // when the body is empty. Send only apikey/auth + Prefer.
  const res = await fetch(`${URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: 'return=minimal',
    },
  });
  return handle(res);
}

// POST insert/upsert. opts: { upsert: true, onConflict: 'a,b', returning: 'representation'|'minimal' }
export async function insert(table, rows, opts = {}) {
  const prefer = [];
  if (opts.upsert) prefer.push('resolution=merge-duplicates');
  prefer.push(`return=${opts.returning || 'representation'}`);
  const qs = opts.onConflict ? `?on_conflict=${opts.onConflict}` : '';
  const res = await fetch(`${URL}/rest/v1/${table}${qs}`, {
    method: 'POST',
    headers: headers({ Prefer: prefer.join(',') }),
    body: JSON.stringify(rows),
  });
  return handle(res);
}

// PATCH /rest/v1/<table>?<filter>
export async function update(table, filter, patch, opts = {}) {
  const res = await fetch(`${URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: headers({ Prefer: `return=${opts.returning || 'representation'}` }),
    body: JSON.stringify(patch),
  });
  return handle(res);
}

// POST /rest/v1/rpc/<fn>
export async function rpc(fn, args = {}) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  return handle(res);
}
