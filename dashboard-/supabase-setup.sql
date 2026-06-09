-- ═══════════════════════════════════════════════════════════
-- NXTUP LEAD — Supabase Auth Setup
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════════

-- ── 1. PROFILES TABLE ────────────────────────────────────
-- Stores only public user info; passwords are handled by Supabase Auth.

create table if not exists public.profiles (
  id          uuid        references auth.users(id) on delete cascade primary key,
  email       text        unique not null,
  full_name   text,
  role        text        default 'Agent',
  created_at  timestamptz default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Policy: users can only read/update their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using ( auth.uid() = id );

create policy "Users can update own profile"
  on public.profiles for update
  using ( auth.uid() = id );


-- ── 2. AUTO-CREATE PROFILE ON SIGNUP ─────────────────────
-- Trigger that creates a profile row whenever a new user registers.

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'Agent')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if it already exists, then recreate
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── 3. CREATE YOUR FIRST ADMIN USER (optional helper) ────
-- After running this script, create a user via:
--   Supabase Dashboard → Authentication → Users → Add User
-- OR via the Supabase CLI / API.
--
-- To promote a user to Admin role, run:
--   update public.profiles set role = 'Admin' where email = 'your@email.com';


-- ── 4. VERIFY SETUP ──────────────────────────────────────
-- After adding a user, verify the profile was auto-created:
--   select * from public.profiles;
