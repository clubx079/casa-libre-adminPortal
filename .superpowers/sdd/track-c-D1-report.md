# Track C-D1 — Users: IP + geolocation, block/suspend

## Summary
Added an IP + resolved geolocation display and Block/Suspend controls to the admin Users page,
backed by the already-live `ip_address`, `registration_ip`, `blocked`, `suspended` columns on the
shared `users` table. Geolocation is resolved on read via a session-gated proxy to the free
`ip-api.com` batch endpoint (no DB storage of geo, matching the DeelMap admin pattern), with an
in-process cache on the server and a 7-day localStorage cache on the client to stay under the free
tier's rate limit.

## Files created
- `app/api/users/geo-lookup/route.js` — `POST { ips: [...] }` → `{ ip: { city, state, country } }`.
  Session-gated (401 if no session). Module-level `Map` cache (ip → geo) and `NULL_GEO` sentinel.
  Dedupes/filters the input, serves cache hits immediately, and batch-resolves misses via
  `POST http://ip-api.com/batch?fields=status,city,regionName,countryCode,query` in chunks of 100
  (`AbortSignal.timeout(8000)`), mapping each result by the echoed `query` field and caching every
  resolved IP (success or `NULL_GEO`) so repeat lookups never re-hit the external API. A chunk-level
  try/catch falls back to `NULL_GEO` for that chunk on network failure rather than failing the whole
  request.
- `app/api/users/[id]/route.js` — `PATCH` mirroring `app/api/scraper-registry/[id]/route.js`'s
  shape. Session-gated. `EDITABLE = ['blocked', 'suspended']` is the only writable set — email,
  active, role, etc. are not reachable through this route no matter what the body contains. Each
  present key is coerced to a strict boolean via `body[k] === true || body[k] === 'true'` (so a
  stray string/number in the body can't silently write a truthy non-boolean). 400 if the whitelist
  intersection is empty. `update('users', 'id=eq.'+id, patch, { returning: 'representation' })`,
  returns `{ ok: true, row }`.

## Files modified
- `app/api/users/route.js` — `GET`'s column list extended from
  `id,email,full_name,phone,verified,active,auth_provider,created_at,last_login_at` to also include
  `ip_address,registration_ip,blocked,suspended`. No other logic changed (search/`q` filter,
  `limit=500`, ordering all untouched).
- `app/(dashboard)/users/page.js`:
  - New `T` tokens: `warning`/`warningSurface` (reused verbatim from `analytics/page.js` and
    `reports/page.js` — `#8A5A12` / `#F5EAD5`, the only amber pair already established in this
    codebase) and new `danger`/`dangerSurface` (`#B3261E` / `#FBEAE9` — no red token existed
    anywhere in this admin portal, so this pair was added fresh, scoped to this page, reserved
    strictly for the Blocked pill/button per the brief).
  - **IP column**: `u.ip_address` in mono `11px` with a small `Globe` icon, or `—` when null.
  - **Location column**: reads `geoData[u.ip_address]` from local state; renders
    `[city, state].filter(Boolean).join(', ')` plus a small muted country code, or `—` while
    unresolved/unknown.
  - **Status column**: now checks `blocked` → `suspended` → the pre-existing `active`/`verified`
    logic, in that priority order, so a blocked-and-suspended user shows the red Blocked pill (most
    severe state wins). Suspended shows the amber pill, otherwise falls through to the original
    Inactive/Verified/Unverified pills unchanged.
  - **Actions column**: kept the existing "Activity" link and added two pill buttons —
    Suspend/Unsuspend (amber when actionable, neutral ink/paper once already suspended) and
    Block/Unblock (red when actionable, neutral once already blocked). Both call
    `toggleFlag(u, field)`, which PATCHes `/api/users/<id>` with `{ [field]: !u[field] }` and, on
    success, merges the server's returned row into local `users` state (no full re-fetch). A single
    `busy = { id, field }` state disables the row's action buttons and swaps the clicked button's
    label to `…` while its own request is in flight; the other row's buttons stay interactive.
  - **Geolocation fetch**: on every successful `GET /api/users` response, `fetchGeoData(rows)` runs:
    collects unique non-null `ip_address` values, seeds `geoData` instantly from a localStorage
    cache (`cl_admin_geo_cache_v1`, 7-day TTL via `loadGeoCache()`), then POSTs only the un-cached
    IPs to `/api/users/geo-lookup` in one request, merges the response into `geoData`, and writes
    only the *real* hits (non-null city/state/country) back to localStorage — failed/rate-limited
    lookups are deliberately not cached so they retry on the next load instead of getting stuck as a
    permanent blank.
  - Table `min-w` widened from `860px` to `1180px` to fit the two new columns without breaking the
    existing `overflow-x-auto cl-scroll` wrapper; header array, loading-skeleton cell count, and
    `colSpan` on the error/empty rows all bumped from 7 to 9 to match the new column count.
  - Existing search (`q`/`term`), stat strip (Total/Verified/Showing), and row hover styling are
    unchanged.

## Self-review
- `node --check` passed clean on all three touched/created API route files:
  `app/api/users/route.js`, `app/api/users/geo-lookup/route.js`, `app/api/users/[id]/route.js`.
- `app/(dashboard)/users/page.js` is JSX and can't be syntax-checked with `node --check`; verified by
  careful re-read of the full file after editing (imports, hooks, JSX structure, column/colSpan
  counts all consistent). Per the task constraints, `npm run build`/`next build` was intentionally
  **not** run (dev server on :3005 shares this `.next`); live verification against the running admin
  portal is the controller's responsibility.
- Confirmed the PATCH whitelist genuinely excludes everything except `blocked`/`suspended` — grepped
  `EDITABLE` and the coercion line by hand; no path from request body to any other column.

## Concerns
- The Block/Suspend buttons fail silently on network error (mirrors the existing terse
  optimistic-update convention already used elsewhere in this admin, e.g. the scraper-registry
  toggle) — a failed PATCH just leaves the row's pill unchanged with no visible error toast. A
  refresh would reveal true DB state if this ever masked a real failure.
- `ip-api.com` (HTTP, not HTTPS) is queried in plaintext per the brief's exact spec — same as the
  DeelMap admin's implementation this was modeled on. IP addresses are not typically treated as
  highly sensitive, but flagging in case a stricter posture is wanted later.
- Did not add Blocked/Suspended counts to the stat strip (kept to Total/Verified/Showing) since the
  brief didn't ask for it and I wanted to stay tightly scoped to the four listed deliverables.
