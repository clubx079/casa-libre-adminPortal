// Adapter: Aurora Inmobiliaria (https://aurora.com.py) — React SPA backed by a
// custom Laravel REST API at https://backend.aurora.com.py/api (no auth).
// Two datasets: `fractions` (loteamientos / land developments, the core product —
// 328) and `immovables` (built properties — 14). Choose via config.dataset.
// Currency is PYG (implicit in the site). Fraction prices are monthly cuotas.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const WA_PHONE = '595971227558'; // site-wide WhatsApp (no per-listing contact)
const listCache = new Map();

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const clean = (s) => (s ? String(s).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim() : null);

function apiBase(config) {
  return (config.api_base || 'https://backend.aurora.com.py/api').replace(/\/$/, '');
}
function storageBase(config) {
  return (config.storage_base || 'https://backend.aurora.com.py/storage').replace(/\/$/, '');
}
function dataset(config) {
  return config.dataset === 'immovables' ? 'immovables' : 'fractions';
}

async function apiJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`aurora ${res.status} @ ${url}`);
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

// Walk Laravel pagination to collect the full light list (cached).
async function getList(config) {
  const base = apiBase(config);
  const ds = dataset(config);
  const cacheKey = base + '|' + ds;
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.t < 120000) return cached.items;

  const all = [];
  let page = 1;
  let lastPage = 1;
  do {
    const env = await apiJson(`${base}/${ds}?page=${page}`);
    const rows = Array.isArray(env) ? env : env.data || [];
    all.push(...rows);
    lastPage = Array.isArray(env) ? 1 : Number(env.last_page) || 1;
    page++;
  } while (page <= lastPage && page <= 40);

  listCache.set(cacheKey, { t: Date.now(), items: all });
  return all;
}

// Orchestrator contract: { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const base = apiBase(config);
  const ds = dataset(config);
  const list = await getList(config);
  const total = list.length;
  const windowItems = list.slice(skip, skip + top);
  const items = await pool(windowItems, 4, async (li) => {
    // detail: fractions keyed by cod_fraccion, immovables by id
    const key = ds === 'fractions' ? li.cod_fraccion ?? li.id : li.id;
    try {
      const detail = await apiJson(`${base}/${ds}/${key}`);
      return { ...li, ...detail };
    } catch {
      return li;
    }
  });
  return { total, items };
}

function images(it, config) {
  const base = storageBase(config);
  const arr = Array.isArray(it.image) ? it.image : [];
  return arr
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((im) => im.route)
    .filter(Boolean)
    .map((r) => (r.startsWith('http') ? r : `${base}/${r.replace(/^\//, '')}`));
}

function mapFraction(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const price = num(it.cuota_minima) ?? num(it.precio_minimo);
  const currency = 'PYG';
  const priceUsd = price != null ? Math.round(price / (pygPerUsd || 7300)) : null;

  const lat = num(it.latitude) ?? num(it.latciudad);
  const lng = num(it.longitude) ?? num(it.longciudad);
  const address = [it.nombre, it.ciudad, it.nombre_distrito, it.departamento]
    .filter((x) => x && String(x).trim()).join(', ') || it.nombre || 'Loteamiento';

  const features = [];
  if (it.cantidad_lotes) features.push(`${it.cantidad_lotes} lotes`);
  if (it.agotado) features.push('Agotado');

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: `${(config.base_url || 'https://aurora.com.py').replace(/\/$/, '')}/loteamientos/${it.cod_fraccion ?? id}`,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address,
    seo_title: it.nombre || null,
    latitude: lat,
    longitude: lng,
    price,
    currency,
    price_usd: priceUsd,
    listing_type: 'sale',
    price_period: 'month', // fraction prices are monthly installments (cuotas)
    bedrooms: null,
    bathrooms: null,
    floor_area: null,
    covered_area: null,
    land_area: null, // fraction-level total not published; per-lot superficie varies
    city: it.ciudad || null,
    province: it.departamento || null,
    neighborhood: it.nombre_distrito || null,
    country: 'Paraguay',
    property_type: 'loteamiento',
    description: clean(it.descripcion) || clean(it.descripcion_ciudad) || null,
    features,
    status: 'published',
    property_status: it.agotado ? 'sold' : 'available',
    admin_status: 'active',
    contact_phone: WA_PHONE,
    raw_data: { ...it, platform: 'aurora', dataset: 'fractions' },
  };

  const imgs = images(it, config).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const hashInput = JSON.stringify({
    price, lotes: it.cantidad_lotes, lat, lng, nombre: it.nombre,
    desc: row.description, imgs: imgs.map((x) => x.source_url),
  });
  return { external_id: id, row, images: imgs, hashInput };
}

function mapImmovable(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const price = num(it.precio);
  const currency = 'PYG';
  const priceUsd = price != null ? Math.round(price / (pygPerUsd || 7300)) : null;
  const area = num(it.superficie);
  const listingType = String(it.operacion || it.tipo || '').toLowerCase().includes('alquil') ? 'rent' : 'sale';
  const isLand = /terreno|lote/i.test(it.tipo_inmueble || it.tipo || '');

  const address = [it.nombre_comercial, it.direccion, it.ciudad, it.departamento]
    .filter((x) => x && String(x).trim()).join(', ') || it.nombre_comercial || 'Sin dirección';

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: `${(config.base_url || 'https://aurora.com.py').replace(/\/$/, '')}/propiedades/${id}`,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address,
    seo_title: it.nombre_comercial || null,
    latitude: num(it.latitude),
    longitude: num(it.longitude),
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(it.rooms),
    bathrooms: num(it.bathroom),
    floor_area: isLand ? null : area,
    covered_area: isLand ? null : area,
    land_area: isLand ? area : null,
    city: it.ciudad || null,
    province: it.departamento || null,
    neighborhood: null,
    country: 'Paraguay',
    property_type: it.tipo_inmueble || 'propiedad',
    description: clean(it.descripcion) || clean(it.resumen) || null,
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_phone: WA_PHONE,
    raw_data: { ...it, platform: 'aurora', dataset: 'immovables' },
  };

  const imgs = images(it, config).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const hashInput = JSON.stringify({
    price, beds: row.bedrooms, baths: row.bathrooms, area,
    lat: row.latitude, lng: row.longitude, nombre: it.nombre_comercial,
    desc: row.description, imgs: imgs.map((x) => x.source_url),
  });
  return { external_id: id, row, images: imgs, hashInput };
}

function mapListing(it, ctx) {
  return dataset(ctx.config) === 'immovables' ? mapImmovable(it, ctx) : mapFraction(it, ctx);
}

export default { fetchPage, mapListing };
