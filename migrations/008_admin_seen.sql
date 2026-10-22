-- Unread counters per team member (admin sidebar badges on Reports and Feedback).
-- One row per admin + page: when that admin last opened the page in THIS country.
-- Unread = rows created after it. Each admin has their own, so one person reading
-- doesn't clear the badge for the others. admin_key = the admin's id (control DB),
-- or their email for the env fallback account. Safe to run more than once.
create table if not exists public.admin_seen (
  admin_key text not null,
  page text not null,
  seen_at timestamptz not null default now(),
  primary key (admin_key, page)
);

alter table public.admin_seen enable row level security;
