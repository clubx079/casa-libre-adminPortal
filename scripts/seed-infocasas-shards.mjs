#!/usr/bin/env node
// Seeds `scrape_shards` for InfoCasas Paraguay: one row per
// (operation_type × estate), with property-type sub-splits for estates whose
// op-slice already fills a 100-row search page (too big for one shard).
//
//   node scripts/seed-infocasas-shards.mjs --dry-run   # print the matrix, no DB writes
//   node scripts/seed-infocasas-shards.mjs             # upsert into scrape_shards
//
// The InfoCasas GraphQL calls need no auth beyond the fixed GQL_HEADERS.
// The real (non-dry) run additionally needs AIROBASE_URL + AIROBASE_SECRET_KEY
// (loaded from .env.local below) to look up the `infocasas` source row and
// upsert shard rows — run migrations/005_infocasas.sql FIRST, or the source
// lookup will fail.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gql, searchListing } from '../lib/infocasasClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

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

const DRY_RUN = process.argv.includes('--dry-run');

const PARAGUAY_COUNTRY_ID = 2;
const OPERATIONS = [1, 2];         // 1 Venta, 2 Alquiler
const BIG_ESTATE_PTS = [1, 2, 3];  // casa, departamento, terreno
const ASUNCION_ESTATE_ID = 21;     // recon: runs first
const PAGE_FULL = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    })
  );
}

async function fetchParaguayEstates() {
  // `estates` returns an EstatePaginator ({ paginatorInfo, data }), same
  // shape as `searchListing` — NOT a bare list (confirmed via introspection:
  // `estates` -> EstatePaginator -> { paginatorInfo, data: [Estate] }).
  const data = await gql('query{ estates(first:200,page:1){ data{ id name country_id } } }');
  const estates = data?.estates?.data || [];
  return estates.filter((e) => Number(e.country_id) === PARAGUAY_COUNTRY_ID);
}

async function isBigSlice(operation_type_id, estate_id) {
  const { count } = await searchListing({ params: { operation_type_id, estate_id }, first: PAGE_FULL, page: 1 });
  return count >= PAGE_FULL;
}

function priorityFor(estateId) {
  return Number(estateId) === ASUNCION_ESTATE_ID ? 10 : 100;
}

async function buildShardMatrix(estates) {
  const shards = [];
  const jobs = [];
  for (const estate of estates) {
    for (const op of OPERATIONS) jobs.push({ estate, op });
  }

  await pool(jobs, 5, async ({ estate, op }) => {
    const estateId = Number(estate.id);
    const priority = priorityFor(estateId);
    const baseKey = `op${op}_estate${estateId}`;
    shards.push({
      shard_key: baseKey,
      params: { operation_type_id: op, estate_id: estateId },
      priority,
      estateName: estate.name,
    });

    let big = false;
    try {
      big = await isBigSlice(op, estateId);
    } catch (e) {
      console.error(`[seed] WARN: big-slice probe failed for ${baseKey}: ${e.message}`);
    }
    if (big) {
      for (const pt of BIG_ESTATE_PTS) {
        shards.push({
          shard_key: `${baseKey}_pt${pt}`,
          params: { operation_type_id: op, estate_id: estateId, property_type_id: pt },
          priority,
          estateName: estate.name,
        });
      }
    }
    await sleep(150); // polite pacing between probe requests
  });

  shards.sort((a, b) => a.priority - b.priority || a.shard_key.localeCompare(b.shard_key));
  return shards;
}

function printMatrix(shards) {
  console.log(`[seed] shard matrix: ${shards.length} shards`);
  for (const s of shards) {
    console.log(`  ${s.shard_key.padEnd(24)} prio=${s.priority} params=${JSON.stringify(s.params)}  (${s.estateName})`);
  }
}

async function upsertShards(shards) {
  const BASE = process.env.AIROBASE_URL;
  const KEY = process.env.AIROBASE_SECRET_KEY;
  if (!BASE || !KEY) {
    console.error('[seed] AIROBASE_URL / AIROBASE_SECRET_KEY missing (checked process.env and .env.local)');
    process.exit(1);
  }
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const sres = await fetch(`${BASE}/rest/v1/scrape_sources?key=eq.infocasas&select=id`, { headers: H });
  if (!sres.ok) throw new Error(`lookup scrape_sources failed: ${sres.status} ${(await sres.text()).slice(0, 200)}`);
  const [source] = await sres.json();
  if (!source) throw new Error("scrape_sources row for key='infocasas' not found — run migrations/005_infocasas.sql first");

  const rows = shards.map((s) => ({
    source_id: source.id,
    shard_key: s.shard_key,
    params: s.params,
    priority: s.priority,
  }));

  const res = await fetch(`${BASE}/rest/v1/scrape_shards?on_conflict=shard_key`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert scrape_shards failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  console.log(`[seed] upserted ${rows.length} shard rows for source ${source.id}`);
}

async function main() {
  console.log(`[seed] starting${DRY_RUN ? ' (dry-run, no DB writes)' : ''}`);

  const estates = await fetchParaguayEstates();
  console.log(`[seed] ${estates.length} Paraguay estates found (country_id=${PARAGUAY_COUNTRY_ID})`);
  if (!estates.length) {
    console.error('[seed] no Paraguay estates returned — aborting');
    process.exit(1);
  }

  const shards = await buildShardMatrix(estates);
  printMatrix(shards);

  if (DRY_RUN) {
    console.log('[seed] dry-run: no shards inserted');
    return;
  }
  await upsertShards(shards);
}

main().catch((err) => {
  console.error(`[seed] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
