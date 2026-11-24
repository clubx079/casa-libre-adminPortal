// COPY of the website's lib/newsletter/insightsCore.js (casa-libre-buyerPortal) — keep the two the same.
// Used by the weekly edition generator (lib/newsletterEditionRun.js) to know this week's numbers.
// The newsletter's numbers, from raw PostHog + DB rows (pure — tests/newsletter.test.mjs).
// lib/newsletter/insights.js fetches the rows. Every number is ROUNDED DOWN (Marketing Formula:
// "check it on the day of sending and round down"), and a number is left out when there isn't
// enough data to say it honestly — the issue that needs it is then skipped that week.
//
// raw = {
//   totals:   [views, people]                         last 30 days, this country's site
//   listings: [{ views, price_usd, listing_type, city, property_type, origin, photos }]
//   searches: { rent, sale }                          search_applied by operation
//   queries:  [[text, count], …]                      search_applied query text
//   activeListings: number
// }

export const MIN_SAMPLE = 10;      // listings per group for a "N times more" ratio
export const MIN_VIEWS = 30;       // views behind a price number
const SALE_CAP = 100000;

export function roundDown(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  const r = v >= 1000 ? Math.floor(v / 100) * 100 : v >= 100 ? Math.floor(v / 10) * 10 : v;
  return thousands(r);
}
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const usd = (n) => `US$${thousands(Math.floor(Number(n) || 0))}`;
export const joinEs = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`);

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const titleCase = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
  .replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Del|La|Las|Los|El|Y)\b/g, (w, _x, i) => (i === 0 ? w : w.toLowerCase()));

const isSale = (t) => /^(sale|venta)$/i.test(String(t || ''));
const isRent = (t) => /^(rent|alquiler)$/i.test(String(t || ''));
const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const avg = (arr) => (arr.length ? sum(arr, (x) => x.views) / arr.length : 0);

// Weighted median: the price under which half of the views fall.
export function viewMedian(rows) {
  const list = rows.filter((r) => r.views > 0 && r.price_usd > 0).sort((a, b) => a.price_usd - b.price_usd);
  const total = sum(list, (r) => r.views);
  let acc = 0;
  for (const r of list) { acc += r.views; if (acc >= total / 2) return r.price_usd; }
  return null;
}

export const RENT_BANDS = [
  { max: 200, label: 'menos de US$200' },
  { min: 200, max: 400, label: 'US$200 a US$400' },
  { min: 400, max: 700, label: 'US$400 a US$700' },
  { min: 700, max: 1000, label: 'US$700 a US$1.000' },
  { min: 1000, label: 'más de US$1.000' },
];
const bandOf = (p) => RENT_BANDS.find((b) => (b.min == null || p >= b.min) && (b.max == null || p < b.max));

const TYPE_PLURAL = { casa: 'casas', departamento: 'departamentos', 'dúplex': 'dúplex', duplex: 'dúplex', terreno: 'terrenos', 'local comercial': 'locales comerciales', oficina: 'oficinas', condominio: 'condominios', 'depósito': 'depósitos', campo: 'campos', edificio: 'edificios' };

export function insightVars(raw = {}) {
  const out = {};
  const [views, people] = (raw.totals || []).map(Number);
  if (views > 0) out.nl_views_30d = roundDown(views);
  if (people > 0) out.nl_people_30d = roundDown(people);
  if (raw.activeListings > 0) out.active_listings = roundDown(raw.activeListings);

  const rows = (raw.listings || []).map((r) => ({ ...r, views: Number(r.views) || 0, price_usd: Number(r.price_usd) || 0 })).filter((r) => r.views > 0);

  // cities: the top 3 by views
  const byCity = new Map();
  for (const r of rows) { const c = String(r.city || '').trim(); if (c) byCity.set(norm(c), { name: byCity.get(norm(c))?.name || titleCase(c), v: (byCity.get(norm(c))?.v || 0) + r.views }); }
  const cities = [...byCity.values()].sort((a, b) => b.v - a.v).slice(0, 3);
  if (cities.length === 3) out.nl_top_cities = joinEs(cities.map((c) => c.name));

  // property types: the top 2 with their share of views
  const byType = new Map();
  for (const r of rows) { const t = norm(r.property_type); if (t) byType.set(t, (byType.get(t) || 0) + r.views); }
  const tTotal = [...byType.values()].reduce((a, b) => a + b, 0);
  const types = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (types.length === 2 && tTotal >= MIN_VIEWS) out.nl_top_types = joinEs(types.map(([t, v]) => `${TYPE_PLURAL[t] || t} (${Math.floor((v / tTotal) * 100)} %)`));

  // for sale: the view-weighted median price + the share under US$100.000
  const sale = rows.filter((r) => isSale(r.listing_type) && r.price_usd >= 1000);
  const saleViews = sum(sale, (r) => r.views);
  if (saleViews >= MIN_VIEWS) {
    const med = viewMedian(sale);
    if (med) out.nl_sale_median = usd(Math.floor(med / 1000) * 1000);
    out.nl_sale_under_100k_pct = String(Math.floor((sum(sale.filter((r) => r.price_usd < SALE_CAP), (r) => r.views) / saleViews) * 100));
  }

  // rent: the most viewed monthly range
  const rent = rows.filter((r) => isRent(r.listing_type) && r.price_usd > 0);
  const rentViews = sum(rent, (r) => r.views);
  if (rentViews >= MIN_VIEWS) {
    const per = new Map();
    for (const r of rent) { const b = bandOf(r.price_usd); per.set(b.label, (per.get(b.label) || 0) + r.views); }
    const [label, v] = [...per.entries()].sort((a, b) => b[1] - a[1])[0];
    out.nl_rent_band = label;
    out.nl_rent_band_pct = String(Math.floor((v / rentViews) * 100));
  }

  // published directly (origin user) vs imported: N times the average views — only ≥ 2
  const direct = rows.filter((r) => r.origin === 'user');
  const imported = rows.filter((r) => r.origin !== 'user');
  if (direct.length >= MIN_SAMPLE && imported.length >= MIN_SAMPLE && avg(imported) > 0) {
    const ratio = Math.floor(avg(direct) / avg(imported));
    if (ratio >= 2) out.nl_direct_ratio = String(ratio);
  }
  // with photos vs none: N times the average views — only ≥ 2
  const noPhoto = rows.filter((r) => !(Number(r.photos) > 0));
  const withPhoto = rows.filter((r) => Number(r.photos) > 0);
  if (noPhoto.length >= MIN_SAMPLE && withPhoto.length >= MIN_SAMPLE && avg(noPhoto) > 0) {
    const ratio = Math.floor(avg(withPhoto) / avg(noPhoto));
    if (ratio >= 2) out.nl_photo_ratio = String(ratio);
  }

  // searches: rent vs sale counts, the 3 most typed places (accents / case merged)
  const rs = Number(raw.searches?.rent) || 0;
  const ss = Number(raw.searches?.sale) || 0;
  if (rs >= MIN_VIEWS && ss >= MIN_VIEWS && rs > ss) { out.nl_rent_searches = roundDown(rs); out.nl_sale_searches = roundDown(ss); }
  const q = new Map();
  for (const [text, n] of raw.queries || []) {
    const k = norm(text);
    if (!k || k.length < 3 || /^\d+$/.test(k)) continue;
    const cur = q.get(k) || { n: 0, best: null, bestN: 0 };
    cur.n += Number(n) || 0;
    // the spelling with accents wins when it is there ("Asunción" over "asuncion")
    const hasAccent = /[^\u0000-\u007f]/.test(String(text));
    if (!cur.best || (hasAccent && !/[^\u0000-\u007f]/.test(cur.best)) || (Number(n) > cur.bestN && hasAccent === /[^\u0000-\u007f]/.test(cur.best))) { cur.best = String(text); cur.bestN = Number(n) || 0; }
    q.set(k, cur);
  }
  const top = [...q.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  if (top.length === 3 && top[2].n >= 10) out.nl_top_searches = joinEs(top.map((x) => titleCase(x.best)));
  return out;
}
