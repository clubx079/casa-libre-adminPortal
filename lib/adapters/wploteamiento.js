// Adapter: WordPress loteamiento marketing sites (La Loteadora, LPI, ...).
// These sell land subdivisions as plain WP `posts` (no real-estate CPT), filed
// under a category = city. The REST collection gives title/description/city +
// hero image; price (a monthly "cuota") and the photo gallery live only in the
// rendered Elementor HTML, so we fetch each post's page too. Config-driven so any
// such WP site works: api_base, price_regex, gallery_regex/exclude, contact_phone.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const listCache = new Map();

const stripHtml = (h) => (h ? String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8[0-9]+;/g, ' ').replace(/\s+/g, ' ').trim() : null);

// Collapse WordPress "-WxH" thumbnail variants to the full-size original,
// keeping first-seen order. The bare original always exists in WP uploads.
function dedupeVariants(urls) {
  const out = [];
  const seen = new Set();
  for (const u of urls) {
    const base = u.replace(/-\d{2,4}x\d{2,4}(\.\w+)(?:\?.*)?$/i, '$1');
    if (!seen.has(base)) { seen.add(base); out.push(base); }
  }
  return out;
}

function base(config) {
  return (config.api_base || config.base_url || '').replace(/\/$/, '');
}
function reOrNull(src, flags) {
  if (!src) return null;
  try { return new RegExp(src, flags); } catch { return null; }
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json' } });
  if (!res.ok) throw new Error(`wp ${res.status} @ ${url}`);
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

// Pull all posts via the WP REST collection (per_page capped at 100). Cached.
async function getPosts(config) {
  const b = base(config);
  const cached = listCache.get(b);
  if (cached && Date.now() - cached.t < 120000) return cached.posts;

  const posts = [];
  for (let page = 1; page <= 30; page++) {
    const url = `${b}/wp-json/wp/v2/posts?per_page=100&page=${page}&_embed`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) break;
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) break;
    posts.push(...arr);
    const totalPages = Number(res.headers.get('x-wp-totalpages')) || 1;
    if (page >= totalPages) break;
  }
  listCache.set(b, { t: Date.now(), posts });
  return posts;
}

function heroImage(post) {
  const fm = post?._embedded?.['wp:featuredmedia']?.[0];
  return fm?.source_url || post.featured_image_url || null;
}
function cityOf(post) {
  const terms = post?._embedded?.['wp:term'] || [];
  for (const group of terms) {
    for (const t of group) {
      if (t.taxonomy === 'category' && t.name && !/sin categor/i.test(t.name)) return t.name;
    }
  }
  return null;
}

// Parse the rendered detail page for installment price + gallery images.
function parseDetail(html, config) {
  const out = { price: null, currency: null, soldOut: false, images: [] };

  const priceRe = reOrNull(config.price_regex, 'i');
  if (priceRe) {
    const m = html.match(priceRe);
    if (m && m[1]) {
      const raw = m[1];
      out.currency = /usd|u\$s|\$/i.test(raw) ? 'USD' : /gs|g\.|₲|guar/i.test(raw) ? 'PYG' : 'PYG';
      const intPart = raw.replace(/[^\d.,]/g, '').replace(/\./g, '').split(',')[0];
      out.price = intPart ? Number(intPart) : null;
    }
  }
  if (config.soldout_regex) {
    const soRe = reOrNull(config.soldout_regex, 'i');
    if (soRe && soRe.test(html)) out.soldOut = true;
  }

  const galRe = reOrNull(config.gallery_regex, 'gi') ||
    new RegExp(`https?://[^"'\\s]*${base(config).replace(/^https?:\/\//, '').replace(/\./g, '\\.')}/wp-content/uploads/[^"'\\s]+\\.(?:jpe?g|png|webp)`, 'gi');
  const excludeRe = reOrNull(config.gallery_exclude, 'i');
  const imgs = [...new Set(html.match(galRe) || [])].filter((u) => !excludeRe || !excludeRe.test(u));
  out.images = dedupeVariants(imgs);
  return out;
}

// Orchestrator contract: { total, items } for the window [skip, skip+top).
async function fetchPage(config, filters, skip, top) {
  const posts = await getPosts(config);
  const total = posts.length;
  const windowPosts = posts.slice(skip, skip + top);
  const maxImages = Number(config.max_images) || 15;
  const items = await pool(windowPosts, 4, async (post) => {
    const hero = heroImage(post);
    let detail = { price: null, currency: null, soldOut: false, images: [] };
    try { detail = parseDetail(await fetchText(post.link), config); } catch { /* keep REST-only */ }
    const gallery = [];
    if (hero) gallery.push(hero);
    for (const u of detail.images) if (!gallery.includes(u)) gallery.push(u);
    return {
      id: post.id,
      title: stripHtml(post.title?.rendered),
      link: post.link,
      slug: post.slug,
      description: stripHtml(post.content?.rendered) || stripHtml(post.excerpt?.rendered),
      city: cityOf(post),
      price: detail.price,
      currency: detail.currency,
      soldOut: detail.soldOut,
      images: gallery.slice(0, maxImages),
    };
  });
  return { total, items };
}

function mapListing(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const currency = it.currency || (it.price != null ? 'PYG' : null);
  const price = it.price ?? null;
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const ptype = config.property_type || 'loteamiento';

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: it.link || null,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address: [it.title, it.city].filter(Boolean).join(', ') || it.title || 'Loteamiento',
    seo_title: it.title || null,
    latitude: null,
    longitude: null,
    price,
    currency,
    // land subdivisions sold on installments -> price is a monthly cuota
    price_usd: priceUsd,
    listing_type: 'sale',
    price_period: price != null ? 'month' : null,
    bedrooms: null,
    bathrooms: null,
    floor_area: null,
    covered_area: null,
    land_area: null,
    city: it.city || null,
    province: null,
    neighborhood: null,
    country: 'Paraguay',
    property_type: ptype,
    description: it.description || null,
    features: [],
    status: 'published',
    property_status: it.soldOut ? 'sold' : 'available',
    admin_status: 'active',
    contact_phone: config.contact_phone || null,
    raw_data: { ...it, platform: 'wp-loteamiento' },
  };

  const images = (it.images || []).map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));
  const hashInput = JSON.stringify({
    price, currency, soldOut: it.soldOut, title: it.title, city: it.city,
    desc: it.description, imgs: it.images,
  });
  return { external_id: id, row, images, hashInput };
}

export default { fetchPage, mapListing };
