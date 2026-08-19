// Adapter: Century 21 Paraguay (custom Symfony site).
// No JSON API — each /busqueda results page embeds the listings as JSON in
// `window.REP_LOG_APP_PROPS`. We fetch pages (10 listings each) and extract it.

const PER_PAGE = 10;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const slug = (s) => String(s).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

// Pull a top-level value out of the REP_LOG_APP_PROPS object literal.
function extractValue(blob, key) {
  const re = new RegExp('[\\n\\r\\t ]' + key + ':\\s*');
  const m = re.exec(blob);
  if (!m) return null;
  let start = m.index + m[0].length;
  const ch = blob[start];
  if (ch !== '[' && ch !== '{') {
    return blob.slice(start).split(/[,\n\r]/)[0].trim();
  }
  let depth = 0, instr = false, esc = false;
  for (let i = start; i < blob.length; i++) {
    const c = blob[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && instr) { esc = true; continue; }
    if (c === '"') { instr = !instr; continue; }
    if (instr) continue;
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return blob.slice(start, i + 1); }
  }
  return null;
}

function buildUrl(config, filters, pageNum) {
  const base = (config.base_url || 'https://century21.com.py').replace(/\/$/, '');
  let path = '/busqueda';
  if (filters.operacion) path += `/operacion_${filters.operacion}`;
  if (filters.ubicacion) path += `/en-estado_${slug(filters.ubicacion)}`;
  if (pageNum > 1) path += `/pagina_${pageNum}`;
  return base + path;
}

async function fetchAndParse(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' } });
  if (!res.ok) throw new Error(`Century21 ${res.status} @ ${url}`);
  const html = await res.text();
  const i = html.indexOf('window.REP_LOG_APP_PROPS');
  if (i < 0) return { props: [], total: 0 };
  const blob = html.slice(i);
  const arr = extractValue(blob, 'propiedades');
  const total = num(extractValue(blob, 'numPropiedades')) || 0;
  const props = arr ? JSON.parse(arr) : [];
  return { props, total };
}

// Orchestrator contract: return { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const startPage = Math.floor(skip / PER_PAGE) + 1;
  const pagesNeeded = Math.ceil(top / PER_PAGE);
  const items = [];
  let total = 0;
  for (let p = 0; p < pagesNeeded; p++) {
    const pageNum = startPage + p;
    const { props, total: t } = await fetchAndParse(buildUrl(config, filters, pageNum));
    total = t || total;
    if (!props.length) break;
    items.push(...props);
    if (items.length >= top) break;
    if ((pageNum) * PER_PAGE >= total) break; // reached the end
  }
  return { total, items: items.slice(0, top) };
}

function mapListing(c, { source, baseUrl, config, pygPerUsd }) {
  const id = String(c.id);
  const moneda = c.moneda || null;
  const price = num(c.precio);
  const secCur = c.monedaSecundaria || null;
  const secPrice = num(c.precioSecundario);
  let priceUsd = null;
  if (moneda === 'USD') priceUsd = price;
  else if (secCur === 'USD' && secPrice != null) priceUsd = Math.round(secPrice);
  else if (price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const listingType = c.tipoOperacion === 'renta' ? 'rent' : 'sale';
  const isLand = (c.tipoPropiedad || '').toLowerCase().includes('terreno') || (c.subTipoPropiedad || '').toLowerCase().includes('terreno');

  const address = [c.calle, c.numero, c.colonia, c.municipio, c.estado, c.pais]
    .filter((x) => x !== null && x !== undefined && String(x).trim() !== '')
    .join(', ') || c.encabezado || 'Sin dirección';

  // active features from caracteristicasJSON
  let features = [];
  try {
    const cj = typeof c.caracteristicasJSON === 'string' ? JSON.parse(c.caracteristicasJSON) : c.caracteristicasJSON;
    if (cj && Array.isArray(cj.campos)) features = cj.campos.filter((f) => f && f.valor).map((f) => f.label || f.nombre);
  } catch { /* ignore */ }

  const base = (config.base_url || baseUrl || 'https://century21.com.py').replace(/\/$/, '');

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: c.urlCorrecta ? base + c.urlCorrecta : null,
    origin: 'scraped',
    slug: `century21-${id}`,
    address,
    seo_title: c.encabezado || null,
    latitude: num(c.lat),
    longitude: num(c.lon),
    price,
    currency: moneda,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(c.recamaras),
    bathrooms: num(c.banios),
    floor_area: num(c.m2C) || num(c.m2T),
    covered_area: num(c.m2C),
    land_area: isLand ? num(c.m2T) : null,
    parking_spaces: num(c.estacionamientos),
    city: c.municipio || null,
    province: c.estado || null,
    neighborhood: c.colonia || null,
    country: c.pais || 'Paraguay',
    property_type: c.subTipoPropiedad || c.tipoPropiedad || null,
    description: c.descripcion || null,
    features,
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: c.nombreAsesor || c.nombre || null,
    contact_phone: c.whatsAppAsesor || c.celularAsesor || c.telefonoAsesor || c.telefono || null,
    raw_data: c,
  };

  const imgs = (c.fotosArray || [])
    .slice()
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))
    .map((f, i) => ({ source_url: f.large, position: i, is_feature: i === 0 }))
    .filter((x) => x.source_url);

  const hashInput = JSON.stringify({
    price, moneda, listingType, beds: row.bedrooms, baths: row.bathrooms,
    area: row.floor_area, address, desc: row.description, imgs: imgs.map((x) => x.source_url),
  });

  return { external_id: id, row, images: imgs, hashInput };
}

export default { fetchPage, mapListing };
