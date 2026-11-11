-- Saved translations (lib/translationCache.js + lib/translationStore.js).
-- Run ONCE in the CONTROL DB (the one with admin_users / countries) — NOT in the country DBs:
-- a translation is the same whichever country the text came from, so every admin and every
-- country shares this one table.
--
-- Until this is run the admin works exactly as before (it translates and keeps the result in
-- memory only); once the table exists it starts saving by itself within 10 minutes.
-- key = hash of (source text, source→target language, purpose, prompt/model version): a changed
-- text is a new row, so a stale translation is never served. Safe to run more than once.
create table if not exists public.translation_cache (
  key text primary key,
  source_lang text not null default 'es',
  target_lang text not null default 'en',
  purpose text not null default 'general',
  engine text,
  source_chars integer,
  translation text not null,
  created_at timestamptz not null default now()
);

create index if not exists translation_cache_created_at_idx on public.translation_cache (created_at desc);

alter table public.translation_cache enable row level security;
