-- 012_seo_runs.sql — one row per SEO pipeline run (Admin → Admin Manager → AI SEO tab).
-- Run in EACH country DB (PY, BO, UY, VE, SV), after 011. Additive only, safe to run twice.
-- AiroBase SQL editor: paste and Run (no begin/commit — the editor rejects them).
--   steps       what each stage returned (collect / decide / autopilot / improve)
--   changes     the page changes this run made (added pages, edited titles, links, guides) + why
--   snapshot    the numbers at this run: Google clicks / impressions / position (site + pipeline
--               pages), top keywords with their ranking, page counts, visits + contacts
--   comparison  this snapshot vs the previous run's
--   report      the AI SEO report (status, headline, what changed, keywords, wins, problems, next)
create table if not exists public.seo_runs (
  id uuid primary key default gen_random_uuid(),
  country text not null default 'py',
  trigger text not null default 'cron',
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  steps jsonb not null default '{}'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  comparison jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  model text,
  error text,
  created_by text
);
create index if not exists seo_runs_recent on public.seo_runs (country, started_at desc);
alter table public.seo_runs enable row level security;
