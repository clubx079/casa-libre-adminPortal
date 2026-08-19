// Adapter: Raíces platform (Laravel white-label used by Paraguay Sotheby's & others).
// No API — the results page renders all listings as HTML cards; detail pages add
// coordinates + the full gallery. Config-driven so any Raíces site works by base_url.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const MAX_IMAGES = 10; // Raíces serves multi-MB originals slowly — cap per listing
const listCache = new Map(); // listUrl -> { t, cards }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Raíces ${res.status} @ ${url}`);
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

function parsePrice(raw) {
  if (!raw) return { price: null, currency: null };
  const s = raw.trim();
  if (/consult|convenir|request|a\s*conven/i.test(s)) return { price: null, currency: null };
  const digits = s.replace(/[^\d]/g, '');
  const val = digits ? Number(digits) : null;
  if (/usd|u\$s|\bus\b|\$/i.test(s)) return { price: val, currency: 'USD' };
  if (/gs|g\.|₲|gua/i.test(s)) return { price: val, currency: 'PYG' };
  return { price: val, currency: null };
}

function inferType(title) {
  const t = (title || '').toLowerCase();
  if (/lote|terreno|loteamiento|fracci/.test(t)) return 'terreno';
  if (/duplex|dúplex/.test(t)) return 'duplex';
  if (/departamento|depto|monoambiente|penthouse|piso/.test(t)) return 'departamento';
  if (/casa|residencia|chalet|vivienda/.test(t)) return 'casa';
  if (/oficina/.test(t)) return 'oficina';
  if (/local|comercial|salon|salón|depósito|deposito/.test(t)) return 'local';
  if (/edificio/.test(t)) return 'edificio';
  if (/campo|estancia|chacra|granja/.test(t)) return 'campo';
  return null;
}

function parseCards(html, base) {
  const cards = [];
  const seen = new Set();
  // split into per-card blocks at each property anchor (robust vs nested tags)
  const blocks = html.split(/(?=<a href="[^"]*\/propiedades\/\d+")/);
  for (const b of blocks) {
    const idm = b.match(/^<a href="[^"]*\/propiedades\/(\d+)"/);
    if (!idm) continue;
    const id = idm[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = (b.match(/smallTitle">([^<]+)/) || [])[1];
    const priceRaw = (b.match(/smallPrice">([^<]+)/) || [])[1];
    const detBlock = (b.match(/smallDetailList">([\s\S]*?)<\/ul>/) || [])[1] || '';
    const detText = detBlock.replace(/<[^>]+>/g, ' ');
    const area = (detText.match(/([\d.,]+)\s*m2/i) || [])[1];
    const beds = (detText.match(/(\d+)\s*Habitac/i) || [])[1];
    const thumb = (b.match(/background-image:\s*url\(([^)]+)\)/) || [])[1];
    const { price, currency } = parsePrice(priceRaw);
    cards.push({
      id, url: `${base}/propiedades/${id}`,
      title: title ? title.trim() : null,
      price, currency, area: num(area), beds: num(beds),
      thumb: thumb ? thumb.trim() : null,
    });
  }
  return cards;
}

function parseDetail(html) {
  const main = html.split('search_result_box')[0]; // drop related-listing cards
  const geo = main.match(/q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const imgRe = /https?:\/\/[^"')\s]+\/storage\/app\/uploads\/public\/[^"')\s]+\.(?:jpg|jpeg|png|webp)/gi;
  const images = [...new Set(main.match(imgRe) || [])];
  const text = main.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const baths = (text.match(/(\d+)\s*ba[ñn]os?/i) || [])[1];
  const cityM = text.match(/Ciudad:\s*([A-Za-zÁÉÍÓÚÑÜáéíóúñü .'-]+?)\s*(?:Compartir|ID\s*Propiedad|Estado|Barrio|$)/);
  let description = null;
  const dM = text.match(/Descripci[oó]n\s*(.{40,1500}?)(?:Caracter[ií]sticas|Ubicaci[oó]n|Compartir|ID\s*Propiedad|Propiedades|$)/i);
  if (dM) description = dM[1].trim();
  return {
    lat: geo ? num(geo[1]) : null,
    lng: geo ? num(geo[2]) : null,
    baths: num(baths),
    city: cityM ? cityM[1].trim() : null,
    description,
    images,
  };
}

async function getCards(config) {
  const base = (config.base_url || 'https://www.psir.com.py').replace(/\/$/, '');
  const listUrl = base + (config.list_path || '/propiedades');
  const cached = listCache.get(listUrl);
  if (cached && Date.now() - cached.t < 120000) return { cards: cached.cards, base };
  const html = await fetchText(listUrl);
  const cards = parseCards(html, base);
  listCache.set(listUrl, { t: Date.now(), cards });
  return { cards, base };
}

// Orchestrator contract: return { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const { cards, base } = await getCards(config);
  const total = cards.length;
  const windowCards = cards.slice(skip, skip + top);
  const items = await pool(windowCards, 4, async (card) => {
    try {
      const dhtml = await fetchText(`${base}/propiedades/${card.id}`);
      const detail = parseDetail(dhtml);
      const all = detail.images.length ? detail.images : card.thumb ? [card.thumb] : [];
      return { ...card, ...detail, images: all.slice(0, MAX_IMAGES) };
    } catch {
      return { ...card, images: card.thumb ? [card.thumb] : [] };
    }
  });
  return { total, items };
}

function mapListing(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const base = (config.base_url || 'https://www.psir.com.py').replace(/\/$/, '');
  const currency = it.currency || null;
  const price = it.price ?? null;
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const ptype = inferType(it.title);
  const isLand = ptype === 'terreno' || ptype === 'campo';
  const area = num(it.area);

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: `${base}/propiedades/${id}`,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address: it.title || it.city || 'Sin dirección',
    seo_title: it.title || null,
    latitude: it.lat ?? null,
    longitude: it.lng ?? null,
    price,
    currency,
    price_usd: priceUsd,
    listing_type: 'sale',
    price_period: null,
    bedrooms: num(it.beds),
    bathrooms: num(it.baths),
    floor_area: isLand ? null : area,
    covered_area: isLand ? null : area,
    land_area: isLand ? area : null,
    city: it.city || null,
    province: null,
    country: 'Paraguay',
    neighborhood: null,
    property_type: ptype,
    description: it.description || null,
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    raw_data: { ...it, platform: 'raices' },
  };

  const images = (it.images || []).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const hashInput = JSON.stringify({
    price, currency, beds: row.bedrooms, baths: row.bathrooms, area,
    title: it.title, lat: it.lat, imgs: it.images,
  });
  return { external_id: id, row, images, hashInput };
}

export default { fetchPage, mapListing };
