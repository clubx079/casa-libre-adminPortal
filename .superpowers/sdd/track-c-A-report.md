# Track C-A Report — UI consistency pass (Scrapers / Properties / Runs)

Branch: `omar-admin-track-c`
Commit: `78320c0` — `style(admin): normalize scrape/properties/runs to Overview/Users design + fixed-height scroll containers`

## Scope

Restyled the three "new" pages (Scrapers, Properties, Runs) to match the visual
language of the three original pages (Overview `app/(dashboard)/page.js`, Users
`app/(dashboard)/users/page.js`, Analytics `app/(dashboard)/analytics/page.js`), and
added fixed-height scroll containers to the Runs history table and the Properties
list (both table and card views) so the page no longer grows with row count.

No data-fetching, i18n keys (existing ones), actions, or routes were changed. Two
new i18n keys were added (`prop.subtitle`, `runs.subtitle`, es + en) since those two
pages previously had no subtitle text under the heading — see below.

## Files touched

- `app/(dashboard)/scrape/page.js`
- `components/ScrapeBoard.js`
- `app/(dashboard)/properties/page.js`
- `components/PropertiesView.js`
- `app/(dashboard)/runs/page.js`
- `lib/i18n.js` (added `prop.subtitle` / `runs.subtitle`, es + en)

## Before → after, per file

### `app/(dashboard)/scrape/page.js`

- **Before**: root `<div className="p-6 md:p-10">`; header block with `font-mono
  uppercase tracking-label` kicker (`t('scrape.kicker')`), a
  `text-[clamp(30px,5vw,44px)] tracking-display` heading split into
  `t('scrape.title1')` + `<em className="font-serif italic font-normal">` for
  `t('scrape.title2')`, and a `text-ink/55` intro paragraph. Error state used
  `bg-hatch1 border border-ink/20 rounded-card`.
- **After**: root `<div className="space-y-5">` (shell already pads via
  `AdminShell`'s `<main>`). Heading collapsed to the standard block:
  `<h1 className="text-2xl font-bold tracking-head" style={{color:T.textPrimary}}>`
  with plain-text `{t('scrape.title1')} {t('scrape.title2')}` (no serif-italic
  accent), and `t('scrape.intro')` reused verbatim as the `text-[13px]`
  `T.textSecondary` subtitle (no new i18n needed here — `scrape.intro` already
  existed and fit perfectly as the standard subtitle). Error banner converted to
  the `#FBEDE9` / `#8A2B16` inline-style pattern used on Overview's DB-error banner.
  Local `T`/`CARD` tokens added, matching the originals' hex values.

### `components/ScrapeBoard.js`

- **Before**: tile grid `gap-6`; each tile `bg-card border border-ink/15
  rounded-card p-6 cl-lift hover:shadow-hard-sm hover:border-ink`; mono-font logo
  placeholder in a `cl-hatch` box; `rounded-pill` badges; serif/mono ink-token
  typography throughout.
  All info about "Track C" was consistent with the *scrape/properties/runs* design
  language, distinct from the originals.
- **After**: tile grid `gap-4`; each tile `bg-white p-5` + `CARD` (14px radius,
  `#E7E1D6` border), with an inline `onMouseEnter/Leave` background swap to
  `T.bgSurface` (same hover technique as the Users/Analytics table rows, applied
  here to the tile itself since these are card links, not rows). Logo placeholder
  simplified to a plain `T.bgSurface` box with `T.textMuted` initials (no more
  `cl-hatch`/mono). Badges switched to inline-style `rounded-full` (active =
  `T.textPrimary`/white, inactive = `T.bgSurface`/`T.textSecondary`), matching the
  status-pill look on Users (`Verified`) and Runs (`status`). Footer row (last-run
  date / "Open →") restyled with `T.textMuted` / `T.textPrimary` tokens instead of
  ink-opacity utilities. Dropped `cl-lift` transform-on-hover and
  `hover:shadow-hard-sm` — the originals don't lift cards, they just swap
  background (see Overview's "Quick links" cards, which do keep a `hover:shadow-hard-soft`
  utility class already defined in the design system, but the more common pattern —
  used on table rows and here — is the plain background swap, which is what I used
  for consistency with Users/Runs rows).

### `app/(dashboard)/properties/page.js`

- **Before**: root `<div className="p-6 md:p-10">`; header with mono kicker
  (`t('prop.kicker')`) + giant serif-italic split heading (`title1` / `title2`);
  no subtitle paragraph at all. Error banner `bg-hatch1 border border-ink/20
  rounded-card ... font-mono`.
- **After**: root `<div className="space-y-5">`. Standard heading block, plain
  `text-2xl` with `{t('prop.title1')} {t('prop.title2')}`. Added a subtitle line
  using the **new** i18n key `prop.subtitle` (this page had no subtitle text
  in the dictionary previously — see i18n additions below). Error banner
  converted to the same `#FBEDE9`/`#8A2B16` inline-style pattern.

### `components/PropertiesView.js` (the big one)

- **Before**: controls row used heavy `border-[1.5px] border-ink` pill
  buttons/toggles, `bg-card` search input, `rounded-pill`; card-grid tiles
  `bg-card border border-ink/15 rounded-card`, `cl-hatch` image placeholder;
  table wrapped in `bg-card border border-ink/15 rounded-card` + plain
  `overflow-x-auto` (no `cl-scroll`); `<thead>` used `font-mono text-[10px]
  uppercase tracking-label text-ink/50 border-b border-ink/10` (no background
  fill, no row hover); rows `border-b border-ink/[.06]`, no hover; pagination
  buttons `border-[1.5px] border-ink rounded-pill`. **No scroll container** —
  both table and card views rendered every row/card inline, so the page grew
  unbounded with result count (up to 24 rows/cards per page, but still the
  longest content block on the page).
- **After**:
  - Controls row moved into its own `bg-white p-4` + `CARD` card (matches the
    "toolbar card" pattern implied by Users' search-bar-in-table-header, but
    since Properties' toolbar has many more controls than Users' single search
    box, it's kept as its own card above the list rather than jammed into the
    table header — still uses the same `T.borderLight` 1px pill-button style
    used by e.g. Overview's stat cards and Users' search input).
  - Search input restyled to Users' exact input recipe (`1px solid
    T.borderLight`, `rounded-full`/999px, 13px font, `T.bgWhite`/`T.textBody`).
  - Status filter, class toggle, source `<select>`, and table/cards view toggle
    all restyled with inline `T.borderLight` borders and `T.textPrimary`/`white`
    for the active state (replacing `border-ink`/`bg-ink`/`text-paper` utility
    classes) — same on/off visual contract, new token source.
  - Card-grid tiles: `bg-white` + `CARD` (14px radius) instead of `bg-card
    border-ink/15 rounded-card`; image placeholder now `T.bgSurface` instead of
    `cl-hatch`; status badge, type/source chips, specs line, and buttons all
    switched from ink-opacity utilities to `T.*` inline styles; View/Edit/Delete
    buttons now `rounded-full` with `T.borderLight`/`T.textPrimary` instead of
    `border-ink`/`bg-ink`.
  - Table view: wrapper card is `bg-white overflow-hidden` + `CARD`; `<thead>`
    now has `background: T.bgSurface`, `borderBottom: 1px solid T.borderLight`,
    and non-mono `text-[10px] font-semibold uppercase tracking-wider`
    `T.textSecondary` headers (was mono/no-background); every `<tr>` in
    `<tbody>` now has the same `onMouseEnter/Leave` background-swap hover as
    Users' and Analytics' table rows (previously no hover at all); row border
    color driven by `T.borderLight` instead of `border-ink/[.06]`.
  - Table wrapped in `overflow-x-auto cl-scroll` (previously plain
    `overflow-x-auto`, no scrollbar styling class).
  - Pagination buttons restyled to `T.borderLight` bordered pills with
    `T.textBody` text, matching the thinner-border look used everywhere else
    (was the heavier `border-[1.5px] border-ink`).

### `app/(dashboard)/runs/page.js`

- **Before**: root `<div className="p-6 md:p-10">`; mono kicker + giant
  serif-italic heading, no subtitle; table in `bg-card border border-ink/15
  rounded-card` with plain `overflow-x-auto`; `<thead>` mono/no-background, no
  row hover; `STATUS` badge map used ink-opacity utility classes
  (`bg-hatch1`, `text-ink/60`, `border-ink/40`, etc.) — **not** aligned with the
  `T`/`CARD` token system.
- **After**: root `<div className="space-y-5">`; standard heading block, plain
  `text-2xl` heading `{t('runs.title1')} {t('runs.title2')}`; new subtitle from
  the **new** `runs.subtitle` i18n key (Runs also had no subtitle text
  previously). `STATUS` map rewritten as inline-style objects keyed off `T.*`
  (success = filled `T.textPrimary`/white; partial = `T.bgSurface`/
  `T.textPrimary`; failed = filled + strikethrough; running/paused = transparent
  + `T.borderLight` outline; stopped = `T.bgSurface`/`T.textSecondary`).
  Table wrapper `bg-white overflow-hidden` + `CARD`; `<thead>` given
  `T.bgSurface` background + `T.textSecondary` non-mono uppercase headers, and
  made `position: sticky; top: 0` inside the scroll container so the header
  stays visible while scrolling (mirrors what a sticky header would do for a
  tall table). Rows get the `onMouseEnter/Leave` `T.bgSurface` hover swap.

## Scroll containers (the explicit ask)

- **Runs** (`app/(dashboard)/runs/page.js`): table (up to 100 rows) wrapped in
  `<div style={{ maxHeight: 520, overflowY: 'auto' }} className="cl-scroll">`,
  mirroring the `maxHeight: 320` pattern already used in
  `analytics/page.js`'s session-events list. 520px was chosen (vs analytics'
  320px) because Runs can hold up to 100 rows vs. a single session's event list,
  so a slightly taller viewport reduces excessive scrolling while still capping
  page growth. Header (`<thead>`) is `position: sticky; top: 0` so column labels
  stay visible while scrolling.
- **Properties** (`components/PropertiesView.js`): both the **table** view and
  the **card-grid** view are wrapped in the same
  `<div style={{ maxHeight: 640, overflowY: 'auto' }} className="cl-scroll">`
  container (constant `LIST_MAX_HEIGHT = 640`). 640px was chosen because
  Properties pages can show up to 24 rows/cards per page (vs. Runs' 100 rows in
  a denser table), and card tiles are visually taller than table rows, so a
  taller viewport keeps a reasonable number of cards visible at once while still
  preventing the grid from pushing pagination far down the page. The table's
  `<thead>` is likewise `position: sticky; top: 0` inside the scroll container.
  The toolbar (search/filters) and pagination controls sit **outside** the
  scroll container, so only the list body scrolls — filters and page nav stay
  put.

## i18n additions

Two keys were missing entirely (Properties and Runs never had subtitle copy,
unlike Overview/Users/Analytics, which all have a one-line subtitle under the
`<h1>`). Added, es + en:

- `prop.subtitle`
  - es: "Todas las propiedades scrapeadas, con estado y edición rápida"
  - en: "Every scraped property, with status and quick editing"
- `runs.subtitle`
  - es: "Historial de corridas de scraping por template"
  - en: "History of scraping runs by template"

Scrape's subtitle needed no new key — `scrape.intro` (already existed, es + en)
was reused directly as the standard `T.textSecondary` subtitle line, since it
was already a concise one-line description of the page.

All existing i18n keys (titles, table headers, buttons, empty states, error
strings, etc.) were reused unchanged — no key was renamed, removed, or had its
meaning altered.

## Build output

`npm run build` from repo root — **succeeded**, no new errors or warnings:

```
✓ Compiled successfully
✓ Generating static pages (13/13)

Route (app)                                Size     First Load JS
├ ƒ /                                      178 B          96.1 kB
├ ƒ /analytics                             8.02 kB        95.3 kB
├ ƒ /properties                            7.52 kB         103 kB
├ ƒ /properties/[id]/edit                  6.46 kB         102 kB
├ ƒ /runs                                  142 B          87.4 kB
├ ƒ /scrape                                178 B          96.1 kB
├ ƒ /scrape/[key]                          7.27 kB         103 kB
├ ƒ /users                                 3.43 kB        99.4 kB
... (all 24 routes generated, ƒ/○ markers unchanged from before)
```

All 24 routes generated (dynamic ƒ / static ○ markers unchanged from a normal
build). No TypeScript/lint errors surfaced during "Linting and checking
validity of types."

## Concerns / notes

1. **`scrape/[key]/page.js` (the per-source detail page) was intentionally left
   untouched.** The task named only `scrape/page.js` + `ScrapeBoard.js`,
   `properties/page.js` + `PropertiesView.js`, and `runs/page.js` as in scope.
   The detail page still uses the old `p-6 md:p-10` / mono-kicker / serif-italic
   heading pattern and ink-opacity utilities (`STATUS`/`ctl.*` buttons, live
   progress log, cron config card, etc.) — it now visually mismatches the board
   page that links into it. If full consistency across *all* scrape-related UI
   is wanted, that page should get the same pass in a follow-up.
2. **Card view badge/active-state colors**: I used filled `T.textPrimary`
   (black) for "active" pills in both Properties and Scrapers, matching the
   pattern Users uses for method chips vs. Analytics' filled progress bars —
   there's no single "canonical" pill-active color across the three original
   pages (Users uses a green `success`/`successSurface` pair for "Verified";
   Overview/Analytics use plain `T.primary` fills for progress/avatar). I chose
   plain ink-fill (`T.textPrimary`) for status toggles since that's what the
   Users page's own action buttons and Overview's avatar circles use, and it
   reads as "on/selected" rather than implying semantic success/danger — open to
   revisiting if a reviewer wants the green success-token used for "active"
   properties specifically (would need `T.success`/`T.successSurface`, which I
   did not add since neither original Runs/Scrape page needed it before).
3. **`hover:shadow-hard-soft` vs. background-swap hover**: Overview's two
   "Quick links" cards use a `hover:shadow-hard-soft` Tailwind utility on hover;
   Users/Analytics table rows use the inline `onMouseEnter/Leave` background
   swap instead. I used the background-swap technique for the Scrapers tile
   grid (since a shadow risked looking like the old `cl-lift` treatment I was
   asked to drop) — flagging in case a shadow-based hover was actually the
   intended "match" for card tiles vs. table rows.
4. No production behavior, data-fetching, routes, or i18n *keys* (only two
   additions) were changed. Every feature (search, filters, view toggle,
   pagination, toggle-active, delete, cron badge, per-source drill-in link) is
   still present and wired exactly as before — only class names, inline
   `style=` colors, and DOM wrapper structure changed.

---

# Follow-up fix pass — sticky-header bug, scrape/[key] restyle, pill legibility

Branch: `omar-admin-track-c`
Commit: `475c65b` — `fix(admin): single-container sticky-header scroll, restyle scrape/[key], legible in-progress pills`

A review of the pass above found three issues. All three are fixed in this commit.

## FIX 1 — sticky-header / nested-overflow bug (Runs + Properties)

**Bug**: both `runs/page.js` and `PropertiesView.js` nested a vertical scroller
(`maxHeight` + `overflowY:auto`) around an inner `overflow-x-auto` div, with the
sticky `<thead>` living inside that *inner*, non-scrolling div. The actual
vertical-scrolling ancestor was the *outer* div, so `position:sticky` on the
`<thead>` had no scrolling container to pin against at the level it needed —
the header scrolled away with the body instead of staying pinned.

**Fix** (both files): collapsed to a single scroll container that handles both
axes:

```jsx
<div className="cl-scroll" style={{ maxHeight: 520, overflow: 'auto' }}>  {/* Properties: 640 */}
  <table className="w-full min-w-[720px]">                                {/* Properties: min-w-[1140px] */}
    <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
      <tr>
        <th style={{ color: T.textSecondary, background: T.bgSurface }}>...</th>
        ...
      </tr>
    </thead>
    <tbody>...</tbody>
  </table>
</div>
```

- Removed the inner `overflow-x-auto` wrapper entirely — the single outer div
  now handles both horizontal scroll (table `min-w` exceeds container width)
  and vertical scroll (`maxHeight` cap) at once.
- `<thead>` moved from inline `position:'sticky', top:0, zIndex:1` to
  `className="sticky top-0 z-10"`, now living directly inside the one
  scrolling ancestor, so it correctly resolves and pins against that
  container.
- Every `<th>` was also given an explicit `background: T.bgSurface` (in
  addition to the `<thead>`'s own background) so table body rows don't show
  through the header cells as they scroll underneath — `<thead>`'s
  background alone isn't always painted per-cell in all browsers when cells
  have their own box.
- Max-height values unchanged: Runs 520, Properties 640 (both table and card
  views in Properties already used a single container correctly for the
  card-grid case — only the *table* view had the bug in both files).

**Reasoning through the fix**: with one `<div style="max-height:520px;
overflow:auto">` directly wrapping `<table>`, that div *is* the nearest
scrolling ancestor for everything inside it, including `<thead>`. A
`position: sticky; top: 0` element inside a scrolling ancestor pins to that
ancestor's viewport edge as the ancestor scrolls — there's no longer a
non-scrolling div sitting between the sticky element and the actual
scrolling container, so the header now stays pinned to the top of the
visible table area while `<tbody>` rows scroll underneath it, with a solid
`T.bgSurface` fill so no row content is visible through the header row.

Files: `app/(dashboard)/runs/page.js`, `components/PropertiesView.js`.

## FIX 2 — restyle scrape/[key] detail page

The task named `app/(dashboard)/scrape/[key]/page.js` as the file to fix, but
that file is a thin wrapper (data fetch + back-link) — essentially all of the
old styling (`p-6 md:p-10`, mono kickers, `bg-ink`/`bg-card`/`border-ink`/
`rounded-card`/`rounded-pill`/`rounded-input`, the inverted dark "live
progress" panel) actually lives in `components/ScrapeDetail.js`, which the
page renders. Restyled both so the whole detail view — reached via the
"Open →" tile link on `/scrape` — now matches the `T`/`CARD` token system.

### `app/(dashboard)/scrape/[key]/page.js`
- Root wrapper changed from `<div className="p-6 md:p-10">` to `<div
  className="space-y-5">` (AdminShell already pads `<main>`).
- Error state (source lookup failure) converted from `bg-hatch1 border
  border-ink/20 rounded-card` to the standard `#FBEDE9`/`#8A2B16` inline-style
  banner used everywhere else (Overview, Scrape board, Properties, Runs).
- Back link (`← {t('detail.back')}`) restyled from `text-ink/60 hover:text-ink`
  to inline `style={{ color: T.textSecondary }}`, local `T` token added (just
  `textSecondary`, since that's all this file needs).

### `components/ScrapeDetail.js`
Added the same local `T`/`CARD` token block used by the sibling pages, copied
from `runs/page.js`. Every section restyled, functionality/hooks/state
untouched:

- **Header**: logo box `w-16 h-16 cl-hatch`/`bg-card border-ink/10` →
  `w-14 h-14` plain `T.bgSurface` box with `T.textMuted` initials. Heading
  went from `text-[clamp(24px,3.5vw,34px)] tracking-head` (still fairly
  large but no serif-italic in this particular heading, just oversized) down
  to the standard `text-2xl font-bold tracking-head` `T.textPrimary` used by
  every other page's `<h1>`. Active/inactive badge switched from `bg-ink
  text-paper` / `bg-hatch1 text-ink/60` to inline `T.textPrimary`/white vs.
  `T.bgSurface`/`T.textSecondary` pill. Description paragraph switched from
  `text-ink/55` to `T.textSecondary`.
- **Filters panel (left card)**: `bg-card border-ink/15 rounded-card` → `bg-white
  overflow-hidden` + `CARD` (14px, `#E7E1D6`). `Field` component's inputs/selects
  went from `border-[1.5px] border-ink/30 rounded-input bg-paper` to `1px
  solid T.borderLight`, `10px` radius, `T.bgWhite`/`T.textBody` — same visual
  contract as Properties' search input and select filters. Section kicker
  ("Filtros"/"Filters") went from `font-mono text-[10px] uppercase
  tracking-label text-ink/50` to a plain `text-sm font-bold` `T.textPrimary`
  heading, matching Analytics' "User funnel"/"Journey" card headers.
- **Action buttons**: "Scrape now" / Pause / Resume / Stop went from
  `bg-ink text-paper rounded-pill shadow-hard-soft` / `border-2 border-ink` to
  filled `T.textPrimary`/white or `1px solid T.borderLight` outline
  `rounded-full` buttons, matching the button recipes used across
  Properties/Runs/Analytics. The pause-state spinner (`cl-spin`) kept its
  animation class but switched its border colors from `border-ink/30
  border-t-ink` to `T.borderLight`/`T.textPrimary` inline styles.
- **Cron sub-panel**: `border-t border-ink/10 bg-paper/50` → `border-t`
  `T.borderLight` + `T.bgSurface` background (clipped by the parent card's
  now-added `overflow-hidden` so the surface fill doesn't overhang the card's
  rounded corners). ON/OFF toggle switched from `border-[1.5px] border-ink`
  filled/outline to `T.textPrimary`-filled when on, `T.borderLight`-outlined
  when off. Cron expression input restyled to the same field recipe as the
  filter inputs (kept `font-mono` on the input itself since it's a cron
  expression — code-like content, consistent with how `trigger`/email columns
  elsewhere keep `font-mono` for machine-readable text). Save button and
  helper/status text converted from ink-opacity utilities to `T.textSecondary`
  / `T.textMuted`.
- **Live progress panel (right card)**: this was the biggest visual change —
  previously an *inverted* `bg-ink text-paper` dark panel, now a `bg-white`
  `CARD` panel like every other card on the site (per the fix instructions:
  "convert cards/panels/error banners to bg-white + CARD"). Stat grid
  (`found`/`new`/`updated`/`unchanged`) numbers switched from `text-paper` to
  `T.textPrimary`; labels from `font-mono text-paper/50` to plain
  `T.textMuted`. The "done" status pulse dot switched from `bg-paper`/
  `bg-paper/50` to `T.textPrimary`/`T.borderLight`. Finished-run summary
  banner (`bg-paper text-ink`) → `T.bgSurface` background box with
  `T.textPrimary`/`T.textMuted` text, "View properties →" link now
  `T.textPrimary`. Progress bar track `bg-paper/15` → `T.bgSurface`; fill
  `bg-paper` → `T.textPrimary`. Event log box (`bg-black/30 border-paper/10
  text-paper font-mono`, dark terminal-style) → `T.bgSurface` background with
  `T.borderLight` border, `cl-scroll` class added for the thin-scrollbar
  treatment used elsewhere, and per-event text colors mapped from the old
  `text-paper`/`text-paper/80`/`text-paper/45` opacity ladder onto
  `T.textPrimary`/`T.textBody`/`T.textMuted` (kept `font-mono` for the log
  since it's inherently a code/event-stream readout, same reasoning as the
  cron input). The "reconnected" note banner switched from `bg-paper/10
  text-paper/70` to `T.bgSurface`/`T.textSecondary`.
- Root element wrapped in `space-y-5` (was a bare `<div>` with `mb-6` on the
  header) to match the vertical rhythm of every other page/section.

No i18n keys were added, removed, or renamed — every `t('card.*')`,
`t('detail.*')`, `t('ctl.*')`, `t('ev.*')` key used before is reused verbatim.
No change to polling, run-control (`start`/`pause`/`resume`/`stop`), cron
save, or reconnect-on-mount logic — only JSX markup, `className`, and inline
`style` values changed.

Files: `app/(dashboard)/scrape/[key]/page.js`, `components/ScrapeDetail.js`.

## FIX 3 — legible in-progress pills (Runs)

**Bug**: `running` and `paused` status pills in `runs/page.js` had
`border: 1px solid T.borderLight` (`#E7E1D6`) — the same very-light warm-grey
used for hairline dividers everywhere else, which reads as almost invisible
against the white table background, making the two in-progress states hard
to distinguish from a plain unstyled cell.

**Fix**: gave `running` and `paused` a mid-gray border, `#C9C2B4`, clearly
darker than `T.borderLight` (`#E7E1D6`) while staying inside the existing
warm-neutral palette (it's the token palette's border-light hue turned down a
few steps toward `T.textMuted` `#9C978C`, rather than introducing a new hue
like a semantic amber/warning color). `success`, `partial`, `failed`, and
`stopped` pill styles were left untouched.

```js
running: { background: 'transparent', color: T.textPrimary, border: '1px solid #C9C2B4' },
paused:  { background: 'transparent', color: T.textPrimary, border: '1px solid #C9C2B4' },
```

File: `app/(dashboard)/runs/page.js`.

## Build output

`npm run build` from repo root — **succeeded**, no new errors or warnings:

```
✓ Compiled successfully
   Linting and checking validity of types ...
 ✓ Generating static pages (13/13)

Route (app)                                Size     First Load JS
├ ƒ /properties                            7.51 kB         103 kB
├ ƒ /runs                                  142 B          87.4 kB
├ ƒ /scrape                                178 B          96.1 kB
├ ƒ /scrape/[key]                          7.4 kB          103 kB
... (all 24 routes generated, ƒ/○ markers unchanged from before)
```

All 24 routes generated (13 static-page-generation entries reported by
`next build`, matching the prior pass's build). No TypeScript/lint errors.

## Concerns / notes

1. **`PropertiesView.js` indentation**: after removing the inner
   `overflow-x-auto` wrapper div (one level of nesting), the `rows.map(...)`
   callback body inside `<tbody>` is now indented one level deeper than its
   surrounding `<tbody>`/`</tbody>` tags (cosmetic whitespace only — valid
   JSX/JS, confirmed by a successful build). Not fixed further to avoid
   unnecessary line churn across ~35 lines; flagging in case a reviewer wants
   it reflowed for readability.
2. **`scrape/[key]` visual scope**: fixed both the page wrapper *and*
   `ScrapeDetail.js`, since the task's description of the bug (giant heading,
   `bg-hatch1`/`border-ink`, old wrapper padding) describes content that
   actually lives in `ScrapeDetail.js`, not the thin page.js wrapper alone.
   Restyling only page.js would have left the actual visual mismatch
   (the dark inverted progress panel, ink-opacity buttons, mono kickers)
   completely unaddressed. Flagging in case the intent was narrower than what
   I did.
3. No production behavior, data-fetching, routes, or i18n keys were changed
   in this follow-up pass — same constraint as the original pass. Every
   feature on all three touched surfaces (scroll/sticky header, scraper
   detail start/pause/resume/stop/cron/reconnect, in-progress status pills)
   is still wired exactly as before; only markup/class/inline-style changed.
