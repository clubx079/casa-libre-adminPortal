-- InfoCasas Paraguay scraper: source row + shard table.
-- DO NOT run this automatically — apply manually in the AiroBase SQL editor,
-- like migrations 003/004. Not run as part of Task 6 implementation.

-- InfoCasas source (single row; shards live in scrape_shards).
insert into public.scrape_sources (key, name, adapter, base_url, config, default_filters, is_active, cron_enabled)
values (
  'infocasas', 'InfoCasas Paraguay', 'infocasas_gql', 'https://www.infocasas.com.py',
  '{}'::jsonb,
  '{"class":"all","limit":250}'::jsonb,
  true, false   -- driven by the dedicated /api/cron/infocasas rotator, not the generic cron
) on conflict (key) do update set adapter = excluded.adapter, base_url = excluded.base_url;

-- Shard matrix: one row per (operation_type × estate [× optional property_type]).
create table if not exists public.scrape_shards (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.scrape_sources(id) on delete cascade,
  shard_key     text unique not null,          -- e.g. 'op1_estate21' or 'op1_estate21_pt2'
  params        jsonb not null,                -- SearchParamsInput slice
  phase         text not null default 'backfill',  -- backfill | incremental
  cursor        int not null default 0,        -- resume offset (skip) within the slice
  enabled       boolean not null default true,
  priority      int not null default 100,      -- lower = sooner
  backfilled_at timestamptz,
  last_run_at   timestamptz,
  last_status   text,
  last_new      int default 0,
  created_at    timestamptz not null default now()
);
create index if not exists ix_shards_due on public.scrape_shards (enabled, phase, last_run_at nulls first);
