-- Email (info@) — a saved copy of the info@casa-libre.com mailbox (lib/emailStore.js).
-- Run ONCE in the CONTROL DB (the one with admin_users / countries) — NOT in the country DBs:
-- there is one info@ mailbox for every country. Safe to run more than once.
--
-- The admin shows the mailbox from these tables at once, then fetches what's new from Gmail in
-- the background (the Gmail script also pushes new emails every minute). Gmail stays the source
-- of truth; these rows are its copy plus the AI's type for each conversation.

create table if not exists public.email_threads (
  id text primary key,                         -- Gmail thread id
  subject text,
  snippet text,
  last_from text,
  last_date timestamptz,
  message_count integer not null default 1,
  unread boolean not null default false,
  in_inbox boolean not null default true,
  in_spam boolean not null default false,
  in_trash boolean not null default false,
  has_sent boolean not null default false,     -- info@ wrote in it (the Sent folder)
  starred boolean not null default false,
  has_attachments boolean not null default false,
  labels text[] not null default '{}',
  category text check (category in ('important', 'marketing', 'other', 'spam')),
  urgent boolean not null default false,
  forwarded_at timestamptz,                     -- sent on to the team (Forwarding settings)
  synced_at timestamptz not null default now()
);
create index if not exists email_threads_last_date_idx on public.email_threads (last_date desc);
create index if not exists email_threads_category_idx on public.email_threads (category, last_date desc);
create index if not exists email_threads_inbox_idx on public.email_threads (in_inbox, last_date desc);

create table if not exists public.email_messages (
  id text primary key,                          -- Gmail message id
  thread_id text not null references public.email_threads (id) on delete cascade,
  sent_at timestamptz,
  from_addr text,
  to_addr text,
  cc text,
  reply_to text,
  subject text,
  body_text text,
  body_html text,
  attachments jsonb not null default '[]',
  sent_by_us boolean not null default false,
  unread boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists email_messages_thread_idx on public.email_messages (thread_id, sent_at);

-- The admin's server reads and writes these with the control DB's secret key; nobody else.
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
