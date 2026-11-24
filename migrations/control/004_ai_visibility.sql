-- AI visibility → AI SEO (lib/aiVisibility/*). Run ONCE in the CONTROL DB (the one with admin_users /
-- countries / bot_runs). Safe to run more than once.
-- One row per answer an AI assistant gave to one of our questions: asked by the admin through the
-- assistant's API with web search on (provider 'api', daily), or reported by the Grok bot
-- (provider 'grok_bot', e.g. Google AI answers). The AI SEO pipeline turns the questions where
-- competitors are named and Casa-Libre isn't into keywords (source 'ai_visibility').
create table if not exists public.ai_visibility_answers (
  id bigserial primary key,
  run_date date not null default current_date,
  country text not null default 'py',
  assistant text not null,                 -- claude | chatgpt | gemini | perplexity | grok | google-ai | …
  provider text not null default 'api',    -- api | grok_bot
  question text not null,
  keyword text,                            -- the search keyword we may work (null = names a competitor / not Spanish)
  language text,
  mentioned boolean not null default false,
  position integer,                        -- our place among the brands named (1 = first)
  competitors text[] not null default '{}',
  sources text[] not null default '{}',    -- hosts the assistant cited
  quote text,                              -- what it said about Casa-Libre
  answer text,
  error text,                              -- set when the assistant gave no answer
  source_ref text unique,                  -- dedupe: 'api:<date>:<assistant>:<question>' or 'bot:<run id>:<n>'
  created_at timestamptz not null default now()
);
create index if not exists ai_visibility_answers_date on public.ai_visibility_answers (run_date desc);
create index if not exists ai_visibility_answers_country on public.ai_visibility_answers (country, run_date desc);
alter table public.ai_visibility_answers enable row level security;
