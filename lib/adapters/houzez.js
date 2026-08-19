// Adapter: WordPress + Houzez real-estate theme (raices loteamientos, etc).
// The `property` CPT is exposed at REST base `properties`. Pretty /wp-json/ is
// often blocked, so we use the `?rest_route=` query form. Specs live in
// property_meta (single-element arrays); taxonomy names come via _embed; the
// gallery is a list of media IDs we resolve in one batched /media call.
// Config-driven: api_base (the Houzez site's origin).

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const listCache = new Map();

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const stripHtml = (h) => (h ? String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null);

function base(config) {
  return (config.api_base || config.base_url || '').replace(/\/$/, '');
}
function restUrl(config, route, params = '') {
  return `${base(config)}/?rest_route=${encodeURIComponent(route)}${params}`;
}
// Paraguay free-text price like "Desde: Gs. 780.000" / "US$ 45.000".
function parseMoney(raw) {
  if (!raw) return { price: null, currency: null };
  const s = String(raw).trim();
  if (/consult|conven|a\s*tratar/i.test(s)) return { price: null, currency: null };
  const currency = /usd|u\$s|\bus\$|\bus\b/i.test(s) ? 'USD' : /gs|g\.|₲|guar/i.test(s) ? 'PYG' : /\$/.test(s) ? 'USD' : null;
  const cleaned = s.replace(/[^\d.,]/g, '');
  const intPart = cleaned.replace(/\./g, '').split(',')[0];
  const val = intPart ? Number(intPart) : null;
  return { price: Number.isFinite(val) ? val : null, currency };
}

async function apiJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`houzez ${res.status} @ ${url}`);
  return res.json();
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
    })
  );
  return out;
}

async function getProperties(config) {
  const b = base(config);
  const cached = listCache.get(b);
  if (cached && Date.now() - cached.t < 120000) return cached.props;
  const props = [];
  for (let page = 1; page <= 30; page++) {
    const url = restUrl(config, '/wp/v2/properties', `&per_page=${config.per_page || 100}&page=${page}&_embed`);
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) break;
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) break;
    props.push(...arr);
    const totalPages = Number(res.headers.get('x-wp-totalpages')) || 1;
    if (page >= totalPages) break;
  }
  listCache.set(b, { t: Date.now(), props });
  return props;
}

const meta = (p, key) => {
  const v = p?.property_meta?.[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
};
function termsByTax(p) {
  const groups = p?._embedded?.['wp:term'] || [];
  const by = {};
  for (const g of groups) for (const t of g || []) {
    if (t && t.taxonomy) (by[t.taxonomy] = by[t.taxonomy] || []).push(t.name);
  }
  return by;
}
function featured(p) {
  return p?._embedded?.['wp:featuredmedia']?.[0]?.source_url || null;
}

// Resolve a set of media IDs -> source_url in one batched call.
async function resolveMedia(config, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const map = new Map();
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    try {
      const arr = await apiJson(restUrl(config, '/wp/v2/media', `&include=${chunk.join(',')}&per_page=100&_fields=id,source_url`));
      for (const m of arr) map.set(String(m.id), m.source_url);
    } catch { /* skip chunk */ }
  }
  return map;
}

// Orchestrator contract: { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const props = await getProperties(config);
  const total = props.length;
  const windowProps = props.slice(skip, skip + top);

  const allIds = [];
  for (const p of windowProps) {
    const g = meta(p, 'fave_property_images');
    if (Array.isArray(g)) allIds.push(...g);
    else if (p.property_meta?.fave_property_images) allIds.push(...[].concat(p.property_meta.fave_property_images));
  }
  const mediaMap = await resolveMedia(config, allIds);

  const items = windowProps.map((p) => {
    const tax = termsByTax(p);
    const galleryIds = [].concat(p.property_meta?.fave_property_images || []);
    const gallery = [];
    const feat = featured(p);
    if (feat) gallery.push(feat);
    for (const id of galleryIds) { const u = mediaMap.get(String(id)); if (u && !gallery.includes(u)) gallery.push(u); }
    return {
      id: p.id,
      slug: p.slug,
      link: p.link,
      title: stripHtml(p.title?.rendered),
      description: stripHtml(p.content?.rendered),
      priceRaw: meta(p, 'fave_property_price'),
      address: meta(p, 'fave_property_address'),
      lat: meta(p, 'houzez_geolocation_lat'),
      lng: meta(p, 'houzez_geolocation_long'),
      bedrooms: meta(p, 'fave_property_bedrooms'),
      bathrooms: meta(p, 'fave_property_bathrooms'),
      size: meta(p, 'fave_property_size'),
      land: meta(p, 'fave_property_land'),
      ptype: (tax.property_type || [])[0] || null,
      status: (tax.property_status || [])[0] || null,
      city: (tax.property_city || [])[0] || null,
      area: (tax.property_area || [])[0] || null,
      state: (tax.property_state || [])[0] || null,
      images: gallery,
    };
  });
  return { total, items };
}

function mapListing(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const parsed = parseMoney(it.priceRaw);
  const price = parsed.price;
  // Some Houzez sites (e.g. Century 21 Platinum) store the price as a bare number
  // with the currency in separate meta — fall back to the source's default_currency.
  const currency = parsed.currency || config.default_currency || null;
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const listingType = /alquil|rent/i.test(it.status || '') ? 'rent' : 'sale';
  const ptype = it.ptype || null;
  const isLand = /lote|terreno|land|campo/i.test(ptype || '');
  const size = num(it.size);
  const land = num(it.land);

  const address = it.address || [it.title, it.city].filter(Boolean).join(', ') || it.title || 'Sin dirección';

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: it.link || null,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address,
    seo_title: it.title || null,
    latitude: num(it.lat),
    longitude: num(it.lng),
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(it.bedrooms),
    bathrooms: num(it.bathrooms),
    floor_area: isLand ? null : size,
    covered_area: isLand ? null : size,
    land_area: isLand ? (land ?? size) : land,
    city: it.city || null,
    province: it.state || null,
    neighborhood: it.area || null,
    country: 'Paraguay',
    property_type: ptype,
    description: it.description || null,
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: config.contact_name || null,
    contact_phone: config.contact_phone || null,
    raw_data: { ...it, platform: 'houzez' },
  };

  const images = (it.images || []).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const hashInput = JSON.stringify({
    price, currency, listingType, beds: row.bedrooms, baths: row.bathrooms,
    size, land, lat: row.latitude, lng: row.longitude, title: it.title,
    desc: row.description, imgs: it.images,
  });
  return { external_id: id, row, images, hashInput };
}

export default { fetchPage, mapListing };
