begin;

create table if not exists public.community_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint community_follows_no_self_follow check (follower_id <> following_id)
);

create index if not exists idx_community_follows_following on public.community_follows(following_id, created_at desc);
create index if not exists idx_community_follows_follower on public.community_follows(follower_id, created_at desc);

alter table public.community_follows enable row level security;

drop policy if exists community_follows_select_all on public.community_follows;
create policy community_follows_select_all
on public.community_follows
for select
to authenticated
using (true);

drop policy if exists community_follows_insert_own on public.community_follows;
create policy community_follows_insert_own
on public.community_follows
for insert
to authenticated
with check (auth.uid() = follower_id and auth.uid() <> following_id);

drop policy if exists community_follows_delete_own on public.community_follows;
create policy community_follows_delete_own
on public.community_follows
for delete
to authenticated
using (auth.uid() = follower_id);

create or replace function public.community_notify_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_follower_name text;
begin
  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    into v_follower_name
  from public.profiles
  where id = new.follower_id;

  insert into public.in_app_notifications (
    user_id,
    type,
    title,
    body,
    data
  )
  values (
    new.following_id,
    'system',
    'New follower',
    coalesce(nullif(v_follower_name, ''), 'Someone') || ' started following you.',
    jsonb_build_object('followerId', new.follower_id)
  );

  return new;
end;
$$;

drop trigger if exists trg_community_notify_follow on public.community_follows;
create trigger trg_community_notify_follow
after insert on public.community_follows
for each row
execute function public.community_notify_follow();

commit;

