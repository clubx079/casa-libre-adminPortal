// LOCAL DEVELOPMENT ONLY: a stand-in for the CONTROL DB (admin team logins + the countries
// registry), so Team → roles / page access can be tried end to end without touching the live
// control DB. It answers the small part of the PostgREST API that lib/control.js uses:
//   GET    /rest/v1/<table>?select=a,b&col=eq.v&order=c.asc&limit=n
//   POST   /rest/v1/<table>            (Prefer: return=representation | minimal)
//   PATCH  /rest/v1/<table>?col=eq.v
//   DELETE /rest/v1/<table>?col=eq.v
// Data lives in .dev-control-db.json next to package.json (gitignored).
//
//   node scripts/dev-control-db.mjs                 → http://localhost:54390
//   node scripts/dev-control-db.mjs --no-page-access  behaves like a control DB that hasn't run
//                                                      migrations/control/001_admin_page_access.sql
// Point the admin at it in .env.local: CONTROL_DB_URL=http://localhost:54390  CONTROL_DB_KEY=local-dev
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, '.dev-control-db.json');
const PORT = Number(process.env.DEV_CONTROL_PORT || 54390);
const NO_PAGE_ACCESS = process.argv.includes('--no-page-access');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}
function save(db) { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }

const db = load() || { admin_users: [], countries: [] };
if (!db.countries.length) {
  db.countries = [
    ['py', 'Paraguay', 'casa-libre.com.py', 'PYG', '+595', 1],
    ['bo', 'Bolivia', 'casa-libre.com.bo', 'BOB', '+591', 2],
    ['uy', 'Uruguay', 'uy.casa-libre.com', 'UYU', '+598', 3],
    ['ve', 'Venezuela', 'casa-libre.com.ve', 'USD', '+58', 4],
    ['sv', 'El Salvador', 'casa-libre.com.sv', 'USD', '+503', 5],
  ].map(([code, label, domain, currency, phone_prefix, sort_order]) => ({
    code, label, domain, currency, phone_prefix, sort_order, active: true, is_live: false, secret_ref: `AIROBASE_SECRET_KEY_${code.toUpperCase()}`,
  }));
  save(db);
}

const cast = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v);
function parse(qs) {
  const p = new URLSearchParams(qs);
  const filters = [];
  let select = null, order = [], limit = Infinity;
  for (const [k, v] of p) {
    if (k === 'select') select = v.split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === 'order') order = v.split(',').map((o) => { const [col, dir] = o.split('.'); return { col, desc: dir === 'desc' }; });
    else if (k === 'limit') limit = Number(v);
    else { const i = v.indexOf('.'); filters.push({ col: k, op: v.slice(0, i), val: cast(decodeURIComponent(v.slice(i + 1))) }); }
  }
  return { filters, select, order, limit };
}
const match = (row, filters) => filters.every(({ col, op, val }) => {
  if (op === 'eq') return (row[col] ?? null) === val || String(row[col]) === String(val);
  if (op === 'is') return (row[col] ?? null) === val;
  return true;
});
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const missingCol = (res, table) => send(res, 400, { code: 'PGRST204', message: `Could not find the 'page_access' column of '${table}' in the schema cache`, details: null, hint: null });

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m || !db[m[1]]) return send(res, 404, { code: 'PGRST205', message: `relation "${m?.[1]}" does not exist` });
    const table = m[1];
    const rows = db[table];
    const q = parse(url.search.slice(1));
    const prefer = String(req.headers.prefer || '');
    const strip = (r) => { if (!NO_PAGE_ACCESS || table !== 'admin_users') return r; const { page_access, ...rest } = r; return rest; };
    try {
      if (req.method === 'GET') {
        if (NO_PAGE_ACCESS && table === 'admin_users' && q.select?.includes('page_access')) return send(res, 400, { code: '42703', message: 'column admin_users.page_access does not exist' });
        let out = rows.filter((r) => match(r, q.filters)).map(strip);
        for (const { col, desc } of [...q.order].reverse()) out.sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (desc ? -1 : 1));
        out = out.slice(0, q.limit);
        if (q.select && !q.select.includes('*')) out = out.map((r) => Object.fromEntries(q.select.map((c) => [c, r[c] ?? null])));
        return send(res, 200, out);
      }
      const payload = body ? JSON.parse(body) : {};
      if (req.method === 'POST') {
        const list = Array.isArray(payload) ? payload : [payload];
        if (NO_PAGE_ACCESS && list.some((r) => 'page_access' in r)) return missingCol(res, table);
        const made = [];
        for (const r of list) {
          if (table === 'admin_users' && rows.some((x) => x.email === r.email)) return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint "admin_users_email_key"' });
          const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), last_login_at: null, ...r };
          rows.push(row); made.push(row);
        }
        save(db);
        return prefer.includes('return=representation') ? send(res, 201, made.map(strip)) : send(res, 201);
      }
      if (req.method === 'PATCH') {
        if (NO_PAGE_ACCESS && 'page_access' in payload) return missingCol(res, table);
        const hit = rows.filter((r) => match(r, q.filters));
        for (const r of hit) Object.assign(r, payload);
        save(db);
        return prefer.includes('return=representation') ? send(res, 200, hit.map(strip)) : send(res, 204);
      }
      if (req.method === 'DELETE') {
        db[table] = rows.filter((r) => !match(r, q.filters));
        save(db);
        return send(res, 204);
      }
      return send(res, 405, { message: 'method not allowed' });
    } catch (e) {
      return send(res, 400, { message: String(e?.message || e) });
    }
  });
}).listen(PORT, () => console.log(`dev control DB on http://localhost:${PORT}${NO_PAGE_ACCESS ? ' (no page_access column)' : ''} · ${FILE}`));
