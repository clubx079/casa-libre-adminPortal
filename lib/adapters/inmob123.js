// Adapter: Grupo Inmobiliario 123 (https://123.com.py) — bespoke PHP CMS.
// Server-rendered HTML, no API. The /propiedades index paginates with ?page=N
// (12 cards/page); each card links to /propiedad/<slug>. The numeric id lives on
// the detail page (propiedad_id / image folder). No coordinates on this site.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const MAX_IMAGES = 15;
const listCache = new Map(); // listUrl -> { t, cards }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
// Paraguay money format: "USD 200.000,00" / "Gs 1.200.000". Dots = thousands,
// comma = decimals. Take the integer part.
function parseMoney(raw) {
  if (!raw) return { price: null, currency: null };
  const s = String(raw).trim();
  if (/consult|conven|a\s*tratar/i.test(s)) return { price: null, currency: null };
  const currency = /usd|u\$s|\bus\b|\$/i.test(s) ? 'USD' : /gs|g\.|₲|guar/i.test(s) ? 'PYG' : null;
  const cleaned = s.replace(/[^\d.,]/g, '');
  const intPart = cleaned.replace(/\./g, '').split(',')[0];
  const val = intPart ? Number(intPart) : null;
  return { price: Number.isFinite(val) ? val : null, currency };
}

function inferType(text) {
  const t = (text || '').toLowerCase();
  if (/lote|terreno|loteamiento|fracci/.test(t)) return 'terreno';
  if (/d[uú]plex/.test(t)) return 'duplex';
  if (/departamento|depto|monoambiente|penthouse|loft|piso/.test(t)) return 'departamento';
  if (/casa|residencia|chalet|vivienda/.test(t)) return 'casa';
  if (/oficina/.test(t)) return 'oficina';
  if (/local|comercial|sal[oó]n|dep[oó]sito/.test(t)) return 'local';
  if (/edificio/.test(t)) return 'edificio';
  if (/campo|estancia|chacra|granja/.test(t)) return 'campo';
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`123 ${res.status} @ ${url}`);
  return res.text();
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

// Parse listing cards from an index page. Cards are <a class="pcard" href=...>.
function parseCards(html, base) {
  const cards = [];
  const seen = new Set();
  // Split at every <a>; keep the ones whose opening tag is a .pcard link.
  // Attribute order varies (href may come before or after class), so match
  // within the opening tag rather than assuming a fixed order.
  const blocks = html.split(/(?=<a\b)/);
  for (const b of blocks) {
    const tagM = b.match(/^<a\b([^>]*)>/);
    if (!tagM) continue;
    const tag = tagM[1];
    if (!/class="[^"]*\bpcard\b[^"]*"/.test(tag)) continue;
    const hrefM = tag.match(/href="([^"]*\/propiedad\/[^"]+)"/);
    if (!hrefM) continue;
    const url = hrefM[1].startsWith('http') ? hrefM[1] : base + hrefM[1];
    const slug = url.split('/propiedad/')[1]?.replace(/[/?#].*$/, '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const op = (b.match(/pcard__op"[^>]*>([^<]+)/) || [])[1];
    const priceRaw = (b.match(/pcard__price"[^>]*>([^<]+)/) || [])[1];
    const title = (b.match(/pcard__title"[^>]*>([^<]+)/) || [])[1];
    const loc = (b.match(/pcard__loc"[\s\S]*?<\/i>\s*([^<]+)/) || [])[1];
    const thumb = (b.match(/pcard__img[\s\S]*?<img[^>]+src="([^"]+)"/) || [])[1];
    cards.push({
      slug, url,
      op: op ? op.trim() : null,
      priceRaw: priceRaw ? priceRaw.trim() : null,
      title: title ? title.trim() : null,
      loc: loc ? loc.trim() : null,
      thumb: thumb && !/sin-foto/.test(thumb) ? thumb.replace(/_thumb(\.\w+)$/i, '$1') : null,
    });
  }
  return cards;
}

// Build a { label(lower) -> value } map from all ficha__spec blocks in one pass.
// Each block is <spec-val>VALUE</> <spec-label>LABEL</>; a global lazy scan pairs
// each value with the label that immediately follows it.
function specMap(html) {
  const map = {};
  const re = /ficha__spec-val"[^>]*>\s*([^<]+?)\s*<[\s\S]*?ficha__spec-label"[^>]*>\s*([^<]+?)\s*</gi;
  let m;
  while ((m = re.exec(html))) map[m[2].toLowerCase()] = m[1];
  return map;
}
// Parse a Paraguay-format area string: "410.00 m²" -> 410, "1.002 m²" -> 1002.
function parseArea(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  s = s.split(',')[0]; // drop comma-decimals
  if (/^\d+\.\d{2}$/.test(s)) return Math.round(parseFloat(s)); // single ".00" decimal
  const n = Number(s.replace(/\./g, '')); // dots are thousands separators
  return Number.isFinite(n) ? n : null;
}

function parseDetail(html, base) {
  const idM = html.match(/name="propiedad_id"\s+value="(\d+)"/) ||
              html.match(/PROP-0*(\d+)/) ||
              html.match(/\/uploads\/propiedades\/(\d+)\//);
  const id = idM ? idM[1] : null;

  const title = (html.match(/ficha__title"[^>]*>([^<]+)/) || [])[1];
  const loc = (html.match(/ficha__loc"[\s\S]*?<\/i>\s*([^<]+)/) || [])[1];
  const ptypeRaw = (html.match(/ficha__op"[^>]*>([^<]+)/) || [])[1];

  // op-switch carries both prices: data-p1 (venta), data-p2 (alquiler)
  const sw = html.match(/op-switch"[^>]*data-p1="([^"]*)"(?:[^>]*data-p2="([^"]*)")?/);
  const priceVenta = sw ? sw[1] : (html.match(/id="opPrecio"[^>]*>([^<]+)/) || [])[1];
  const priceAlq = sw ? sw[2] : null;
  const hasVenta = /data-op="1"|>\s*Venta/i.test(html);
  const hasAlq = /data-op="2"|>\s*Alquiler/i.test(html);

  const descM = html.match(/ficha__desc"[^>]*>([\s\S]*?)<\/div>/);
  const description = descM
    ? descM[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\s+\n/g, '\n').trim()
    : null;

  const contactName = (html.match(/vend-card__nombre"[^>]*>([^<]+)/) || [])[1];
  const waM = html.match(/vend-card__wa"[^>]*href="https?:\/\/wa\.me\/(\d+)"/);

  const spec = specMap(html);
  const pick = (...labels) => { for (const l of labels) if (spec[l] != null) return spec[l]; return null; };

  // full-size images: /uploads/propiedades/<id>/... minus _thumb variants
  const imgRe = /https?:\/\/[^"')\s]*\/uploads\/propiedades\/\d+\/[^"')\s]+\.(?:jpe?g|png|webp)/gi;
  const images = [...new Set((html.match(imgRe) || []).map((u) => u.replace(/_thumb(\.\w+)$/i, '$1')))]
    .filter((u) => !/sin-foto/.test(u));

  return {
    id,
    title: title ? title.trim() : null,
    loc: loc ? loc.trim() : null,
    ptypeRaw: ptypeRaw ? ptypeRaw.trim() : null,
    priceVenta: priceVenta ? priceVenta.trim() : null,
    priceAlq: priceAlq ? priceAlq.trim() : null,
    hasVenta, hasAlq,
    bedrooms: num(pick('dormitorios', 'habitaciones')),
    bathrooms: num(pick('baños', 'banos')),
    parking: num(pick('cocheras', 'cochera')),
    covered: parseArea(pick('sup. construida', 'sup construida', 'superficie construida')),
    land: parseArea(pick('sup. terreno', 'sup terreno', 'superficie terreno')),
    description,
    contactName: contactName ? contactName.trim() : null,
    contactPhone: waM ? waM[1] : null,
    images: images.slice(0, MAX_IMAGES),
  };
}

async function getCards(config) {
  const base = (config.base_url || 'https://123.com.py').replace(/\/$/, '');
  const listPath = config.list_path || '/propiedades';
  const cacheKey = base + listPath;
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.t < 120000) return { cards: cached.cards, base };

  const all = [];
  const seen = new Set();
  for (let page = 1; page <= 60; page++) {
    const url = `${base}${listPath}${page > 1 ? `?page=${page}` : ''}`;
    let html;
    try { html = await fetchText(url); } catch { break; }
    const cards = parseCards(html, base).filter((c) => !seen.has(c.slug));
    if (!cards.length) break;
    cards.forEach((c) => seen.add(c.slug));
    all.push(...cards);
  }
  listCache.set(cacheKey, { t: Date.now(), cards: all });
  return { cards: all, base };
}

// Orchestrator contract: { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const { cards, base } = await getCards(config);
  const total = cards.length;
  const windowCards = cards.slice(skip, skip + top);
  const items = await pool(windowCards, 4, async (card) => {
    try {
      const detail = parseDetail(await fetchText(card.url), base);
      const images = detail.images.length ? detail.images : card.thumb ? [card.thumb] : [];
      return { ...card, ...detail, images };
    } catch {
      return { ...card, images: card.thumb ? [card.thumb] : [] };
    }
  });
  return { total, items };
}

function mapListing(it, { source, config, pygPerUsd }) {
  const base = (config.base_url || 'https://123.com.py').replace(/\/$/, '');
  const id = String(it.id || it.slug);

  // Prefer the operation shown on the card; fall back to whichever price exists.
  const cardIsRent = /alquil/i.test(it.op || '');
  const listingType = cardIsRent && it.priceAlq ? 'rent' : it.hasVenta || it.priceVenta ? 'sale' : cardIsRent ? 'rent' : 'sale';
  const priceRaw = listingType === 'rent' ? it.priceAlq || it.priceVenta || it.priceRaw : it.priceVenta || it.priceRaw;
  const { price, currency } = parseMoney(priceRaw);

  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const title = it.title || it.loc || 'Sin dirección';
  const ptype = inferType(it.ptypeRaw || title);
  const isLand = ptype === 'terreno' || ptype === 'campo';

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: it.url || `${base}/propiedad/${it.slug}`,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address: title,
    seo_title: title,
    latitude: null,
    longitude: null,
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: it.bedrooms ?? null,
    bathrooms: it.bathrooms ?? null,
    parking_spaces: it.parking ?? null,
    floor_area: isLand ? null : it.covered ?? null,
    covered_area: isLand ? null : it.covered ?? null,
    land_area: it.land ?? null,
    city: it.loc || null,
    province: null,
    neighborhood: null,
    country: 'Paraguay',
    property_type: ptype,
    description: it.description || null,
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: it.contactName || null,
    contact_phone: it.contactPhone || null,
    raw_data: { ...it, platform: 'inmob123' },
  };

  const images = (it.images || []).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const hashInput = JSON.stringify({
    price, currency, listingType, beds: row.bedrooms, baths: row.bathrooms,
    covered: it.covered, land: it.land, title, desc: row.description, imgs: it.images,
  });
  return { external_id: id, row, images, hashInput };
}

export default { fetchPage, mapListing };
