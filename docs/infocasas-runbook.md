# InfoCasas Paraguay Scraper — Operational Runbook

Covers: initial setup, the cron-driven backfill → incremental lifecycle,
delisting, pausing/stopping, expected throughput, and how to verify progress.

## 1. Prereqs (one-time setup)

1. **Apply the migration.** Run `migrations/005_infocasas.sql` manually in the
   AiroBase SQL editor (same process as migrations 003/004 — it is *not* run
   automatically by any script or CI step). This creates the `infocasas` row
   in `scrape_sources` (adapter `infocasas_gql`, `is_active=true`,
   `cron_enabled=false` — it is driven by the dedicated cron route below, not
   the generic `/api/cron` rotator) and the `scrape_shards` table.

2. **Seed the shard matrix.**
   ```
   node scripts/seed-infocasas-shards.mjs --dry-run   # inspect the matrix first
   node scripts/seed-infocasas-shards.mjs             # upsert into scrape_shards
   ```
   This queries InfoCasas for every Paraguay estate (department/city), crosses
   each with the two operation types (venta/alquiler), and further splits any
   op×estate slice that already fills a full 100-row search page by property
   type (casa/departamento/terreno). Result: ~104 shard rows, each a bounded,
   independently-resumable slice of the catalog. Requires
   `AIROBASE_URL` + `AIROBASE_SECRET_KEY` in `.env.local` for the non-dry-run.

## 2. Backfill

Schedule an **AiroBase Cron** job to `POST /api/cron/infocasas` every
**3–5 minutes**, with header `Authorization: Bearer <CRON_SECRET>` (the same
`CRON_SECRET` env var the route checks — set it in AiroBase's cron secrets,
not just the app's env).

Each tick:
- Skips if a run is already in flight for the source (`getActiveRun`).
- Picks the next due shard (`nextDueShard`): backfill-phase shards first
  (lowest `priority`, then oldest/never-run `last_run_at`), and only once no
  backfill shards remain does it pick an incremental shard.
- Runs **one bounded slice** of that shard — backfill: `limit=250`, resuming
  from the shard's `cursor` (offset into the slice). This goes through the
  unchanged `runJob` pipeline (fetch → map → AI classify → image screening →
  watermark removal → B2 mirror → upsert), so every InfoCasas listing gets the
  same validation and quality gates as every other source.
- Advances the shard (`advanceShard`): if the tick returned fewer rows than
  requested, the slice is exhausted — cursor resets to 0, and a `backfill`
  shard **automatically flips to `incremental`** (`backfilled_at` is set).
  Otherwise the cursor advances by the number found, and the shard stays
  `backfill` for the next tick.

No manual step is needed to transition a shard — the same cron endpoint keeps
rotating shards and flips each one from `backfill` to `incremental` on its own
as it finishes. The whole country (~104 shards) backfills over roughly
**1–2 days** of continuous ticking (see Throughput below).

## 3. Incremental refresh (automatic, ongoing)

Once *all* shards have `backfilled_at` set, every cron tick is doing cheap
incremental work only:
- `nextDueShard` falls through to incremental shards, picking whichever has
  the oldest (or null) `last_run_at`.
- Incremental ticks fetch **newest-first** (`order:3`, confirmed via live
  probe to be id-descending recency, not `order:0` which is relevance),
  `limit=60`, always starting at `skip=0` (not the cursor — incremental always
  looks at the current head of the list).
- `stopWhenKnown` early-stops the moment a full page of already-known,
  unchanged listings is hit — the newest-first tail is caught up, no need to
  keep scanning known territory.

With the same 3–5 minute cadence, a full incremental cycle over all shards
completes in **a few hours**, so every listing's `last_seen_at` gets refreshed
several times a day as long as it's still live on InfoCasas.

## 4. Delisting (weekly)

A listing that InfoCasas no longer returns will simply stop getting its
`last_seen_at` bumped by incremental ticks. `scripts/infocasas-delist-sweep.mjs`
finds properties from the `infocasas` source whose `last_seen_at` is older
than a cutoff (default 7 days) and marks them `is_delisted=true`.

**Always dry-run first:**
```
node scripts/infocasas-delist-sweep.mjs --dry-run          # default N=7, no writes
node scripts/infocasas-delist-sweep.mjs --dry-run --days 10 # custom window
```
This prints the candidate count and a sample of up to 10 (oldest `last_seen_at`
first) with id/address/city, and writes nothing.

**Then commit weekly:**
```
node scripts/infocasas-delist-sweep.mjs --commit
```

Why 7 days by default: N must be at least one full incremental sweep cycle
across all ~104 shards (a few hours, per §3) so a still-live listing gets many
chances to be re-confirmed before it's considered stale. 7 days is a large
safety margin over that cycle time — comfortably absorbs cron downtime, a
paused source, or a slow week, without prematurely delisting live listings.

If `migrations/005_infocasas.sql` hasn't been applied yet (no `infocasas` row
in `scrape_sources`), the script prints a clear message and exits 0 — it does
not crash and does not require the migration to have run.

Recommended schedule: a weekly manual run (or a separate low-frequency
AiroBase Cron entry calling this script via a small wrapper endpoint, if
automating it later) — it is intentionally **not** wired into the 3–5 minute
`/api/cron/infocasas` tick, since delisting is a batch judgment call, not a
per-tick action.

## 5. Pause / stop

Three ways, from least to most disruptive:

- **Pause the whole source:** set `scrape_sources.is_active = false` for
  `key = 'infocasas'`. (Note: the cron route itself doesn't currently check
  `is_active` before running — the reliable way to pause is to disable or
  remove the AiroBase Cron schedule itself, or disable shards as below.)
- **Disable specific shards:** set `enabled = false` on rows in
  `scrape_shards` (e.g. to stop backfilling a low-value estate while leaving
  the rest running). `nextDueShard` only considers `enabled = true` shards.
- **Stop the cron entirely:** disable/delete the AiroBase Cron schedule that
  calls `/api/cron/infocasas`. No shard state is lost — ticks simply stop, and
  resuming later picks up exactly where the cursors left off.
- **In-flight run control:** an individual run (`scrape_runs` row) can be
  paused or stopped via the existing `/scrape` control UI, same as any other
  source — this affects only the currently-executing tick, not the shard
  schedule.

## 6. Throughput reality

Expect roughly **200–300 listings per tick**, not thousands — the bottleneck
isn't the InfoCasas GraphQL API (which is fast), it's the per-listing pipeline
run for *every* item: detail-page fetch for phone capture, image screening,
AI property-type classification, watermark removal, and B2 mirroring. With
~90k listings estimated across all of Paraguay, backfill takes on the order of
**a day or two** of continuous 3–5 minute ticks.

## 7. Verification — how to check progress

**Shard progress:**
```
GET {AIROBASE_URL}/rest/v1/scrape_shards?source_id=eq.<infocasas id>&select=shard_key,phase,cursor,last_run_at,last_new,last_status&order=priority.asc
```
- `phase`: `backfill` until exhausted, then `incremental`.
- `cursor`: offset reached within the current slice (backfill only; resets to
  0 on the phase flip).
- `last_run_at` / `last_status` / `last_new`: when the shard last ran, whether
  it succeeded (`success`) or was partial (`partial`), and how many new/
  updated rows it produced.
- Count shards where `phase='incremental'` vs total to gauge backfill
  completion.

**Run-level detail:**
```
GET {AIROBASE_URL}/rest/v1/scrape_runs?source_id=eq.<infocasas id>&select=*&order=started_at.desc&limit=20
```
Each run's `progress` JSON carries the full per-run counters: `found`,
`inserted`, `updated`, `skipped`, `images`, `imagesRejected`,
`watermarksRemoved`, `quarantined`, `duplicates`, plus a `recent` activity
tail. Use this to spot elevated `quarantined` or `imagesRejected` counts,
which would indicate a source-side format change worth investigating.

**Buyer marketplace:**
Check the buyer portal for listings whose `source_id` matches the `infocasas`
row (or filter by the source's listings in the admin `/scrape` UI) to confirm
scraped properties are actually surfacing to buyers with images, price, and
contact info populated.
