// Leads → "Agency websites" tab: one row per agency / developer company instead of one per
// person, with its own website, where we found it, how many of its agents we have, whether
// its site shows listings (scripts/check-agency-sites.mjs → data/agencySiteChecks.json) and
// whether it is already on Casa-Libre (an account or a listing with its phone / email).
// Pure (tests/agencySites.test.mjs).

// Pages that are NOT the agency's own website.
const NOT_OWN = [
  /(^|\.)exa\.ai$/, /(^|\.)archive\.org$/, /(^|\.)google\./, /(^|\.)infocasas\./, /(^|\.)holacasa\./, /(^|\.)ubicaprop\./,
  /(^|\.)wasi\.co$/, /(^|\.)casa-libre\./, /(^|\.)ciu\.org\.uy$/, /(^|\.)linkedin\.com$/, /(^|\.)wa\.me$/, /(^|\.)whatsapp\.com$/,
  /(^|\.)mercadolibre\./, /(^|\.)olx\./, /(^|\.)clasipar\./, /(^|\.)encuentra24\./, /(^|\.)properati\./, /(^|\.)yelp\./,
  /(^|\.)paginasamarillas\./, /(^|\.)cybo\.com$/, /(^|\.)bing\.com$/, /(^|\.)youtube\.com$/,
];
const SOCIAL = [[/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'Facebook'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)(x|twitter)\.com$/, 'X']];
// Franchise networks: the page is the network's site (an office page), not the agency's own.
// Only the network's own main site (first label exactly the brand: remax.com.ve, c21.com.bo,
// century21.com.py…). An office's own domain (remaxhabitat.com, remax-central.com.sv) is its website.
const NETWORKS = [[/^(remax|remax-centralamerica)$/, 'RE/MAX'], [/^(century21|c21)$/, 'Century 21'], [/^sothebysrealty$/, "Sotheby's"], [/^(kw|kellerwilliams)$/, 'Keller Williams'], [/^coldwellbanker$/, 'Coldwell Banker']];
// Free mail: an address there says nothing about the company's domain.
const FREE_MAIL = /^(gmail|hotmail|outlook|live|yahoo|icloud|me|aol|proton(mail)?|msn|mail|gmx)\./;

export const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
export const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(inmobiliaria|bienes raices|real estate|s\.?a\.?|s\.?r\.?l\.?|e\.?a\.?s\.?|group|grupo)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export const digits = (p) => String(p || '').replace(/\D/g, '');
const phoneKey = (p) => { const d = digits(p); return d.length >= 7 ? d.slice(-8) : ''; };

// → { kind: 'own' | 'network' | 'social' | 'directory' | 'none', host, home, label }
export function siteOf(url) {
  const host = hostOf(url);
  if (!host) return { kind: 'none', host: '', home: null, label: null };
  if (NOT_OWN.some((r) => r.test(host))) return { kind: 'directory', host, home: null, label: null };
  const soc = SOCIAL.find(([r]) => r.test(host));
  if (soc) return { kind: 'social', host, home: url, label: soc[1] };
  const first = host.split('.')[0];
  const net = NETWORKS.find(([r]) => r.test(first));
  if (net) return { kind: 'network', host, home: url, label: net[1] };
  return { kind: 'own', host, home: `https://${host}/`, label: null };
}

// One scraped lead row → the agency it belongs to (or null: an independent agent with no site).
function agencyOfRow(r) {
  const site = siteOf(r.source_url);
  const isCompany = r.category === 'agency' || r.category === 'developer';
  const name = isCompany ? r.name : (r.legal_name || null);
  if (site.kind === 'own') return { key: `h:${site.host}`, name, site };
  if (name && normName(name)) return { key: `n:${normName(name)}`, name, site };
  return null;
}

// potential_leads rows → agencies (sorted: most agents first, then name)
export function groupAgencies(rows = []) {
  const map = new Map();
  let independent = 0;
  for (const r of rows) {
    const a = agencyOfRow(r);
    if (!a) { independent++; continue; }
    let g = map.get(a.key);
    if (!g) {
      g = { key: a.key, names: new Map(), companyName: null, website: null, host: null, network: null, networkUrl: null, socials: new Set(),
        sources: new Set(), agents: 0, leads: 0, developer: false, phones: new Set(), whatsapp: null, emails: new Set(), locations: new Set(), leadIds: [] };
      map.set(a.key, g);
    }
    g.leads++; g.leadIds.push(r.id);
    if (r.category === 'agent') g.agents++;
    if (r.category === 'developer') g.developer = true;
    if ((r.category === 'agency' || r.category === 'developer') && !g.companyName) g.companyName = r.name;
    if (a.name) g.names.set(a.name, (g.names.get(a.name) || 0) + 1);
    if (a.site.kind === 'own') { g.website = a.site.home; g.host = a.site.host; }
    if (a.site.kind === 'network' && !g.network) { g.network = a.site.label; g.networkUrl = a.site.home; }
    if (a.site.kind === 'social') g.socials.add(a.site.home);
    if (r.source) g.sources.add(r.source);
    for (const p of [r.whatsapp, r.phone]) if (p) g.phones.add(p);
    if (r.whatsapp && !g.whatsapp) g.whatsapp = r.whatsapp;
    if (r.email) g.emails.add(String(r.email).trim().toLowerCase());
    if (r.location) g.locations.add(r.location);
  }
  // A name-only group (e.g. a RE/MAX office page) that has the same name as a website group → one agency.
  const byName = new Map();
  for (const g of map.values()) if (g.host) for (const n of [g.companyName, ...g.names.keys()].filter(Boolean)) byName.set(normName(n), g);
  for (const [k, g] of [...map]) {
    if (g.host) continue;
    const target = [g.companyName, ...g.names.keys()].map(normName).map((n) => byName.get(n)).find(Boolean);
    if (!target) continue;
    target.leads += g.leads; target.agents += g.agents; target.developer ||= g.developer; target.leadIds.push(...g.leadIds);
    target.companyName ||= g.companyName;
    for (const [n, c] of g.names) target.names.set(n, (target.names.get(n) || 0) + c);
    if (!target.network && g.network) { target.network = g.network; target.networkUrl = g.networkUrl; }
    for (const s of ['socials', 'sources', 'phones', 'emails', 'locations']) for (const v of g[s]) target[s].add(v);
    target.whatsapp ||= g.whatsapp;
    map.delete(k);
  }
  const out = [...map.values()].map((g) => {
    const topName = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      key: g.key,
      name: g.companyName || topName || g.host,
      type: g.developer ? 'developer' : 'agency',
      website: g.website, host: g.host, network: g.network, networkUrl: g.networkUrl, socials: [...g.socials].slice(0, 3),
      sources: [...g.sources], agents: g.agents, leads: g.leads,
      phones: [...g.phones].slice(0, 3), whatsapp: g.whatsapp, emails: [...g.emails].slice(0, 3), location: [...g.locations][0] || null,
      leadIds: g.leadIds,
    };
  });
  out.sort((a, b) => b.agents - a.agents || b.leads - a.leads || String(a.name).localeCompare(String(b.name)));
  return { agencies: out, independent };
}

// Is the agency already on Casa-Libre? users: [{ phone, email }], listings: [{ contact_phone, contact_email? }]
// → mutates each agency with onCasaLibre: { accounts, listings, via: 'phone' | 'email' | 'domain' | null }
export function matchCasaLibre(agencies, { users = [], listings = [] } = {}) {
  const userByPhone = new Map(); const userByEmail = new Map(); const userByDomain = new Map();
  for (const u of users) {
    const k = phoneKey(u.phone); if (k) userByPhone.set(k, (userByPhone.get(k) || 0) + 1);
    const e = String(u.email || '').trim().toLowerCase();
    if (e) {
      userByEmail.set(e, (userByEmail.get(e) || 0) + 1);
      const dom = e.split('@')[1] || '';
      if (dom && !FREE_MAIL.test(dom)) userByDomain.set(dom.replace(/^www\./, ''), (userByDomain.get(dom) || 0) + 1);
    }
  }
  const listByPhone = new Map();
  for (const l of listings) { const k = phoneKey(l.contact_phone); if (k) listByPhone.set(k, (listByPhone.get(k) || 0) + 1); }
  for (const a of agencies) {
    const pk = [...new Set(a.phones.map(phoneKey).filter(Boolean))];
    let accounts = 0; let via = null;
    for (const k of pk) if (userByPhone.get(k)) { accounts += userByPhone.get(k); via = 'phone'; }
    for (const e of a.emails) if (userByEmail.get(e)) { accounts += userByEmail.get(e); via ||= 'email'; }
    if (!accounts && a.host && userByDomain.get(a.host)) { accounts = userByDomain.get(a.host); via = 'domain'; }
    const nListings = pk.reduce((s, k) => s + (listByPhone.get(k) || 0), 0);
    a.onCasaLibre = { accounts, listings: nListings, via: via || (nListings ? 'phone' : null) };
  }
  return agencies;
}

// Count listing-like links in a page's HTML (same site). Used by the site checker.
const LISTING_PATH = /(propiedad|propiedades|inmueble|inmuebles|property|properties|listing|listings|ficha|detalle|venta|alquiler|casa|casas|departamento|apartamento|terreno|lote|local|oficina|quinta|duplex)/i;
export function countListingLinks(html, baseUrl) {
  const host = hostOf(baseUrl);
  const seen = new Set();
  for (const m of String(html || '').matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    let u; try { u = new URL(m[1], baseUrl); } catch { continue; }
    if (hostOf(u.href) !== host) continue;
    const p = u.pathname.toLowerCase();
    if (!LISTING_PATH.test(p)) continue;
    // a single listing: the path carries an id (4+ digits) or a long slug
    if (!/\d{3,}/.test(p) && !/[a-z0-9]+(-[a-z0-9]+){4,}/.test(p)) continue;
    seen.add(u.origin + p.replace(/\/$/, ''));
  }
  return seen.size;
}
// The link to the site's "all properties" page, if the home page has one.
export function findListingsPage(html, baseUrl) {
  const host = hostOf(baseUrl);
  for (const m of String(html || '').matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    let u; try { u = new URL(m[1], baseUrl); } catch { continue; }
    if (hostOf(u.href) !== host) continue;
    if (/\/(propiedades|inmuebles|properties|listings|busqueda|buscar|search|catalogo|venta|alquiler)(\/|\.htm|\?|$)/i.test(u.pathname + (u.search ? '?' : ''))) return u.href;
  }
  return null;
}
