-- Unified per-source usage log for billable Google APIs (Casa Libre AiroBase).
-- Casa Libre only calls Cloud Vision (Places/Geocoding are never used), but the
-- schema matches DeelMap's so one hourly monitor can read both databases.
--
-- Every screening batch appends one row here (see lib/api-usage.js). Apply once
-- in the Casa Libre AiroBase SQL editor. Until it exists, logApiCall() no-ops.

create table if not exists public.api_usage_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  api        text not null,   -- 'vision' (Casa Libre only uses Vision)
  source     text not null,   -- scrape_sources.key: remax_py, tulugar_py, century21_py, …
  code_path  text not null,   -- 'imageScreen'
  calls      integer not null -- billable Vision feature-calls (images × 4 features)
);

create index if not exists api_usage_log_created_at_idx on public.api_usage_log (created_at);
create index if not exists api_usage_log_api_source_idx  on public.api_usage_log (api, source);

create or replace view public.api_usage_hourly as
select date_trunc('hour', created_at) as hour, api, source,
       sum(calls) as calls, count(*) as batches
from public.api_usage_log
group by 1, 2, 3
order by 1 desc, 4 desc;
