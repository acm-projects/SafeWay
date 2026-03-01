-- SafeWay initial auth-owned data model for Supabase Postgres
-- Run in Supabase SQL editor or via migration tooling.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bookmarks_user_id on public.bookmarks (user_id);
create index if not exists idx_bookmarks_created_at on public.bookmarks (created_at desc);

alter table public.profiles enable row level security;
alter table public.bookmarks enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "Users can view own bookmarks" on public.bookmarks;
create policy "Users can view own bookmarks"
  on public.bookmarks
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own bookmarks" on public.bookmarks;
create policy "Users can insert own bookmarks"
  on public.bookmarks
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own bookmarks" on public.bookmarks;
create policy "Users can update own bookmarks"
  on public.bookmarks
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own bookmarks" on public.bookmarks;
create policy "Users can delete own bookmarks"
  on public.bookmarks
  for delete
  using (auth.uid() = user_id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user_profile();
