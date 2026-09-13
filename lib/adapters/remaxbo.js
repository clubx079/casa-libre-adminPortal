// Adapter: RE/MAX Bolivia (remax.bo) — Laravel + Inertia site.
// Listings come from the public paginated JSON API:
//   GET /api/search?operacion=<venta|alquiler|anticretico>&page=N   (20 per page)
// The agent phone + rich description live ONLY on the detail page's Inertia
// payload (/propiedad/<slug> → props.agent.user.phone_number /
// props.listing.description_website), so we enrich each list item with one
// bounded-concurrency detail fetch. Images are on intramax.bo/storage.

const PER_PAGE = 20;
const MAX_IMAGES = 15;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`RemaxBO ${res.status} @ ${url}`);
  return res.json();
}

// Pull + JSON-parse the Inertia `data-page` blob out of an HTML page.
function decodeDataPage(html) {
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) return null;
  const s = m[1]
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  try { return JSON.parse(s); } catch { return null; }
}

// Agent phone + full description live only on the detail page (not the list API).
async function fetchDetail(base, slug) {
  try {
    const res = await fetch(`${base}/propiedad/${slug}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const p = decodeDataPage(await res.text())?.props || {};
    const phone = p?.agent?.user?.phone_number || p?.listing?.agents?.[0]?.user?.phone_number || null;
    const description = p?.listing?.description_website || p?.listing?.title || null;
    return { phone: phone ? String(phone) : null, description };
  } catch { return {}; }
}

async function poolMap(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

// Orchestrator contract: return { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const base = (config.base_url || 'https://www.remax.bo').replace(/\/$/, '');
  const op = filters.operacion || config.operacion || 'venta';
  const startPage = Math.floor(skip / PER_PAGE) + 1;
  const pagesNeeded = Math.ceil(top / PER_PAGE);
  const items = [];
  let total = 0;
  for (let i = 0; i < pagesNeeded; i++) {
    const page = startPage + i;
    const d = await fetchJson(`${base}/api/search?operacion=${encodeURIComponent(op)}&page=${page}`);
    total = d.total || total;
    const data = d.data || [];
    if (!data.length) break;
    items.push(...data);
    if (items.length >= top) break;
    if (page >= (d.last_page || 1)) break;
  }
  const sliced = items.slice(0, top);
  // Enrich with agent phone + description from the detail page (concurrency 5).
  await poolMap(sliced, 5, async (it) => {
    const det = await fetchDetail(base, it.slug);
    it._phone = det.phone; it._desc = det.description;
  });
  return { total, items: sliced };
}

function mapListing(c, { source, config }) {
  const base = ((config && config.base_url) || 'https://www.remax.bo').replace(/\/$/, '');
  const li = c.listing_information || {};
  const loc = c.location || {};
  const pr = c.price || {};
  const opName = (c.transaction_type?.name || '').toLowerCase();
  const listingType = opName.includes('venta') ? 'sale' : 'rent'; // alquiler / anticretico → rent
  const currency = pr.currency_id === 1 ? 'BOB' : 'USD';
  const price = num(pr.amount);
  const priceUsd = num(pr.price_in_dollars) ?? (currency === 'USD' ? price : null);
  const zone = loc.zone?.name || null;
  const city = loc.city?.name || null;
  const province = loc.city?.province?.name || null;
  const subtype = li.subtype_property?.name || null;
  const isLand = /terreno|lote/i.test(subtype || '');

  const imgs = (c.multimedias || [])
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .slice(0, MAX_IMAGES)
    .map((m, i) => ({ source_url: m.large_url || m.url, position: i, is_feature: i === 0 }))
    .filter((x) => x.source_url);

  const external_id = String(c.MLSID || c.id);
  const row = {
    source_id: source.id,
    external_id,
    external_url: `${base}/propiedad/${c.slug}`,
    origin: 'scraped',
    slug: `remaxbo-${external_id}`,
    address: loc.first_address || [zone, city].filter(Boolean).join(', ') || 'Sin dirección',
    latitude: num(loc.latitude),
    longitude: num(loc.longitude),
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(li.number_bedrooms),
    bathrooms: num(li.number_bathrooms),
    floor_area: num(li.construction_area_m) || num(li.land_m2),
    covered_area: num(li.construction_area_m),
    land_area: isLand ? (num(li.land_m2) || num(li.construction_area_m)) : num(li.land_m2),
    total_rooms: num(li.total_number_rooms),
    city,
    province,
    neighborhood: zone,
    country: 'Bolivia',
    property_type: subtype || c.area?.name || null,
    description: c._desc || null,
    contact_name: c.agent?.user?.name_to_show || null,
    contact_phone: c._phone || null,
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
