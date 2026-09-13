// Control-plane client for the shared admin: reads the CONTROL DB (admin team
// logins + the per-country registry). This DB holds NO marketplace data.
// Server-only. Uses the control DB's SECRET key (bypasses RLS).
//
// Env:
//   CONTROL_DB_URL  — control DB host (e.g. https://d50673….db.airosofts.com)
//   CONTROL_DB_KEY  — control DB secret key
// Per-country secret keys are resolved separately (see lib/db.js dbFor), by the
// `secret_ref` env-var NAME stored in each registry row — never the key itself.
import 'server-only';

const CTRL_URL = process.env.CONTROL_DB_URL;
const CTRL_KEY = process.env.CONTROL_DB_KEY;

function ctrlHeaders(extra = {}) {
  return { apikey: CTRL_KEY, Authorization: `Bearer ${CTRL_KEY}`, 'Content-Type': 'application/json', ...extra };
}
async function ctrlHandle(res) {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(body?.message || `Control PostgREST ${res.status}`);
    err.status = res.status; err.code = body?.code; err.details = body?.details;
    throw err;
  }
  return body;
}
async function ctrlSelect(table, query = '') {
  const res = await fetch(`${CTRL_URL}/rest/v1/${table}${query ? '?' + query : ''}`, { headers: ctrlHeaders(), cache: 'no-store' });
  return ctrlHandle(res);
}
async function ctrlPatch(table, filter, patch) {
  const res = await fetch(`${CTRL_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: ctrlHeaders({ Prefer: 'return=minimal' }), body: JSON.stringify(patch),
  });
  return ctrlHandle(res);
}

export function isControlConfigured() {
  return !!(CTRL_URL && CTRL_KEY);
}

// ---- Countries registry ----------------------------------------------------
// Cached in-memory for a short TTL — the registry changes rarely (a new country
// is a row insert), and every request would otherwise hit the control DB.
let _countriesCache = null; // { at, rows }
const COUNTRIES_TTL = 60 * 1000;

// Interim fallback: a COUNTRIES_JSON env can stand in before the control DB is
// wired (plan Phase 2.1). Shape = same columns as the `countries` table.
function fromEnvJson() {
  try {
    const raw = process.env.COUNTRIES_JSON;
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}

export async function listCountries({ force = false } = {}) {
  if (!force && _countriesCache && Date.now() - _countriesCache.at < COUNTRIES_TTL) return _countriesCache.rows;
  let rows = null;
  if (isControlConfigured()) {
    try {
      rows = await ctrlSelect('countries', 'active=eq.true&order=sort_order.asc,code.asc');
    } catch (e) {
      // fall through to env fallback so the admin never hard-fails on a control-DB blip
      rows = null;
    }
  }
  if (!rows) rows = fromEnvJson() || [];
  _countriesCache = { at: Date.now(), rows };
  return rows;
}

// One registry row by code (null if unknown/inactive).
export async function countryConfig(code) {
  const rows = await listCountries();
  return rows.find((c) => c.code === code) || null;
}

// Default active country when none is selected (keeps PY behaving as today).
export const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'py';

// ---- Admin users (team logins) --------------------------------------------
// Look up an admin by email (case-insensitive). Returns the row or null.
export async function getAdminByEmail(email) {
  if (!isControlConfigured() || !email) return null;
  const e = String(email).trim().toLowerCase();
  try {
    const rows = await ctrlSelect('admin_users', `email=eq.${encodeURIComponent(e)}&is_active=eq.true&limit=1`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch { return null; }
}

export async function touchAdminLogin(id) {
  if (!isControlConfigured() || !id) return;
  try { await ctrlPatch('admin_users', `id=eq.${encodeURIComponent(id)}`, { last_login_at: new Date().toISOString() }); } catch {}
}
