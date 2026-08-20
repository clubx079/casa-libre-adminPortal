# Track C-B — Scraper Status page

## Summary
Added a new "Scraper Status" admin page backed by the pre-existing (live) `scraper_registry`
table, plus two API routes and a sidebar nav entry. Team members propose a site via a modal
(enters as `pending`); an admin toggles it to `running` once deployed.

## Files created
- `app/(dashboard)/scraper-status/page.js` — client component, the page itself.
- `app/api/scraper-registry/route.js` — `GET` (list, newest first) / `POST` (create pending row).
- `app/api/scraper-registry/[id]/route.js` — `PATCH` (whitelist-based update, used for the status toggle).

## Files modified
- `components/AdminShell.js` — added `['/scraper-status', 'Scraper Status', 'scrape']` to `NAV`,
  placed immediately after the `/scrape` entry so scraper-related items are grouped. Reuses the
  existing `scrape` icon case (no new icon added — reuse was explicitly acceptable per spec).

## Page structure (`app/(dashboard)/scraper-status/page.js`)
- `'use client'` component. On mount, `fetchRows()` calls `GET /api/scraper-registry` and stores
  `rows` in state; `loading`/`error` states drive a skeleton (animated pulse rows, same shape as
  `users/page.js`) and an error banner respectively.
- Local `T` token object and `CARD` style object copied verbatim from `users/page.js` /
  `runs/page.js` (`textPrimary #111111`, `textSecondary #6B6862`, `textMuted #9C978C`,
  `borderLight #E7E1D6`, `bgSurface #FAF7F1`, `bgWhite #FFFFFF`), plus `success #0F6E56` /
  `successSurface #E4F1E9` and `warning #8A5A12` / `warningSurface #F5EAD5` copied from
  `analytics/page.js` (the only place that pair was already defined).
- Heading block matches spec exactly (`h1.text-2xl.font-bold.tracking-head` + subtitle `p`), root
  `<div className="space-y-5">` with no extra outer padding (AdminShell's `<main>` already applies
  `max-w-[1100px] mx-auto px-5 md:px-8 py-8`).
- Table: `bg-white` + `CARD` wrapper, `th` styled `px-4 py-2.5 text-[10px] font-semibold uppercase
  tracking-wider` in `T.textSecondary` (non-mono), rows `border-b` in `T.borderLight`. Body is
  wrapped in a single scroll container `className="cl-scroll"` `style={{ maxHeight: 560,
  overflow: 'auto' }}` (matches the normalized Runs page fixed-height pattern) so the page itself
  never grows with row count.
- Columns: Name, Website (external link, `target="_blank" rel="noopener noreferrer"`, truncated
  with a `title` tooltip holding the full URL), Status (pill — `running` → green success token,
  `pending` → amber warning token), Description (truncated, `title` tooltip), Added (short date via
  `toLocaleDateString`), Actions (toggle button — CSS `hover:bg-[#FAF7F1]` on the row, no
  `onMouseEnter`/`onMouseLeave`, consistent with the "recently normalized" pages / the constraint
  in the brief).
- "Add website" button top-right of the heading row (`bg: T.textPrimary`, `color: T.bgWhite`,
  `rounded-full` pill with a `Plus` icon) opens the modal.
- Modal: fixed overlay (`bg-ink/30 backdrop-blur-sm`, click-outside closes) + centered white card
  using `CARD` styling. Fields: Name (required), Website URL (`type="url"`, required),
  Description/note (optional `textarea`). Inline validation sets a red border + message under a
  field when empty on submit attempt. A request-level error (e.g. network/API failure) surfaces in
  a banner above the buttons, styled like the existing error banners (`#FBEDE9` / `#8A2B16`).
  Submit disables both buttons and shows "Adding…"; on success it closes the modal, clears the
  form, and re-fetches the list (`fetchRows()`).
- Status toggle: `toggleStatus(row)` computes the flipped status client-side, PATCHes
  `/api/scraper-registry/<id>`, and on success replaces that row in local state with the server's
  returned row (avoids a full re-fetch); the button shows `…` and is disabled while its own request
  is in flight (tracked per-row via `togglingId`).
- Loading skeleton mirrors `users/page.js` (5 pulsing rows); empty state is a centered message with
  a `Globe2` icon, consistent with the `UsersIcon` empty state pattern.

## API routes
### `app/api/scraper-registry/route.js`
- `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';`
- `GET`: session-gated (`getSession()` from `@/lib/auth`, 401 `{ error: 'No autorizado' }` if
  absent); `select('scraper_registry', 'select=*&order=created_at.desc')`; returns `{ rows }`;
  wrapped in try/catch returning 500 on failure, matching the other routes' error shape.
- `POST`: session-gated; parses JSON body (400 `Bad request` on parse failure); trims `name`/`url`,
  requires both non-empty (400 `'Nombre y URL son requeridos'` — Spanish, matching the existing
  route convention); `description` defaults to `null`; inserts via
  `insert('scraper_registry', [{ name, url, description, status: 'pending' }], { returning:
  'representation' })`; returns `{ ok: true, row }`.

### `app/api/scraper-registry/[id]/route.js`
- Same runtime/dynamic exports.
- `PATCH`: session-gated; parses body; if `status` is present it must be `'pending'` or `'running'`
  (400 `'Estado invalido'` otherwise); whitelists `['status', 'name', 'url', 'description']` into
  `patch`, converting empty strings to `null` (mirrors `properties/[id]/route.js`); sets
  `patch.updated_at = new Date().toISOString()`; 400 `'Nada para actualizar'` if the whitelist
  produced nothing; `update('scraper_registry', 'id=eq.' + id, patch, { returning:
  'representation' })`; returns `{ ok: true, row }`.

Both routes follow the exact `select`/`insert`/`update` signatures in `lib/db.js` and the
session-gate + Spanish-error-string convention used by `app/api/properties/[id]/route.js` and
`app/api/sources/[key]/route.js`.

## Nav
`components/AdminShell.js` `NAV` array now reads:
```
['/', 'Overview', 'dash'],
['/users', 'Users', 'users'],
['/analytics', 'Analytics', 'chart'],
['/scrape', 'Scrapers', 'scrape'],
['/scraper-status', 'Scraper Status', 'scrape'],
['/properties', 'Properties', 'home'],
['/runs', 'Runs', 'runs'],
```
Confirmed no route-highlighting collision: `isActive('/scrape')` only matches `/scrape` or paths
starting with `/scrape/`, which `/scraper-status` does not (it starts with `/scraper-`, not
`/scrape/`), so the two nav items highlight independently.

## Build output
`npm run build` — compiled successfully, no type/lint errors. Route table confirms all three new
routes registered as dynamic (`ƒ`):
```
├ ƒ /api/scraper-registry                  0 B                0 B
├ ƒ /api/scraper-registry/[id]             0 B                0 B
├ ƒ /scraper-status                        3.66 kB        90.9 kB
```

## Reasoned-through behavior (not exercised against a live server in this task)
- `GET /api/scraper-registry` against the live DB should return the 12 seeded rows, all
  `status: 'running'`, ordered by `created_at desc`.
- Submitting "Add website" with valid Name + URL POSTs `{name, url, description}`; the server
  forces `status: 'pending'` regardless of client input, so the new row always enters the queue as
  pending.
- Clicking "Mark pending"/"Mark running" PATCHes only `{status: <flipped>}`; the server whitelist
  additionally allows `name`/`url`/`description` edits via the same endpoint if ever wired up later,
  but the current UI only ever sends `status`.
- Live verification (seeded rows rendering, insert/toggle round-tripping through PostgREST) depends
  on the dev server running against AiroBase with the `scraper_registry` migration already applied
  — not exercised here since this was a static build check only.

## Concerns
- None blocking. Minor note: the toggle's failure path is silent (no visible error toast) — it
  just leaves the row unchanged in local state; a manual page refresh would reveal the true DB
  state if a PATCH silently failed for some reason. Matches the terseness of the rest of the admin
  UI's optimistic-update patterns (e.g. `ScrapeDetail.js`'s `control()`), so left as-is rather than
  adding new UI conventions.
