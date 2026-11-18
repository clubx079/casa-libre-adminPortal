-- CONTROL DB (the admin's own DB), NOT a country DB.
-- AI Analyst runs (Admin Manager → AI Analyst): every finished analysis, any country or "all",
-- kept here so they survive deploys and server restarts (lib/analyst/run.js).
--   id        the run id shown in the URL (e.g. 20261118054400-a1b2c3)
--   request   what was asked ({ days, start, end })    period / previous_period  the dates analysed
--   result    the analysis the page shows              pack   the numbers it was built on
-- Additive and safe to run twice. Run it in the AiroBase SQL editor of the control DB project.
create table if not exists public.analyst_runs (
  id text primary key,
  country text not null,
  status text not null default 'done',
  request jsonb,
  period jsonb,
  previous_period jsonb,
  result jsonb,
  pack jsonb,
  usage jsonb,
  cost_usd numeric(10,4),
  model text,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists analyst_runs_recent on public.analyst_runs (created_at desc);
alter table public.analyst_runs enable row level security;
