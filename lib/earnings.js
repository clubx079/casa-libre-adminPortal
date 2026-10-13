// Earnings: money actually received (payments with status 'succeeded'), per month, per
// product and per country. Products:
//   listing        → Extra listing (over the free monthly listings, US$5.80)
//   listing_extend → Listing extension (+30 days, US$5)
//   highlight      → Verified (US$5) / Home page (US$20) by plan
//   renewal        → the same plans, renewed
// listing_free rows are the free-listings ledger (US$0) and never count. Pure — test/earnings.test.js.

export const PRODUCTS = ['Extra listing', 'Listing extension', 'Verified', 'Home page', 'Renewal'];

export function productOf(p) {
  if (p.kind === 'listing') return 'Extra listing';
  if (p.kind === 'listing_extend') return 'Listing extension';
  if (p.kind === 'renewal') return 'Renewal';
  if (p.kind === 'highlight') return p.plan === 'home' ? 'Home page' : 'Verified';
  return null;
}

const round = (n) => Math.round(n * 100) / 100;

// rows: [{ country, kind, plan, amount_usd, status, created_at }] → summary
export function summarize(rows = []) {
  const months = new Map();
  const byCountry = {};
  const byProduct = Object.fromEntries(PRODUCTS.map((p) => [p, 0]));
  let total = 0, count = 0;
  for (const r of rows) {
    if (r.status !== 'succeeded') continue;
    const product = productOf(r);
    if (!product) continue;
    const amt = Number(r.amount_usd) || 0;
    const month = String(r.created_at || '').slice(0, 7);
    if (!months.has(month)) months.set(month, { month, total: 0, count: 0, byProduct: Object.fromEntries(PRODUCTS.map((p) => [p, 0])), byCountry: {} });
    const m = months.get(month);
    m.total += amt; m.count++; m.byProduct[product] += amt; m.byCountry[r.country] = (m.byCountry[r.country] || 0) + amt;
    byProduct[product] += amt; byCountry[r.country] = (byCountry[r.country] || 0) + amt;
    total += amt; count++;
  }
  const list = [...months.values()].sort((a, b) => b.month.localeCompare(a.month)).map((m) => ({
    ...m, total: round(m.total),
    byProduct: Object.fromEntries(Object.entries(m.byProduct).map(([k, v]) => [k, round(v)])),
    byCountry: Object.fromEntries(Object.entries(m.byCountry).map(([k, v]) => [k, round(v)])),
  }));
  return {
    total: round(total), count, months: list,
    byProduct: Object.fromEntries(Object.entries(byProduct).map(([k, v]) => [k, round(v)])),
    byCountry: Object.fromEntries(Object.entries(byCountry).map(([k, v]) => [k, round(v)])),
  };
}
