// Public GraphQL client for InfoCasas + detail-page phone parser.
export const IC_GRAPHQL_URL = 'https://graph.infocasas.com.uy/graphql';
export const IC_ORIGIN = 'www.infocasas.com.py';
export const IC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
export const GQL_HEADERS = {
  'Content-Type': 'application/json',
  authorization: 'Bearer gika',
  'x-origin': IC_ORIGIN,
  'User-Agent': IC_UA,
};

const SEARCH_QUERY = `query($p:SearchParamsInput!,$f:Int!,$pg:Int!){
  searchListing(params:$p,first:$f,page:$pg){
    data{ id title address code latitude longitude m2 m2Built m2Terrain
      bedrooms bathrooms garage floor
      price{ amount currency{ id name rate } hidePrice }
      property_type{ id name } operation_type{ id name }
      neighborhood{ id name } estate{ id name } legacy_city legacy_neighborhood
      link isExternal active seller{ name } image_count img images{ id image tag } } } }`;

export async function searchListing({ params, first = 100, page = 1 }) {
  const body = JSON.stringify({ query: SEARCH_QUERY, variables: { p: params, f: first, pg: page } });
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(IC_GRAPHQL_URL, { method: 'POST', headers: GQL_HEADERS, body, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`infocasas gql ${res.status}`);
      const j = await res.json();
      if (j.errors && !j.data) throw new Error(`infocasas gql errors: ${JSON.stringify(j.errors).slice(0, 200)}`);
      const items = j.data?.searchListing?.data || [];
      return { items, count: items.length };
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
  }
  throw lastErr;
}

// Generic GraphQL POST helper for ad-hoc queries (e.g. estate enumeration for
// shard seeding) — same endpoint/headers/retry as searchListing, but returns
// the raw `data` object instead of assuming a `searchListing` shape.
export async function gql(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(IC_GRAPHQL_URL, { method: 'POST', headers: GQL_HEADERS, body, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`infocasas gql ${res.status}`);
      const j = await res.json();
      if (j.errors && !j.data) throw new Error(`infocasas gql errors: ${JSON.stringify(j.errors).slice(0, 200)}`);
      return j.data;
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
  }
  throw lastErr;
}

export function parsePhoneFromHtml(html) {
  const s = String(html || '');
  const wa = s.match(/"whatsapp_phone":"(\+?\d[\d ]{6,})"/);
  const ph = s.match(/"phone":"(\(?\+?[\d ()\-]{6,})"/);
  const nm = s.match(/"seller"[^}]*?"name":"([^"]{2,80})"/);
  const raw = (wa && wa[1]) || (ph && ph[1]) || null;
  const phone = raw ? raw.replace(/[^\d+]/g, '') : null;
  return { phone: phone && phone.replace(/\D/g, '').length >= 6 ? phone : null, name: nm ? nm[1] : null };
}

export async function fetchPhone(link) {
  if (!link) return { phone: null, name: null };
  try {
    const res = await fetch(`https://www.infocasas.com.py/${link}`, { headers: { 'User-Agent': IC_UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { phone: null, name: null };
    return parsePhoneFromHtml(await res.text());
  } catch { return { phone: null, name: null }; }
}
