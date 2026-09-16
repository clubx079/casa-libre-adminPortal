// Adapter: Coldwell Banker Blue Paraguay — Brokian CMS, server-rendered.
//
// No JSON API. The listing pages (/propiedades/todas/{venta|alquiler}?page=N)
// render 10 structured cards each, carrying the fields we need as data-* attrs
// and a small <ul>: data-id (external_id), data-type (property type), data-price
// + data-currency (1=USD, 3=PYG), title, a description teaser, beds / baths /
// area, and a thumbnail. The per-property detail page adds the full description
// (<meta name="description">), map coordinates, the full photo gallery, and the
// public contact phone. robots.txt allows /propiedades/ and /propiedad/ (only
// /property/markers, /property/responsible-info and /whatsapp are disallowed —
// we never touch those), so everything here comes from allowed HTML.
//
// Orchestrator contract (see lib/scrape.js): fetchPage does ALL network I/O
// (mapListing is called synchronously), returning fully-hydrated items; then
// mapListing purely shapes each item into a `properties` row.

const PER_PAGE = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const DETAIL_CONCURRENCY = 4;
const CUR = { '1': 'USD', '3': 'PYG' };
// Paraguay bounding box — reject any stray map-default / marker coord outside it.
const PY = { latMin: -27.8, latMax: -19.0, lngMin: -63.0, lngMax: -54.0 };

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Minimal HTML-entity decode for the handful that appear in titles/descriptions.
function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .trim();
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Coldwell ${res.status} @ ${url}`);
  return res.text();
}

// Run `fn` over items with a bounded number of workers (polite + fast).
async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

function opPath(filters) {
  const op = String(filters.operacion || filters.op || filters.operation || 'venta').toLowerCase();
  return op.startsWith('alq') || op === 'rent' ? 'alquiler' : 'venta';
}

// The card thumbnail is a /conversions/<name>-thumbnail.webp; the original photo
// lives at the same host as /<photoId>/<name>.jpg. Recover the full-size URL.
function fullSize(thumb) {
  if (!thumb) return null;
  const m = thumb.match(/(https:\/\/[^"'?]*cloudfront\.net\/\d+)\/conversions\/(.+?)-thumbnail\.(?:webp|jpg|jpeg|png)/i);
  return m ? `${m[1]}/${m[2]}.jpg` : thumb.split('?')[0];
}

// Strip the "Casa en venta … - Gs. 999.-" chrome off a title to leave a location.
function titleLocation(title) {
  if (!title) return null;
  let s = title;
  s = s.replace(/\s*[-–]\s*(?:Gs\.?|US\$|USD|₲)[\s\d.,]+\.?-?\s*$/i, ''); // trailing price
  s = s.replace(/^.*?\ben\s+(?:venta|alquiler)\s+/i, '');                        // leading "… en venta "
  s = s.replace(/\s+/g, ' ').trim();
  return s || title;
}

function parseCards(html, base) {
  const out = [];
  const re = /<div class="card property-item[^>]*data-id="(\d+)"[^>]*data-type="([^"]*)"([\s\S]*?)(?=<div class="card property-item|<\/section|<footer|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const type = decode(m[2]).trim();
    const body = m[3];
    const href = (body.match(/href="(\/propiedad\/[^"#?]+)"/) || [])[1] || null;
    const pc = body.match(/data-price="(\d+)"\s+data-currency="(\d+)"/) || [];
    const price = num(pc[1]);
    let currency = CUR[pc[2]] || null;
    if (!currency) currency = /US\$|USD/i.test(body) ? 'USD' : (/₲|Gs/i.test(body) ? 'PYG' : null);
    const title = decode((body.match(/<p class="address-to-show">([^<]+)<\/p>/) || body.match(/alt="([^"]+)"/) || [])[1] || '');
    const cardDesc = decode((body.match(/<p class="description">\s*<small>([\s\S]*?)<\/small>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    let beds = null, baths = null, area = null;
    for (const raw of [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)]) {
      const li = raw[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      let g;
      if ((g = li.match(/(\d+)\s*Dormitor/i))) beds = num(g[1]);
      else if ((g = li.match(/(\d+)\s*Ba[nñ]o/i))) baths = num(g[1]);
      if ((g = li.match(/Sup\.?\s*(?:Total|Terreno|Construida|Cubierta)\s*([\d.,]+)/i))) area = num(g[1]);
    }
    const thumb = (body.match(/src="(https:\/\/[^"]*cloudfront[^"]*)"/) || [])[1] || null;
    out.push({ id, type, url: href ? base + href : null, price, currency, title, cardDesc, beds, baths, area, thumb });
  }
  return out;
}

function parseTotal(html) {
  const m = html.match(/([\d.,]+)\s*Propiedades/i);
  return m ? num(m[1]) : 0;
}

function parseDetail(html) {
  const desc = decode((html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || [])[1] || '') || null;
  let lat = null, lng = null;
  const cm = html.match(/latitude"?\s*:\s*"?(-?\d{1,2}\.\d+)[\s\S]{0,80}?longitude"?\s*:\s*"?(-?\d{1,3}\.\d+)/i);
  if (cm) {
    const a = num(cm[1]), b = num(cm[2]);
    if (a >= PY.latMin && a <= PY.latMax && b >= PY.lngMin && b <= PY.lngMax) { lat = a; lng = b; }
  }
  const imgs = [...new Set(
    [...html.matchAll(/https:\/\/[^"'()\s]*cloudfront\.net\/\d+\/[^"'()\s/]+\.(?:jpg|jpeg|png|webp)/gi)].map((x) => x[0])
  )].filter((u) => !/\/sites\//i.test(u) && !/\/conversions\//i.test(u));
  const ph = (html.match(/(?:\+?595|0)\s?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/) || [])[0];
  const phone = ph ? ph.replace(/\D/g, '') : null;
  return { desc, lat, lng, imgs, phone };
}

async function fetchPage(config, filters, skip, top) {
  const base = (config.base_url || 'https://coldwellbankerblue.com.py').replace(/\/$/, '');
  const op = opPath({ ...(config.default_filters || {}), ...filters });
  const listingType = op === 'alquiler' ? 'rent' : 'sale';
  const startPage = Math.floor(skip / PER_PAGE) + 1;
  const pagesNeeded = Math.ceil(top / PER_PAGE);

  let total = 0;
  let cards = [];
  for (let p = 0; p < pagesNeeded; p++) {
    const pageNum = startPage + p;
    const url = `${base}/propiedades/todas/${op}${pageNum > 1 ? `?page=${pageNum}` : ''}`;
    let html;
    try { html = await get(url); } catch { break; }
    const t = parseTotal(html); if (t) total = t;
    const pageCards = parseCards(html, base);
    if (!pageCards.length) break;
    cards.push(...pageCards);
    if (cards.length >= top) break;
    if (total && pageNum * PER_PAGE >= total) break;
  }
  cards = cards.slice(0, top).map((c) => ({ ...c, _listingType: listingType }));

  // Enrich each card from its detail page (bounded concurrency). Detail failures
  // are non-fatal: the card data alone still yields a valid listing.
  await mapLimit(cards, DETAIL_CONCURRENCY, async (card) => {
    if (!card.url) return;
    try {
      const d = parseDetail(await get(card.url));
      card.detailDesc = d.desc;
      card.lat = d.lat; card.lng = d.lng;
      card.gallery = d.imgs;
      card.phone = d.phone;
    } catch { /* fall back to card-only data */ }
  });

  return { total: total || cards.length, items: cards };
}

function mapListing(c, { source, baseUrl, config = {}, pygPerUsd }) {
  const id = String(c.id);
  const currency = c.currency;
  const price = c.price;
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const isLand = /terreno|lote|campo|fracci|parcela/i.test(c.type || '');
  const listingType = c._listingType === 'rent' ? 'rent' : 'sale';
  const location = titleLocation(c.title);
  const description =
    (c.detailDesc && c.detailDesc.length >= (c.cardDesc || '').length) ? c.detailDesc : (c.cardDesc || null);

  const gallery = (c.gallery && c.gallery.length) ? c.gallery : (c.thumb ? [fullSize(c.thumb)] : []);
  const images = gallery
    .filter(Boolean)
    .map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));

  const base = (config.base_url || source?.base_url || baseUrl || 'https://coldwellbankerblue.com.py').replace(/\/$/, '');

  const row = {
    source_id: source?.id ?? null,
    external_id: id,
    external_url: c.url || (base + '/propiedades'),
    origin: 'scraped',
    slug: `coldwell-${id}`,
    address: c.title || location,
    latitude: c.lat ?? null,
    longitude: c.lng ?? null,
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: c.beds ?? null,
    bathrooms: c.baths ?? null,
    floor_area: isLand ? null : (c.area ?? null),
    covered_area: isLand ? null : (c.area ?? null),
    land_area: isLand ? (c.area ?? null) : null,
    parking_spaces: null,
    city: null,                  // resolved by normalizeZone() from the address haystack
    province: null,
    neighborhood: location,
    country: 'Paraguay',
    property_type: c.type || null,
    description,
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: config.contact_name || 'Coldwell Banker Blue',
    contact_phone: c.phone || config.default_phone || null,
    raw_data: {
      id, type: c.type, url: c.url, price, currency,
      beds: c.beds, baths: c.baths, area: c.area,
      lat: c.lat ?? null, lng: c.lng ?? null, image_count: images.length,
    },
  };

  const hashInput = JSON.stringify({
    price, currency, beds: row.bedrooms, baths: row.bathrooms, area: c.area,
    loc: location, desc: description, imgs: images.map((x) => x.source_url),
  });

  return { external_id: id, row, images, hashInput };
}

export default { fetchPage, mapListing };
