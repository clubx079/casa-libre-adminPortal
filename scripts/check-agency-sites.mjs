// Agency website checker for Leads → "Agency websites" (lib/agencySites.js).
// READ-ONLY on the country DBs; fetches each agency's public home page (+ its "properties" page
// when linked) and counts listing links. Writes data/agencySiteChecks.json, which the
// /api/leads/agencies route bundles — commit + deploy the file after a run.
//   node scripts/check-agency-sites.mjs            (new + older than 7 days)
//   node scripts/check-agency-sites.mjs --retry    (also the failed ones, slowly)
//   node scripts/check-agency-sites.mjs --all      (everything again)
// DB settings: AIROBASE_URL_<CC> / AIROBASE_SECRET_KEY_<CC> from .env.local.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
const dbs = Object.fromEntries(['py', 'bo', 'uy', 've', 'sv'].map((cc) => [cc, { host: env[`AIROBASE_URL_${cc.toUpperCase()}`] || env.AIROBASE_URL, key: env[`AIROBASE_SECRET_KEY_${cc.toUpperCase()}`] || env.AIROBASE_SECRET_KEY }]));
const { groupAgencies, countListingLinks, findListingsPage } = await import(pathToFileURL(path.join(ROOT, 'lib/agencySites.js')).href);
const OUT = path.join(ROOT, 'data/agencySiteChecks.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
let checks = {}; try { checks = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
const ALL = process.argv.includes('--all');
const RETRY = process.argv.includes('--retry');   // recheck failed + never-checked, slowly
const CONC = RETRY ? 3 : 12; const TIMEOUT = RETRY ? 25000 : 15000;

const hosts = new Map();   // host → home url
const summary = [];
for (const cc of ['py', 'bo', 'uy', 've', 'sv']) {
  const d = dbs[cc]; const H = { apikey: d.key, Authorization: `Bearer ${d.key}` };
  const rows = await (await fetch(`${d.host}/rest/v1/potential_leads?select=id,name,legal_name,category,phone,whatsapp,email,location,source,source_url&limit=20000`, { headers: H })).json();
  const { agencies, independent } = groupAgencies(rows);
  const own = agencies.filter((a) => a.website);
  summary.push(`${cc}: leads=${rows.length} agencies=${agencies.length} withOwnSite=${own.length} network=${agencies.filter((a) => !a.website && a.network).length} independentAgents=${independent}`);
  for (const a of own) hosts.set(a.host, a.website);
}
console.log(summary.join('\n'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function get(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: ctl.signal });
    const html = r.ok ? (await r.text()).slice(0, 1_500_000) : '';
    return { status: r.status, html, url: r.url || url };
  } catch (e) { return { status: 0, html: '', url, error: String(e.cause?.code || e.name || e.message).slice(0, 40) }; } finally { clearTimeout(t); }
}
async function check(host, home) {
  const h = await get(home);
  if (!h.html) return { checkedAt: new Date().toISOString(), ok: false, status: h.status, error: h.error || null, listings: null, page: null };
  let listings = countListingLinks(h.html, h.url); let page = h.url;
  const lp = findListingsPage(h.html, h.url);
  if (lp && lp !== h.url) {
    const l = await get(lp);
    const n = l.html ? countListingLinks(l.html, l.url) : 0;
    if (n > listings) { listings = n; page = l.url; }
  }
  return { checkedAt: new Date().toISOString(), ok: true, status: h.status, listings, page };
}

const todo = [...hosts].filter(([h]) => ALL || !checks[h] || (RETRY && !checks[h].ok) || Date.now() - Date.parse(checks[h].checkedAt) > 7 * 864e5);
let done = 0;
const queue = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const [host, home] = queue.shift();
    checks[host] = await check(host, home);
    if (++done % 25 === 0) { fs.writeFileSync(OUT, JSON.stringify(checks, null, 0)); console.log(`${done}/${todo.length}`); }
  }
}));
fs.writeFileSync(OUT, JSON.stringify(checks, null, 0));
const vals = Object.values(checks);
console.log(`DONE ${done}/${todo.length} · total hosts ${vals.length} · site down ${vals.filter((v) => !v.ok).length} · with listings ${vals.filter((v) => v.listings >= 3).length} · none found ${vals.filter((v) => v.ok && v.listings < 3).length}`);
