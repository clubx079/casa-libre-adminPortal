// Live listings → what each SEO page has (pure; rows come from the country DB, read-only).
// Same rules as the website's matrix (lib/matrix.js there): active + complete listings, op from
// listing_type, type from property_type keywords, city from the country's city list, barrio = slug
// of the neighborhood text. Prices are US$ (price_usd); stats use priced listings only.
import { typeSlugOf, citySlugOf, opOfListing, slugify, pathOf, VARIANTS, MIN_LISTINGS } from './matrix.js';

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function statsOf(items) {
  const prices = items.map((r) => Number(r.price_usd)).filter((n) => Number.isFinite(n) && n > 0);
  const newest = items.map((r) => r.created_at).filter(Boolean).sort().pop() || null;
  return {
    count: items.length,
    priced: prices.length,
    median: median(prices),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    newest,
  };
}

// Does a listing belong in a variant of its city page? (cheap needs the city-page median)
export function inVariant(row, variantSlug, cityMedian) {
  const v = VARIANTS[variantSlug];
  if (!v) return false;
  if (v.kind === 'cheap') {
    const p = Number(row.price_usd);
    return Number.isFinite(p) && p > 0 && cityMedian != null && p < cityMedian;
  }
  if (v.kind === 'beds') return Number(row.bedrooms) === v.beds;
  return false;
}

// rows: [{ listing_type, property_type, city, neighborhood, price_usd, bedrooms, created_at }]
// → Map(path → { path, level: 'city'|'barrio'|'variant', op, tipo, ciudad, barrio?, barrioName?, variant?, ...stats })
export function buildInventory(rows, cities) {
  const groups = new Map();
  const names = new Map(); // barrio path → Map(name → n)
  const add = (key, info, r) => {
    let g = groups.get(key);
    if (!g) { g = { ...info, items: [] }; groups.set(key, g); }
    g.items.push(r);
  };
  for (const r of rows || []) {
    const op = opOfListing(r.listing_type);
    const tipo = typeSlugOf(r.property_type);
    const ciudad = citySlugOf(r.city, cities);
    if (!tipo || !ciudad) continue;
    add(pathOf({ op, tipo, ciudad }), { level: 'city', op, tipo, ciudad }, r);
    add(`/${op}/${tipo}`, { level: 'country', op, tipo }, r);   // whole country (guides' numbers only — no page)
    const bname = String(r.neighborhood || '').trim();
    const barrio = bname ? slugify(bname) : '';
    if (barrio) {
      const p = pathOf({ op, tipo, ciudad, barrio });
      add(p, { level: 'barrio', op, tipo, ciudad, barrio }, r);
      const n = names.get(p) || new Map();
      n.set(bname, (n.get(bname) || 0) + 1);
      names.set(p, n);
    }
  }
  const out = new Map();
  for (const [path, g] of groups) {
    const s = statsOf(g.items);
    const row = { path, level: g.level, op: g.op, tipo: g.tipo, ciudad: g.ciudad, ...s };
    if (g.level === 'barrio') {
      row.barrio = g.barrio;
      let best = -1;
      for (const [name, n] of names.get(path)) if (n > best) { best = n; row.barrioName = name; }
    }
    out.set(path, row);
    if (g.level === 'city') {
      for (const v of Object.keys(VARIANTS)) {
        const items = g.items.filter((r) => inVariant(r, v, s.median));
        if (!items.length) continue;
        const vp = pathOf({ op: g.op, tipo: g.tipo, ciudad: g.ciudad, variant: v });
        out.set(vp, { path: vp, level: 'variant', op: g.op, tipo: g.tipo, ciudad: g.ciudad, variant: v, ...statsOf(items), cityMedian: s.median });
      }
    }
  }
  return out;
}

// Does the website serve this path today, and is it indexable?
//   city:    exists with ≥1 listing, indexable with ≥5
//   barrio:  exists (and indexable) with ≥5
//   variant: exists only when enabled (or retired → noindex) in seo_overrides; indexable when enabled with ≥5
export function pageState(path, inventory, overridesByPath = new Map()) {
  const inv = inventory.get(path) || null;
  const count = inv?.count || 0;
  if (!inv || inv.level === 'country') return { exists: false, indexable: false, count: inv?.count || 0 };
  if (inv.level === 'city') return { exists: count > 0, indexable: count >= MIN_LISTINGS, count };
  if (inv.level === 'barrio') return { exists: count >= MIN_LISTINGS, indexable: count >= MIN_LISTINGS, count };
  const base = overridesByPath.get(pathOf({ op: inv.op, tipo: inv.tipo, ciudad: inv.ciudad })) || {};
  const enabled = (base.enabled_variants || []).includes(inv.variant);
  const retired = (base.retired_variants || []).includes(inv.variant);
  return { exists: (enabled || retired) && count > 0, indexable: enabled && count >= MIN_LISTINGS, count, enabled, retired };
}
