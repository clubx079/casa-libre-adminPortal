// Admin Manager — the agent's READ-ONLY tools (lib/manager/agent.js runs them).
// Claude can look anything up, the way Roland did by clicking through the admin, but it
// never writes: the database tools only send GET requests to PostgREST, and PostHog's
// HogQL is read-only. What comes back is trimmed for privacy and size:
//   · secrets / payment / device fields are dropped (password_hash, tokens, card ids, IPs…)
//   · emails and phone numbers are masked (o***@gmail.com, +595 9•• ••• •56) — drafts
//     address people by user id; the real address is only read when an admin hits Send
//   · long texts are cut, and every result is capped (rows and characters).
// Pure except runTool's deps (db select / count / hogql), passed in — test/managerTools.test.js.

// Tables the agent may read. Left out on purpose: admins, admin_sessions, otp_codes,
// push_tokens (secrets), manager_reports (its own output), potential_leads (never contacted —
// nothing about them belongs in a report or a draft).
export const READABLE_TABLES = [
  'users', 'properties', 'property_images', 'listing_drafts', 'favorites', 'payments',
  'automations', 'automation_runs', 'email_log', 'email_templates', 'listing_view_milestones',
  'feedback', 'listing_reports', 'contact_link_clicks', 'partner_inquiries',
  'scrape_sources', 'scrape_runs', 'scrape_shards', 'scraper_registry', 'ingest_quarantine',
  'notification_prefs', 'push_log', 'api_usage_log',
];

// Never shown to the agent.
const DROP = new Set([
  'password_hash', 'code_hash', 'token', 'card_pm_id', 'stripe_customer_id', 'stripe_payment_intent_id',
  'ip_address', 'registration_ip', 'buyer_ip', 'google_id', 'raw_data', 'payload', 'card_exp_month', 'card_exp_year',
]);
const EMAIL_KEYS = /(^|_)email$/;
const PHONE_KEYS = /(^|_)(phone|whatsapp)$/;

export function maskEmail(v) {
  const s = String(v || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? '***' : s;
  return `${s[0]}***${s.slice(at)}`;
}
export function maskPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 6) return d ? '•••' : '';
  return `+${d.slice(0, 3)} ${d.slice(3, 4)}•• ••• •${d.slice(-2)}`;
}

const MAX_TEXT = 700;
// One row → safe to show: drops secrets, masks contact details, cuts long text.
export function cleanRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (DROP.has(k)) continue;
    if (v != null && EMAIL_KEYS.test(k)) out[k] = maskEmail(v);
    else if (v != null && PHONE_KEYS.test(k)) out[k] = maskPhone(v);
    else if (typeof v === 'string' && v.length > MAX_TEXT) out[k] = `${v.slice(0, MAX_TEXT)}… (+${v.length - MAX_TEXT} chars)`;
    else if (v && typeof v === 'object') {
      const j = JSON.stringify(v);
      out[k] = j.length > MAX_TEXT ? `${j.slice(0, MAX_TEXT)}… (json, ${j.length} chars)` : v;
    } else out[k] = v;
  }
  return out;
}

// PostgREST query pieces the agent writes. Only plain column lists and filter syntax.
const SELECT_RE = /^[a-zA-Z0-9_,*:()!.\-> ]{1,400}$/;
const ORDER_RE = /^[a-zA-Z0-9_,.]{1,120}$/;

// → { ok, query } or { ok:false, error }. filters = PostgREST filter string, e.g.
// "origin=eq.user&created_at=gte.2026-10-01" (already URL-safe values are fine).
export function buildQuery({ table, select = '*', filters = '', order = '', limit = 50 } = {}) {
  if (!READABLE_TABLES.includes(table)) return { ok: false, error: `Table "${table}" is not readable. Readable: ${READABLE_TABLES.join(', ')}` };
  if (!SELECT_RE.test(select)) return { ok: false, error: 'select must be a plain column list (PostgREST syntax).' };
  if (order && !ORDER_RE.test(order)) return { ok: false, error: 'order must look like "created_at.desc".' };
  const f = String(filters || '').trim().replace(/^[?&]+/, '');
  if (/(^|&)(select|order|limit|offset)=/i.test(f)) return { ok: false, error: 'Put select / order / limit in their own fields, not in filters.' };
  if (/[\s#]/.test(f)) return { ok: false, error: 'filters must not contain spaces — URL-encode values (%20).' };
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const parts = [`select=${select.replace(/\s+/g, '')}`];
  if (f) parts.push(f);
  if (order) parts.push(`order=${order}`);
  parts.push(`limit=${n}`);
  return { ok: true, query: parts.join('&'), limit: n };
}

const MAX_HOGQL_ROWS = 300;
// HogQL from the agent: read-only by nature; must be a SELECT, gets a LIMIT if it has none.
export function checkHogql(sql) {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) return { ok: false, error: 'Only SELECT (or WITH … SELECT) queries.' };
  if (s.includes(';')) return { ok: false, error: 'One query at a time (no semicolons).' };
  return { ok: true, sql: /\blimit\s+\d+\s*$/i.test(s) ? s : `${s}\nLIMIT ${MAX_HOGQL_ROWS}` };
}

const MAX_RESULT_CHARS = 30000;
export function capJson(value) {
  const j = JSON.stringify(value);
  if (j.length <= MAX_RESULT_CHARS) return j;
  return `${j.slice(0, MAX_RESULT_CHARS)}\n… (cut: the result was ${j.length} characters — ask for fewer rows or columns)`;
}

// Tool definitions sent to Claude (the order never changes — it is part of the cached prefix).
export const TOOL_DEFS = [
  {
    name: 'query_database',
    description: 'Read rows from the country\'s Casa Libre database (PostgREST, read-only). Use it to check a number, look at examples, or find the people behind a problem. Emails/phones come back masked; secrets are removed. Max 200 rows. Count with count_rows instead of reading many rows.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: READABLE_TABLES },
        select: { type: 'string', description: 'PostgREST column list, e.g. "id,created_at,property_type,listing_type,city,status". Embeds are not available.' },
        filters: { type: 'string', description: 'PostgREST filters joined by &, e.g. "origin=eq.user&created_at=gte.2026-10-14T00:00:00Z&is_delisted=eq.false". Empty string for none.' },
        order: { type: 'string', description: 'e.g. "created_at.desc". Empty string for none.' },
        limit: { type: 'integer', description: '1–200' },
      },
      required: ['table', 'select', 'filters', 'order', 'limit'],
      additionalProperties: false,
    },
  },
  {
    name: 'count_rows',
    description: 'Exact number of rows in a table matching PostgREST filters (read-only).',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: READABLE_TABLES },
        filters: { type: 'string', description: 'PostgREST filters joined by &, or empty string.' },
      },
      required: ['table', 'filters'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_posthog',
    description: 'Run a read-only HogQL SELECT on the website/app analytics (PostHog, all Casa Libre countries in one project). ALWAYS add the country + team filter given in the instructions to the WHERE clause. Returns rows as arrays (max 300).',
    input_schema: {
      type: 'object',
      properties: { hogql: { type: 'string', description: 'One HogQL SELECT query.' } },
      required: ['hogql'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_listing',
    description: 'Everything about one listing: its fields, photos count, owner (first name, user id), views and contacts. Use before drafting an email about a listing.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'properties.id (uuid)' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_user',
    description: 'One user\'s story: sign-up, sign-in method, verification, their listings, drafts, payments, feedback and every email / WhatsApp message we sent them (with status). Use before drafting an email to that person.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'users.id (uuid)' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

const UUID_RE = /^[0-9a-f-]{36}$/i;
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || null;

// deps: { select(table, query), count(table, filters), hogql(sql), siteFilter }
// → string (JSON) for the tool_result; errors come back as { error } so Claude can adjust.
export async function runTool(name, input = {}, deps) {
  try {
    if (name === 'query_database') {
      const q = buildQuery(input);
      if (!q.ok) return capJson({ error: q.error });
      const rows = await deps.select(input.table, q.query);
      return capJson({ rows: (rows || []).map(cleanRow), returned: (rows || []).length, limit: q.limit });
    }
    if (name === 'count_rows') {
      const q = buildQuery({ table: input.table, select: 'id', filters: input.filters, limit: 1 });
      if (!q.ok) return capJson({ error: q.error });
      return capJson({ count: await deps.count(input.table, String(input.filters || '').replace(/^[?&]+/, '')) });
    }
    if (name === 'query_posthog') {
      const c = checkHogql(input.hogql);
      if (!c.ok) return capJson({ error: c.error });
      const rows = await deps.hogql(c.sql);
      return capJson({ rows: (rows || []).slice(0, MAX_HOGQL_ROWS) });
    }
    if (name === 'get_listing') {
      if (!UUID_RE.test(String(input.id || ''))) return capJson({ error: 'id must be a uuid' });
      const [p] = await deps.select('properties', `select=*&id=eq.${input.id}&limit=1`);
      if (!p) return capJson({ error: 'listing not found' });
      const [owner] = p.created_by && UUID_RE.test(p.created_by) ? await deps.select('users', `select=id,full_name,auth_provider,verified,created_at&id=eq.${p.created_by}&limit=1`) : [];
      const photos = await deps.count('property_images', `property_id=eq.${p.id}`);
      const [views] = await deps.select('listing_view_milestones', `select=last_views,last_milestone,updated_at&property_id=eq.${p.id}&limit=1`).catch(() => []);
      const contacts = await deps.count('contact_link_clicks', `property_id=eq.${p.id}`).catch(() => null);
      const listing = cleanRow(p);
      delete listing.seo_description; delete listing.social_description; delete listing.social_title; delete listing.seo_title;
      return capJson({ listing, owner: owner ? { id: owner.id, first_name: firstName(owner.full_name), auth_provider: owner.auth_provider, verified: owner.verified, signed_up: owner.created_at } : null, photos, views: views || null, buyer_contacts: contacts });
    }
    if (name === 'get_user') {
      if (!UUID_RE.test(String(input.id || ''))) return capJson({ error: 'id must be a uuid' });
      const [u] = await deps.select('users', `select=id,email,full_name,phone,verified,active,blocked,suspended,auth_provider,created_at,last_login_at,phone_verified_at&id=eq.${input.id}&limit=1`);
      if (!u) return capJson({ error: 'user not found' });
      const email = String(u.email || '').toLowerCase();
      const [listings, drafts, payments, feedback, messages] = await Promise.all([
        deps.select('properties', `select=id,created_at,property_type,listing_type,city,neighborhood,price,currency,status,admin_status,is_complete,image_status,promotion_plan&created_by=eq.${u.id}&order=created_at.desc&limit=30`).catch(() => []),
        deps.select('listing_drafts', `select=id,created_at,updated_at&user_id=eq.${u.id}&order=updated_at.desc&limit=10`).catch(() => []),
        deps.select('payments', `select=id,kind,plan,amount_usd,status,failure_reason,created_at,property_id&user_id=eq.${u.id}&order=created_at.desc&limit=20`).catch(() => []),
        deps.select('feedback', `select=id,rating,message,source,created_at&user_id=eq.${u.id}&order=created_at.desc&limit=10`).catch(() => []),
        email ? deps.select('email_log', `select=automation_id,template_key,subject,status,channel,created_at&to_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=40`).catch(() => []) : [],
      ]);
      return capJson({
        user: { ...cleanRow(u), first_name: firstName(u.full_name) },
        listings, drafts, payments: payments.map(cleanRow), feedback: feedback.map(cleanRow), messages_sent_to_them: messages,
      });
    }
    return capJson({ error: `Unknown tool ${name}` });
  } catch (e) {
    return capJson({ error: String(e?.message || e).slice(0, 400) });
  }
}
