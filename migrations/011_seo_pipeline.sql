-- 011_seo_pipeline.sql — the automatic SEO pipeline (Admin → SEO; design: Casa-Libre-SEO-Pipeline.pdf).
-- Run in EACH country DB (PY, BO, UY, VE, SV) — the admin writes these tables, the website reads
-- seo_overrides + seo_drafts at render time. Additive only, safe to run twice (if not exists).
-- AiroBase SQL editor: paste and Run (no begin/commit — the editor rejects them).
--
-- Stage → table
--   1 Collect   seo_signals (Ads search terms, Search Console query×page, site-search box), seo_trends (Google Trends RSS)
--   3 Decide    seo_opportunities (ranked actions)
--   4 Create    seo_overrides (per page: title/H1/description, enabled page variants, extra links), seo_drafts (guides)
--   5 Check     seo_changes (every action, with the before/after to revert it)
--   8 Improve   reads all of the above; settings in seo_settings

-- 1. Collected demand. One row per (source, term, page, day). Each daily run stores a snapshot of the
-- source's rolling window (metrics.window_days), so history builds up day by day.
--   source: 'ads' (Google Ads search terms: clicks, impressions, conversions, cost)
--           'gsc' (Search Console query × page: clicks, impressions, ctr, position)
--           'site_search' (what visitors type in the Casa-Libre search box, PostHog search_applied: searches, people)
create table if not exists public.seo_signals (
  id bigserial primary key,
  country text not null default 'py',
  source text not null check (source in ('ads', 'gsc', 'site_search')),
  term text not null,
  page text not null default '',
  date date not null default current_date,
  metrics jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  unique (country, source, term, page, date)
);
create index if not exists seo_signals_country_date on public.seo_signals (country, date desc);
create index if not exists seo_signals_term on public.seo_signals (country, term);

-- Google Trends "trending now" RSS, one row per (geo, topic, hourly reading) → history of what is trending.
--   topic: 'property' | 'economy' | 'other' (tagged in code from the title + news headlines)
create table if not exists public.seo_trends (
  id bigserial primary key,
  geo text not null,
  title text not null,
  traffic integer,
  traffic_label text,
  news jsonb not null default '[]'::jsonb,
  topic text not null default 'other',
  pub_date timestamptz,
  seen_hour text not null,
  seen_at timestamptz not null default now(),
  unique (geo, title, seen_hour)
);
create index if not exists seo_trends_geo_seen on public.seo_trends (geo, seen_at desc);

-- 3. What to do, ranked. key = type + term + url, so a re-run updates the same row (score/evidence).
--   type: create_variant | strengthen_page | write_guide | trend_post | lower_bid_suggestion | new_title
--   status: open | applied | dismissed
create table if not exists public.seo_opportunities (
  id uuid primary key default gen_random_uuid(),
  country text not null default 'py',
  key text not null,
  type text not null,
  term text not null,
  url text,
  parsed jsonb not null default '{}'::jsonb,
  score numeric not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  unique (country, key)
);
create index if not exists seo_opportunities_rank on public.seo_opportunities (country, status, score desc);

-- 4. Page overrides read by the website at render time (cached 5 min) — live without a deploy.
-- One row per page path (e.g. /alquiler/departamentos/asuncion or …/asuncion/baratos).
--   title / h1 / description   null = the page's own data-built copy
--   enabled_variants           variant slugs switched on under this page ('baratos', '1-dormitorio', …):
--                              only these render and go in the sitemap (and only with 5+ listings)
--   retired_variants           variants switched off by the weekly loop: still answer, but noindex
--   extra_links                [{ href, label }] internal links added by "strengthen"
--   title_changed_at           the 14-day title rate limit
create table if not exists public.seo_overrides (
  id uuid primary key default gen_random_uuid(),
  country text not null default 'py',
  path text not null,
  title text,
  h1 text,
  description text,
  enabled_variants text[] not null default '{}',
  retired_variants text[] not null default '{}',
  extra_links jsonb not null default '[]'::jsonb,
  title_changed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (country, path)
);

-- 5. Every change the pipeline (or a person) made, with what it replaced → one-click revert.
--   action: enable_variant | retire_variant | set_title | add_links | publish_guide | unpublish_guide
create table if not exists public.seo_changes (
  id uuid primary key default gen_random_uuid(),
  country text not null default 'py',
  path text not null,
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  by text,
  opportunity_id uuid,
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by text
);
create index if not exists seo_changes_recent on public.seo_changes (country, created_at desc);

-- 4/5. Guide drafts (Claude, or the data template when Claude is unavailable) → approval queue →
-- published on the website's /guias. Body numbers are placeholders ({{count:…}}, {{median:…}},
-- {{range:…}}, {{month}}) the website fills from live listings; they refresh monthly.
--   status: draft | approved (= published) | rejected
create table if not exists public.seo_drafts (
  id uuid primary key default gen_random_uuid(),
  country text not null default 'py',
  slug text not null,
  kind text not null default 'guide',
  status text not null default 'draft',
  opportunity_id uuid,
  term text,
  title text not null,
  h1 text not null,
  description text,
  answer text,
  sections jsonb not null default '[]'::jsonb,
  faq jsonb not null default '[]'::jsonb,
  related jsonb not null default '[]'::jsonb,
  source text not null default 'template',
  model text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  unique (country, slug)
);
create index if not exists seo_drafts_status on public.seo_drafts (country, status);

-- Settings tab: feature switches + thresholds, one row per country.
create table if not exists public.seo_settings (
  country text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
