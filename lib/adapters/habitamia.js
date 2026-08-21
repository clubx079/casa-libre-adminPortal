// Adapter: Habitamia (https://habitamia.com) — a Wasi.co white-label for a
// Paraguay real-estate agency. No API: the SSR HTML detail pages carry a clean
// structured detail list (<li><strong>Label:</strong> value</li>) plus a
// schema.org-ish JSON blob with the description + agent telephone. There is no
// paginated results endpoint, so the sitemap IS the listing index — every
// /{slug}/{id} loc is a property. Config-driven so a sibling Wasi site works by
// base_url. Mirrors the raices.js contract (list + per-detail fetch, pool).

import { extractContact, normalizePyPhone } from '../contactPhone';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const MAX_IMAGES = 12;
const listCache = new Map(); // sitemapUrl -> { t, list }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  // strip thousands separators (dots and commas) then any non-digit
  const n = Number(String(v).replace(/[.,](?=\d{3}\b)/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Decode HTML entities (named + numeric) enough for Spanish listing text.
const ENT = {
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  uuml: 'ü', Uuml: 'Ü', ordm: 'º', ordf: 'ª', sup2: '²', deg: '°',
  iquest: '¿', iexcl: '¡', nbsp: ' ', amp: '&', quot: '"', apos: "'",
  lt: '<', gt: '>', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»',
};
function decodeEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => (n in ENT ? ENT[n] : m));
}
const stripHtml = (h) =>
  decodeEntities(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || null;

// remove accents + lowercase for keyword matching
const deburr = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Habitamia ${res.status} @ ${url}`);
  return res.text();
}

// bounded-concurrency map
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

// Map a Spanish property-type label / slug token to the canon used across the app.
function canonType(raw) {
  const t = deburr(raw);
  if (!t) return null;
  if (/terreno|lote|fraccion|loteamiento|parcela/.test(t)) return 'terreno';
  if (/duplex/.test(t)) return 'dúplex';
  if (/departamento|apartamento|depto|monoambiente|penthouse|piso/.test(t)) return 'departamento';
  if (/galpon|deposito|dep(o|ó)sito|tinglado|bodega/.test(t)) return 'depósito';
  if (/oficina/.test(t)) return 'oficina';
  if (/local|salon|comercial/.test(t)) return 'local comercial';
  if (/edificio/.test(t)) return 'edificio';
  if (/campo|estancia|chacra|granja/.test(t)) return 'campo';
  if (/casa|chalet|residencia|vivienda/.test(t)) return 'casa';
  return raw ? String(raw).trim().toLowerCase() : null;
}

// Titlecase a hyphen/space separated zone token: "mora-cue" -> "Mora Cue"
const titleZone = (s) =>
  String(s || '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || null;

function parseSlug(slug) {
  // {tipo}-{operacion}-{zona...}  e.g. galpon-industrial-venta-asuncion
  const parts = String(slug || '').split('-');
  const opIdx = parts.findIndex((p) => p === 'venta' || p === 'alquiler');
  if (opIdx < 0) return { type: slug, op: null, zoneTokens: [] };
  return {
    type: parts.slice(0, opIdx).join('-'),
    op: parts[opIdx] === 'alquiler' ? 'rent' : 'sale',
    zoneTokens: parts.slice(opIdx + 1),
  };
}

// --- sitemap = listing index --------------------------------------------------
function parseSitemap(xml, base) {
  const list = [];
  const seen = new Set();
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  for (const loc of locs) {
    const m = loc.match(/^https?:\/\/[^/]+\/([^/]+)\/(\d{7,8})\/?$/);
    if (!m) continue; // skips the bare homepage loc and any non-listing paths
    const slug = m[1];
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({ id, url: `${base}/${slug}/${id}`, slug });
  }
  return list;
}

async function getList(config) {
  const base = (config.base_url || 'https://habitamia.com').replace(/\/$/, '');
  const sitemap = config.sitemap || `${base}/sitemap.xml`;
  const cached = listCache.get(sitemap);
  if (cached && Date.now() - cached.t < 180000) return { list: cached.list, base };
  const xml = await fetchText(sitemap);
  const list = parseSitemap(xml, base);
  listCache.set(sitemap, { t: Date.now(), list });
  return { list, base };
}

// --- detail page --------------------------------------------------------------
function parsePrice(html) {
  const bm = html.match(/blq_precio[^>]*>([\s\S]*?)<\/div>/i);
  const inner = bm ? bm[1] : '';
  if (/a\s*consultar|consultar|convenir/i.test(inner)) return { price: null, currency: null };
  const pm = inner.match(/<p[^>]*class="pr1"[^>]*>([\s\S]*?)<\/p>/i);
  const amtRaw = pm ? pm[1].replace(/<[^>]+>/g, ' ') : inner.replace(/<[^>]+>/g, ' ');
  const digits = amtRaw.replace(/[^\d]/g, '');
  const price = digits ? Number(digits) : null;
  let currency = null;
  if (/d[oó]lar|US\$|USD|U\$S/i.test(inner)) currency = 'USD';
  else if (/guaran|₲|\bGs?\.?\b|G[\s]?[\d]/i.test(inner)) currency = 'PYG';
  return { price, currency };
}

function parseDetail(html) {
  // Structured detail list: <li ...><strong>Label:</strong> value</li>
  const fields = {};
  for (const m of html.matchAll(/<li[^>]*><strong>\s*([^<:]+?)\s*:?\s*<\/strong>\s*([^<]*)<\/li>/gi)) {
    fields[deburr(m[1])] = decodeEntities(m[2].trim());
  }
  const F = (k) => fields[k] || null;

  const { price, currency } = parsePrice(html);

  const negocio = deburr(F('tipo de negocio'));
  const priceLabel = deburr((html.match(/Precio de (venta|alquiler)/i) || [])[1]);
  const isRent = negocio === 'alquiler' || priceLabel === 'alquiler';

  const typeLabel = F('tipo de inmueble');

  const areaConstruida = num(F('area construida'));
  const areaTerreno = num(F('area terreno'));

  // Description + telephone live in the page's JSON blob.
  const descM = html.match(/"description"\s*:\s*"([\s\S]*?)"\s*,\s*"address"/);
  const description = descM ? stripHtml(decodeEntities(descM[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\//g, '/'))) : null;

  // Agent contact: prefer the shared helper (finds the tel:/wa.me links);
  // fall back to the trailing "telephone":"+595... +595..." JSON blob.
  let contactPhone = null;
  const c = extractContact(html);
  if (c && c.phone) contactPhone = c.phone;
  if (!contactPhone) {
    const tel = (html.match(/"telephone"\s*:\s*"([^"]+)"/) || [])[1];
    if (tel) contactPhone = normalizePyPhone(tel.trim().split(/\s+/)[0]);
  }
  const nameM = html.match(/Nombre:\s*<\/strong>\s*<br\s*\/?>\s*<span[^>]*>([^<]+)<\/span>/i);
  const contactName = (nameM ? decodeEntities(nameM[1].trim()) : (c && c.name)) || null;

  // Images: gallery URLs on images.wasi.co are base64 image-handler tokens that
  // decode to {key:"inmuebles/..."}; the og:image is a direct inmuebles URL.
  const imgMap = new Map(); // photoId -> url (keeps first/feature order)
  const addImg = (u) => {
    const fn = (u.match(/inmuebles\/([^/?"]+?)\.(?:jpe?g|png|webp)/i) || [])[1];
    const key = fn ? fn.replace(/^[a-z]/i, '') : u; // drop size-variant letter prefix
    if (!imgMap.has(key)) imgMap.set(key, u);
  };
  const og = (html.match(/og:image"[^>]*content="([^"]+)"/) || html.match(/content="([^"]+)"[^>]*property="og:image"/) || [])[1];
  if (og && /inmuebles\//i.test(og)) addImg(og);
  // direct inmuebles urls
  for (const m of html.matchAll(/https?:\/\/images\.wasi\.co\/inmuebles\/[^"'\s)]+?\.(?:jpe?g|png|webp)/gi)) addImg(m[0]);
  // base64 image-handler tokens (served from image.wasi.co / images.wasi.co)
  for (const m of html.matchAll(/images?\.wasi\.co\/([A-Za-z0-9+/]{40,}={0,2})/g)) {
    try {
      const j = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
      if (j && j.key && /^inmuebles\//i.test(j.key)) addImg(`https://images.wasi.co/${j.key}`);
    } catch { /* not a decodable token */ }
  }
  const images = [...imgMap.values()].slice(0, MAX_IMAGES);

  return {
    price, currency, isRent,
    typeLabel,
    areaConstruida, areaTerreno,
    bedrooms: num(F('dormitorios')),
    bathrooms: num(F('banos') ?? F('bano')),
    parking: num(F('garaje')),
    city: F('ciudad'),
    province: F('departamento'),
    neighborhood: F('zona'),
    country: F('pais'),
    seoTitle: decodeEntities((html.match(/<title>([^<]*?)(?:\s*-\s*[GU][^<]*)?<\/title>/i) || [])[1] || '') || null,
    description,
    images,
    contactName,
    contactPhone,
    fields,
  };
}

// Orchestrator contract: return { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const { list, base } = await getList(config);
  const total = list.length;
  const windowItems = list.slice(skip, skip + top);
  const items = await pool(windowItems, 4, async (card) => {
    try {
      const html = await fetchText(card.url);
      const detail = parseDetail(html);
      return { ...card, ...detail };
    } catch {
      // never let one bad page throw the whole window — return card basics
      const { op, type, zoneTokens } = parseSlug(card.slug);
      return { ...card, isRent: op === 'rent', typeLabel: type, images: [], _fallback: true, _zoneTokens: zoneTokens };
    }
  });
  return { total, items };
}

function mapListing(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const base = (config.base_url || 'https://habitamia.com').replace(/\/$/, '');
  const url = it.url || `${base}/${it.slug}/${id}`;
  const { op, zoneTokens } = parseSlug(it.slug);

  const currency = it.currency || null;
  const price = it.price ?? null;
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const listingType = it.isRent != null ? (it.isRent ? 'rent' : 'sale') : (op === 'rent' ? 'rent' : 'sale');

  // property type from the detail list label, falling back to the slug token
  const ptype = canonType(it.typeLabel) || canonType(parseSlug(it.slug).type);
  const isLand = ptype === 'terreno' || ptype === 'campo';

  const areaC = num(it.areaConstruida);
  const areaT = num(it.areaTerreno);
  const area = areaC ?? areaT;

  // zone: use the detail list (Ciudad/Zona). Only when the detail page failed to
  // load (_fallback) do we derive a rough city/neighborhood from the slug tokens.
  const zt = it._fallback ? (it._zoneTokens || zoneTokens) : null;
  const city = it.city || (zt && zt.length ? titleZone(zt[zt.length - 1]) : null);
  const neighborhood = it.neighborhood || (zt && zt.length > 1 ? titleZone(zt.slice(0, -1).join(' ')) : null);

  const address = [neighborhood, city].filter(Boolean).join(', ') || it.seoTitle || 'Sin dirección';

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: url,
    origin: 'scraped',
    slug: `habitamia-${id}`,
    address,
    seo_title: it.seoTitle || null,
    latitude: null,
    longitude: null,
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(it.bedrooms),
    bathrooms: num(it.bathrooms),
    floor_area: isLand ? null : areaC,
    covered_area: isLand ? null : areaC,
    land_area: isLand ? (areaT ?? areaC) : (areaT ?? null),
    city: city || null,
    province: it.province || null,
    country: 'Paraguay',
    neighborhood: neighborhood || null,
    property_type: ptype,
    description: it.description || null,
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: it.contactName || null,
    contact_phone: it.contactPhone || null,
    raw_data: { ...it, platform: 'habitamia' },
  };

  const imgs = (it.images || []).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const hashInput = JSON.stringify({
    price, currency, listingType,
    beds: row.bedrooms, baths: row.bathrooms, area,
    title: it.seoTitle, imgs: imgs.map((x) => x.source_url),
  });
  return { external_id: id, row, images: imgs, hashInput };
}

export default { fetchPage, mapListing };
