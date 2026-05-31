-- App-managed content pages + support tickets
-- Allows admin to edit app legal/support pages and users to submit support complaints.

begin;

create table if not exists public.app_content_pages (
  key text primary key,
  title text not null default '',
  body text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  subject text not null default '',
  message text not null default '',
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_support_tickets_user_id on public.support_tickets(user_id);
create index if not exists idx_support_tickets_status on public.support_tickets(status);
create index if not exists idx_support_tickets_created_at on public.support_tickets(created_at desc);

insert into public.app_content_pages (key, title, body)
values
  (
    'support',
    'Contact & Support',
    'For support, contact the CD4 team at support@cd4.app.\n\nPlease include your registered email and issue details.'
  ),
  (
    'terms',
    'Terms & Service',
    'By using CD4, you agree to these terms. CD4 guidance does not replace emergency medical care.'
  ),
  (
    'privacy_policy',
    'Privacy Policy',
    'CD4 stores only necessary user and health settings for personalized experience. We do not sell user data.'
  )
on conflict (key) do nothing;

alter table public.app_content_pages enable row level security;
alter table public.support_tickets enable row level security;

-- Read app content for signed-in users
drop policy if exists app_content_pages_select_authenticated on public.app_content_pages;
create policy app_content_pages_select_authenticated
on public.app_content_pages
for select
to authenticated
using (true);

-- Admin can insert/update app content
drop policy if exists app_content_pages_admin_write on public.app_content_pages;
create policy app_content_pages_admin_write
on public.app_content_pages
for all
to authenticated
using (
  exists (
    select 1
    from public.roles r
    where r.id = auth.uid()
      and lower(r.slug) = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.roles r
    where r.id = auth.uid()
      and lower(r.slug) = 'admin'
  )
);

-- Any authenticated user can create a support ticket
drop policy if exists support_tickets_insert_authenticated on public.support_tickets;
create policy support_tickets_insert_authenticated
on public.support_tickets
for insert
to authenticated
with check (auth.uid() is not null);

-- Users can view their own tickets
drop policy if exists support_tickets_select_own on public.support_tickets;
create policy support_tickets_select_own
on public.support_tickets
for select
to authenticated
using (user_id = auth.uid());

-- Admin can view and update all tickets
drop policy if exists support_tickets_admin_select_all on public.support_tickets;
create policy support_tickets_admin_select_all
on public.support_tickets
for select
to authenticated
using (
  exists (
    select 1
    from public.roles r
    where r.id = auth.uid()
      and lower(r.slug) = 'admin'
  )
);

drop policy if exists support_tickets_admin_update_all on public.support_tickets;
create policy support_tickets_admin_update_all
on public.support_tickets
for update
to authenticated
using (
  exists (
    select 1
    from public.roles r
    where r.id = auth.uid()
      and lower(r.slug) = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.roles r
    where r.id = auth.uid()
      and lower(r.slug) = 'admin'
  )
);

commit;
