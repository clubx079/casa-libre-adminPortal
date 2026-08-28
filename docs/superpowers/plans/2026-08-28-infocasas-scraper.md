# InfoCasas Paraguay Scraper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add InfoCasas Paraguay (`infocasas.com.py`) as a Casa Libre scraper source that ingests the full ~90k+ listing inventory through the existing AI/validation/image pipeline, backfills it in resumable shards, and keeps it fresh with an incremental cron — no listing reaches the marketplace without passing every existing gate.

**Architecture:** A new `infocasas_gql` adapter pulls bulk listing data from InfoCasas' public GraphQL API (`https://graph.infocasas.com.uy/graphql`) and enriches each listing's contact phone from its detail-page HTML. A single `scrape_sources` row + a new `scrape_shards` table shard the work by `(operation_type × estate)`; a dedicated cron endpoint rotates through shards, each run bounded and resumable via a page cursor so it survives the 5-minute tick limit. Everything downstream — AI type classification, zone normalization, dedupe, validation, Google Vision image screening, LaMa watermark removal, B2 mirroring, and marketplace activation — is the existing pipeline, unchanged.

**Tech Stack:** Next.js 14 (App Router, `runtime: 'nodejs'`), plain JS, PostgREST/AiroBase via `lib/db.js`, Backblaze B2, Groq (AI classify), Google Vision (image screen). Tests: **vitest** (added in Task 1; repo has no runner today). InfoCasas API: GraphQL over `fetch`.

**Spec:** This plan is self-contained; the "spec" is the existing pipeline in `lib/scrape.js` + `lib/ingest.js` and the verified recon in this document's Task 0. The adapter contract is defined by `lib/adapters/tulugar.js` (the closest existing analog: public JSON API for bulk + per-listing detail fetch for the phone).

## Global Constraints

- **Never write to the prod AiroBase `properties` / `property_images` / `scrape_*` tables until the Task 5 dry-run output is reviewed and approved by the user.** Tasks 1–5 touch NO database.
- **Do not bypass any existing gate.** AI type classify, `normalizeZone`, `dedupeKey`/`isDuplicate`, `validateListing`, `screenPropertyImages`, `removeWatermark`, and the completeness/`admin_status` marketplace gate MUST all run via the unchanged `runJob` loop. The adapter only produces `{ external_id, row, images, hashInput }`.
- **Output row shape must match the existing `properties` columns exactly** — mirror the field set produced by `lib/adapters/tulugar.js` `mapListing` (same keys, same types).
- **`admin_status: 'active'`** is set by the adapter (same as every other adapter); a listing only becomes visible after it also passes `validateListing` and has a mirrored feature image (`image_status: 'ok'`) — enforced by the existing loop, not by this plan.
- **A listing with no usable phone must quarantine, not publish** — this is the existing `validateListing` `no_contact` rule; do not weaken it.
- **InfoCasas API access:** every GraphQL request MUST send headers `authorization: Bearer gika` and `x-origin: www.infocasas.com.py`. Detail-page fetches send a browser `User-Agent`.
- **Be a polite client:** bounded concurrency (≤ 5 detail fetches in parallel, matching tulugar's pool), ret/timeout on every request, and per-tick run limits so no single run exceeds `maxDuration: 300`.
- **Sequential shards:** all shards share ONE `scrape_sources` row, so `getActiveRun` naturally serializes them (no overlapping runs hammering InfoCasas or the prod DB).
- **Currency:** map by `price.currency` — `id === 1` or name containing `$`/`US` → `USD`, otherwise `PYG` (guaraníes). Never assume USD.

---

## Verified Recon (Task 0 — already done, do not re-investigate)

These facts are established and MUST be treated as ground truth by implementers:

- **Endpoint:** `POST https://graph.infocasas.com.uy/graphql`, headers `authorization: Bearer gika`, `x-origin: www.infocasas.com.py`, `Content-Type: application/json`. Returns HTTP 200.
- **Bulk query:** `searchListing(params: SearchParamsInput!, first: Int!, page: Int!)` → `{ paginatorInfo { total lastPage perPage currentPage }, data [Property] }`. **`paginatorInfo.total`/`lastPage` are unreliable (scale with page size) — do not use them to bound a crawl. Stop when `data` returns fewer than `first` rows, or is empty.**
- **Filters (`SearchParamsInput`):** `operation_type_id` (1 Venta, 2 Alquiler, 4 Alquiler Temporal — 3 = both, avoid), `property_type_id` (1 Casa, 2 Departamento, 3 Terreno, 4 Local Comercial, 5 Oficina, 6 Chacra o Campo, 8 Garaje o Cochera, 9 Negocio Especial, 10 Edificio u Hotel, 12 Tinglado o Depósito, 13 Otro, 14 Dúplex), `estate_id` (department), `neighborhood_id`, `minPrice`/`maxPrice`/`currencyID`, `order` (Int — confirm newest-first value in Task 5 before Task 9).
- **`Property` fields used:** `id title address code latitude longitude m2 m2Built m2Terrain bedrooms bathrooms garage floor price{amount currency{id name rate} hidePrice} property_type{id name} operation_type{id name} neighborhood{id name} estate{id name} legacy_city legacy_neighborhood link isExternal active image_count img images{id image tag}`.
- **Phone is auth-gated in the API** (`seller.phone` → "Unauthenticated") **but present in the detail-page HTML** as embedded JSON: `"whatsapp_phone":"+595981765404"` and `"phone":"(+595) 981 424 876"`. Detail URL = `https://www.infocasas.com.py/{link}`. Verified 12/12 sample listings had a number.
- **Coverage is real:** distinct, non-recycled, terminating pagination (3,000 requested → 2,999 distinct; deep pages fresh with 0 overlap; empty by page ~1,000 per slice). One slice (Asunción/sale) alone holds tens of thousands.
- **Estate ids seen in recon:** Asunción = 21, Cordillera = 25 (full list enumerated at runtime via the `estates(first,page)` query in Task 6).

---

## File Structure

- **Create** `lib/adapters/infocasas.js` — the adapter: `fetchPage()` (GraphQL bulk + phone enrichment) + `mapListing()` (→ `properties` row) + default export `{ fetchPage, mapListing }`.
- **Create** `lib/infocasasClient.js` — thin GraphQL client (query builder, headers, retry) + detail-page phone parser. Kept separate from the adapter so it is unit-testable without the orchestrator.
- **Create** `lib/shards.js` — shard scheduling helpers: `nextDueShard()`, `advanceShard()`, `buildShardMatrix()`. Pure DB helpers.
- **Modify** `lib/scrape.js` — (a) register `infocasas_gql` in the `ADAPTERS` map; (b) honor `filters.skip` as the initial page offset so a shard resumes from its cursor (one-line, backwards-compatible).
- **Create** `app/api/cron/infocasas/route.js` — cron tick: pick next due shard, run one bounded resumable slice, advance the shard cursor.
- **Create** `migrations/005_infocasas.sql` — `scrape_sources` row for InfoCasas + `scrape_shards` table (+ indexes). Run manually in the AiroBase SQL editor, like prior migrations.
- **Create** `scripts/probe-infocasas.mjs` — live dry-run: map N real listings (with phones) and print them; **no DB writes**. The "test small" gate.
- **Create** `test/fixtures/infocasas/*.json|*.html` + `test/infocasas.test.js` — vitest fixtures (a saved real GraphQL response + a saved detail page) driving deterministic unit tests.
- **Create/Modify** `package.json` — add `vitest` devDep + `"test": "vitest run"` script (Task 1).

---

## Task 1: Vitest setup + InfoCasas GraphQL client

**Files:**
- Modify: `package.json` (add vitest + test script)
- Create: `lib/infocasasClient.js`
- Create: `test/infocasas.client.test.js`
- Create: `test/fixtures/infocasas/search-page.json` (saved real `searchListing` response, 3 listings)

**Interfaces:**
- Produces: `searchListing({ params, first, page })` → `Promise<{ items: object[], count: number }>` where `items` are raw `Property` objects and `count` is `data.length`; `GQL_HEADERS` const; `IC_GRAPHQL_URL` const.

- [ ] **Step 1: Capture the fixture** — save a real 3-listing response to `test/fixtures/infocasas/search-page.json`:

```bash
curl -s -X POST "https://graph.infocasas.com.uy/graphql" \
 -H "Content-Type: application/json" -H "authorization: Bearer gika" -H "x-origin: www.infocasas.com.py" \
 -d '{"query":"query($p:SearchParamsInput!,$f:Int!,$pg:Int!){searchListing(params:$p,first:$f,page:$pg){data{id title address code latitude longitude m2 m2Built m2Terrain bedrooms bathrooms garage floor price{amount currency{id name rate} hidePrice} property_type{id name} operation_type{id name} neighborhood{id name} estate{id name} legacy_city legacy_neighborhood link isExternal active image_count img images{id image tag}}}}","variables":{"p":{"operation_type_id":1,"estate_id":21},"f":3,"pg":1}}' \
 > test/fixtures/infocasas/search-page.json
```

- [ ] **Step 2: Add vitest** — `npm i -D vitest`, add `"test": "vitest run"` to `package.json` scripts.

- [ ] **Step 3: Write the failing test** `test/infocasas.client.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { searchListing, IC_GRAPHQL_URL, GQL_HEADERS } from '../lib/infocasasClient.js';
import fixture from './fixtures/infocasas/search-page.json' assert { type: 'json' };

describe('infocasasClient.searchListing', () => {
  it('posts with the required headers and returns items+count', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => fixture,
    });
    const { items, count } = await searchListing({ params: { operation_type_id: 1, estate_id: 21 }, first: 3, page: 1 });
    expect(count).toBe(3);
    expect(items).toHaveLength(3);
    const [url, opts] = spy.mock.calls[0];
    expect(url).toBe(IC_GRAPHQL_URL);
    expect(opts.headers.authorization).toBe('Bearer gika');
    expect(opts.headers['x-origin']).toBe('www.infocasas.com.py');
    spy.mockRestore();
  });
});
```

- [ ] **Step 4: Run it, verify it fails** — `npm test` → FAIL (module not found).

- [ ] **Step 5: Implement `lib/infocasasClient.js`:**

```js
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
      link isExternal active image_count img images{ id image tag } } } }`;

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
```

- [ ] **Step 6: Run it, verify it passes** — `npm test` → PASS.

- [ ] **Step 7: Commit** — `git add package.json lib/infocasasClient.js test/ && git commit -m "feat(infocasas): graphql search client + vitest"`

---

## Task 2: Detail-page phone parser

**Files:**
- Modify: `lib/infocasasClient.js` (add `parsePhoneFromHtml`, `fetchPhone`)
- Modify: `test/infocasas.client.test.js`
- Create: `test/fixtures/infocasas/detail.html` (saved real detail page)

**Interfaces:**
- Produces: `parsePhoneFromHtml(html)` → `{ phone: string|null, name: string|null }`; `fetchPhone(link)` → `Promise<{ phone, name }>`.

- [ ] **Step 1: Capture fixture** — `curl -s -A "Mozilla/5.0" "https://www.infocasas.com.py/<a-real-link-from-search-page.json>" > test/fixtures/infocasas/detail.html`.

- [ ] **Step 2: Write failing test:**

```js
import { parsePhoneFromHtml } from '../lib/infocasasClient.js';
import { readFileSync } from 'node:fs';
it('extracts a Paraguay phone from detail HTML', () => {
  const html = readFileSync(new URL('./fixtures/infocasas/detail.html', import.meta.url), 'utf8');
  const { phone } = parsePhoneFromHtml(html);
  expect(phone).toMatch(/\d{6,}/);
});
it('returns null phone when none present', () => {
  expect(parsePhoneFromHtml('<html>no number here</html>').phone).toBeNull();
});
```

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement** (prefer `whatsapp_phone`, fall back to `phone`; reuse the app's own normalization idea — keep digits, keep leading `+`):

```js
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
```

- [ ] **Step 5: Run, verify pass.**
- [ ] **Step 6: Commit** — `git commit -am "feat(infocasas): detail-page phone parser"`

---

## Task 3: `mapListing` — normalize a Property to a `properties` row

**Files:**
- Create: `lib/adapters/infocasas.js` (mapListing only for now)
- Modify: `test/infocasas.test.js` (new file for the adapter)

**Interfaces:**
- Consumes: raw `Property` object; ctx `{ source, config, pygPerUsd }`.
- Produces: `mapListing(it, ctx)` → `{ external_id, row, images, hashInput }` — SAME shape as `tulugar.mapListing` (see `lib/adapters/tulugar.js:91`).

- [ ] **Step 1: Write failing test** against `test/fixtures/infocasas/search-page.json` (assert the mapped row has the canonical keys and correct derivations):

```js
import { describe, it, expect } from 'vitest';
import infocasas from '../lib/adapters/infocasas.js';
import fixture from './fixtures/infocasas/search-page.json' assert { type: 'json' };

const ctx = { source: { id: 'SRC', key: 'infocasas', base_url: 'https://www.infocasas.com.py' }, config: {}, pygPerUsd: 7300 };

describe('infocasas.mapListing', () => {
  const raw = fixture.data.searchListing.data[0];
  const m = infocasas.mapListing(raw, ctx);
  it('emits canonical row keys', () => {
    for (const k of ['source_id','external_id','origin','slug','address','price','currency','price_usd','listing_type','property_type','admin_status','contact_phone','raw_data'])
      expect(m.row).toHaveProperty(k);
  });
  it('maps operation_type to listing_type', () => {
    expect(['sale','rent']).toContain(m.row.listing_type);
  });
  it('resolves currency to USD or PYG', () => {
    expect(['USD','PYG']).toContain(m.row.currency);
  });
  it('builds absolute image urls with feature flag', () => {
    expect(m.images[0].source_url).toMatch(/^https?:\/\//);
    expect(m.images.some((i) => i.is_feature)).toBe(true);
  });
  it('external_id is the InfoCasas id', () => {
    expect(m.external_id).toBe(String(raw.id));
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `mapListing`** in `lib/adapters/infocasas.js`:

```js
const OP_MAP = { 1: 'sale', 2: 'rent', 4: 'rent' };           // 4 = alquiler temporal → rent
const PT_MAP = {
  1: 'casa', 2: 'departamento', 3: 'terreno', 4: 'local comercial', 5: 'oficina',
  6: 'campo', 8: 'cochera', 9: 'local comercial', 10: 'edificio', 12: 'depósito', 13: 'otro', 14: 'dúplex',
};
const LAND_PT = new Set(['3', '6']);                           // terreno, campo
const num = (v) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : null; };

function resolveCurrency(price) {
  const id = price?.currency?.id != null ? String(price.currency.id) : null;
  const nm = String(price?.currency?.name || '');
  if (id === '1' || /\$|US/i.test(nm)) return 'USD';
  return 'PYG';
}

function mapListing(it, { source, config, pygPerUsd }) {
  const id = String(it.id);
  const opId = it.operation_type?.id != null ? String(it.operation_type.id) : null;
  const listingType = OP_MAP[opId] || 'sale';
  const ptId = it.property_type?.id != null ? String(it.property_type.id) : null;
  const isLand = ptId ? LAND_PT.has(ptId) : false;
  const ptype = (ptId && PT_MAP[ptId]) || (it.property_type?.name || '').toLowerCase() || null;

  const currency = resolveCurrency(it.price);
  const price = num(it.price?.amount);
  let priceUsd = null;
  if (currency === 'USD') priceUsd = price;
  else if (currency === 'PYG' && price != null) priceUsd = Math.round(price / (pygPerUsd || 7300));

  const m2 = num(it.m2);
  const built = num(it.m2Built);
  const terrain = num(it.m2Terrain);
  const address = it.address || it.title || [it.neighborhood?.name, it.estate?.name].filter(Boolean).join(', ') || 'Sin dirección';

  const row = {
    source_id: source.id,
    external_id: id,
    external_url: it.link ? `https://www.infocasas.com.py/${it.link}` : null,
    origin: 'scraped',
    slug: `${source.key}-${id}`,
    address,
    seo_title: it.title || null,
    latitude: num(it.latitude),
    longitude: num(it.longitude),
    price,
    currency,
    price_usd: priceUsd,
    listing_type: listingType,
    price_period: listingType === 'rent' ? 'month' : null,
    bedrooms: num(it.bedrooms),
    bathrooms: num(it.bathrooms),
    parking_spaces: num(it.garage),
    floor_area: isLand ? null : (built || m2),
    covered_area: isLand ? null : (built || m2),
    land_area: isLand ? (terrain || m2) : (terrain || null),
    city: it.legacy_city || it.estate?.name || null,
    province: it.estate?.name || null,
    neighborhood: it.neighborhood?.name || it.legacy_neighborhood || null,
    country: 'Paraguay',
    property_type: ptype,
    description: null,                     // search API omits description; detail page has it (optional future enrichment)
    features: [],
    status: 'published',
    property_status: 'available',
    admin_status: 'active',
    contact_name: null,                    // filled by fetchPage phone enrichment
    contact_phone: null,                   // filled by fetchPage phone enrichment
    raw_data: { ...it, platform: 'infocasas' },
  };

  const cdn = (u) => (u && u.startsWith('http') ? u : (u ? `https://cdn2.infocasas.com.uy${u.startsWith('/') ? '' : '/'}${u}` : null));
  const seen = new Set();
  const images = (Array.isArray(it.images) ? it.images : [])
    .map((im) => cdn(im.image)).filter((u) => u && !seen.has(u) && seen.add(u))
    .map((u, i) => ({ source_url: u, position: i, is_feature: i === 0 }));

  const hashInput = JSON.stringify({
    price, currency, listingType, ptype, beds: row.bedrooms, baths: row.bathrooms,
    built, terrain, lat: row.latitude, lng: row.longitude, title: it.title,
    imgs: images.map((x) => x.source_url),
  });
  return { external_id: id, row, images, hashInput };
}

export default { mapListing };  // fetchPage added in Task 4
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(infocasas): mapListing normalizer"`

---

## Task 4: `fetchPage` + adapter assembly + registration

**Files:**
- Modify: `lib/adapters/infocasas.js` (add `fetchPage`, export `{ fetchPage, mapListing }`)
- Modify: `lib/scrape.js` (register `infocasas_gql`)
- Modify: `test/infocasas.test.js`

**Interfaces:**
- Consumes: orchestrator contract — `fetchPage(config, filters, skip, top)` → `{ total, items }` for the window `[skip, skip+top)`; each item is a raw `Property` already enriched with `contact_phone`/`contact_name`. (`mapListing` reads `it.contact_phone` — extend the Task 3 mapper's `contact_phone`/`contact_name` to read `it.contact_phone ?? null` / `it.contact_name ?? null`.)
- Produces: `ADAPTERS.infocasas_gql` wired in `lib/scrape.js`.

- [ ] **Step 1: Update `mapListing`** to read the enriched phone: set `contact_phone: it.contact_phone || null` and `contact_name: it.contact_name || null` in the row.

- [ ] **Step 2: Write failing test** for `fetchPage` windowing + phone enrichment (mock `searchListing` + `fetchPhone`):

```js
import { vi } from 'vitest';
import * as client from '../lib/infocasasClient.js';
import infocasas from '../lib/adapters/infocasas.js';
import fixture from './fixtures/infocasas/search-page.json' assert { type: 'json' };

it('fetchPage returns a window and enriches phones', async () => {
  vi.spyOn(client, 'searchListing').mockResolvedValue({ items: fixture.data.searchListing.data, count: 3 });
  vi.spyOn(client, 'fetchPhone').mockResolvedValue({ phone: '+595981000000', name: 'Test' });
  const { items } = await infocasas.fetchPage({ shard: { operation_type_id: 1, estate_id: 21 } }, {}, 0, 3);
  expect(items.length).toBe(3);
  expect(items[0].contact_phone).toBe('+595981000000');
});
```

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement `fetchPage`** — translate the loop's `(skip, top)` into InfoCasas `page`/`first`, then pool-enrich phones (only for `active` non-null-link items). Params come from `config.shard` merged with `filters` (so the cron passes the shard's `params`):

```js
import { searchListing, fetchPhone } from '../infocasasClient.js';

const PER = 100;
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  }));
}

async function fetchPage(config, filters, skip, top) {
  // Merge shard params (config.shard or filters.params) with any run filters.
  const params = { ...(config.shard || {}), ...(filters.params || {}) };
  if (filters.order != null) params.order = filters.order;
  // Map absolute [skip, skip+top) to InfoCasas 1-based pages of PER.
  const start = skip;
  const end = skip + top;
  const firstPage = Math.floor(start / PER) + 1;
  const lastPage = Math.floor((end - 1) / PER) + 1;
  let all = [];
  for (let pg = firstPage; pg <= lastPage; pg++) {
    const { items, count } = await searchListing({ params, first: PER, page: pg });
    all = all.concat(items);
    if (count < PER) break;           // reached the end of this slice
  }
  // Trim to the exact window and enrich phones.
  const offset = start - (firstPage - 1) * PER;
  const windowItems = all.slice(offset, offset + top).filter((x) => x && x.id);
  await pool(windowItems, 5, async (it) => {
    const { phone, name } = await fetchPhone(it.link);
    it.contact_phone = phone; it.contact_name = name || it.contact_name || null;
  });
  // `total` is unreliable upstream; report a large sentinel so the loop is bounded
  // ONLY by filters.limit and by an empty page (handled in runJob via items.length===0).
  const total = windowItems.length < top ? skip + windowItems.length : Number.MAX_SAFE_INTEGER;
  return { total, items: windowItems };
}

export default { fetchPage, mapListing };
```

- [ ] **Step 5: Register in `lib/scrape.js`** — add `import infocasas from './adapters/infocasas';` and `infocasas_gql: infocasas,` to the `ADAPTERS` map.

- [ ] **Step 6: Run, verify pass.** Also run `npm run build` to confirm the app still compiles.
- [ ] **Step 7: Commit** — `git commit -am "feat(infocasas): fetchPage + register infocasas_gql adapter"`

---

## Task 5: Live dry-run probe — the "test small" gate (NO DB)

**Files:**
- Create: `scripts/probe-infocasas.mjs`

**Interfaces:**
- Consumes: `infocasas.fetchPage` + `mapListing` against the LIVE API.
- Produces: console output only — no DB, no B2, no AI. Also prints observed `order` behavior for Task 9.

- [ ] **Step 1: Implement the probe** — map ~20 real Asunción/sale listings and print `{ external_id, address, price, currency, price_usd, listing_type, property_type, beds, baths, area, neighborhood, contact_phone, images.length }`; count how many have a phone; print the first two listings' `created_at`/ids at `order` 0/1/2 to identify newest-first:

```js
import infocasas from '../lib/adapters/infocasas.js';
const source = { id: 'DRYRUN', key: 'infocasas', base_url: 'https://www.infocasas.com.py' };
const ctx = { source, config: { shard: { operation_type_id: 1, estate_id: 21 } }, pygPerUsd: 7300 };
const { items } = await infocasas.fetchPage(ctx.config, {}, 0, 20);
let withPhone = 0;
for (const it of items) {
  const m = infocasas.mapListing(it, ctx);
  if (m.row.contact_phone) withPhone++;
  console.log(JSON.stringify({
    id: m.external_id, addr: m.row.address, price: m.row.price, cur: m.row.currency, usd: m.row.price_usd,
    type: m.row.property_type, op: m.row.listing_type, beds: m.row.bedrooms, baths: m.row.bathrooms,
    area: m.row.covered_area || m.row.land_area, zone: m.row.neighborhood, phone: m.row.contact_phone, imgs: m.images.length,
  }));
}
console.log(`\nPHONE CAPTURE: ${withPhone}/${items.length}`);
```

- [ ] **Step 2: Run** — `node scripts/probe-infocasas.mjs`. Expected: 20 well-formed rows, most/all with a phone and ≥1 image, sensible USD/PYG prices.

- [ ] **Step 3: STOP — user review gate.** Present the output to the user. Do NOT proceed to Task 6+ (anything touching prod) until the user confirms the mapped data looks correct. (This is the plan's hard checkpoint.)

- [ ] **Step 4: Commit** — `git commit -am "feat(infocasas): live dry-run probe script"`

---

## Task 6: Migration — source row, shard table, seed matrix, cursor support

**Files:**
- Create: `migrations/005_infocasas.sql`
- Modify: `lib/scrape.js` (honor `filters.skip` as initial offset)
- Create: `scripts/seed-infocasas-shards.mjs` (enumerate estates via `estates` query, build shard rows)

**Interfaces:**
- Produces: `scrape_sources` row `key='infocasas'`, `adapter='infocasas_gql'`; `scrape_shards` rows; `runJob` resuming from `filters.skip`.

- [ ] **Step 1: Write `migrations/005_infocasas.sql`:**

```sql
-- InfoCasas source (single row; shards live in scrape_shards).
insert into public.scrape_sources (key, name, adapter, base_url, config, default_filters, is_active, cron_enabled)
values (
  'infocasas', 'InfoCasas Paraguay', 'infocasas_gql', 'https://www.infocasas.com.py',
  '{}'::jsonb,
  '{"class":"all","limit":250}'::jsonb,
  true, false   -- driven by the dedicated /api/cron/infocasas rotator, not the generic cron
) on conflict (key) do update set adapter = excluded.adapter, base_url = excluded.base_url;

-- Shard matrix: one row per (operation_type × estate [× optional property_type]).
create table if not exists public.scrape_shards (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.scrape_sources(id) on delete cascade,
  shard_key     text unique not null,          -- e.g. 'op1_estate21' or 'op1_estate21_pt2'
  params        jsonb not null,                -- SearchParamsInput slice
  phase         text not null default 'backfill',  -- backfill | incremental
  cursor        int not null default 0,        -- resume offset (skip) within the slice
  enabled       boolean not null default true,
  priority      int not null default 100,      -- lower = sooner
  backfilled_at timestamptz,
  last_run_at   timestamptz,
  last_status   text,
  last_new      int default 0,
  created_at    timestamptz not null default now()
);
create index if not exists ix_shards_due on public.scrape_shards (enabled, phase, last_run_at nulls first);
```

- [ ] **Step 2: Modify `runJob`** in `lib/scrape.js` — change `let skip = 0;` to `let skip = Math.max(0, Number(merged.skip) || 0);` (backwards-compatible: default 0). Add a code comment explaining shard resume.

- [ ] **Step 3: Write `scripts/seed-infocasas-shards.mjs`** — query `estates(first,page)` for Paraguay (via the same client), and for each estate emit shards for operations `[1,2]`; for estates whose first-page `count` is at `PER` (large), also emit per-`property_type_id` sub-shards `[1,2,3]` (casa/depto/terreno) so no slice is unbounded. Insert rows into `scrape_shards` (upsert on `shard_key`). Print the shard count.

- [ ] **Step 4: Run the migration** in the AiroBase SQL editor, then `node scripts/seed-infocasas-shards.mjs`. **User runs the SQL** (like prior migrations); confirm `scrape_shards` row count > 30.

- [ ] **Step 5: Commit** — `git commit -am "feat(infocasas): source row, shard table + seed, cursor resume"`

---

## Task 7: Shard scheduler helpers

**Files:**
- Create: `lib/shards.js`
- Create: `test/shards.test.js` (fixture rows, mock `lib/db`)

**Interfaces:**
- Produces:
  - `nextDueShard(sourceId)` → shard row or null. Policy: enabled shards; **backfill phase first** (any `phase='backfill'`, lowest `priority`, then `last_run_at nulls first`); once none remain in backfill, pick the **incremental** shard with the oldest `last_run_at`.
  - `advanceShard(shard, { found, inserted, updated, reachedEnd })` → updates `cursor` (+= found, or 0 if reachedEnd), sets `last_run_at`, `last_status`, `last_new`; when a backfill shard `reachedEnd`, set `phase='incremental'`, `cursor=0`, `backfilled_at=now()`.

- [ ] **Step 1: Write failing tests** — (a) backfill shards precede incremental; (b) within backfill, `nulls first` on `last_run_at`; (c) `advanceShard` flips phase + zeroes cursor on end; (d) mid-backfill advance bumps cursor by `found`.

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `lib/shards.js`** using `select`/`update` from `lib/db`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(infocasas): shard scheduler helpers"`

---

## Task 8: Cron rotator — bounded, resumable, one shard per tick

**Files:**
- Create: `app/api/cron/infocasas/route.js`

**Interfaces:**
- Consumes: `nextDueShard`, `advanceShard`, `startRun`/`runJob` (or `runScrape`), `getActiveRun`.
- Produces: `POST`/`GET` handler (auth `CRON_SECRET`) that runs ONE shard slice per invocation.

- [ ] **Step 1: Write the route:**

```js
import { NextResponse } from 'next/server';
import { getSourceByKey } from '@/lib/scrape';        // export it if not already
import { getActiveRun, startRun, runJob } from '@/lib/scrape';
import { nextDueShard, advanceShard } from '@/lib/shards';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET)
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const source = await getSourceByKey('infocasas');
  if (await getActiveRun(source.id))                    // a shard is still running — skip this tick
    return NextResponse.json({ ok: true, skipped: 'run_in_progress' });

  const shard = await nextDueShard(source.id);
  if (!shard) return NextResponse.json({ ok: true, done: 'no_due_shards' });

  const isIncremental = shard.phase === 'incremental';
  const filters = {
    params: shard.params,
    skip: isIncremental ? 0 : shard.cursor,             // incremental always starts at newest
    order: 0,                                           // newest-first (confirmed in Task 5)
    limit: isIncremental ? 60 : 250,                    // small incremental sweep; bounded backfill slice
    class: 'all',
  };
  const { runId } = await startRun({ sourceKey: 'infocasas', filters, trigger: 'cron' });
  const summary = await runJob({ runId });
  const reachedEnd = summary.found < filters.limit;     // fewer than asked ⇒ slice exhausted
  await advanceShard(shard, { found: summary.found, inserted: summary.inserted, updated: summary.updated, reachedEnd });

  return NextResponse.json({ ok: true, shard: shard.shard_key, phase: shard.phase, ...summary, reachedEnd });
}
export const POST = handle;
export const GET = handle;
```

- [ ] **Step 2: Ensure `getSourceByKey` is exported** from `lib/scrape.js` (add `export` if it is currently module-private).
- [ ] **Step 3: `npm run build`** to confirm it compiles and the route registers.
- [ ] **Step 4: Manual smoke test (still bounded, WRITES to prod — gated on Task 5 approval):** with one shard seeded and `limit` temporarily set to `5`, curl the endpoint with the `CRON_SECRET`. Verify: a `scrape_runs` row appears, ≤5 properties are inserted, and each ran through validation/screening (check `scrape_runs.progress` counters: `quarantined`, `imagesRejected`, `watermarksRemoved`). Confirm inserted rows have `image_status='ok'` and a `contact_phone`.
- [ ] **Step 5: Commit** — `git commit -am "feat(infocasas): sharded cron rotator (backfill+incremental)"`

---

## Task 9: Incremental early-stop (cheap refresh)

**Files:**
- Modify: `lib/scrape.js` (add optional `merged.stopWhenKnown` early-exit) OR `app/api/cron/infocasas/route.js`
- Modify: `test/` as needed

**Interfaces:**
- Consumes: the run loop's per-item `action` (`skip` = unchanged existing).
- Produces: an incremental run that stops after a page whose items are ALL `skip` (already known + unchanged), bounding refresh cost to just the new/changed head of the newest-first list.

- [ ] **Step 1: Confirm newest-first `order`** from the Task 5 probe output; set the confirmed value in the cron `filters.order`. If no order value yields date-desc, fall back to scanning the first `limit` items each incremental tick (still bounded).
- [ ] **Step 2: Write failing test** — a run over a page where every item resolves to `skip` sets a `stoppedKnown` flag and ends.
- [ ] **Step 3: Implement** — in the page loop, when `merged.stopWhenKnown` and every item in the just-processed page produced `action==='skip'`, break out of the while-loop (mark run `success`). The cron sets `stopWhenKnown: true` for incremental shards.
- [ ] **Step 4: Run, verify pass;** `npm run build`.
- [ ] **Step 5: Commit** — `git commit -am "feat(infocasas): incremental early-stop on known-unchanged"`

---

## Task 10: Delisting sweep + operational docs

**Files:**
- Create: `scripts/infocasas-delist-sweep.mjs` (or a `phase='sweep'` variant)
- Create: `docs/infocasas-runbook.md`

**Interfaces:**
- Produces: listings from `source='infocasas'` whose `last_seen_at` is older than the full-sweep window get `is_delisted=true`; a runbook describing the cron schedule.

- [ ] **Step 1: Implement the delist sweep** — mark `is_delisted=true` for `properties` where `source_id = infocasas` and `last_seen_at < now() - interval 'N days'` and `is_delisted=false`. N ≥ the time for one full incremental cycle across all shards (compute from shard count × tick cadence).
- [ ] **Step 2: Write the runbook** — document: (a) run the migration; (b) seed shards; (c) schedule the AiroBase Cron to hit `/api/cron/infocasas` every 3–5 min for backfill; (d) after `backfilled_at` is set on all shards, the same cron transitions to incremental automatically; (e) delist sweep weekly; (f) how to pause (disable shards / `is_active=false` on the source); (g) expected throughput (~200–300 listings/tick given per-listing detail fetch + image screening).
- [ ] **Step 3: Commit** — `git commit -am "feat(infocasas): delist sweep + runbook"`

---

## Self-Review

- **Spec coverage:** adapter (T1–4), test-small gate (T5), all AI/validation/screening via unchanged `runJob` (Global Constraints + T8 smoke test asserts counters), sharded backfill (T6–8), incremental new+update (T8–9), huge-dataset scheduling (T6–8 shard rotation), delisting (T10). ✅
- **Type consistency:** `mapListing` returns `{ external_id, row, images, hashInput }` (matches `tulugar` + the `runJob` consumer at `scrape.js:254`/`:270`). `fetchPage(config, filters, skip, top) → { total, items }` matches the loop at `scrape.js:241`. `filters.skip` honored by the T2 `runJob` change. Cron uses `startRun`/`runJob`/`getActiveRun` (existing exports; `getSourceByKey` exported in T8). ✅
- **No prod writes before approval:** T1–5 are DB-free; the first prod write is the T8 smoke test, explicitly gated on the T5 review. ✅
- **Placeholder scan:** all code steps carry real code; the only deliberately deferred value is the newest-first `order` int, resolved empirically in T5 before it is used in T9. ✅

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-28-infocasas-scraper.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

**Which approach?** (Either way, execution HALTS at the Task 5 dry-run for your review before anything touches prod.)
