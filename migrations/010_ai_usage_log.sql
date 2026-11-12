-- AI usage log (admin → AI usage page): one row per AI call — Anthropic Claude and Groq — made by
-- the admin (app 'admin', lib/aiUsage.js) or the website (app 'website', buyer portal
-- lib/aiUsage.js), with the tokens in / out, prompt-cache tokens and the US$ cost (priced in code,
-- lib/aiPricing.js, at the time of the call).
--
-- Run ONCE in EVERY COUNTRY DB (py, bo, uy, ve, sv — and the sandbox) in the AiroBase SQL editor.
-- The same file is in the buyer portal repo (migrations/021_ai_usage_log.sql): running either is
-- enough. Safe to run more than once. Until it exists, both apps simply don't log (nothing breaks)
-- and the AI usage page says the migration is needed.
create table if not exists public.ai_usage_log (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  app                text        not null default 'admin',      -- 'admin' | 'website'
  provider           text        not null,                      -- 'anthropic' | 'groq'
  model              text        not null,                      -- e.g. claude-opus-5-5, openai/gpt-oss-20b
  feature            text        not null,                      -- e.g. inbox_auto_reply, listing_photo_check
  input_tokens       integer     not null default 0,            -- uncached input
  output_tokens      integer     not null default 0,
  cache_read_tokens  integer     not null default 0,
  cache_write_tokens integer     not null default 0,
  cost_usd           numeric(12,6) not null default 0,
  ok                 boolean     not null default true,         -- false = the call failed (still counted)
  ref                text                                       -- what it was for (message id, listing id…), optional
);

create index if not exists ai_usage_log_created_at_idx on public.ai_usage_log (created_at desc);
create index if not exists ai_usage_log_feature_idx    on public.ai_usage_log (feature, created_at desc);

alter table public.ai_usage_log enable row level security;
