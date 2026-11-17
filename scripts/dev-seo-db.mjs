// LOCAL DEVELOPMENT ONLY: a stand-in for the seo_* tables of migrations/011_seo_pipeline.sql, for
// trying the SEO pipeline end to end before that migration has been run on the sandbox DB (DDL needs
// the AiroBase SQL editor; port 5432 is closed from dev). Answers the part of the PostgREST API that
// lib/seo/* (admin) and lib/seoDb.js (website) use:
//   GET    /rest/v1/<table>?select=a,b&col=eq.v&col=in.(a,b)&col=gte.v&order=c.desc&limit=n&offset=n
//   POST   /rest/v1/<table>[?on_conflict=a,b]   (Prefer: resolution=merge-duplicates, return=…)
//   PATCH  /rest/v1/<table>?col=eq.v
//   DELETE /rest/v1/<table>?col=eq.v
// Data lives in .dev-seo-db.json next to package.json (gitignored).
//
//   node scripts/dev-seo-db.mjs          → http://localhost:54391
// Point both apps at it in .env.local: SEO_DB_URL=http://localhost:54391  SEO_DB_KEY=local-dev
// (remove those two lines once the migration has run on the DB: the seo_* tables then live there).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.DEV_SEO_DB_FILE || path.join(ROOT, '.dev-seo-db.json');
const PORT = Number(process.env.DEV_SEO_PORT || 54391);

// table → { unique keys (like the migration), id kind, defaults }
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const TABLES = {
  seo_signals: { unique: ['country', 'source', 'term', 'page', 'date'], id: 'serial', defaults: () => ({ country: 'py', page: '', date: today(), metrics: {}, collected_at: now() }) },
  seo_trends: { unique: ['geo', 'title', 'seen_hour'], id: 'serial', defaults: () => ({ news: [], topic: 'other', seen_at: now() }) },
  seo_opportunities: { unique: ['country', 'key'], id: 'uuid', defaults: () => ({ country: 'py', parsed: {}, score: 0, evidence: {}, status: 'open', created_at: now(), updated_at: now(), decided_at: null, decided_by: null }) },
  seo_overrides: { unique: ['country', 'path'], id: 'uuid', defaults: () => ({ country: 'py', title: null, h1: null, description: null, enabled_variants: [], retired_variants: [], extra_links: [], title_changed_at: null, updated_at: now() }) },
  seo_changes: { unique: null, id: 'uuid', defaults: () => ({ country: 'py', before: null, after: null, reason: null, by: null, opportunity_id: null, created_at: now(), reverted_at: null, reverted_by: null }) },
  seo_drafts: { unique: ['country', 'slug'], id: 'uuid', defaults: () => ({ country: 'py', kind: 'guide', status: 'draft', sections: [], faq: [], related: [], source: 'template', model: null, note: null, created_at: now(), updated_at: now(), approved_at: null, approved_by: null }) },
  seo_settings: { unique: ['country'], id: null, defaults: () => ({ settings: {}, updated_at: now(), updated_by: null }) },
};

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const db = load();
for (const t of Object.keys(TABLES)) db[t] ||= [];
db.__seq ||= 0;
const save = () => fs.writeFileSync(FILE, JSON.stringify(db));

const cast = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v);
const cmp = (a, b) => {
  const na = Number(a), nb = Number(b);
  if (a !== null && b !== null && a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb) && typeof a !== 'boolean') return na - nb;
  return String(a ?? '') < String(b ?? '') ? -1 : String(a ?? '') > String(b ?? '') ? 1 : 0;
};
function parse(qs) {
  const filters = [];
  let select = null, order = [], limit = Infinity, offset = 0, onConflict = null;
  for (const [k, v] of new URLSearchParams(qs)) {
    if (k === 'select') select = v.split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === 'order') order = v.split(',').map((o) => { const [col, dir] = o.split('.'); return { col, desc: dir === 'desc' }; });
    else if (k === 'limit') limit = Number(v);
    else if (k === 'offset') offset = Number(v);
    else if (k === 'on_conflict') onConflict = v.split(',');
    else {
      let op = v.slice(0, v.indexOf('.')); let val = v.slice(v.indexOf('.') + 1); let not = false;
      if (op === 'not') { not = true; op = val.slice(0, val.indexOf('.')); val = val.slice(val.indexOf('.') + 1); }
      filters.push({ col: k, op, val: op === 'in' ? val.replace(/^\(|\)$/g, '').split(',').map((x) => cast(x.replace(/^"|"$/g, ''))) : cast(val), not });
    }
  }
  return { filters, select, order, limit, offset, onConflict };
}
const test = (row, { col, op, val, not }) => {
  const x = row[col] ?? null;
  let r;
  if (op === 'eq') r = x === val || String(x) === String(val);
  else if (op === 'neq') r = !(x === val || String(x) === String(val));
  else if (op === 'is') r = x === val;
  else if (op === 'in') r = val.some((v) => String(v) === String(x));
  else if (op === 'gte') r = x != null && cmp(x, val) >= 0;
  else if (op === 'gt') r = x != null && cmp(x, val) > 0;
  else if (op === 'lte') r = x != null && cmp(x, val) <= 0;
  else if (op === 'lt') r = x != null && cmp(x, val) < 0;
  else if (op === 'ilike') r = new RegExp(`^${String(val).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*')}$`, 'i').test(String(x ?? ''));
  else if (op === 'cs') r = Array.isArray(x) && String(val).replace(/^\{|\}$/g, '').split(',').every((v) => x.includes(v));
  else r = true;
  return not ? !r : r;
};
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const sameKey = (a, b, keys) => keys.every((k) => String(a[k] ?? '') === String(b[k] ?? ''));

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m || !TABLES[m[1]]) return send(res, 404, { code: 'PGRST205', message: `Could not find the table 'public.${m?.[1]}' in the schema cache` });
    const table = m[1];
    const conf = TABLES[table];
    const q = parse(url.search.slice(1));
    const prefer = String(req.headers.prefer || '');
    const rep = prefer.includes('return=representation');
    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        let out = db[table].filter((r) => q.filters.every((f) => test(r, f)));
        for (const { col, desc } of [...q.order].reverse()) out.sort((a, b) => cmp(a[col], b[col]) * (desc ? -1 : 1));
        const total = out.length;
        out = out.slice(q.offset, q.offset + q.limit);
        if (q.select && !q.select.includes('*')) out = out.map((r) => Object.fromEntries(q.select.map((c) => [c, r[c] ?? null])));
        return send(res, 200, out, { 'content-range': `${q.offset}-${q.offset + out.length - 1}/${prefer.includes('count=exact') ? total : '*'}` });
      }
      const payload = body ? JSON.parse(body) : {};
      if (req.method === 'POST') {
        const list = Array.isArray(payload) ? payload : [payload];
        const keys = q.onConflict || conf.unique;
        const merge = prefer.includes('resolution=merge-duplicates');
        const made = [];
        for (const r of list) {
          const hit = keys ? db[table].find((x) => sameKey(x, { ...conf.defaults(), ...r }, keys)) : null;
          if (hit) {
            if (!merge) return send(res, 409, { code: '23505', message: `duplicate key value violates unique constraint "${table}_key"` });
            Object.assign(hit, r); made.push(hit); continue;
          }
          const id = conf.id === 'uuid' ? crypto.randomUUID() : conf.id === 'serial' ? (db.__seq += 1) : undefined;
          const row = { ...(id !== undefined ? { id } : {}), ...conf.defaults(), ...r };
          db[table].push(row); made.push(row);
        }
        save();
        return rep ? send(res, 201, made) : send(res, 201);
      }
      if (req.method === 'PATCH') {
        const hit = db[table].filter((r) => q.filters.every((f) => test(r, f)));
        for (const r of hit) Object.assign(r, payload);
        save();
        return rep ? send(res, 200, hit) : send(res, 204);
      }
      if (req.method === 'DELETE') {
        db[table] = db[table].filter((r) => !q.filters.every((f) => test(r, f)));
        save();
        return send(res, 204);
      }
      return send(res, 405, { message: 'method not allowed' });
    } catch (e) {
      return send(res, 400, { message: String(e?.message || e) });
    }
  });
}).listen(PORT, () => console.log(`dev SEO DB on http://localhost:${PORT} · ${FILE}`));
