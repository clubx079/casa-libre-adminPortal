-- Casa Libre — Track C schema (run ONCE in the AiroBase SQL editor for the
-- d34d50f3 project). PostgREST cannot run DDL, so this is applied by hand.
-- Covers: (B) scraper status registry, (C) no-response listing reports,
-- (D) user IP capture + block/suspend. All tables use RLS-enabled + no
-- policies = reachable only by the service/secret key (same as `favorites`).

-- ─────────────────────────────────────────────────────────────────────────
-- (B) Scraper Status registry — status board / submission queue.
--     Holds both proposed sites (pending, not yet built) and live scrapers.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.scraper_registry (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null,
  description text,
  status      text not null default 'pending' check (status in ('pending','running')),
  source_key  text,                       -- links to scrape_sources.key once built; null for pending-only
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists scraper_registry_status_idx on public.scraper_registry (status);
alter table public.scraper_registry enable row level security;

-- Seed the already-built scrapers as Running (run-once; safe to skip if scrape_sources is empty).
insert into public.scraper_registry (name, url, description, status, source_key)
select coalesce(s.name, s.key),
       coalesce(s.base_url, ''),
       s.description,
       'running',
       s.key
from public.scrape_sources s
where s.key is not null
  and not exists (select 1 from public.scraper_registry r where r.source_key = s.key);

-- ─────────────────────────────────────────────────────────────────────────
-- (C) No-response listing reports — a buyer flags a seller who did not reply.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.listing_reports (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid references public.properties(id) on delete set null,
  listing_ref      text,                  -- CL-xxxx snapshot for display
  user_id          uuid references public.users(id) on delete set null,  -- null when anonymous
  reporter_name    text,
  reporter_contact text,                  -- buyer's WhatsApp / phone / email
  seller_name      text,                  -- properties.contact_name snapshot
  seller_phone     text,                  -- properties.contact_phone snapshot
  message          text,
  status           text not null default 'open' check (status in ('open','reviewed','resolved')),
  created_at       timestamptz not null default now()
);
create index if not exists listing_reports_created_idx on public.listing_reports (created_at desc);
create index if not exists listing_reports_status_idx  on public.listing_reports (status);
alter table public.listing_reports enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- (D) User IP capture + block/suspend (DeelMap-style).
--     `active` already exists on public.users.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.users add column if not exists ip_address      text;   -- last-login IP (overwritten each login)
alter table public.users add column if not exists registration_ip text;   -- first-seen IP (immutable)
alter table public.users add column if not exists blocked         boolean not null default false;
alter table public.users add column if not exists suspended       boolean not null default false;
create index if not exists users_blocked_idx   on public.users (blocked);
create index if not exists users_suspended_idx on public.users (suspended);
