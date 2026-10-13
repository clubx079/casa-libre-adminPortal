// Adapter: RE/MAX El Salvador (remax-elsalvador.com) — RE/MAX Caribbean & Central
// America platform (ASP.NET MVC). No JSON API:
//   • the results page /showing-properties-in/el-salvador/<for-sale|for-lease>/newest-listings
//     lists 52 cards per page; page 1 is a GET, further pages are the site's own search
//     POST (hidden form fields ax/bx/cx/dx + anti-forgery token + cookie) returning
//     { ModelString: <cards html> };
//   • each listing's detail page (/<listing id>) has a schema.org RealEstateListing
//     (JSON-LD: name, description, price, address), a "Listing details" table (type,
//     contract, beds, baths, sizes), the map coordinates and the photo gallery.
// Agent and office phones are deliberately hidden behind the site's "reveal contact"
// check — we do NOT get around it, so contact_phone stays empty (listings are held in
// Quarantine as 'no_contact' until a contact is decided). Sizes come in m² or varas².

const PER_PAGE = 52;
const MAX_IMAGES = 20;
const VARA2_M2 = 0.698737;   // 1 vara cuadrada (El Salvador) in m²
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const BASE = 'https://www.remax-elsalvador.com';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
// HTML entities the site leaves in its texts (accents, ñ, dashes, quotes…).
const NAMED = {
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', iquest: '¿', iexcl: '¡', ordm: 'º', ordf: 'ª', deg: '°', sup2: '²', sup3: '³',
  ndash: '–', mdash: '—', hellip: '…', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', laquo: '«', raquo: '»', bull: '•', middot: '·',
  quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', times: '×', euro: '€', copy: '©', reg: '®', amp: '&',
};
const decode = (s) => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z]+\d?);/gi, (m, n) => NAMED[n] ?? m)
  .replace(/\r\n?/g, '\n').replace(/�/g, '').trim();

// "387.19 Sq. Mt." | "3,772.40 Sq. Vr." → m² (null when 0 / missing)
export function areaM2(text) {
  const m = String(text || '').match(/([\d,]+(?:\.\d+)?)\s*Sq\.?\s*(Mt|Vr|Ft)/i);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  if (!(v > 0)) return null;
  const unit = m[2].toLowerCase();
  return Math.round((unit === 'vr' ? v * VARA2_M2 : unit === 'ft' ? v * 0.092903 : v) * 100) / 100;
}

// The site's English property types → the Spanish types the Casa Libre site uses.
const TYPES = [
  [/lot|land/i, 'Terreno'], [/apartment|condo/i, 'Departamento'], [/house|villa|home/i, 'Casa'],
  [/office/i, 'Oficina'], [/warehouse|industrial|bodega/i, 'Bodega'], [/commercial|retail|local/i, 'Local comercial'],
  [/building/i, 'Edificio'], [/farm|ranch|finca/i, 'Finca'], [/duplex/i, 'Dúplex'],
];
export const mapType = (t) => (TYPES.find(([re]) => re.test(String(t || ''))) || [null, t || null])[1];

const contractPath = (op) => (String(op || '').match(/rent|lease|alquiler|renta/i) ? 'for-lease' : 'for-sale');
const listUrl = (config, op) => `${(config.base_url || BASE).replace(/\/$/, '')}/showing-properties-in/el-salvador/${contractPath(op)}/newest-listings`;

const cardIds = (html) => [...new Set([...String(html).matchAll(/href="\/(\d{9,15})"/g)].map((m) => m[1]))];

// Page 1 (GET) also gives the session cookie + the hidden search form for the POSTs.
async function openSearch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`RemaxSV ${res.status} @ ${url}`);
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const html = await res.text();
  const val = (id) => (html.match(new RegExp(`<input[^>]*id="${id}"[^>]*value="([^"]*)"`)) || [])[1] ?? '';
  const sel = (id) => {
    const m = html.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`));
    const s = m && m[0].match(/<option[^>]*selected[^>]*value="([^"]*)"|<option[^>]*value="([^"]*)"[^>]*selected/);
    return s ? (s[1] ?? s[2]) : '';
  };
  const form = {
    ax: val('ax'), bx: val('bx'), cx: val('cx'), dx: val('dx'), keyword: '', propertyTypeID: sel('propertyTypeID'),
    ContractTypeID: sel('ContractTypeID'), sortType: sel('sortType'), countryID: val('countryID'), bethrooms: sel('bethrooms'),
    bathrooms: sel('bathrooms'), minprice: val('minprice'), maxprice: val('maxprice'), generalLocationID: sel('generalLocationID'),
    __RequestVerificationToken: (html.match(/name="__RequestVerificationToken" type="hidden" value="([^"]*)"/) || [])[1] || '',
  };
  const total = num((html.match(/Total properties:\s*([\d,]+)/i) || [])[1]) || 0;
  return { cookie, form, total, ids: cardIds(html) };
}

async function nextPage(url, s, page) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, cookie: s.cookie, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ ...s.form, page: String(page) }),
  });
  if (!res.ok) throw new Error(`RemaxSV page ${page}: ${res.status}`);
  const j = await res.json().catch(() => ({}));
  return cardIds(j.ModelString || '');
}

// Everything on one listing's detail page.
export function parseDetail(html, id) {
  const ldRaw = (String(html).match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/) || [])[1];
  let ld = {};
  try { ld = JSON.parse(ldRaw); } catch { ld = {}; }
  const facts = {};
  for (const m of String(html).matchAll(/>\s*([A-Za-z][A-Za-z ./]+):\s*<[^>]*>\s*(?:<[^>]*>\s*)*([^<]{1,80})/g)) {
    const k = m[1].trim();
    if (!(k in facts)) facts[k] = decode(m[2]).replace(/\s*-\s*$/, '');
  }
  const coords = (String(html).match(/maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)/) || []);
  // The gallery = every photo above the "Properties for sale in …" (similar listings)
  // section. Not filtered by listing id: some listings reuse a sibling listing's photos.
  const page = String(html);
  const cut = page.search(/Properties for (?:sale|lease|rent) in|Propiedades en (?:venta|alquiler) en|Similar properties/i);
  const gallery = cut > 0 ? page.slice(0, cut) : page;
  const seen = new Set();
  const images = [];
  for (const m of gallery.matchAll(/https:\/\/(?:remaxcaribbeanandcentralamerica\.azureedge\.net\/images|images\.remax-ccamls\.com)\/([^"'()<>]+?\.(?:jpe?g|png|webp))/gi)) {
    const path = m[1];
    if (cut <= 0 && !path.startsWith(`${id}/`)) continue;          // no section marker: own photos only
    const file = decodeURIComponent(path.split('/').pop()).toLowerCase();
    if (seen.has(file)) continue;
    seen.add(file);
    images.push(m[0].replace(/ /g, '%20'));
  }
  const addr = ld.about?.address || {};
  const parts = decode(addr.streetAddress).split(',').map((x) => x.trim()).filter(Boolean);
  return {
    id, url: ld.url || null, title: decode(ld.name), description: decode(ld.description),
    price: num(ld.offers?.price), currency: ld.offers?.priceCurrency || 'USD',
    street: decode(addr.streetAddress), region: decode(addr.addressRegion) || null,
    city: parts.length >= 2 ? parts[parts.length - 2] : null,
    lat: num(coords[1]), lng: num(coords[2]), facts, images,
  };
}

async function fetchDetail(base, id) {
  try {
    const res = await fetch(`${base}/${id}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return parseDetail(await res.text(), id);
  } catch { return null; }
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
  const url = listUrl(config, filters.operacion || config.operacion);
  const s = await openSearch(url);
  const ids = [];
  const startPage = Math.floor(skip / PER_PAGE) + 1;
  const lastPage = Math.max(1, Math.ceil((s.total || PER_PAGE) / PER_PAGE));
  for (let page = startPage; page <= lastPage && ids.length < top + (skip % PER_PAGE); page++) {
    const pageIds = page === 1 ? s.ids : await nextPage(url, s, page);
    if (!pageIds.length) break;
    ids.push(...pageIds);
  }
  const window = [...new Set(ids)].slice(skip % PER_PAGE, (skip % PER_PAGE) + top);
  const items = [];
  await poolMap(window, 4, async (id) => { const d = await fetchDetail(base, id); if (d && d.title) items.push(d); });
  items.sort((a, b) => window.indexOf(a.id) - window.indexOf(b.id));
  return { total: s.total, items };
}

function mapListing(c, { source, config }) {
  const f = c.facts || {};
  const listingType = /lease|rent/i.test(f['Contract type'] || '') ? 'rent' : 'sale';
  const type = mapType(f['Property type']);
  const isLand = type === 'Terreno';
  const built = areaM2(f['Construction size']);
  const lot = areaM2(f['Lot size']);
  const imgs = (c.images || []).slice(0, MAX_IMAGES).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const external_id = String(c.id);
  const row = {
    source_id: source.id,
    external_id,
    external_url: c.url || `${((config && config.base_url) || BASE).replace(/\/$/, '')}/${external_id}`,
    origin: 'scraped',
    slug: `remaxsv-${external_id}`,
    address: c.street || [c.city, c.region].filter(Boolean).join(', ') || 'Sin dirección',
    seo_title: c.title || null,
    latitude: c.lat,
    longitude: c.lng,
    price: c.price,
    currency: c.currency || 'USD',
    price_usd: (c.currency || 'USD') === 'USD' ? c.price : null,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(f.Bedrooms),
    bathrooms: num(f.Bathrooms),
    parking_spaces: num(f['Garage capacity']),
    floors: num(f['Stories/Floor']),
    covered_area: isLand ? null : built,
    floor_area: isLand ? lot : (built || lot),
    land_area: lot,
    city: c.city,
    province: c.region,
    neighborhood: c.city,
    country: 'El Salvador',
    property_type: type,
    description: c.description || c.title || null,
    contact_name: null,
    contact_phone: null,   // hidden by the site (protected) — see the header
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    raw_data: { ...c, facts: f },
  };
  const hashInput = JSON.stringify({
    price: row.price, listingType, type, beds: row.bedrooms, baths: row.bathrooms,
    built, lot, address: row.address, desc: row.description, imgs: imgs.map((x) => x.source_url),
  });
  return { external_id, row, images: imgs, hashInput };
}

export default { fetchPage, mapListing };
