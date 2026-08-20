#!/usr/bin/env node
// Standalone CLI: backfill AI property-type classification onto existing
// active + complete deals in AiroBase. Run with plain node (no Next.js), e.g.:
//
//   node scripts/backfill-ai-types.mjs --dry-run --limit 3
//   node scripts/backfill-ai-types.mjs
//
// Env is loaded manually from .env.local (Next.js's dotenv loading doesn't
// apply to a standalone node script). Needs AIROBASE_URL, AIROBASE_SECRET_KEY,
// GROQ_API_KEY, GROQ_MODEL.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyPropertyTypeCore } from '../lib/aiClassifyCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadEnvLocal() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error(`[backfill] .env.local not found at ${envPath}`);
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
    // Strip matching surrounding quotes, if any.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();

const AIROBASE_URL = process.env.AIROBASE_URL;
const AIROBASE_SECRET_KEY = process.env.AIROBASE_SECRET_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

function fail(msg) {
  console.error(`[backfill] ${msg}`);
  process.exit(1);
}

if (!AIROBASE_URL) fail('AIROBASE_URL is not set (checked process.env and .env.local)');
if (!AIROBASE_SECRET_KEY) fail('AIROBASE_SECRET_KEY is not set (checked process.env and .env.local)');
if (!GROQ_API_KEY) fail('GROQ_API_KEY is not set (checked process.env and .env.local) - classification would no-op');

// ---- CLI args ----
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : null;

// ---- PostgREST helpers ----
function pgHeaders(extra = {}) {
  return {
    apikey: AIROBASE_SECRET_KEY,
    Authorization: `Bearer ${AIROBASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

const SELECT_FIELDS =
  'id,property_type,address,city,neighborhood,description,bedrooms,bathrooms,parking_spaces,covered_area,floor_area,land_area,listing_type,price,currency';

// Mirrors the buyer portal's completeness pre-filter for "active, complete" deals.
const BASE_FILTER = `admin_status=eq.active&contact_phone=not.is.null&price=gt.0`;

const PAGE_SIZE = 200;

async function fetchPage(offset) {
  const query = `select=${SELECT_FIELDS}&${BASE_FILTER}&order=id.asc&offset=${offset}&limit=${PAGE_SIZE}`;
  const res = await fetch(`${AIROBASE_URL}/rest/v1/properties?${query}`, {
    headers: pgHeaders({ Prefer: 'count=exact' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PostgREST GET ${res.status}: ${text.slice(0, 300)}`);
  }
  const rows = await res.json();
  const cr = res.headers.get('content-range') || '';
  const total = cr.includes('/') ? Number(cr.split('/')[1]) : null;
  return { rows, total: Number.isFinite(total) ? total : null };
}

async function patchType(id, propertyType, attempt = 0) {
  const res = await fetch(`${AIROBASE_URL}/rest/v1/properties?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: pgHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ property_type: propertyType }),
  });
  if (res.status === 429 && attempt === 0) {
    await sleep(2000);
    return patchType(id, propertyType, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PostgREST PATCH ${res.status}: ${text.slice(0, 300)}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function classifyWithRetry(row) {
  let type = await classifyPropertyTypeCore(row, { apiKey: GROQ_API_KEY, model: GROQ_MODEL });
  if (type == null) {
    // One extra courtesy retry after a short backoff (handles a transient
    // rate-limit/timeout without giving up on the row outright).
    await sleep(1200);
    type = await classifyPropertyTypeCore(row, { apiKey: GROQ_API_KEY, model: GROQ_MODEL });
  }
  return type;
}

async function main() {
  console.log(
    `[backfill] starting${DRY_RUN ? ' (dry-run, no writes)' : ''}${LIMIT ? ` limit=${LIMIT}` : ''} model=${GROQ_MODEL}`
  );

  const stats = { processed: 0, updated: 0, unchanged: 0, failed: 0 };
  let offset = 0;
  let total = null;
  let done = false;

  while (!done) {
    let page;
    try {
      page = await fetchPage(offset);
    } catch (err) {
      console.error(`[backfill] failed to fetch page at offset ${offset}: ${err.message}`);
      break;
    }
    const { rows } = page;
    if (total === null) total = page.total;
    if (!rows.length) break;

    for (const row of rows) {
      if (LIMIT && stats.processed >= LIMIT) { done = true; break; }
      stats.processed++;

      let aiType = null;
      try {
        aiType = await classifyWithRetry(row);
      } catch (err) {
        console.error(`[${stats.processed}${total ? '/' + total : ''}] ${row.id} classification error: ${err.message}`);
      }

      if (aiType == null) {
        stats.failed++;
        console.log(`[${stats.processed}${total ? '/' + total : ''}] ${row.id} ${row.property_type ?? '(none)'} -> FAILED (kept)`);
        await sleep(200);
        continue;
      }

      if (aiType === row.property_type) {
        stats.unchanged++;
        console.log(`[${stats.processed}${total ? '/' + total : ''}] ${row.id} ${row.property_type ?? '(none)'} -> ${aiType} (unchanged)`);
      } else {
        console.log(`[${stats.processed}${total ? '/' + total : ''}] ${row.id} ${row.property_type ?? '(none)'} -> ${aiType}`);
        if (!DRY_RUN) {
          try {
            await patchType(row.id, aiType);
            stats.updated++;
          } catch (err) {
            stats.failed++;
            console.error(`[backfill] PATCH failed for ${row.id}: ${err.message}`);
          }
        } else {
          stats.updated++; // would-update, counted for dry-run visibility
        }
      }

      // Respect Groq rate limits with a small delay between calls.
      await sleep(200);
    }

    if (done) break;
    offset += PAGE_SIZE;
    if (!total || offset >= total) break;
  }

  console.log('[backfill] summary', JSON.stringify(stats));
}

main().catch((err) => {
  console.error(`[backfill] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
