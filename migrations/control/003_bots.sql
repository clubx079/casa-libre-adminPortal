-- CONTROL DB (the admin's own DB), NOT a country DB.
-- Bots page (Team tools → Bots): the Grok Bots connected to the admin and every run they do.
--   bot_connections  one row per connected bot: its Grok routine webhook ("POST to" URL + key).
--                    The key is a secret: only the server reads it, it is never sent to the browser.
--   bot_runs         every job the admin sent (Run now / Test connection), and what the bot reported back
--                    to /api/bot-report (summary + items). token_hash = SHA-256 of the one-time report token.
-- Additive and safe to run twice. Run it in the AiroBase SQL editor of the CONTROL DB project.
create table if not exists public.bot_connections (
  bot_key text primary key,
  webhook_url text not null,
  webhook_key text not null,
  connected_at timestamptz not null default now(),
  connected_by text,
  last_test_at timestamptz,
  last_test_ok boolean
);

create table if not exists public.bot_runs (
  id uuid primary key default gen_random_uuid(),
  bot_key text not null,
  trigger text not null default 'manual',
  status text not null default 'sent',
  token_hash text not null,
  request jsonb,
  summary text,
  items jsonb,
  item_count integer not null default 0,
  error text,
  approval text not null default 'none',
  approved_by text,
  created_by text,
  started_at timestamptz not null default now(),
  reported_at timestamptz
);
create index if not exists bot_runs_recent on public.bot_runs (bot_key, started_at desc);

alter table public.bot_connections enable row level security;
alter table public.bot_runs enable row level security;
