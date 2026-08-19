import 'server-only';

// Thin server-only PostgREST wrapper over the shared Casa Libre AiroBase DB.
// Uses the secret key (bypasses RLS) — never import this from a client component.
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

function assertEnv() {
  if (!URL || !KEY) {
    throw new Error('AIROBASE_URL / AIROBASE_SECRET_KEY are not set');
  }
}

// GET /rest/v1/<table>?<query>
export async function select(table, query = '') {
  assertEnv();
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    headers: headers(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`select ${table} ${res.status}: ${await res.text()}`);
  return res.json();
}

// GET with an exact row count (Content-Range header) → { rows, count }
export async function selectWithCount(table, query = '') {
  assertEnv();
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    headers: headers({ Prefer: 'count=exact' }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`select ${table} ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  const range = res.headers.get('content-range') || '';
  const count = Number(range.split('/')[1]) || rows.length;
  return { rows, count };
}

// PATCH /rest/v1/<table>?<filter>
export async function update(table, filter, patch) {
  assertEnv();
  const res = await fetch(`${URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update ${table} ${res.status}: ${await res.text()}`);
  return true;
}
