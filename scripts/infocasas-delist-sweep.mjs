#!/usr/bin/env node
// Standalone CLI: delist InfoCasas Paraguay listings that haven't been seen
// in a full sweep for N days (default 7). Run with plain node (no Next.js):
//
//   node scripts/infocasas-delist-sweep.mjs                 # dry-run (default), N=7
//   node scripts/infocasas-delist-sweep.mjs --days 10        # dry-run, N=10
//   node scripts/infocasas-delist-sweep.mjs --commit         # actually PATCH is_delisted=true
//
// Why 7 days: N must be at least one full incremental sweep cycle across all
// ~104 InfoCasas shards (the cron rotates all shards every few hours once
// backfilled), so a listing that's truly gone from the source will have had
// many chances to be re-confirmed (last_seen_at bumped) before it's this
// stale. 7 days is a generous safety margin over that cycle time.
//
// Env is loaded manually from .env.local (Next.js's dotenv loading doesn't
// apply to a standalone node script). Needs AIROBASE_URL, AIROBASE_SECRET_KEY.
//
// NO server-only / lib/db imports — talks to AiroBase via plain fetch, same
// convention as scripts/backfill-ai-types.mjs and scripts/seed-infocasas-shards.mjs.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadEnvLocal() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error(`[delist-sweep] .env.local not found at ${envPath}`);
    return;
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();

const AIROBASE_URL = process.env.AIROBASE_URL;
const AIROBASE_SECRET_KEY = process.env.AIROBASE_SECRET_KEY;

function fail(msg) {
  console.error(`[delist-sweep] ${msg}`);
  process.exit(1);
}

if (!AIROBASE_URL) fail('AIROBASE_URL is not set (checked process.env and .env.local)');
if (!AIROBASE_SECRET_KEY) fail('AIROBASE_SECRET_KEY is not set (checked process.env and .env.local)');

// ---- CLI args ----
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DRY_RUN = !COMMIT; // safe default: dry-run unless --commit is explicitly passed
const daysIdx = args.indexOf('--days');
const DAYS = daysIdx !== -1 && args[daysIdx + 1] ? Number(args[daysIdx + 1]) : 7;

if (!Number.isFinite(DAYS) || DAYS <= 0) fail(`--days must be a positive number (got ${args[daysIdx + 1]})`);

// ---- PostgREST helpers ----
function pgHeaders(extra = {}) {
  return {
    apikey: AIROBASE_SECRET_KEY,
    Authorization: `Bearer ${AIROBASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function getInfocasasSourceId() {
  const res = await fetch(`${AIROBASE_URL}/rest/v1/scrape_sources?key=eq.infocasas&select=id,name`, {
    headers: pgHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PostgREST GET scrape_sources ${res.status}: ${text.slice(0, 300)}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

const SAMPLE_SIZE = 10;

async function countCandidates(sourceId, cutoffIso) {
  const query =
    `select=id&source_id=eq.${sourceId}&last_seen_at=lt.${encodeURIComponent(cutoffIso)}&is_delisted=eq.false&limit=1`;
  const res = await fetch(`${AIROBASE_URL}/rest/v1/properties?${query}`, {
    headers: pgHeaders({ Prefer: 'count=exact' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PostgREST GET properties (count) ${res.status}: ${text.slice(0, 300)}`);
  }
  await res.json(); // drain body
  const cr = res.headers.get('content-range') || '';
  const total = cr.includes('/') ? Number(cr.split('/')[1]) : null;
  return Number.isFinite(total) ? total : 0;
}

async function fetchSample(sourceId, cutoffIso) {
  const query =
    `select=id,address,city,last_seen_at&source_id=eq.${sourceId}&last_seen_at=lt.${encodeURIComponent(cutoffIso)}&is_delisted=eq.false&order=last_seen_at.asc&limit=${SAMPLE_SIZE}`;
  const res = await fetch(`${AIROBASE_URL}/rest/v1/properties?${query}`, {
    headers: pgHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PostgREST GET properties (sample) ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function delistCandidates(sourceId, cutoffIso) {
  const query = `source_id=eq.${sourceId}&last_seen_at=lt.${encodeURIComponent(cutoffIso)}&is_delisted=eq.false`;
  const res = await fetch(`${AIROBASE_URL}/rest/v1/properties?${query}`, {
    method: 'PATCH',
    headers: pgHeaders({ Prefer: 'return=representation,count=exact' }),
    body: JSON.stringify({ is_delisted: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PostgREST PATCH properties ${res.status}: ${text.slice(0, 300)}`);
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

async function main() {
  console.log(
    `[delist-sweep] starting${DRY_RUN ? ' (dry-run, no writes)' : ' (COMMIT MODE — will write)'} days=${DAYS}`
  );

  const source = await getInfocasasSourceId();
  if (!source) {
    console.log(
      "[delist-sweep] scrape_sources row for key='infocasas' not found — migration not applied yet (migrations/005_infocasas.sql). Nothing to do."
    );
    process.exit(0);
  }
  console.log(`[delist-sweep] source found: id=${source.id} name=${source.name}`);

  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  console.log(`[delist-sweep] cutoff: last_seen_at < ${cutoffIso}`);

  const count = await countCandidates(source.id, cutoffIso);
  console.log(`[delist-sweep] candidates (not seen since cutoff, not already delisted): ${count}`);

  if (count > 0) {
    const sample = await fetchSample(source.id, cutoffIso);
    console.log(`[delist-sweep] sample (up to ${SAMPLE_SIZE}, oldest first):`);
    for (const row of sample) {
      console.log(`  ${row.id}  ${row.address || '(no address)'}, ${row.city || '(no city)'}  last_seen_at=${row.last_seen_at}`);
    }
  }

  if (DRY_RUN) {
    console.log(`[delist-sweep] dry-run: would delist ${count} row(s). Re-run with --commit to apply.`);
    return;
  }

  if (count === 0) {
    console.log('[delist-sweep] nothing to delist.');
    return;
  }

  const updated = await delistCandidates(source.id, cutoffIso);
  console.log(`[delist-sweep] delisted ${updated} row(s).`);
}

main().catch((err) => {
  console.error(`[delist-sweep] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
