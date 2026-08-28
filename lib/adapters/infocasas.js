// Adapter: InfoCasas Paraguay (https://www.infocasas.com.py) — public GraphQL
// bulk API + per-listing detail-page phone enrichment.

import { searchListing, fetchPhone } from '../infocasasClient.js';

const OP_MAP = { 1: 'sale', 2: 'rent', 4: 'rent' };           // 4 = alquiler temporal → rent
const PT_MAP = {
  1: 'casa', 2: 'departamento', 3: 'terreno', 4: 'local comercial', 5: 'oficina',
  6: 'campo', 8: 'cochera', 9: 'local comercial', 10: 'edificio', 12: 'depósito', 13: 'otro', 14: 'dúplex',
};
const LAND_PT = new Set(['3', '6']);                           // terreno, campo
const num = (v) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : null; };

function resolveCurrency(price) {
  const id = price?.currency?.id != null ? String(price.currency.id) : null;
  const nm = String(price?.currency?.name || '');
  if (id === '1' || /\$|US/i.test(nm)) return 'USD';
  return 'PYG';
}

function mapListing(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const opId = it.operation_type?.id != null ? String(it.operation_type.id) : null;
  const listingType = OP_MAP[opId] || 'sale';
  const ptId = it.property_type?.id != null ? String(it.property_type.id) : null;
  const isLand = ptId ? LAND_PT.has(ptId) : false;
  const ptype = (ptId && PT_MAP[ptId]) || (it.property_type?.name || '').toLowerCase() || null;

  const currency = resolveCurrency(it.price);
  const price = num(it.price?.amount);
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const m2 = num(it.m2);
  const built = num(it.m2Built);
  const terrain = num(it.m2Terrain);
  const address = it.address || it.title || [it.neighborhood?.name, it.estate?.name].filter(Boolean).join(', ') || 'Sin dirección';

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: it.link ? `https://www.infocasas.com.py/${it.link}` : null,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address,
    seo_title: it.title || null,
    latitude: num(it.latitude),
    longitude: num(it.longitude),
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(it.bedrooms),
    bathrooms: num(it.bathrooms),
    parking_spaces: num(it.garage),
    floor_area: isLand ? null : (built || m2),
    covered_area: isLand ? null : (built || m2),
    land_area: isLand ? (terrain || m2) : (terrain || null),
    city: it.legacy_city || it.estate?.name || null,
    province: it.estate?.name || null,
    neighborhood: it.neighborhood?.name || it.legacy_neighborhood || null,
    country: 'Paraguay',
    property_type: ptype,
    description: null,                     // search API omits description; detail page has it (optional future enrichment)
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: it.contact_name || it.seller?.name || null,
    contact_phone: it.contact_phone || null,   // filled by fetchPage phone enrichment
    raw_data: { ...it, platform: 'infocasas' },
  };

  const cdn = (u) => (u && u.startsWith('http') ? u : (u ? `https://cdn2.infocasas.com.uy${u.startsWith('/') ? '' : '/'}${u}` : null));
  const seen = new Set();
  const images = (Array.isArray(it.images) ? it.images : [])
    .map((im) => cdn(im.image)).filter((u) => u && !seen.has(u) && seen.add(u))
    .map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));

  const hashInput = JSON.stringify({
    price, currency, listingType, ptype, beds: row.bedrooms, baths: row.bathrooms,
    built, terrain, lat: row.latitude, lng: row.longitude, title: it.title,
    imgs: images.map((x) => x.source_url),
  });
  return { external_id: id, row, images, hashInput };
}

const PER = 100;
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  }));
}

async function fetchPage(config, filters, skip, top) {
  // Merge shard params (config.shard or filters.params) with any run filters.
  const params = { ...(config.shard || {}), ...(filters.params || {}) };
  if (filters.order != null) params.order = filters.order;
  // Map absolute [skip, skip+top) to InfoCasas 1-based pages of PER.
  const start = skip;
  const end = skip + top;
  const firstPage = Math.floor(start / PER) + 1;
  const lastPage = Math.floor((end - 1) / PER) + 1;
  let all = [];
  for (let pg = firstPage; pg <= lastPage; pg++) {
    const { items, count } = await searchListing({ params, first: PER, page: pg });
    all = all.concat(items);
    if (count < PER) break;           // reached the end of this slice
  }
  // Trim to the exact window and enrich phones.
  const offset = start - (firstPage - 1) * PER;
  const windowItems = all.slice(offset, offset + top).filter((x) => x && x.id);
  await pool(windowItems, 5, async (it) => {
    const { phone, name } = await fetchPhone(it.link);
    it.contact_phone = phone; it.contact_name = name || it.contact_name || null;
  });
  // `total` is unreliable upstream; report a large sentinel so the loop is bounded
  // ONLY by filters.limit and by an empty page (handled in runJob via items.length===0).
  const total = windowItems.length < top ? skip + windowItems.length : Number.MAX_SAFE_INTEGER;
  return { total, items: windowItems };
}

export default { fetchPage, mapListing };
