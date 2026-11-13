// Funnel leads (Admin → Funnels): people who filled the form on one of the two Spanish
// funnel sites — "vender-mi-casa" (owners) and "como-vender-mas-propiedades" (agents).
// Each lead is stored in the visitor's country DB, table public.funnel_leads.
// Pure helpers shared by the API routes and the page — test/funnelLeads.test.js.

export const FUNNEL_SITES = ['owners', 'agents'];
export const SITE_LABEL = { owners: 'Owners', agents: 'Agents' };
export const SITE_DOMAIN = { owners: 'vender-mi-casa', agents: 'como-vender-mas-propiedades' };
export const FUNNEL_COUNTRIES = ['py', 'bo', 'uy', 've', 'sv'];

export const FUNNEL_STATUSES = ['new', 'contacted', 'converted', 'discarded'];
export const STATUS_LABEL = { new: 'New', contacted: 'Contacted', converted: 'Converted', discarded: 'Discarded' };

// Date ranges the leads list accepts (days; 0 = all time).
export const LEAD_RANGES = [
  { v: 7, l: '7 days' },
  { v: 30, l: '30 days' },
  { v: 90, l: '3 months' },
  { v: 365, l: '12 months' },
  { v: 0, l: 'All time' },
];
export const DEFAULT_LEAD_DAYS = 30;

// The fields each site's form asks (besides name / WhatsApp / email).
export const SITE_FIELDS = {
  owners: [['operation', 'Operation'], ['city', 'City'], ['property_type', 'Property type'], ['has_title', 'Has title']],
  agents: [['operation', 'Operation'], ['city', 'City'], ['portfolio', 'Portfolio'], ['role', 'Role'], ['agency', 'Agency']],
};

// The table isn't there yet (PostgREST 42P01 / PGRST205 / "does not exist").
export function isMissingTable(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  const msg = String(err.message || err || '');
  return /does not exist|could not find the table|schema cache/i.test(msg);
}

export const normSite = (s) => (FUNNEL_SITES.includes(String(s || '').toLowerCase()) ? String(s).toLowerCase() : 'all');
export const normStatus = (s) => (FUNNEL_STATUSES.includes(String(s || '').toLowerCase()) ? String(s).toLowerCase() : 'all');
export function normLeadDays(d) {
  const n = Number(d);
  return LEAD_RANGES.some((r) => r.v === n) && d !== '' && d != null ? n : DEFAULT_LEAD_DAYS;
}

// PostgREST query for the date window (every site / status — the counts need them all).
export function leadsQuery({ days, now = Date.now(), limit = 5000 } = {}) {
  const parts = ['select=*', 'order=created_at.desc', `limit=${limit}`];
  if (days > 0) parts.push(`created_at=gte.${new Date(now - days * 86400000).toISOString()}`);
  return parts.join('&');
}

// wa.me needs digits only.
export const waDigits = (p) => String(p || '').replace(/\D/g, '');
export const waLink = (p) => (waDigits(p) ? `https://wa.me/${waDigits(p)}` : null);

const norm = (v) => String(v ?? '').toLowerCase();

// Site / status / text search (name, WhatsApp, email). Phone search ignores spaces and symbols.
export function filterFunnelLeads(rows = [], { site = 'all', status = 'all', q = '' } = {}) {
  const text = norm(q).trim();
  const digits = waDigits(q);
  return rows.filter((r) => {
    if (site !== 'all' && r.site !== site) return false;
    if (status !== 'all' && (r.status || 'new') !== status) return false;
    if (!text) return true;
    if (norm(r.name).includes(text) || norm(r.email).includes(text) || norm(r.whatsapp).includes(text)) return true;
    return digits.length >= 3 && waDigits(r.whatsapp).includes(digits);
  });
}

// Counts on top of the page: by status and by site (for the whole date window).
export function funnelCounts(rows = []) {
  const c = { total: rows.length, status: { new: 0, contacted: 0, converted: 0, discarded: 0 }, site: { owners: 0, agents: 0 } };
  for (const r of rows) {
    const s = r.status || 'new';
    if (s in c.status) c.status[s] += 1;
    if (r.site in c.site) c.site[r.site] += 1;
  }
  return c;
}

// utm jsonb → { source, medium, campaign, content, term } (tolerates a JSON string).
export function utmOf(r) {
  let u = r?.utm;
  if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = null; } }
  if (!u || typeof u !== 'object') return {};
  const pick = (k) => u[k] ?? u[`utm_${k}`] ?? null;
  return { source: pick('source'), medium: pick('medium'), campaign: pick('campaign'), content: pick('content'), term: pick('term') };
}

// The admin's change to one lead: status and/or notes. → { patch } or { error }.
// handled_by / handled_at are stamped from the session by the route.
export function leadPatch(body, by, now = new Date()) {
  if (!body || typeof body !== 'object') return { error: 'Bad request' };
  const patch = {};
  if (body.status !== undefined) {
    if (!FUNNEL_STATUSES.includes(body.status)) return { error: 'Invalid status' };
    patch.status = body.status;
  }
  if (body.notes !== undefined) patch.notes = String(body.notes || '').slice(0, 4000) || null;
  if (!Object.keys(patch).length) return { error: 'Nothing to update' };
  patch.handled_by = by || null;
  patch.handled_at = now.toISOString();
  return { patch };
}
