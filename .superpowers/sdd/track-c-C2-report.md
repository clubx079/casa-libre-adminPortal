# Track C — C2: Unresponsive Reports admin surface

## Files added/changed

- `app/(dashboard)/reports/page.js` (new) — client page, "Reports" review table.
- `app/api/reports/route.js` (new) — GET, session-gated, lists `listing_reports` newest first.
- `app/api/reports/[id]/route.js` (new) — PATCH, session-gated, status-only whitelist.
- `components/AdminShell.js` (edited) — added `['/reports', 'Reports', 'runs']` to `NAV`, placed right after `/scraper-status` and before `/properties`. Reused the existing `runs` icon case (already defined in the `Icon` component — confirmed present, no crash risk).

## Page structure (`app/(dashboard)/reports/page.js`)

- `'use client'`, fetches `/api/reports` on mount via `useEffect`, `cache: 'no-store'`.
- Local `T` token object and `CARD` style copied verbatim from `scraper-status/page.js` (textPrimary, textSecondary, borderLight, bgSurface, bgWhite, success/successSurface, warning/warningSurface).
- Heading "Reports" + subtitle "Buyers who reported a publisher that didn't respond".
- Single scroll container: `className="cl-scroll"` with `style={{ maxHeight: 560, overflow: 'auto' }}`, matching the scraper-status pattern (not the `overflow-x-auto` variant used in users/page.js).
- Row hover via CSS class `hover:bg-[#FAF7F1]` (no onMouseEnter/onMouseLeave), per spec.
- Columns:
  - **Listing** — `listing_ref` (truncated, `title` = full) over `property_id` shortened to first 8 chars, mono/muted.
  - **Seller** — `seller_name` over `seller_phone` (mono/muted).
  - **Reporter** — `reporter_name` over `reporter_contact`; an "account" pill with a `User` icon when `user_id` is set, otherwise the text "anonymous".
  - **Message** — truncated single line, `title` attribute carries the full text.
  - **When** — `created_at` formatted via the same `fmtDate` helper used elsewhere (`en-US`, short month/day/year).
  - **Status** — pill: `open` → warning tokens, `reviewed` → neutral (bgSurface bg / textPrimary ink), `resolved` → success tokens.
  - **Actions** — one button per status other than the current one (`Mark reviewed`, `Mark resolved`, `Reopen` when current is not `open`), each firing `PATCH /api/reports/:id` and replacing the row in state with the API's returned row on success. Silent no-op on failure (mirrors scraper-status's `toggleStatus`), leaving the row as-is for a manual refresh.
- Loading state: 5 skeleton rows with pulsing placeholders (same pattern as scraper-status, sized 7 columns instead of 6).
- Error state: single centered message row, "Couldn't load reports. Check the DB connection."
- Empty state: centered `Flag` icon + "No reports yet" / helper line, styled like scraper-status's `Globe2` empty state.
- Newest first is enforced server-side by the API's `order=created_at.desc`.

## API routes

`app/api/reports/route.js`:
- `runtime='nodejs'`, `dynamic='force-dynamic'`.
- `GET`: 401 via `getSession()` check ⇒ `{ error: 'No autorizado' }`; otherwise `select('listing_reports', 'select=*&order=created_at.desc')` and returns `{ rows }`. Try/catch wraps the DB call, 500 on failure — mirrors `scraper-registry/route.js` exactly.

`app/api/reports/[id]/route.js`:
- `runtime='nodejs'`, `dynamic='force-dynamic'`.
- `PATCH`: 401 via `getSession()`; parses JSON body (400 on parse failure); validates `body.status` is one of `['open','reviewed','resolved']` (400 `'Estado invalido'` otherwise) — this doubles as the whitelist since nothing else is read from `body`. Calls `update('listing_reports', 'id=eq.'+params.id, { status: body.status }, { returning: 'representation' })` and returns `{ ok: true, row }` (destructured first element, matching the `scraper-registry/[id]/route.js` return shape). No `updated_at` bump since `listing_reports` wasn't specified to have one (scraper_registry's route sets it because that table has the column; not adding an unverified column here).

## Nav

`NAV` array in `components/AdminShell.js` now reads:
```
['/', 'Overview', 'dash'],
['/users', 'Users', 'users'],
['/analytics', 'Analytics', 'chart'],
['/scrape', 'Scrapers', 'scrape'],
['/scraper-status', 'Scraper Status', 'scrape'],
['/reports', 'Reports', 'runs'],
['/properties', 'Properties', 'home'],
['/runs', 'Runs', 'runs'],
```
The `runs` icon (clock/history glyph) is already defined in the `Icon` switch in the same file — verified by reading the component before editing, so there's no undefined-icon crash.

## Self-review (no build was run)

- `node --check` (Node 22, which auto-detects ESM syntax regardless of `package.json` "type") passed clean on both new API route files.
- `page.js` was re-read in full after writing and manually checked for: balanced JSX tags, all three ternary branches closed correctly, `colSpan={7}` matching the 7 header cells, all imported icons (`Flag`, `User`) actually used, no leftover unused imports.
- No project ESLint config exists (`next lint` would trigger the interactive "set up ESLint" wizard), so `npx next lint` was not usable without creating new config files as a side effect — skipped per the "don't build" spirit of not touching shared state; relied on manual review + `node --check` instead.

## Concerns

- `listing_reports` schema per the task spec has no `updated_at` column, so the PATCH does not attempt to set one; if the live table does have one, it will simply stay stale (harmless, matches spec literally).
- The empty-state and error-state markup assume `NextResponse.json` always returns valid JSON on error paths (consistent with the rest of the codebase's API routes).
- Not verified end-to-end against the live dev server per the task's instructions (controller verifies via the live server) — build/dev-server run was intentionally not performed.
