// Adapter: TuLugar (https://tulugar.com) — Next.js site with a public JSON API.
// The .com.py domain 403s; use .com. Bulk listings come from the whitelisted
// /api/listings/viewport-page endpoint (map markers with full summary data +
// images), paginated 18/page over a Paraguay-wide bounding box. property_type is
// apartment|house|commercial|land — we normalize to the Spanish canon used across
// the app so land classification + type labels stay consistent.

import { extractContact } from '../contactPhone';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const BBOX = 'north=-19&south=-28&east=-54&west=-63'; // all of Paraguay
const listCache = new Map();
const contactCache = new Map(); // listing url -> { name, phone }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const stripHtml = (h) => (h ? String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null);

const TYPE_MAP = {
  apartment: 'departamento', house: 'casa', land: 'terreno', commercial: 'local comercial',
  office: 'oficina', warehouse: 'depósito', townhouse: 'dúplex', duplex: 'dúplex', farm: 'campo',
};

function base(config) {
  return (config.api_base || 'https://tulugar.com').replace(/\/$/, '');
}

async function apiJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`tulugar ${res.status} @ ${url}`);
  return res.json();
}

async function getList(config) {
  const b = base(config);
  const cached = listCache.get(b);
  if (cached && Date.now() - cached.t < 180000) return cached.items;
  const bbox = config.bbox || BBOX;
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= 300; page++) {
    let arr;
    try { arr = await apiJson(`${b}/api/listings/viewport-page?${bbox}&page=${page}`); } catch { break; }
    if (!Array.isArray(arr) || !arr.length) break;
    for (const it of arr) { if (it && it.id && !seen.has(it.id)) { seen.add(it.id); items.push(it); } }
  }
  listCache.set(b, { t: Date.now(), items });
  return items;
}

// The viewport API omits the agent phone; it lives in the detail page's
// server-rendered schema.org JSON-LD ("RealEstateAgent"..."telephone"). Fetch
// the detail HTML once per listing and attach {contact_name, contact_phone}.
// Cached by URL so re-scrapes don't re-fetch unchanged listings.
async function enrichContact(config, it) {
  const b = base(config);
  const url = it.slug ? `${b}/es/paraguay/propiedades/${it.slug}` : null;
  if (!url) return;
  if (contactCache.has(url)) { Object.assign(it, contactCache.get(url)); return; }
  let found = { contact_name: null, contact_phone: null };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const c = extractContact(await res.text());
      if (c && c.phone) found = { contact_name: c.name || null, contact_phone: c.phone };
    }
  } catch {}
  contactCache.set(url, found);
  Object.assign(it, found);
}

// bounded-concurrency map
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  }));
}

// Orchestrator contract: { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const list = await getList(config);
  const windowItems = list.slice(skip, skip + top);
  await pool(windowItems, 5, (it) => enrichContact(config, it));
  return { total: list.length, items: windowItems };
}

function mapListing(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const currency = (it.currency || '').toUpperCase() === 'USD' ? 'USD' : (it.currency ? 'PYG' : null);
  const price = num(it.price);
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const listingType = String(it.listing_type || '').toLowerCase() === 'rent' ? 'rent' : 'sale';
  const ptype = TYPE_MAP[String(it.property_type || '').toLowerCase()] || it.property_type || null;
  const isLand = String(it.property_type || '').toLowerCase() === 'land';
  const area = num(it.area_sqm);

  const address = [it.address, it.neighborhood, it.city].filter((x) => x && String(x).trim()).join(', ') || it.title || 'Sin dirección';
  const b = base(config);

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: it.slug ? `${b}/es/paraguay/propiedades/${it.slug}` : null,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address,
    seo_title: it.title || null,
    latitude: num(it.latitude),
    longitude: num(it.longitude),
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(it.bedrooms),
    bathrooms: num(it.bathrooms),
    parking_spaces: num(it.parking_spaces),
    floor_area: isLand ? null : area,
    covered_area: isLand ? null : area,
    land_area: isLand ? area : null,
    city: it.city || null,
    province: it.state_province || null,
    neighborhood: it.neighborhood || null,
    country: 'Paraguay',
    property_type: ptype,
    description: stripHtml(it.description),
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: it.contact_name || null,
    contact_phone: it.contact_phone || it.whatsapp || null,
    raw_data: { ...it, platform: 'tulugar' },
  };

  const imgs = (Array.isArray(it.images) ? it.images : [])
    .filter(Boolean)
    .map((u, i) => ({ source_url: u.startsWith('http') ? u : `${b}${u.startsWith('/') ? '' : '/'}${u}`, position: i, is_feature: i === 0 }));

  const hashInput = JSON.stringify({
    price, currency, listingType, ptype, beds: row.bedrooms, baths: row.bathrooms,
    area, lat: row.latitude, lng: row.longitude, title: it.title,
    desc: row.description, imgs: imgs.map((x) => x.source_url),
  });
  return { external_id: id, row, images: imgs, hashInput };
}

export default { fetchPage, mapListing };
