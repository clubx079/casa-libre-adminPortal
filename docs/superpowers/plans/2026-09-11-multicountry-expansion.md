# Casa Libre Multi-Country Expansion — Implementation Plan

> **For agentic workers:** implement phase-by-phase. Paraguay MUST keep working at every step. Local-first; push to clubx079 when a phase is verified.

**Goal:** Expand Casa Libre from Paraguay-only to many countries (Bolivia next, then Argentina, Brazil, Chile, …) with: **one database per country**, **one buyer portal per country** (same codebase, env-configured), **one shared admin portal** with a country switcher, and **scrapers run per country**. Adding a country becomes "new DB + registry entry + a buyer deploy," not a fork.

**Architecture:** Control plane / data planes. Data planes = per-country AiroBase DBs (isolated). Buyer portal = one codebase deployed once per country (env → its DB + domain + locale). Admin = one shared deployment; a `dbFor(country)` factory + a country switcher points every screen at the selected country's DB. Registry + DB credentials live in the admin's **env** (no control DB — admin auth is a single env account, no `admin_users` table). See `Casa-Libre-Backend-Architecture.pdf`.

**Tech stack:** Next.js 14.2 App Router (plain JS), AiroBase/PostgREST per country, env-driven country config, Backblaze B2 (shared), Groq/Google Vision/LaMa (shared), Stripe/Resend/PostHog (shared or per-country as needed).

**Spec:** this document + the architecture PDF. Repos: `casa-libre-BuyerPortal`, `casa-libre-adminPortal` (both on `main`, dual remotes origin=clubx079 / airosofts).

## Global Constraints
- **🚫 PARAGUAY PRODUCTION DATA IS SACRED.** The PY buyer portal is LIVE with real users and real properties. This feature must NEVER write to, alter, migrate, or delete anything in the PY DB (`proj_d34d50f3d7174f8aadf0`). All new-country work happens ONLY on the BO DB + the new control DB. No DDL on PY. No test writes on PY — test on the (empty) BO DB or throwaway rows there. Reads of PY are fine.
- **Paraguay never breaks (code parity).** Every change is backward-compatible: `NEXT_PUBLIC_COUNTRY` defaults to `py`; a missing registry entry = today's behavior. PY must be byte-for-byte unchanged. Prove PY parity (build + smoke) BEFORE any push to the live PY buyer portal.
- **Country = configuration, never a branch.** One codebase per repo; per-country = env + a config object.
- **Secrets stay in env.** Each country's `AIROBASE_URL`/`AIROBASE_SECRET_KEY` live only in deployment env — never committed, never in a DB.
- **One DB per country** (data planes): PY = existing project; BO = a new project with identical schema. **PLUS one small shared "control" DB** (global) holding admin team logins + the countries registry (each country's REST URL/key/domain). One env secret (the control DB's own creds) bootstraps everything; adding a country = inserting a registry row.
- **Rotate the committed PAT** in both repos' `.git/config` and switch `origin` to a credential helper (security hygiene; do early).
- Test each phase locally; verify PY regression before pushing.

## Rollout order (phases are independently shippable)
1. **Phase 1 — Buyer portal country config** (unblocks a correct Bolivia buyer site; PY unchanged).
2. **Phase 2 — Admin `dbFor(country)` + registry + switcher + country-aware cron.**
3. **Phase 3 — Lift per-country scraper/ingest logic** (adapters, zone taxonomy, floors, phone, FX).
4. **Phase 4 — Bolivia bring-up** (new DB, sources, deploy, hub card live).

---

## PHASE 1 — Buyer portal: country configuration

**New file:** `casa-libre-BuyerPortal/lib/country.js` — the single source of per-country truth, selected by `process.env.COUNTRY` (default `'py'`).

- [ ] **1.1 Create `lib/country.js`.** A `COUNTRIES` map keyed by code; export the active config `CC = COUNTRIES[process.env.COUNTRY || 'py']`. Fields (PY values = exactly today's constants → zero behavior change):
```js
// lib/country.js
export const COUNTRIES = {
  py: {
    code: 'py', name: { es: 'Paraguay', en: 'Paraguay' }, domain: 'https://casa-libre.com.py',
    currency: { code: 'PYG', symbol: '₲', word: 'Gs.' }, fxKey: 'PYG', fxFallbackEnv: 'PYG_PER_USD', fxFallback: 7300,
    phonePrefix: '595', locale: { es: 'es-PY', en: 'en-US' },
    map: { center: { lat: -25.293, lng: -57.60 }, zoom: 13, bbox: { latMin: -28, latMax: -19, lngMin: -63, lngMax: -54 } },
    defaultCity: 'Asunción', defaultProvince: 'Central',
    saleFloorUsd: 5000, rentFloorLocal: 300000, // for copy/validation parity
    cities: [/* current lib/site.js CITIES */], competitors: [/* current COMPETITORS */],
  },
  bo: {
    code: 'bo', name: { es: 'Bolivia', en: 'Bolivia' }, domain: 'https://casa-libre.com.bo',
    currency: { code: 'BOB', symbol: 'Bs', word: 'Bs.' }, fxKey: 'BOB', fxFallbackEnv: 'BOB_PER_USD', fxFallback: 6.96,
    phonePrefix: '591', locale: { es: 'es-BO', en: 'en-US' },
    map: { center: { lat: -16.5, lng: -68.15 }, zoom: 12, bbox: { latMin: -23, latMax: -9.5, lngMin: -70, lngMax: -57 } },
    defaultCity: 'La Paz', defaultProvince: 'La Paz',
    saleFloorUsd: 5000, rentFloorLocal: 1500,
    cities: [/* BO cities */], competitors: [/* BO portals */],
  },
};
export const CC = COUNTRIES[process.env.COUNTRY || 'py'];
```
- [ ] **1.2 Map → country-generic.** `utils/gmap.js`: rename `inParaguay` → `inCountry(lat,lng)` using `CC.map.bbox` (keep `inParaguay` as an alias re-export for now). In `MarketplaceClient.js`, `MobileMarketplace.js`, `PropertyDetailView.js` use `CC.map.center`/`zoom` instead of the literal `-25.293,-57.60`.
- [ ] **1.3 Money/FX/locale.** `lib/fx.js`: generalize to `getUsdToLocal()` reading `rates[CC.fxKey]` + `process.env[CC.fxFallbackEnv] || CC.fxFallback` (keep `getUsdToPyg` as alias). `lib/money.js`: `dualPrice`/formatters use `CC.currency`. `lib/ui.js`: `loc()` from `CC.locale`, `fmtLocal` symbol from `CC.currency`, `heroTitle2` = `en ${CC.name[lang]}`, `normalizePhone` prefix from `CC.phonePrefix`.
- [ ] **1.4 Site/zones/submissions.** `lib/site.js`: `CITIES`/`COMPETITORS`/tagline/desc from `CC`. `lib/dedupe.js`: city map from `CC.cities`. `lib/quarantine.js`: `province`/`country`/`base_url` from `CC`. `components/AddressAutocomplete.js`: country restriction + default city from `CC`.
- [ ] **1.5 Copy/metadata.** Replace literal "Paraguay"/"en Paraguay" in marketing pages (`app/{comprar,alquilar,vender,...}/page.js`, `app/comparar/[competidor]`), `components/{LandingClient,MobileHome,EmpresasClient,Footer}.js`, `lib/email.js` with `CC.name`.
- [ ] **1.6 Verify + deploy.** With `COUNTRY` unset → confirm PY is unchanged (visual + a quick prod-parity diff). Then locally set `COUNTRY=bo` + BO env and confirm currency (Bs), La Paz map, "en Bolivia" copy. Deploy the BO buyer portal (env: `COUNTRY=bo`, BO `AIROBASE_*`, `APP_PUBLIC_URL=https://casa-libre.com.bo`, `BOB_PER_USD`, Stripe/Resend as needed).

---

## PHASE 2 — Admin portal: shared multi-country

- [ ] **2.1 Control DB + registry — `lib/control.js` (NEW).** Provision a small **control DB** (its own AiroBase project; creds in env: `CONTROL_DB_URL` + `CONTROL_DB_KEY`) with three tables: `admin_users` (email + bcrypt hash + role + allowed_countries), `admin_sessions`, and **`countries`** (`code, label, rest_url, service_key, domain, currency, fx_key, phone_prefix, active`). `lib/control.js` reads it: `listCountries()` + `countryConfig(code)` from the `countries` table, and admin auth from `admin_users`. Adding a country = INSERT a row (no redeploy). Bootstrap the `countries` table with the PY + BO rows. (Interim: a `COUNTRIES_JSON` env can stand in until the control DB exists, but the control DB is the target so team logins + the registry have a home.)
- [ ] **2.2 `lib/db.js` → `dbFor(country)` factory.** Convert the six functions (`select/selectWithCount/insert/update/remove/rpc`) into a factory bound to a country's `{url,key}` from the registry: `export function dbFor(code){ const {url,key}=countryConfig(code); return { select, insert, ... } }`. **Keep the existing named exports** bound to the default (`py`) country so un-migrated callers keep working during the migration (incremental, PY-safe).
- [ ] **2.3 Active-country state — `lib/adminCountry.js` (NEW).** A cookie `cl_admin_country` (default `py`); `activeCountry()` reads it server-side; a setter route/action; guard so only registry countries are accepted.
- [ ] **2.4 Country switcher UI.** A dropdown in the dashboard header (lists `listCountries()`), sets the cookie + reloads. Show the **active country as a prominent banner/badge** so destructive actions are never run on the wrong country.
- [ ] **2.5 Thread `dbFor(activeCountry())` through the app.** Mechanical: in every page/route that does `import { select } from '@/lib/db'`, switch to `const { select, insert, update, selectWithCount, remove, rpc } = dbFor(activeCountry())` per request. Files: `app/(dashboard)/{page,properties,properties/[id]/edit,quarantine,scrape,scrape/[key],scraper-status,runs,reports,analytics,users,partners,contacts,feedbacks}`, and `app/api/{scrape,scrape/control,cron,cron/infocasas,infocasas,scraper-registry,scraper-registry/[id],sources/[key],properties/[id],properties/[id]/images,quarantine,quarantine/[id],reports,reports/[id],users,users/[id],partners,partners/[id],contacts,feedbacks,media/[...key]}`. Do it route-group by route-group, testing PY after each.
- [ ] **2.6 Scrape pipeline country-aware.** `lib/scrape.js` `runScrape/startRun/runJob` take a `country` (or a `db` handle) and pass `dbFor(country)` into `lib/ingest.js`, `lib/api-usage.js`, and `makeCostBreaker(sourceKey, db.select)` (already injected — no change). Run rows (`scrape_runs`) live in that country's DB.
- [ ] **2.7 Country-aware cron.** `app/api/cron/route.js` + `app/api/cron/infocasas/route.js`: accept `?country=<code>` (Bearer `CRON_SECRET` unchanged); the scheduler fans out one call per registry country. Each call scopes to `dbFor(country)` and that country's enabled `scrape_sources`.

---

## PHASE 3 — Lift per-country scraper/ingest logic (admin)

- [ ] **3.1 Adapters:** the 12 `lib/adapters/*.js` emit `country` from the run's country config instead of the literal `'Paraguay'`.
- [ ] **3.2 Ingest per country:** `lib/ingest.js` — the `CANONICAL` zone taxonomy and `validateListing` floors become per-country (a `lib/country.js` in admin, mirroring the buyer's, keyed by the run's country). PY taxonomy unchanged; BO gets its own departments/cities.
- [ ] **3.3 Phone / FX / sources:** phone regex prefix (`+595`→`CC.phonePrefix`) in `imageScreen.js`/`watermarkRemover.js`/`ingest.js`; FX per country; InfoCasas seed/shard scripts take a `--country` (only where InfoCasas operates — it exists in BO/AR/UY too).

---

## PHASE 4 — Bolivia bring-up

- [ ] **4.1 Create the BO AiroBase project.** Apply the buyer/admin migrations so schema == PY: admin `001`–`005` + buyer `001`–`004` (auth, account, highlight/payments, promotion plans). (I'll provide the exact SQL bundle.)
- [ ] **4.2 Register + deploy.** Add BO to the admin's `COUNTRIES_JSON`; deploy the BO buyer portal (Phase 1 env). Both point at the BO DB.
- [ ] **4.3 Configure BO sources.** Insert BO portals into `scrape_sources` (adapters are shared code). Run a small test scrape via the shared admin (country=bo), verify quarantine → insert → images → marketplace end-to-end.
- [ ] **4.4 Go live on the hub.** Flip Bolivia's card to `live` on `casa-libre.com` (casa-libre-main-page `COUNTRIES` array).

---

## Testing strategy
- **PY regression after every task** (esp. Phase 2.5 threading): the PY buyer + admin behave exactly as before with `COUNTRY` unset / `activeCountry()==='py'`.
- **BO smoke:** currency/locale/map/copy correct on the buyer portal; admin switcher flips all screens to BO data; a test scrape flows through the BO pipeline.
- Reuse the existing forged-session + REST harness pattern for server-side E2E, per country.

## Risks / notes
- The **Phase 2.5 threading is the bulk of the effort** — it touches ~35 files but is mechanical and uniform (same `dbFor` pattern). The back-compat default keeps PY safe throughout; migrate + test in small batches.
- Keep the **active-country banner** loud; gate deletes/bulk-quarantine/scrape by it.
- Shared services (B2, Vision, Groq, Resend, Stripe, PostHog) stay global; only `AIROBASE_*` + FX + locale are per-country. Consider per-country B2 prefixes so images are namespaced.
