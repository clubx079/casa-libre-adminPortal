# Casa Libre — Admin Portal

Internal admin dashboard for Casa Libre. Next.js 14 (App Router, JavaScript),
Tailwind with the Casa Libre brand tokens, sharing the same AiroBase DB as the
buyer portal and super admin.

## What it does

- **Login** — single seeded admin (`omar@airosofts.com`), HMAC-signed session
  cookie (`cl_admin_session`), route perimeter enforced by `middleware.js`.
- **Overview** (`/`) — user totals + recent signups from the shared DB.
- **Users** (`/users`) — everyone in the `users` table (buyer-portal accounts):
  name, email, phone, auth method, verification, join date, last login. Each row
  deep-links to that user's activity timeline.
- **Analytics** (`/analytics`) — user behaviour, funnel, and per-user session
  timelines, read from PostHog via the HogQL query API (same UX as the DeelMap
  admin, re-skinned to Casa Libre).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run dev                  # http://localhost:3005
```

Login: `omar@airosofts.com` / the seeded password.

## Environment

| Var | Purpose |
| --- | --- |
| `AIROBASE_URL` | Shared Casa Libre DB base URL |
| `AIROBASE_SECRET_KEY` | `sb_secret_…` server key (bypasses RLS) |
| `SESSION_SECRET` | Signs the admin session cookie — set a long random string in prod |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` | Override the seeded admin (bcrypt hash) — defaults are baked into `lib/adminAuth.js` |
| `POSTHOG_PERSONAL_API_KEY` | `phx_…` personal key, scope `query:read` — admin reads events |
| `POSTHOG_PROJECT_ID` | Numeric PostHog project id |
| `POSTHOG_HOST` | `https://us.posthog.com` (query host — **no** `i.`) |

Until the three `POSTHOG_*` vars are set, the Analytics page renders a
"PostHog not connected" state instead of erroring.

## PostHog wiring (two halves)

This admin app only **reads** events. For users to appear, the **buyer portal**
must **send** them:

1. Add the PostHog JS snippet to the buyer portal with the **project API key**
   (`phc_…`, public) and host.
2. On login/signup call
   `posthog.identify(user.id, { email, first_name, last_name })` so
   `distinct_id === users.id` and person properties carry email/name.
3. Capture product events with these names (the funnel/journey expect them):
   `search_applied`, `property_viewed`, `property_saved`, `property_unsaved`,
   `contact_seller_clicked`, `whatsapp_contact_clicked`, `phone_revealed`,
   `publish_started`, `listing_created`, plus event props `property_id`,
   `address`, `city`, `state`.

Then set the three `POSTHOG_*` vars here (personal key + project id + host).

## Notes

- Uses the same `users` table as the buyer portal — read-only from here.
- Distinct cookie name and `SESSION_SECRET` from the buyer portal so sessions
  never collide.
- Dev port `3005` (buyer portal = 3002, DeelMap admin = 3003).
