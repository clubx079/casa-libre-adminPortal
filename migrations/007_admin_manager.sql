-- Admin Manager (admin /manager): the weekly AI report, one row per run, per country DB.
--   data_pack = the numbers the report was built on (lib/manager/dataPack.js)
--   report    = the agent's report (headline, positives, negatives, follow-ups, …)
--   actions   = the drafted emails and what an admin did with them (draft / sent / dismissed)
--   feedback  = the admins' 👍 / 👎 + notes on report items; the next run reads them
--   log       = progress lines while it runs (tools the agent used)
-- Only the admin server touches it (secret key). Safe to run more than once.
create table if not exists public.manager_reports (
  id uuid primary key default gen_random_uuid(),
  country text not null default 'py',
  trigger text not null default 'manual',
  status text not null default 'running',
  stage text,
  period_start timestamptz,
  period_end timestamptz,
  data_pack jsonb,
  report jsonb,
  notes text,
  actions jsonb not null default '[]'::jsonb,
  feedback jsonb not null default '{}'::jsonb,
  log jsonb not null default '[]'::jsonb,
  usage jsonb,
  cost_usd numeric(10,4),
  model text,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists manager_reports_created_at_idx on public.manager_reports (created_at desc);

alter table public.manager_reports enable row level security;
