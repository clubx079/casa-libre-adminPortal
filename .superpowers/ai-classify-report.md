# AI property-type classification (audit #27)

## What was built

1. **`lib/aiClassifyCore.js`** (new, pure, NO `server-only`) — the classification
   logic, shared by both the Next.js server code and the standalone backfill
   script:
   - `TYPES` — the 11 canonical labels.
   - `normalizeToType(text)` — accent-tolerant, case-insensitive match of the
     model's raw output against `TYPES`; falls back through an English/synonym
     table (`apartment`→Departamento, `house`→Casa, `land`→Terreno,
     `commercial`→Local comercial, `warehouse`→Depósito, `office`→Oficina,
     `building`→Edificio, `farm`→Campo, `duplex`→Dúplex, `condo`→Condominio,
     `subdivision`→Loteamiento); anything unmatched → `'Inmueble'`.
   - `classifyPropertyTypeCore(deal, { apiKey, model })` — calls Groq
     (`POST https://api.groq.com/openai/v1/chat/completions`,
     `temperature: 0`, `max_tokens: 12`, `AbortSignal.timeout(12000)`), parses
     the result through `normalizeToType`. Returns `null` on missing key,
     non-200, timeout, or any thrown error — **never throws**.

2. **`lib/aiClassify.js`** (new, `server-only`) — thin wrapper re-exporting
   `TYPES`/`normalizeToType` and exposing `classifyPropertyType(deal)`, which
   calls the core with `process.env.GROQ_API_KEY` / `process.env.GROQ_MODEL`.

3. **Scrape hook** in `lib/scrape.js`:
   - import added at the top: `import { classifyPropertyType } from './aiClassify';`
   - call site: inside the per-item loop, right after `prev`/`hash` are
     computed and **before** the insert/update branch (so it applies to both
     new inserts and re-scraped updates of the same listing):
     ```js
     try {
       const aiType = await classifyPropertyType(m.row);
       if (aiType) m.row.property_type = aiType;
     } catch { /* never break a scrape run over classification */ }
     ```
   - Location: `lib/scrape.js`, in the per-item loop starting at line ~241,
     the hook is inserted just before the `if (!prev) {` insert branch.
   - Behavior: adds **one Groq call per scraped item**. `llama-3.1-8b-instant`
     (a non-reasoning "instant" model) is fast, so this is cheap per-item
     latency; on any Groq outage/rate-limit/timeout the call returns `null`
     and the source's own `property_type` is kept — a scrape run can never
     fail because of classification.

4. **`scripts/backfill-ai-types.mjs`** (new, standalone ESM CLI):
   - Manually parses `.env.local` (`KEY=VALUE`, quote-stripping) into
     `process.env` since a bare `node` process doesn't get Next.js's env
     loading. Requires `AIROBASE_URL`, `AIROBASE_SECRET_KEY`, `GROQ_API_KEY`.
   - Queries `properties` via PostgREST with the buyer portal's completeness
     pre-filter: `admin_status=eq.active&contact_phone=not.is.null&price=gt.0`,
     paged 200 rows at a time (`offset`/`limit`, reads `Content-Range` for the
     total).
   - For each row: classifies via `classifyPropertyTypeCore` (one courtesy
     retry with a 1.2s backoff if the first call returns `null`); if the AI
     type differs from the current `property_type`, PATCHes
     `properties?id=eq.<id>` with `{ property_type }`
     (`Prefer: return=minimal`); a 429 on the PATCH itself gets one retry
     after a 2s backoff. 200ms delay between rows to stay under Groq rate
     limits.
   - Logs `[n/total] <id> <old> -> <new>` per row and a final
     `[backfill] summary {"processed":...,"updated":...,"unchanged":...,"failed":...}`.
   - Flags: `--dry-run` (classify + log only, never PATCHes) and
     `--limit N`.

   Usage:
   ```
   node scripts/backfill-ai-types.mjs --dry-run --limit 3
   node scripts/backfill-ai-types.mjs                 # full run, all pages
   node scripts/backfill-ai-types.mjs --limit 500      # cap total rows processed
   ```

## System prompt used (verbatim)

> You are a real-estate listing classifier for a Paraguay property
> marketplace. Given a listing's raw data (which may be in Spanish,
> mislabeled, or missing a type), classify it into EXACTLY ONE of these
> internal types: Casa, Departamento, Dúplex, Terreno, Campo, Local
> comercial, Oficina, Depósito, Edificio, Condominio, Loteamiento. Guidance:
> an empty lot / plot -> Terreno; a subdivided plot / 'loteamiento' ->
> Loteamiento; rural land, farm, ranch, 'estancia'/'chacra' -> Campo; a
> standalone house / 'casa'/'chalet'/'residencia' -> Casa; a flat /
> 'departamento'/'depto'/'monoambiente'/'penthouse' -> Departamento; a
> two-level joined unit / 'dúplex' -> Dúplex; a unit in a gated community /
> 'condominio'/'barrio cerrado' -> Condominio; an office -> Oficina; a
> warehouse / 'depósito'/'galpón'/industrial -> Depósito; a shop / retail /
> 'local comercial' -> Local comercial; a whole multi-unit building ->
> Edificio. Weigh the description and attributes over the source's own label
> (e.g. an 'industrial warehouse with commercial potential' is Depósito or
> Local comercial, not the source's generic label; a listing with 0 bedrooms
> and only a large land area is Terreno/Campo). Respond with ONLY the exact
> type label from the list - no punctuation, no explanation.

Allowed types: `Casa, Departamento, Dúplex, Terreno, Campo, Local comercial,
Oficina, Depósito, Edificio, Condominio, Loteamiento` (fallback: `Inmueble`).

## Verification

- `node --check lib/aiClassifyCore.js` → OK
- `node --check scripts/backfill-ai-types.mjs` → OK
- `node --check` was also run against a stripped-import copy of `lib/scrape.js`
  to confirm the hook's syntax (the file itself imports `server-only`, which
  only resolves inside Next.js, so it can't be `--check`ed directly).
- Unit-tested `normalizeToType` directly (no network): `'Dúplex'`→`Dúplex`,
  `'duplex'`→`Dúplex`, `'Departamento.'`→`Departamento`, `'apartment'`→
  `Departamento`, `'  Casa  '`→`Casa`, `'gibberish'`→`Inmueble`. All correct.
- Live dry-run (`node scripts/backfill-ai-types.mjs --dry-run --limit 3`)
  against the real AiroBase (205 active+complete deals found) using the
  `.env.local` credentials: PostgREST fetch worked, but **every** Groq call
  returned `null` (logged as `FAILED (kept)`) because `GROQ_API_KEY`'s
  pinned model `llama-3.1-8b-instant` no longer exists on this account (see
  Concerns). This is exactly the resilient fallback path working as
  designed — no crash, source type kept, run completes with a summary.
- To prove the classification logic itself (prompt, Groq call, parsing,
  diffing) works correctly end-to-end, the same dry-run was re-run with a
  **one-off shell-only** `GROQ_MODEL` override (not written to any file) to a
  model that is currently live on this account (`allam-2-7b`):
  ```
  [backfill] starting (dry-run, no writes) limit=3 model=allam-2-7b
  [1/205] 0047ddfe-7622-4cd6-8f81-d855ea6098ad loteamiento -> Loteamiento
  [2/205] 027b2a1d-bc14-47a3-9117-9bb56c7e6f3b Terreno Urbano -> Terreno
  [3/205] 0367e2dd-63b0-4c1c-9237-e5a97730e0fd Edificio -> Edificio (unchanged)
  [backfill] summary {"processed":3,"updated":2,"unchanged":1,"failed":0}
  ```
  This confirms: PostgREST paging/filtering, the Groq request/response
  parsing, `normalizeToType` canonicalization, and the old-vs-new diffing all
  work correctly. `.env.local` was **not modified** — the override was
  shell-only for this one verification command.

## Concerns

1. **`GROQ_MODEL=llama-3.1-8b-instant` in `.env.local` is stale.** A direct
   `GET https://api.groq.com/openai/v1/models` call with the configured
   `GROQ_API_KEY` shows this account's currently available chat models are:
   `allam-2-7b`, `groq/compound`, `groq/compound-mini`,
   `openai/gpt-oss-safeguard-20b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`,
   `qwen/qwen3.6-27b` (plus non-chat models: whisper, prompt-guard, orpheus).
   `llama-3.1-8b-instant` is not in that list — Groq has deprecated/retired
   it since this env var was set. As shipped, `lib/aiClassify.js` and the
   backfill script will call Groq with this model, get a 404
   `model_not_found`, and — by design — treat that as "AI unreachable":
   `classifyPropertyType` returns `null`, scrapes keep the source's own
   type, and the backfill logs every row as `FAILED (kept)`. **Nothing
   breaks, but nothing gets classified either**, until `GROQ_MODEL` in
   `.env.local` is updated to a currently-valid model.
   - Recommendation: point `GROQ_MODEL` at a fast **non-reasoning** chat
     model. `allam-2-7b` worked cleanly with `max_tokens: 12` in this test.
     The `openai/gpt-oss-*` and `qwen/qwen3.6-27b` models on this account are
     reasoning models — they burn the `max_tokens` budget on hidden
     `reasoning` tokens before emitting visible content, so with a tight
     12-token cap they returned an **empty** `content` (which
     `classifyPropertyTypeCore` correctly treats as a failed call). If a
     reasoning-family model is preferred, `max_tokens` will need to be
     raised substantially (and possibly a "no chain-of-thought" instruction
     added) for it to reliably emit a visible label within budget.
2. The classifier trusts the model's raw label; `normalizeToType` maps
   unrecognized output to `'Inmueble'` rather than silently keeping the old
   type, so a badly-behaving model could still (correctly, by spec) downgrade
   ambiguous listings to `Inmueble`. This matches the spec exactly
   ("If genuinely unclassifiable, return `Inmueble`").
3. The scrape hook adds one Groq round-trip per scraped item (serially,
   inside the existing per-item loop) — on a large source run this adds
   `items × Groq latency` to total scrape time. This was explicitly accepted
   in the task spec ("the `8b-instant` model is fast").
4. `lib/aiClassifyCore.js` currently has no `package.json`
   `"type": "module"`, so plain `node` prints a one-time
   `MODULE_TYPELESS_PACKAGE_JSON` performance warning when running the
   backfill script directly. Harmless (doesn't affect Next.js, which uses its
   own bundler), just cosmetic noise in the CLI output.
