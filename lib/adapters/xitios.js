// Adapter: Xitios Bienes Raíces (xitios.com.sv) — El Salvador agency, custom PHP site.
// No JSON API:
//   • the search /propiedades/buscar?tipo[]=…&categoria[]=VEN|REN&page=N lists ~21 cards
//     per page (title, sale/rent badge, department, area m²/v², rooms, baths, price,
//     main photo, link /propiedad/detalles/<slug>);
//   • each listing page has the municipality line, the description and the gallery
//     (photos whose file name starts with the listing's slug).
// Contact: the agency publishes its WhatsApp (+503 7921-2125) on every page; when the
// description gives the listing's own number ("Información y Citas al 7923-2400") that
// one is used. Development "projects" (tipo INV — towers with many units, no single
// price) are left out: only individual listings.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const BASE = 'https://xitios.com.sv';
const PER_PAGE = 21;
const MAX_IMAGES = 20;
const OFFICE_PHONE = '+50379212125';
const VARA2_M2 = 0.698737;
const TYPES = ['APA', 'BOD', 'CAS', 'RAN', 'OFI', 'TER'];   // not INV (projects)

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const NAMED = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', iquest: '¿', iexcl: '¡', deg: '°', sup2: '²', bull: '•', hellip: '…' };
const text = (html) => String(html ?? '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z]+\d?);/gi, (m, n) => NAMED[n] ?? m)
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// "349 m2" | "740 v2" → m²
export function areaM2(s) {
  const m = String(s || '').match(/([\d,]+(?:\.\d+)?)\s*(m2|m²|v2|v²)/i);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  if (!(v > 0)) return null;
  return Math.round((/v/i.test(m[2]) ? v * VARA2_M2 : v) * 100) / 100;
}

// The listing's type from its title ("Venta de Casa en …", "Alquiler de Apartamento …").
const TYPE_RULES = [
  [/apartamento|apto\b|penthouse|loft/i, 'Departamento'], [/casa|vivienda|chalet/i, 'Casa'], [/terreno|lote\b|lotes\b|solar/i, 'Terreno'],
  [/oficina/i, 'Oficina'], [/bodega|nave|galp[oó]n/i, 'Bodega'], [/local/i, 'Local comercial'], [/edificio|inmueble/i, 'Edificio'],
  [/rancho|finca|quinta|hacienda/i, 'Finca'],
];
export const typeFromTitle = (t) => (TYPE_RULES.find(([re]) => re.test(String(t || ''))) || [null, null])[1];

// A Salvadoran number written in the description (8 digits, starts with 2, 6 or 7).
export function phoneIn(desc) {
  const m = String(desc || '').match(/(?:citas|informaci[oó]n|whats\s*app|llam\w*|cont[aá]ct\w*|tel[eé]fono|cel)[^0-9]{0,25}(?:\+?503[\s-]?)?([267]\d{3})[\s-]?(\d{4})/i);
  return m ? `+503${m[1]}${m[2]}` : null;
}

// One search page → cards.
export function parseCards(html) {
  const out = [];
  for (const block of String(html).split('<!-- ltn__product-item -->').slice(1)) {
    const slug = (block.match(/propiedad\/detalles\/([a-z0-9-]+)/i) || [])[1];
    if (!slug) continue;
    const plot = [...block.matchAll(/<li><span>([^<]*)<\/span>\s*([^<]*)<\/li>/gi)].map((m) => [text(m[1]), text(m[2]).toLowerCase()]);
    const pick = (re) => (plot.find(([, l]) => re.test(l)) || [])[0];
    out.push({
      slug,
      title: text((block.match(/class="product-title"><a[^>]*>([\s\S]*?)<\/a>/i) || [])[1]),
      badge: text((block.match(/<li class="sale-badg">([\s\S]*?)<\/li>/i) || [])[1]),
      location: text((block.match(/flaticon-pin"><\/i>([\s\S]*?)<\/li>/i) || [])[1]),
      built: areaM2(pick(/construcci/)),
      lot: areaM2(pick(/terreno/)),
      beds: num(pick(/habitaci/)),
      baths: num(pick(/ba(?:ñ|n|�)o/)),
      price: num((block.match(/class="product-price">\s*<span>([^<]*)</i) || [])[1]),
      image: (block.match(/<img src="(https:\/\/xitios\.com\.sv\/media\/propiedad\/[^"]+)"/i) || [])[1] || null,
    });
  }
  return out;
}

// One listing page → municipality line, description, gallery.
export function parseDetail(html, slug) {
  const h = String(html);
  const place = text((h.match(/<\/h1>\s*<label>[\s\S]*?<\/span>([\s\S]*?)<\/label>/i) || [])[1]);
  const descHtml = (h.match(/class="content-description">([\s\S]*?)<\/div>\s*<\/div>\s*(?:<!--|<div class="ltn__|<h4)/i) || h.match(/class="content-description">([\s\S]{0,8000}?)(?:Acerca de|<h4)/i) || [])[1] || '';
  const description = text(descHtml);
  const seen = new Set();
  const images = [];
  for (const m of h.matchAll(/https:\/\/xitios\.com\.sv\/media\/propiedad\/\d+\/([a-z0-9-]+)_php[A-Za-z0-9]+\.(?:webp|jpe?g|png)/gi)) {
    if (m[1] !== slug || seen.has(m[0])) continue;
    seen.add(m[0]); images.push(m[0]);
  }
  return { place, description, images };
}

const searchUrl = (base, op, page) => {
  const q = new URLSearchParams();
  for (const t of TYPES) q.append('tipo[]', t);
  if (op === 'venta') q.append('categoria[]', 'VEN');
  else if (op === 'alquiler') q.append('categoria[]', 'REN');
  else { q.append('categoria[]', 'VEN'); q.append('categoria[]', 'REN'); }
  if (page > 1) q.set('page', String(page));
  return `${base}/propiedades/buscar?${q}`;
};

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Xitios ${res.status} @ ${url}`);
  return res.text();
}

// Map pin: the site publishes no coordinates, so geocode the place with OpenStreetMap
// Nominatim (same as the website's publish flow) — the development / colonia named in
// the title + municipality first, then the municipality, then the department.
// Nominatim allows 1 request/s, so calls are spaced; results are cached per query.
const geoCache = new Map();
let lastGeo = 0;
async function nominatim(q) {
  if (geoCache.has(q)) return geoCache.get(q);
  const wait = lastGeo + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeo = Date.now();
  let hit = null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=sv&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'CasaLibre/1.0 (listings@casa-libre.com.sv)' }, signal: AbortSignal.timeout(6000) });
    const j = res.ok ? await res.json() : [];
    if (j[0]) hit = { lat: Number(j[0].lat), lng: Number(j[0].lon) };
  } catch { /* no pin */ }
  geoCache.set(q, hit);
  return hit;
}

// "Venta de Casa en Casas del Bosque PM" → "Casas del Bosque"
export const placeFromTitle = (t) => {
  const m = String(t || '').match(/\ben\s+(.+)$/i);
  return m ? m[1].replace(/\b(PM|PH|[A-Z]{1,3}-?\d+)\b/g, '').replace(/\s+/g, ' ').trim() || null : null;
};

// [municipality, department] from the detail line ("Nuevo Cuscatlán, La Libertad, El
// Salvador") or the card ("La Libertad, El Salvador").
export function placeParts(c) {
  const parts = String(c.place || c.location || '').split(',').map((x) => x.trim()).filter((x) => x && !/el salvador/i.test(x));
  const province = parts.length ? parts[parts.length - 1] : null;
  const city = parts.length >= 2 ? parts[parts.length - 2] : province;
  return { city, province };
}

export async function geocodeListing(c) {
  const { city, province } = placeParts(c);
  const spot = placeFromTitle(c.title);
  const queries = [
    spot && city && `${spot}, ${city}, El Salvador`,
    city && city !== province && `${city}, ${province}, El Salvador`,
    province && `${province}, El Salvador`,
  ].filter(Boolean);
  for (const [i, q] of queries.entries()) {
    const hit = await nominatim(q);
    if (!hit) continue;
    const precision = i === queries.length - 1 ? 'department' : i === 0 && spot ? 'place' : 'municipality';
    if (precision === 'place') return { ...hit, precision };
    // Only the town is known: spread listings sharing it ~100–300 m around the point
    // (stable per listing) so the pins don't sit on top of each other.
    let n = 0;
    for (const ch of String(c.slug || c.title || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    const ang = (n % 360) * Math.PI / 180, r = 0.001 + ((n >>> 9) % 1000) / 1000 * 0.002;
    return { lat: hit.lat + r * Math.sin(ang), lng: hit.lng + r * Math.cos(ang), precision };
  }
  return null;
}

async function poolMap(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

// Orchestrator contract: return { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const base = (config.base_url || BASE).replace(/\/$/, '');
  const op = filters.operacion || config.operacion || 'todas';
  const cards = [];
  let page = Math.floor(skip / PER_PAGE) + 1;
  const offset = skip % PER_PAGE;
  let lastPage = page;
  while (cards.length < offset + top) {
    const html = await get(searchUrl(base, op, page));
    const found = parseCards(html);
    lastPage = Math.max(lastPage, ...[...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])));
    if (!found.length) break;
    cards.push(...found);
    if (page >= lastPage) break;
    page++;
  }
  const window = cards.slice(offset, offset + top);
  await poolMap(window, 3, async (c) => {
    try { Object.assign(c, parseDetail(await get(`${base}/propiedad/detalles/${c.slug}`), c.slug)); } catch { /* card data only */ }
  });
  for (const c of window) {                          // one at a time (Nominatim 1 req/s)
    const g = await geocodeListing(c);
    if (g) Object.assign(c, { lat: g.lat, lng: g.lng, geo_precision: g.precision });
  }
  return { total: lastPage * PER_PAGE, items: window };
}

function mapListing(c, { source, config }) {
  const base = ((config && config.base_url) || BASE).replace(/\/$/, '');
  const listingType = /alquiler|renta/i.test(`${c.badge} ${c.title}`) ? 'rent' : 'sale';
  const type = typeFromTitle(c.title);
  const isLand = type === 'Terreno';
  // "Nuevo Cuscatlán, La Libertad, El Salvador" (detail) or "La Libertad, El Salvador" (card)
  const { city, province } = placeParts(c);
  const imgs = [...new Set([...(c.images || []), c.image].filter(Boolean))].slice(0, MAX_IMAGES)
    .map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const row = {
    source_id: source.id,
    external_id: c.slug,
    external_url: `${base}/propiedad/detalles/${c.slug}`,
    origin: 'scraped',
    slug: `xitios-${c.slug}`.slice(0, 120),
    address: [city, province].filter(Boolean).join(', ') || 'El Salvador',
    seo_title: c.title || null,
    latitude: Number.isFinite(c.lat) ? c.lat : null,
    longitude: Number.isFinite(c.lng) ? c.lng : null,
    price: c.price,
    currency: 'USD',
    price_usd: c.price,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: c.beds,
    bathrooms: c.baths,
    covered_area: isLand ? null : c.built,
    floor_area: isLand ? c.lot : (c.built || c.lot),
    land_area: c.lot,
    city,
    province,
    neighborhood: city,
    country: 'El Salvador',
    property_type: type,
    description: c.description || c.title || null,
    contact_name: 'Xitios Bienes Raíces',
    contact_phone: phoneIn(c.description) || (config && config.contact_phone) || OFFICE_PHONE,
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    raw_data: c,
  };
  const hashInput = JSON.stringify({ price: c.price, listingType, type, beds: c.beds, baths: c.baths, built: c.built, lot: c.lot, place: row.address, desc: row.description, imgs: imgs.map((x) => x.source_url) });
  return { external_id: c.slug, row, images: imgs, hashInput };
}

export default { fetchPage, mapListing };
