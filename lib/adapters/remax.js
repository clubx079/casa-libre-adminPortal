// Adapter: RE/MAX Paraguay (GryphTech / Azure Cognitive Search).
// Knows how to (a) page through the search API given UI filters, and
// (b) map one raw listing into our `properties` row + image list.
// The listing index carries only AgentId — the agent's phone lives in a sibling
// `agent-search` index, which we resolve + cache per run so each listing gets a
// real contact phone (agent mobile / WhatsApp, falling back to the office line).

import { normalizePyPhone } from '../contactPhone';

const MAX_IMAGES = 15;
const agentCache = new Map(); // agentId -> { name, phone }

const UA_HDR = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// Resolve one AgentId -> { name, phone } via the GryphTech agent-search index.
async function fetchAgent(config, agentId) {
  const id = String(agentId || '');
  if (!id) return null;
  if (agentCache.has(id)) return agentCache.get(id);
  let out = null;
  try {
    const agentUrl = String(config.search_url || '').replace('listing-search', 'agent-search');
    const res = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: config.base_url || 'https://www.remax.com.py',
        Referer: (config.base_url || 'https://www.remax.com.py') + '/',
        'User-Agent': UA_HDR,
      },
      body: JSON.stringify({
        count: true, top: 1, searchMode: 'all', queryType: 'simple',
        search: id, filter: `content/TenantId eq ${config.tenantid}`,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const data = await res.json();
      const c = (data.value && data.value[0] && data.value[0].content) || null;
      if (c) {
        const phone = normalizePyPhone(c.WhatsApp || c.AgentPhone || c.AgentDirectDialPhone || c.OfficePhone);
        const name = c.AgentName || [c.FirstName, c.LastName].filter(Boolean).join(' ') || c.OfficeName || null;
        if (phone) out = { name: name || null, phone };
      }
    }
  } catch {}
  agentCache.set(id, out);
  return out;
}

// bounded-concurrency map
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  }));
}

const esDesc = (content) => {
  const ds = content.ListingDescriptions || [];
  const pick = ds.find((d) => (d.ISOLanguageCode || d.LanguageCode || '').toLowerCase().startsWith('es')) || ds[0];
  if (!pick) return null;
  return [pick.Title, pick.Description || pick.Text || pick.ListingDescription]
    .filter(Boolean)
    .join('\n\n') || null;
};

const esUrl = (content, baseUrl) => {
  const sl = (content.ShortLinks || []).find((s) => (s.ISOLanguageCode || '').toLowerCase() === 'es');
  if (!sl) return null;
  return `${baseUrl}/${sl.ShortLink}`;
};

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v)) || null;

function buildFilter(config, filters) {
  const parts = [
    `content/TenantId eq ${config.tenantid}`,
    `content/MacroRegionId eq ${config.macroregionid}`,
    'content/OnHoldListing eq false',
    'content/IsViewable eq true',
  ];
  if (filters.listing_type) parts.push(`content/TransactionTypeUID eq ${Number(filters.listing_type)}`);
  if (filters.min_price) parts.push(`content/ListingPrice ge ${Number(filters.min_price)}`);
  if (filters.max_price) parts.push(`content/ListingPrice le ${Number(filters.max_price)}`);
  if (filters.bedrooms) parts.push(`content/NumberOfBedrooms ge ${Number(filters.bedrooms)}`);
  return parts.join(' and ');
}

// One page. Returns { total, items }.
async function fetchPage(config, filters, skip, top) {
  const body = {
    count: true,
    skip,
    top,
    searchMode: 'all',
    queryType: 'simple',
    search: filters.city ? String(filters.city) : '*',
    filter: buildFilter(config, filters),
    orderby: 'content/LastUpdatedOnWeb desc',
  };
  const res = await fetch(config.search_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: config.base_url || 'https://www.remax.com.py',
      Referer: (config.base_url || 'https://www.remax.com.py') + '/',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RE/MAX search ${res.status}`);
  const data = await res.json();
  const items = (data.value || []).map((v) => v.content);
  // Resolve agent phones for this window (deduped + cached by AgentId).
  await pool(items, 5, async (c) => { c._agent = await fetchAgent(config, c.AgentId); });
  return { total: data['@odata.count'] ?? 0, items };
}

// Map one raw listing -> { external_id, row, images, hashInput }.
function mapListing(content, { source, baseUrl, config, pygPerUsd }) {
  const currency = content.ListingCurrency || null;
  const price = num(content.ListingPrice);
  const priceUsd =
    price == null ? null : currency === 'USD' ? price : Math.round(price / (pygPerUsd || 7300));
  // GryphTech TransactionTypeUID: 260 = for-rent/lease, 261 = for-sale.
  const listingType = Number(content.TransactionTypeUID) === 260 ? 'rent' : 'sale';

  // lot size can be a number (m2) or dimensions like "72x200"
  const lot = content.LotSize;
  const lotIsDims = typeof lot === 'string' && /x/i.test(lot);

  const coords = (content.Location && content.Location.coordinates) || [null, null];

  const address =
    content.FullAddress || content.TitleAddress || content.StreetName || content.City || 'Sin dirección';

  const mls = content.MLSID;

  const row = {
    source_id: source.id,
    external_id: mls,
    external_url: esUrl(content, baseUrl),
    origin: 'scraped',
    slug: `remax-${String(mls).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    address,
    latitude: num(coords[1]),
    longitude: num(coords[0]),
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(content.NumberOfBedrooms),
    bathrooms: num(content.NumberOfBathrooms),
    floor_area: num(content.BuiltArea) || num(content.LivingArea) || num(content.TotalArea),
    covered_area: num(content.BuiltArea) || num(content.LivingArea),
    land_area: lotIsDims ? null : num(lot),
    lot_dimensions: lotIsDims ? lot : null,
    parking_spaces: num(content.ParkingSpaces),
    garages: num(content.NumberOfGarages),
    floors: num(content.NumberOfFloors),
    year_built: num(content.YearBuilt),
    total_rooms: num(content.TotalNumOfRooms),
    city: content.City || null,
    province: content.Province || null,
    neighborhood: content.District || content.LocalZone || null,
    country: 'Paraguay',
    zipcode: content.PostalCode || null,
    property_type: content.PropertyTypeUID ? String(content.PropertyTypeUID) : null,
    description: esDesc(content),
    features: content.ListingFeatures || [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: (content._agent && content._agent.name) || content.OfficeName || null,
    contact_phone: (content._agent && content._agent.phone) || null,
    raw_data: content,
  };

  // images
  const regionId = content.RegionId;
  const imgs = (content.ListingImages || [])
    .slice()
    .sort((a, b) => Number(a.Order || 0) - Number(b.Order || 0))
    .slice(0, MAX_IMAGES)
    .map((im, i) => {
      const folder = im.IsWatermarked === '1' ? 'LargeWM' : 'Large';
      return {
        source_url: `${config.cdn}/${regionId}/${folder}/${im.FileName}`,
        position: i,
        is_feature: i === 0,
      };
    });

  // stable input for change-detection hash
  const hashInput = JSON.stringify({
    price,
    currency,
    listingType,
    beds: row.bedrooms,
    baths: row.bathrooms,
    area: row.floor_area,
    land: row.land_area,
    address,
    desc: row.description,
    imgs: imgs.map((x) => x.source_url),
  });

  return { external_id: mls, row, images: imgs, hashInput };
}

export default { fetchPage, mapListing };
