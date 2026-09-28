-- 006_potential_leads.sql — prospect list for sales outreach (Admin → Leads).
-- Businesses we found ourselves (e.g. property developers listed on HolaCasa) that
-- could become paying clients later. Not users, not inbound inquiries (those are
-- partner_inquiries). Additive and idempotent; touches no existing table.
create table if not exists public.potential_leads (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  legal_name   text,
  category     text not null default 'developer',   -- developer | agency | other
  phone        text,
  whatsapp     text,
  email        text,
  location     text,
  source       text not null,                        -- where we found it, e.g. 'holacasa'
  source_url   text not null,                        -- the exact page (their profile on that site)
  status       text not null default 'new',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint potential_leads_status_chk check (status in ('new', 'contacted', 'interested', 'client', 'discarded')),
  constraint potential_leads_source_url_key unique (source_url)
);
create index if not exists potential_leads_status_idx on public.potential_leads (status, created_at desc);
