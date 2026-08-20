# Fix: "Event handlers cannot be passed to Client Component props" on Runs / Scrapers pages

## Root cause
`app/(dashboard)/runs/page.js` and `components/ScrapeBoard.js` are Server Components
(no `'use client'` directive) but had inline JS `onMouseEnter`/`onMouseLeave` handlers
on DOM elements to swap the hover background. Server Components cannot serialize/pass
event handler functions to client-rendered DOM elements, which triggered the crash.

## Fix
Replaced the JS-based hover background swap with a pure CSS Tailwind `hover:` class
(`hover:bg-[#FAF7F1]`, matching the local `T.bgSurface` token `#FAF7F1`). No client JS
needed, so both files remain Server Components as intended.

### 1. app/(dashboard)/runs/page.js

Before:
```jsx
<tr key={r.id} className="border-b transition-colors" style={{ borderColor: T.borderLight }}
  onMouseEnter={(e) => (e.currentTarget.style.background = T.bgSurface)}
  onMouseLeave={(e) => (e.currentTarget.style.background = T.bgWhite)}>
```

After:
```jsx
<tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
```

### 2. components/ScrapeBoard.js

Before:
```jsx
<Link
  key={s.key}
  href={`/scrape/${s.key}`}
  className="bg-white p-5 flex flex-col transition-colors"
  style={CARD}
  onMouseEnter={(e) => (e.currentTarget.style.background = T.bgSurface)}
  onMouseLeave={(e) => (e.currentTarget.style.background = T.bgWhite)}
>
```

After:
```jsx
<Link
  key={s.key}
  href={`/scrape/${s.key}`}
  className="bg-white p-5 flex flex-col transition-colors hover:bg-[#FAF7F1]"
  style={CARD}
>
```

Both files still have no `'use client'` directive — they remain Server Components,
data fetching (`select()` in runs/page.js, props from server parent in ScrapeBoard.js)
and all other markup/props/i18n/routes are unchanged.

## Other inline handlers check
Grepped both files for `onMouse|onClick|onFocus|onBlur|onKeyDown|onKeyUp|onChange|onSubmit`
after the fix:

```
Grep app/(dashboard)/runs/page.js  -> No files found (zero matches)
Grep components/ScrapeBoard.js     -> No files found (zero matches)
```

Zero inline DOM event handlers remain in either Server Component. No other handler
types (onClick, onMouseDown, etc.) were present before the fix either — only the
onMouseEnter/onMouseLeave pair in each file, both now removed.

Confirmed `analytics/page.js`, `users/page.js`, and `components/PropertiesView.js` were
NOT touched — they are Client Components (`'use client'`) and their handlers are fine.

## Build
```
npm run build
```
Result: `✓ Compiled successfully`, all routes generated (13/13 static pages), including
`/runs` (142 B) and `/scrape` (178 B) routes built with no errors.

## Commit
Files committed: `app/(dashboard)/runs/page.js`, `components/ScrapeBoard.js`
Message: `fix(admin): CSS hover instead of JS handlers in Server Components (runs/scrapers crash)`
