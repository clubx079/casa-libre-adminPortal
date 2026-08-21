#!/usr/bin/env node
// Standalone CLI: backfill contact_phone (+ contact_name) onto EXISTING
// `properties` rows that were scraped before the adapters learned to capture
// the agent phone. Without a phone these listings are hidden from the buyer
// marketplace (contact_phone=not.is.null gate) — this makes them live again.
//
// A plain re-scrape can't fix them: contact_phone isn't part of source_hash, so
// unchanged listings hit the "skip" branch and never get the phone written.
//
//   node scripts/backfill-contact-phones.mjs --dry-run
//   node scripts/backfill-contact-phones.mjs --source tulugar_py --limit 20
//   node scripts/backfill-contact-phones.mjs
//
// Needs AIROBASE_URL + AIROBASE_SECRET_KEY (loaded from .env.local).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractContact, normalizePyPhone } from '../lib/contactPhone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvLocal();

const BASE = process.env.AIROBASE_URL;
const KEY = process.env.AIROBASE_SECRET_KEY;
if (!BASE || !KEY) { console.error('[backfill] AIROBASE_URL / AIROBASE_SECRET_KEY missing'); process.exit(1); }

const DRY = process.argv.includes('--dry-run');
const SRC_ARG = (() => { const i = process.argv.indexOf('--source'); return i > -1 ? process.argv[i + 1] : null; })();
const LIMIT_ARG = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : null; })();

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(pathq, opts = {}) {
  const res = await fetch(`${BASE}/rest/v1/${pathq}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`REST ${res.status} ${pathq} :: ${(await res.text()).slice(0, 200)}`);
  return res;
}
const patchPhone = async (id, phone, name) => {
  if (DRY) return;
  await rest(`properties?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ contact_phone: phone, ...(name ? { contact_name: name } : {}) }),
  });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchHtml(url, tries = 4) {
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (e) {
      if (a === tries - 1) throw e;
      await sleep(1500 * (a + 1) + Math.floor(a * 500)); // linear backoff
    }
  }
}

// --- per-source phone resolvers -> { phone, name } | null ---
const resolvers = {
  // Sotheby's / Raíces: agent card in the detail HTML (telf:/phoneLink).
  async raices_html(row) {
    if (!row.external_url) return null;
    const html = await fetchHtml(row.external_url);
    const main = html.split('search_result_box')[0];
    const section = (main.match(/property_contact[\s\S]*/) || [main])[0];
    const name = (section.match(/mediumTitle">\s*([^<]+?)\s*<\/h4>/i) || [])[1];
    const c = extractContact(section);
    if (c && c.phone) return { phone: c.phone, name: (name && name.replace(/\s+/g, ' ').trim()) || c.name || null };
    return null;
  },
  // tulugar: schema.org JSON-LD in the SSR page.
  async tulugar_api(row) {
    if (!row.external_url) return null;
    return extractContact(await fetchHtml(row.external_url));
  },
  // inmob123: phone usually sits in raw_data; legacy rows predate that, so fall
  // back to the detail page (vend-card name + whatsapp link).
  async inmob123_html(row) {
    const rd = row.raw_data || {};
    const phone = normalizePyPhone(rd.contactPhone);
    if (phone) return { phone, name: rd.contactName || null };
    if (!row.external_url) return null;
    const html = await fetchHtml(row.external_url);
    const name = (html.match(/vend-card__nombre"[^>]*>([^<]+)/) || [])[1];
    const c = extractContact(html);
    if (c && c.phone) return { phone: c.phone, name: (name && name.trim()) || c.name || null };
    return null;
  },
  // remax: resolve AgentId -> phone via the GryphTech agent-search index.
  async remax_gryphtech(row, cfg) {
    const rd = row.raw_data || {};
    const agentId = rd.AgentId;
    if (!agentId || !cfg?.search_url) return null;
    const agentUrl = String(cfg.search_url).replace('listing-search', 'agent-search');
    const res = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://www.remax.com.py', Referer: 'https://www.remax.com.py/', 'User-Agent': UA },
      body: JSON.stringify({ count: true, top: 1, searchMode: 'all', queryType: 'simple', search: String(agentId), filter: `content/TenantId eq ${cfg.tenantid}` }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.value?.[0]?.content;
    if (!c) return null;
    const phone = normalizePyPhone(c.WhatsApp || c.AgentPhone || c.AgentDirectDialPhone || c.OfficePhone);
    const name = c.AgentName || [c.FirstName, c.LastName].filter(Boolean).join(' ') || c.OfficeName || null;
    return phone ? { phone, name: name || null } : null;
  },
};

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

async function main() {
  // sources that need phone backfill, keyed by adapter
  let sources = await (await rest('scrape_sources?select=id,key,adapter,config')).json();
  sources = sources.filter((s) => resolvers[s.adapter]);
  if (SRC_ARG) sources = sources.filter((s) => s.key === SRC_ARG);

  const grand = { scanned: 0, filled: 0, missed: 0, errs: 0 };
  for (const src of sources) {
    const resolver = resolvers[src.adapter];
    // pull rows missing a phone for this source
    let q = `properties?select=id,external_id,external_url,raw_data&source_id=eq.${src.id}&or=(contact_phone.is.null,contact_phone.eq.)&order=id`;
    if (LIMIT_ARG) q += `&limit=${LIMIT_ARG}`;
    const rows = await (await rest(q)).json();
    if (!rows.length) { console.log(`[${src.key}] nothing to backfill`); continue; }
    const st = { scanned: 0, filled: 0, missed: 0, errs: 0 };
    await pool(rows, 5, async (row) => {
      st.scanned++;
      try {
        const c = await resolver(row, src.config);
        if (c && c.phone) { await patchPhone(row.id, c.phone, c.name); st.filled++; }
        else st.missed++;
      } catch { st.errs++; }
      if (st.scanned % 25 === 0) console.log(`[${src.key}] ${st.scanned}/${rows.length} · filled ${st.filled} · missed ${st.missed} · errs ${st.errs}`);
    });
    console.log(`[${src.key}] DONE ${st.scanned} scanned · ${st.filled} filled · ${st.missed} missed · ${st.errs} errs${DRY ? ' (dry-run)' : ''}`);
    for (const k of Object.keys(grand)) grand[k] += st[k];
  }
  console.log(`\n== TOTAL ${grand.scanned} scanned · ${grand.filled} filled · ${grand.missed} missed · ${grand.errs} errs${DRY ? ' (dry-run)' : ''} ==`);
}
main().catch((e) => { console.error(e); process.exit(1); });
