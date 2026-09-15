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
import crypto from 'crypto';

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
async function ctrlPatch(table, filter, patch, { returning = 'minimal' } = {}) {
  const res = await fetch(`${CTRL_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: ctrlHeaders({ Prefer: `return=${returning}` }), body: JSON.stringify(patch),
  });
  return ctrlHandle(res);
}
async function ctrlInsert(table, row, { returning = 'representation' } = {}) {
  const res = await fetch(`${CTRL_URL}/rest/v1/${table}`, {
    method: 'POST', headers: ctrlHeaders({ Prefer: `return=${returning}` }), body: JSON.stringify(row),
  });
  return ctrlHandle(res);
}
async function ctrlDelete(table, filter) {
  const res = await fetch(`${CTRL_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE', headers: { apikey: CTRL_KEY, Authorization: `Bearer ${CTRL_KEY}`, Prefer: 'return=minimal' },
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

// ---- Team / role management ------------------------------------------------
// All of the below live in the CONTROL DB `admin_users` table. They power the
// Super-Admin "Team" screen plus the invite / forgot-password / change-password
// flows. Passwords are ALWAYS stored as bcrypt hashes (never plaintext).

const ID = (v) => encodeURIComponent(String(v));
export function newToken() { return crypto.randomBytes(32).toString('hex'); }
const isExpired = (iso) => !iso || new Date(iso).getTime() < Date.now();

// Safe columns for the Team table (never exposes password_hash / raw tokens).
const SAFE_COLS = 'id,email,name,role,allowed_countries,is_active,created_at,last_login_at,invite_expires_at';

// All team members, oldest first. A row with is_active=false is a pending invite.
export async function listAdmins() {
  if (!isControlConfigured()) return [];
  const rows = await ctrlSelect('admin_users', `select=${SAFE_COLS}&order=created_at.asc`);
  return Array.isArray(rows) ? rows : [];
}

// Full row (incl. password_hash) by id — used for change-password verification.
export async function getAdminById(id) {
  if (!isControlConfigured() || !id) return null;
  const rows = await ctrlSelect('admin_users', `id=eq.${ID(id)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Look up a row by a one-time token field ('invite_token' | 'reset_token').
// Returns the row only if the token matches AND has not expired.
export async function getAdminByToken(field, token) {
  if (!isControlConfigured() || !token) return null;
  if (field !== 'invite_token' && field !== 'reset_token') return null;
  const expiryCol = field === 'invite_token' ? 'invite_expires_at' : 'reset_expires_at';
  const rows = await ctrlSelect('admin_users', `${field}=eq.${ID(token)}&limit=1`);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) return null;
  if (isExpired(row[expiryCol])) return null;
  return row;
}

// Create an invited-but-not-yet-accepted admin (password_hash=null, is_active=false).
// allowed_countries: null for a superadmin, a JS array of codes for an admin.
export async function createInvitedAdmin({ email, name, role, allowed_countries, invite_token, invite_expires_at }) {
  const row = {
    email: String(email).trim().toLowerCase(),
    name: name || null,
    role: role === 'superadmin' ? 'superadmin' : 'admin',
    allowed_countries: role === 'superadmin' ? null : (Array.isArray(allowed_countries) ? allowed_countries : []),
    password_hash: null,
    is_active: false,
    invite_token,
    invite_expires_at,
  };
  const [created] = await ctrlInsert('admin_users', row);
  return created;
}

// Accept an invite: set the password, activate, and clear the invite token.
// Returns the activated row (for auto-login) or null if the token is bad/expired.
export async function acceptInvite(token, passwordHash) {
  const row = await getAdminByToken('invite_token', token);
  if (!row) return null;
  const [updated] = await ctrlPatch(
    'admin_users',
    `id=eq.${ID(row.id)}`,
    { password_hash: passwordHash, is_active: true, invite_token: null, invite_expires_at: null },
    { returning: 'representation' },
  );
  return updated || null;
}

// Update a member's role + country access (superadmin => allowed_countries null).
export async function updateAdminAccess(id, { role, allowed_countries }) {
  const patch = {
    role: role === 'superadmin' ? 'superadmin' : 'admin',
    allowed_countries: role === 'superadmin' ? null : (Array.isArray(allowed_countries) ? allowed_countries : []),
  };
  const [updated] = await ctrlPatch('admin_users', `id=eq.${ID(id)}`, patch, { returning: 'representation' });
  return updated || null;
}

export async function deleteAdmin(id) {
  await ctrlDelete('admin_users', `id=eq.${ID(id)}`);
  return { ok: true };
}

// Issue a password-reset token for an ACTIVE admin. Returns { token, name, email }
// or null if no active admin has that email (caller must not reveal which).
export async function setResetToken(email) {
  const admin = await getAdminByEmail(email); // already filters is_active=eq.true
  if (!admin) return null;
  const token = newToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  await ctrlPatch('admin_users', `id=eq.${ID(admin.id)}`, { reset_token: token, reset_expires_at: expires });
  return { token, name: admin.name, email: admin.email };
}

// Consume a reset token: set the new password hash, clear the token.
export async function resetPassword(token, passwordHash) {
  const row = await getAdminByToken('reset_token', token);
  if (!row) return null;
  const [updated] = await ctrlPatch(
    'admin_users',
    `id=eq.${ID(row.id)}`,
    { password_hash: passwordHash, reset_token: null, reset_expires_at: null },
    { returning: 'representation' },
  );
  return updated || null;
}

export async function changePassword(id, newHash) {
  const [updated] = await ctrlPatch(
    'admin_users', `id=eq.${ID(id)}`, { password_hash: newHash }, { returning: 'representation' },
  );
  return updated || null;
}

// How many active superadmins exist — used to guard the "keep >=1 superadmin" rule.
export async function countActiveSuperadmins() {
  if (!isControlConfigured()) return 0;
  const rows = await ctrlSelect('admin_users', 'select=id&role=eq.superadmin&is_active=eq.true');
  return Array.isArray(rows) ? rows.length : 0;
}
