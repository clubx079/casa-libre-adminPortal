// SkyOne Real Estate (Paraguay) — runs on the "PLACE" proptech platform with a
// public JSON API at api.skyone.group.
//   • list:   GET /api/propiedades?page=N&per_page=P  →  { data: [ {feature-only item} ] }
//   • detail: GET /api/propiedad/{id}                 →  full record incl. agent_phone,
//             descripcion, calle/nro_casa, ciudad/distrito/departamento, img, lat/lon
//
// fetchPage pages the list and enriches each item with its detail (bounded
// concurrency); mapListing maps the enriched detail → the Casa Libre `row`.
// Contract: fetchPage → { total, items }; mapListing → { external_id, row, images, hashInput }.

const API = 'https://api.skyone.group';
const PER = 50; // skyone's page size we fetch; the orchestrator's window is sliced out of it
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://portal.skyone.group/', Origin: 'https://portal.skyone.group' };

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch { return null; }
}

async function pool(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const r = await Promise.allSettled(items.slice(i, i + size).map(fn));
    for (const x of r) out.push(x.status === 'fulfilled' ? x.value : null);
  }
  return out.filter(Boolean);
}

function num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Orchestrator contract: return { total, items } for the window [skip, skip+top).
async function fetchPage(cfg, merged, skip, top) {
  const page = Math.floor(skip / PER) + 1;
  const offset = skip % PER;
  const listJson = await getJson(`${API}/api/propiedades?page=${page}&per_page=${PER}`);
  const all = Array.isArray(listJson?.data) ? listJson.data : [];
  const windowItems = all.slice(offset, offset + top);

  // Enrich each list item with its full detail record (agent_phone + description
  // + street live only on the detail endpoint). Fall back to the list item if a
  // detail fetch fails, so a single bad detail never drops the whole page.
  const items = await pool(windowItems, 4, async (it) => {
    const d = await getJson(`${API}/api/propiedad/${encodeURIComponent(it.id)}`);
    const obj = d?.data || d?.propiedad || d;
    return obj && obj.id ? { ...it, ...obj } : it;
  });

  // last page reached → signal end via an exact total; otherwise keep paging.
  const total = all.length < PER ? skip + windowItems.length : Number.MAX_SAFE_INTEGER;
  return { total, items };
}

function mapListing(it, { source, config = {}, pygPerUsd }) {
  const id = String(it.id);
  const listingType = /alquil/i.test(it.venta_alquiler || '') ? 'rent' : 'sale';
  const currency = /usd|u\$|dol/i.test(it.moneda_contrato || '') ? 'USD' : (it.moneda_contrato ? 'PYG' : null);
  const price = num(it.precio);
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const ptype = it.tipoPropiedad || null;
  const isLand = /lote|terreno|campo|fracci|parcela/i.test(ptype || '');
  const built = num(it.m2_cons);
  const landArea = num(it.m2);

  const street = [it.calle, it.nro_casa].filter(Boolean).join(' ').trim();
  const address = [street, it.distrito, it.ciudad].filter(Boolean).join(', ') || it.titulo || 'Sin dirección';

  // agent phone is the listing's own contact; fall back to the office/central number.
  const phone = String(it.agent_phone || it.office_phone || config.contact_phone || '').trim();

  // The API exposes one feature image (`img`). Prefer the full-size (strip `-small`),
  // but keep the -small as a guaranteed-existing fallback so ≥1 image survives.
  const feat = it.img ? String(it.img) : null;
  const full = feat ? feat.replace(/-small(\.\w+)(?:$|\?)/i, '$1') : null;
  const imgs = [full, feat].filter((u, i, a) => u && a.indexOf(u) === i);
  const images = imgs.map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: it.link || `https://portal.skyone.group/propiedad/${id}`,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address,
    seo_title: it.titulo || null,
    latitude: num(it.lat),
    longitude: num(it.lon),
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(it.dormitorios),
    bathrooms: num(it.banios),
    floor_area: isLand ? null : built,
    covered_area: isLand ? null : built,
    land_area: isLand ? (landArea ?? built) : landArea,
    parking_spaces: num(it.garajes),
    city: it.ciudad || null,
    province: it.departamento || null,
    neighborhood: it.distrito || null,
    country: 'Paraguay',
    property_type: ptype,
    description: it.descripcion || null,
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: it.agent_name || config.contact_name || null,
    contact_phone: phone || null,
    raw_data: { ...it, platform: 'skyone' },
  };

  const hashInput = JSON.stringify({
    price, currency, listingType, beds: row.bedrooms, baths: row.bathrooms,
    built, land: landArea, lat: row.latitude, lng: row.longitude,
    title: it.titulo, desc: row.description, img: feat,
  });
  return { external_id: id, row, images, hashInput };
}

export default { fetchPage, mapListing };
