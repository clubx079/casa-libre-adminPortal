// The website's page matrix, as the SEO pipeline needs it (pure — tests load it directly).
// Same slugs and type keywords as the website's lib/matrix.js (casa-libre-buyerPortal):
//   /{op}/{tipo}/{ciudad}            op × type × city            (exists with ≥1 listing, indexed with ≥5)
//   /{op}/{tipo}/{ciudad}/{barrio}   … × neighbourhood           (exists + indexed with ≥5)
//   /{op}/{tipo}/{ciudad}/{variant}  … × a real filter (VARIANTS) (only when switched on in seo_overrides, indexed with ≥5)
export const MIN_LISTINGS = 5;

export const OPS = {
  venta: { label: 'en venta', short: 'Venta' },
  alquiler: { label: 'en alquiler', short: 'Alquiler' },
};

export const TIPOS = {
  casas: { type: 'casa', kw: ['casa', 'house'], sing: 'casa', plural: 'casas' },
  departamentos: { type: 'depto', kw: ['departamento', 'depto', 'apartment', 'flat'], sing: 'departamento', plural: 'departamentos' },
  duplex: { type: 'duplex', kw: ['duplex', 'dúplex'], sing: 'dúplex', plural: 'dúplex' },
  oficinas: { type: 'oficina', kw: ['oficina', 'office'], sing: 'oficina', plural: 'oficinas' },
  locales: { type: 'comercial', kw: ['comercial', 'local', 'commercial', 'tienda'], sing: 'local comercial', plural: 'locales comerciales' },
  depositos: { type: 'deposito', kw: ['deposito', 'depósito', 'warehouse', 'galp'], sing: 'depósito', plural: 'depósitos' },
  terrenos: { type: 'terreno', kw: ['terreno', 'lote', 'fracci', 'parcela'], sing: 'terreno', plural: 'terrenos' },
};

// Page variants = real filters on a city page. Same list as the website's lib/seoVariants.js.
//   baratos        price (US$) below the median of that op + type + city
//   N-dormitorio(s) exactly N bedrooms
export const VARIANTS = {
  baratos: { label: 'baratos', kind: 'cheap' },
  '1-dormitorio': { label: 'de 1 dormitorio', kind: 'beds', beds: 1 },
  '2-dormitorios': { label: 'de 2 dormitorios', kind: 'beds', beds: 2 },
  '3-dormitorios': { label: 'de 3 dormitorios', kind: 'beds', beds: 3 },
};
export const VARIANT_SLUGS = Object.keys(VARIANTS);

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
export const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export function typeSlugOf(propertyType) {
  const h = norm(propertyType);
  for (const [slug, t] of Object.entries(TIPOS)) if (t.kw.some((k) => h.includes(norm(k)))) return slug;
  return null;
}

export function citySlugOf(city, cities) {
  const h = norm(city);
  if (!h) return null;
  const hit = cities.find((c) => h === norm(c.name) || h.includes(norm(c.name)) || h === c.slug);
  return hit ? hit.slug : null;
}

export const opOfListing = (listingType) => (listingType === 'rent' ? 'alquiler' : 'venta');

// Path helpers. parts: { op, tipo, ciudad, barrio?, variant? }
export function pathOf({ op, tipo, ciudad, barrio, variant }) {
  if (!op || !tipo || !ciudad) return null;
  return `/${op}/${tipo}/${ciudad}${barrio ? `/${barrio}` : variant ? `/${variant}` : ''}`;
}
export function parsePath(path) {
  const seg = String(path || '').replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0].split('/').filter(Boolean);
  if (seg.length < 3 || !OPS[seg[0]] || !TIPOS[seg[1]]) return null;
  const out = { op: seg[0], tipo: seg[1], ciudad: seg[2] };
  if (seg[3]) { if (VARIANTS[seg[3]]) out.variant = seg[3]; else out.barrio = seg[3]; }
  if (seg.length > 4) return null;
  return out;
}
export const basePathOf = (path) => { const p = parsePath(path); return p ? pathOf({ op: p.op, tipo: p.tipo, ciudad: p.ciudad }) : null; };
