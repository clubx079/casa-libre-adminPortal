-- SEO pipeline: let seo_signals keep Google Keyword Planner volumes (source 'keyword_planner').
-- Run ONCE in EVERY COUNTRY DB that has the SEO tables (PY, BO, UY, VE, SV) — the same DBs as
-- migration 011. Safe to run more than once. Until it's run, the pipeline still asks Keyword Planner
-- but can't save the result (the SEO page says so).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.seo_signals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.seo_signals drop constraint %I', c);
  end loop;
end $$;

alter table public.seo_signals add constraint seo_signals_source_check
  check (source in ('ads', 'gsc', 'site_search', 'keyword_planner'));
