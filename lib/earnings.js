// Earnings — the money Casa Libre makes from sellers in the ACTIVE COUNTRY, from that
// country's `payments` table (our own record — no Stripe calls). Two sources of income:
//   LISTING FEES — listing        → Extra listing (past the free monthly listings, US$5.80)
//                  listing_extend → Listing extension (+30 days, US$5)
//   ADD-ONS      — highlight      → Verified (US$5) / Home page (US$20), by plan
//   (visibility)   renewal        → a renewed Verified / Home page
// Every transaction is kept: who paid, what for, the price, paid or failed. listing_free
// rows are only the free-listings ledger (US$0) and never count.
// Pure helpers (filters, periods, totals, buckets) — test/earnings.test.js.

export const PRODUCTS = ['Extra listing', 'Listing extension', 'Verified', 'Home page', 'Renewal'];
export const SOURCES = { 'Listing fees': ['Extra listing', 'Listing extension'], 'Add-ons (visibility)': ['Verified', 'Home page', 'Renewal'] };
export const sourceOf = (product) => Object.keys(SOURCES).find((s) => SOURCES[s].includes(product)) || null;

export function productOf(p) {
  if (p.kind === 'listing') return 'Extra listing';
  if (p.kind === 'listing_extend') return 'Listing extension';
  if (p.kind === 'renewal') return 'Renewal';
  if (p.kind === 'highlight') return p.plan === 'home' ? 'Home page' : 'Verified';
  return null;
}

export const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const DAY = 86400000;

// Period presets → { from, to } (ISO, `to` exclusive). Custom: { from:'YYYY-MM-DD', to:'YYYY-MM-DD' }.
export function periodRange(preset, now = new Date(), custom = {}) {
  const startOfDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const today = startOfDay(now);
  const tomorrow = new Date(+today + DAY);
  const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  switch (preset) {
    case 'today': return { from: today.toISOString(), to: tomorrow.toISOString() };
    case '7d': return { from: new Date(+tomorrow - 7 * DAY).toISOString(), to: tomorrow.toISOString() };
    case '30d': return { from: new Date(+tomorrow - 30 * DAY).toISOString(), to: tomorrow.toISOString() };
    case '90d': return { from: new Date(+tomorrow - 90 * DAY).toISOString(), to: tomorrow.toISOString() };
    case 'month': return { from: m0.toISOString(), to: tomorrow.toISOString() };
    case 'last_month': return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString(), to: m0.toISOString() };
    case 'year': return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to: tomorrow.toISOString() };
    case 'custom': {
      const f = custom.from ? new Date(`${custom.from}T00:00:00Z`) : new Date(0);
      const t = custom.to ? new Date(+new Date(`${custom.to}T00:00:00Z`) + DAY) : tomorrow;
      return { from: f.toISOString(), to: t.toISOString() };
    }
    default: return { from: new Date(0).toISOString(), to: tomorrow.toISOString() };   // all time
  }
}

// The same-length period just before (for "vs previous period"). All time → none.
export function previousRange({ from, to }) {
  if (from <= new Date(0).toISOString()) return null;
  const len = Date.parse(to) - Date.parse(from);
  return { from: new Date(Date.parse(from) - len).toISOString(), to: from };
}

// rows → the rows matching the filters. f = { from, to, source, product, q }
export function filterRows(rows = [], f = {}) {
  const q = String(f.q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.from && String(r.created_at) < f.from) return false;
    if (f.to && String(r.created_at) >= f.to) return false;
    if (f.source && f.source !== 'all' && sourceOf(r.product) !== f.source) return false;
    if (f.product && f.product !== 'all' && r.product !== f.product) return false;
    if (q && !`${r.email || ''} ${r.name || ''} ${r.listing || ''} ${r.product || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// Totals for a set of rows (succeeded = money in; failed counted apart).
export function totals(rows = []) {
  const ok = rows.filter((r) => r.status === 'succeeded');
  const failed = rows.filter((r) => r.status === 'failed');
  const gross = ok.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
  const byProduct = Object.fromEntries(PRODUCTS.map((p) => [p, 0]));
  const bySource = Object.fromEntries(Object.keys(SOURCES).map((s) => [s, 0]));
  for (const r of ok) {
    const a = Number(r.amount_usd) || 0;
    if (r.product in byProduct) byProduct[r.product] += a;
    const src = sourceOf(r.product);
    if (src) bySource[src] += a;
  }
  const rd = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));
  return {
    earned: round(gross), payments: ok.length, sellers: new Set(ok.map((r) => r.user_id)).size,
    average: ok.length ? round(gross / ok.length) : 0,
    failed: failed.length, failedAmount: round(failed.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0)),
    successRate: ok.length + failed.length ? Math.round((ok.length / (ok.length + failed.length)) * 100) : null,
    byProduct: rd(byProduct), bySource: rd(bySource),
  };
}

// What was bought, at what price, by how many people, paid vs failed:
// → [{ product, source, price, paid, failed, users, earned }] (one line per product + price).
export function productTable(rows = []) {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.product}|${round(r.amount_usd)}`;
    const cur = m.get(k) || { product: r.product, source: sourceOf(r.product), price: round(r.amount_usd), paid: 0, failed: 0, users: new Set(), earned: 0 };
    if (r.status === 'succeeded') { cur.paid++; cur.earned += Number(r.amount_usd) || 0; cur.users.add(r.user_id); }
    if (r.status === 'failed') cur.failed++;
    m.set(k, cur);
  }
  return [...m.values()].map((x) => ({ ...x, users: x.users.size, earned: round(x.earned) }))
    .sort((a, b) => PRODUCTS.indexOf(a.product) - PRODUCTS.indexOf(b.product) || b.price - a.price);
}

// The bucket a date falls in: day 'YYYY-MM-DD', week (Monday) 'YYYY-MM-DD', month 'YYYY-MM'.
export function bucketKey(iso, group = 'month') {
  const d = new Date(iso);
  if (group === 'day') return d.toISOString().slice(0, 10);
  if (group === 'week') {
    const wd = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd)).toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 7);
}

// Succeeded rows → [{ key, total, byProduct }] oldest first; every bucket of the range is
// present (zero when nothing was earned).
export function series(rows = [], group = 'month', range = null) {
  const map = new Map();
  const blank = () => ({ total: 0, byProduct: Object.fromEntries(PRODUCTS.map((p) => [p, 0])) });
  const ok = rows.filter((r) => r.status === 'succeeded');
  if (range && ok.length) {
    const start = Date.parse(range.from) > 0 ? Date.parse(range.from) : Math.min(...ok.map((r) => Date.parse(r.created_at)));
    const end = Math.min(Date.parse(range.to), Date.now() + DAY);
    for (let t = start; t < end && map.size < 400; t += DAY) { const k = bucketKey(new Date(t).toISOString(), group); if (!map.has(k)) map.set(k, blank()); }
  }
  for (const r of ok) {
    const k = bucketKey(r.created_at, group);
    if (!map.has(k)) map.set(k, blank());
    const b = map.get(k);
    b.total += Number(r.amount_usd) || 0;
    if (r.product in b.byProduct) b.byProduct[r.product] += Number(r.amount_usd) || 0;
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, b]) => ({ key, total: round(b.total), byProduct: Object.fromEntries(Object.entries(b.byProduct).map(([k, v]) => [k, round(v)])) }));
}

// Top sellers by money spent.
export function topSellers(rows = [], n = 10) {
  const m = new Map();
  for (const r of rows) {
    if (r.status !== 'succeeded') continue;
    const cur = m.get(r.user_id) || { email: r.email, name: r.name, total: 0, payments: 0 };
    cur.total += Number(r.amount_usd) || 0; cur.payments++;
    m.set(r.user_id, cur);
  }
  return [...m.values()].map((x) => ({ ...x, total: round(x.total) })).sort((a, b) => b.total - a.total).slice(0, n);
}

// Percent change, or null when there is nothing to compare with.
export const change = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export function toCsv(rows = []) {
  const head = ['date', 'seller_email', 'seller_name', 'listing', 'source', 'product', 'price_usd', 'status', 'failure_reason', 'card'];
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r) => [r.created_at, r.email, r.name, r.listing, sourceOf(r.product), r.product, r.amount_usd, r.status === 'succeeded' ? 'paid' : 'failed', r.failure || '', r.card || ''].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}
