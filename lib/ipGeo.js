// IP -> { city, state, country } via ip-api.com, remembered for as long as the server
// runs (an IP's location doesn't change). Shared by the Users page locations
// (/api/users/geo-lookup) and the Pakistan-account check (lib/internalAudience.js), so
// each IP is looked up once, not on every page. Server-only.
//
// The free tier allows 15 batch requests a minute (100 IPs each), http only. Batches
// run one after another; a failed batch is not remembered, so it's retried next time.
const NULL_GEO = { city: null, state: null, country: null };
const known = (globalThis.__clIpGeo ||= new Map()); // ip -> geo

async function batch(ips) {
  const res = await fetch('http://ip-api.com/batch?fields=status,city,regionName,countryCode,query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ips),
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ip-api ${res.status}`);
  const data = await res.json();
  for (const d of Array.isArray(data) ? data : []) {
    if (!d?.query) continue;
    known.set(d.query, d.status === 'success' ? { city: d.city, state: d.regionName, country: d.countryCode } : NULL_GEO);
  }
}

// → { ip: geo } for every ip asked (NULL_GEO when it couldn't be found)
export async function ipGeo(ips) {
  const want = [...new Set(ips.filter(Boolean))];
  const misses = want.filter((ip) => !known.has(ip));
  for (let i = 0; i < misses.length; i += 100) {
    try { await batch(misses.slice(i, i + 100)); } catch { /* not remembered: retried next time */ }
  }
  return Object.fromEntries(want.map((ip) => [ip, known.get(ip) || NULL_GEO]));
}
