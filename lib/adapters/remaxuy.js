// Adapter: RE/MAX Uruguay (remax.com.uy) — Angular SPA backed by the public
// "redremax" JSON API (same platform family as RE/MAX Argentina):
//   GET https://api-ar.redremax.com/remaxweb-uy/api/listings/findAll
//       ?page=<0-based>&pageSize=<n>&sort=-createdAt&filterCount=0
// Response envelope: { data: { data:[...], page, pageSize, totalPages, totalItems }, code, message }
//
// Unlike RE/MAX Bolivia, the agent phone is present in the LIST payload
// (associate.phones[]), so NO per-listing detail fetch is needed — the whole run
// is a handful of paged API calls. Images are on the CloudFront CDN:
//   https://d1acdg20u0pmxj.cloudfront.net/<photo.value>

const API_BASE = 'https://api-ar.redremax.com/remaxweb-uy';
const IMG_BASE = 'https://d1acdg20u0pmxj.cloudfront.net';
const SITE_BASE = 'https://www.remax.com.uy';
const PER_PAGE = 24;
const MAX_IMAGES = 15;
const UYU_PER_USD = 40; // offline fallback for the rare UYU-priced listing (mostly USD)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : (n === 0 ? 0 : null);
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA, Origin: SITE_BASE, Referer: `${SITE_BASE}/` },
  });
  if (!res.ok) throw new Error(`RemaxUY ${res.status} @ ${url}`);
  return res.json();
}

// Orchestrator contract: return { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const startPage = Math.floor(skip / PER_PAGE); // API pages are 0-based
  const pagesNeeded = Math.ceil(top / PER_PAGE);
  // Optional operation filter: filters.operation 'sale' | 'rent' → operationId 1 | 2.
  const opId = filters.operation === 'sale' ? 1 : filters.operation === 'rent' ? 2 : null;
  const opParam = opId ? `&in:operationId=${opId}` : '';

  const items = [];
  let total = 0;
  for (let i = 0; i < pagesNeeded; i++) {
    const page = startPage + i;
    const url = `${API_BASE}/api/listings/findAll?page=${page}&pageSize=${PER_PAGE}&sort=-createdAt&filterCount=0${opParam}`;
    const d = await fetchJson(url);
    const wrap = d.data || {};
    total = wrap.totalItems || total;
    const data = wrap.data || [];
    if (!data.length) break;
    items.push(...data);
    if (items.length >= top) break;
    if (page >= (wrap.totalPages || 1) - 1) break;
  }
  return { total, items: items.slice(0, top) };
}

// "La Blanqueada, La Blanqueada, Montevideo" → { neighborhood, city, province }
function splitAddress(addressInfo) {
  const parts = String(addressInfo || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { neighborhood: null, city: null, province: null };
  const province = parts[parts.length - 1];      // department (Montevideo, Canelones…)
  const neighborhood = parts[0];
  const city = province;                          // department doubles as the searchable "city"
  return { neighborhood, city, province };
}

const TYPE_LABELS = {
  departamento_estandar: 'Departamento', departamento: 'Departamento', apartamento: 'Departamento',
  casa: 'Casa', ph: 'PH', terreno: 'Terreno', lote: 'Terreno', campo: 'Campo', chacra: 'Chacra',
  local_comercial: 'Local comercial', local: 'Local comercial', oficina: 'Oficina',
  galpon: 'Galpón', edificio: 'Edificio', hotel: 'Hotel', cochera: 'Cochera',
};

function bestPhone(associate) {
  const list = [
    ...(associate?.phones || []),
    ...(associate?.office?.phones || []),
  ];
  const primary = list.find((p) => p.primary && p.value) || list.find((p) => p.value);
  return primary ? String(primary.value).replace(/\s+/g, ' ').trim() : null;
}

function mapListing(c, { source, config }) {
  const type = c.type?.value || null;
  const typeLabel = TYPE_LABELS[type] || (type ? type.replace(/_/g, ' ') : null);
  const isLand = /terreno|lote|campo|chacra/i.test(type || '');

  const opVal = (c.operation?.value || '').toLowerCase();
  const listingType = opVal === 'rent' || opVal === 'alquiler' ? 'rent' : 'sale';

  const currency = (c.currency?.value || 'USD').toUpperCase();
  const price = num(c.price);
  const priceUsd = currency === 'USD'
    ? price
    : currency === 'UYU' && price ? Math.round(price / UYU_PER_USD) : null;

  const { neighborhood, city, province } = splitAddress(c.addressInfo);

  const coords = Array.isArray(c.location?.coordinates) ? c.location.coordinates : [];
  const longitude = num(coords[0]);
  const latitude = num(coords[1]);

  // bedrooms: no dedicated field — parse from the title ("3 DORMITORIOS", "1 dorm").
  const bedM = String(c.title || '').match(/(\d+)\s*(?:dormitorio|dorm|dorm\.)/i);
  const bedrooms = bedM ? Number(bedM[1]) : null;

  const covered = num(c.dimensionCovered);
  const built = num(c.dimensionTotalBuilt);
  const land = num(c.dimensionLand);

  const imgs = (c.photos || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .slice(0, MAX_IMAGES)
    .map((p, i) => ({ source_url: p.value ? `${IMG_BASE}/${p.value}` : null, position: i, is_feature: i === 0 }))
    .filter((x) => x.source_url);

  const external_id = String(c.id || c.internalId);
  const slug = c.slug ? String(c.slug) : external_id;

  const row = {
    source_id: source.id,
    external_id,
    external_url: `${SITE_BASE}/listings/${slug}`,
    origin: 'scraped',
    slug: `remaxuy-${external_id}`,
    address: c.displayAddress || [neighborhood, city].filter(Boolean).join(', ') || 'Sin dirección',
    latitude,
    longitude,
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms,
    bathrooms: num(c.bathrooms),
    floor_area: built || covered || (isLand ? land : null),
    covered_area: covered,
    land_area: isLand ? (land || built) : land,
    total_rooms: num(c.totalRooms),
    city,
    province,
    neighborhood,
    country: 'Uruguay',
    property_type: typeLabel,
    description: c.title || null,
    contact_name: c.associate?.name || null,
    contact_phone: bestPhone(c.associate),
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    raw_data: c,
  };

  const hashInput = JSON.stringify({
    price, currency, listingType, beds: row.bedrooms, baths: row.bathrooms,
    area: row.floor_area, address: row.address, phone: row.contact_phone,
    imgs: imgs.map((x) => x.source_url),
  });

  return { external_id, row, images: imgs, hashInput };
}

export default { fetchPage, mapListing };
