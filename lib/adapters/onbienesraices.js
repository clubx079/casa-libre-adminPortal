// Adapter: ON Bienes Raíces (https://onbienesraices.com.py) — Next.js frontend
// backed by a public REST API at https://api.proptech.com.py (no auth).
// The list endpoint returns every active property in one call; the per-id detail
// endpoint adds description, coordinates and the agent phone.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const listCache = new Map(); // apiBase -> { t, items }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const stripHtml = (h) => (h ? String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : null);

function apiBase(config) {
  return (config.api_base || 'https://api.proptech.com.py').replace(/\/$/, '');
}

async function apiJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`onbienesraices ${res.status} @ ${url}`);
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

async function getList(config) {
  const base = apiBase(config);
  const cached = listCache.get(base);
  if (cached && Date.now() - cached.t < 120000) return cached.items;
  const data = await apiJson(`${base}/api/public/properties`);
  const items = Array.isArray(data) ? data : data?.items || data?.data || [];
  listCache.set(base, { t: Date.now(), items });
  return items;
}

// Orchestrator contract: { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const base = apiBase(config);
  const list = await getList(config);
  const total = list.length;
  const windowItems = list.slice(skip, skip + top);
  const items = await pool(windowItems, 4, async (li) => {
    try {
      const detail = await apiJson(`${base}/api/public/properties/${li.id}`);
      // list carries cityName (null in detail); detail carries description/lat/lng/agent phone
      return { ...detail, cityName: li.cityName ?? detail.cityName, galleryImages: (detail.galleryImages?.length ? detail.galleryImages : li.galleryImages) || [] };
    } catch {
      return li;
    }
  });
  return { total, items };
}

function imageUrls(it, base) {
  const gallery = Array.isArray(it.galleryImages) ? it.galleryImages : [];
  const urls = gallery
    .slice()
    .sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0))
    .map((g) => g.url)
    .filter(Boolean)
    .map((u) => (u.startsWith('http') ? u : base + (u.startsWith('/') ? u : '/' + u)));
  if (!urls.length && it.featuredImage) {
    const f = it.featuredImage;
    urls.push(f.startsWith('http') ? f : base + (f.startsWith('/') ? f : '/' + f));
  }
  return [...new Set(urls)];
}

function mapListing(it, { source, config, pygPerUsd }) {
  const base = apiBase(config);
  const id = String(it.id);
  const currency = it.currencyCode || null;
  const price = num(it.price);
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const listingType = String(it.operacion || '').toUpperCase() === 'RENT' ? 'rent' : 'sale';
  const ptypeName = it.propertyTypeName || null;
  const isLand = /terreno|lote|campo/i.test(ptypeName || '');
  const area = num(it.area);
  const lot = num(it.lotSize);

  const agent = it.agent || {};
  const contactName = it.agentName || [agent.firstName, agent.lastName].filter(Boolean).join(' ') || null;

  const address = [it.address, it.cityName, it.state, it.countryName].filter((x) => x && String(x).trim()).join(', ') || it.title || 'Sin dirección';

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: it.slug ? `${(config.base_url || 'https://onbienesraices.com.py').replace(/\/$/, '')}/propiedades/${it.slug}` : null,
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
    parking_spaces: num(it.parkingSpaces),
    floor_area: isLand ? null : area,
    covered_area: isLand ? null : area,
    land_area: isLand ? (lot || area) : lot, // rural lots sometimes send lotSize:0 -> fall back to area
    city: it.cityName || null,
    province: it.state || null,
    neighborhood: it.neighborhoodName || it.zone || null,
    country: it.countryName || 'Paraguay',
    property_type: ptypeName,
    description: stripHtml(it.description),
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: contactName || null,
    contact_phone: agent.phone || null,
    raw_data: it,
  };

  const images = imageUrls(it, base).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const hashInput = JSON.stringify({
    price, currency, listingType, beds: row.bedrooms, baths: row.bathrooms,
    area, lot, lat: row.latitude, lng: row.longitude, title: it.title,
    desc: row.description, imgs: images.map((x) => x.source_url),
  });
  return { external_id: id, row, images, hashInput };
}

export default { fetchPage, mapListing };
