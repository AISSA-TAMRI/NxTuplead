-- ═══════════════════════════════════════════════════════════
-- NXTUP LEAD — Supabase Auth Setup  (v2 — fixed)
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════


-- ── 1. PROFILES TABLE ────────────────────────────────────

create table if not exists public.profiles (
  id          uuid        references auth.users(id) on delete cascade primary key,
  email       text        unique not null,
  full_name   text,
  role        text        not null default 'Agent',
  created_at  timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Drop existing policies before recreating (safe to re-run)
drop policy if exists "Users can view own profile"   on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

-- Users can only read their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using ( auth.uid() = id );

-- Users can only update their own profile
create policy "Users can update own profile"
  on public.profiles for update
  using ( auth.uid() = id );


-- ── 2. AUTO-CREATE PROFILE ON SIGNUP ─────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── 3. REQUIRED: ALLOW AUTHENTICATED USERS TO READ PROFILES ─
-- Without this, loadUserProfile() in dashboard.html fails with
-- a "row not found" error even when the profile exists.
-- The select policy above only allows users to read their OWN row.
-- If you want agents to see each other's names later, add a broader policy here.


-- ── 4. SUPABASE DASHBOARD SETTINGS TO CONFIGURE ──────────
--
-- A. Email confirmation (DISABLE for internal tools):
--    Authentication → Providers → Email
--    Uncheck "Enable email confirmations"
--    Reason: with confirmations ON, new users cannot log in until
--    they click the confirmation email. For an internal CRM this
--    is usually unwanted and causes "Email not confirmed" errors.
--
-- B. Password reset redirect URL:
--    Authentication → URL Configuration → Redirect URLs
--    Add EXACTLY:  https://yourdomain.com/reset-password.html
--    Also add:     http://localhost:PORT/reset-password.html  (for local dev)
--    Reason: the reset email link must land on reset-password.html,
--    not dashboard.html. Without this the token is discarded.
--
-- C. Site URL:
--    Authentication → URL Configuration → Site URL
--    Set to your production domain, e.g.: https://crm.upleaddigital.com
--
-- D. JWT Expiry (optional but recommended):
--    Authentication → Configuration → JWT expiry
--    Default is 3600s (1 hour). For a CRM, 86400 (24h) is reasonable.
--    autoRefreshToken: true in the client handles refresh automatically.


-- ── 5. CREATE YOUR FIRST USER ────────────────────────────
--
-- Go to: Supabase Dashboard → Authentication → Users → Add User
-- Fill in email + password, click "Create User"
-- The trigger above will auto-create their profile row.
--
-- To verify the profile was created:
--   select * from public.profiles;
--
-- To set a user as Admin:
--   update public.profiles
--   set role = 'Admin', full_name = 'Your Name'
--   where email = 'you@yourdomain.com';


-- ── 6. PIPELINE STAGE COLUMN (required for Pipeline module) ──
--
-- Run this when ready to use the Pipeline page:
--
--   alter table crm.leads
--   add column if not exists pipeline_stage text default 'New';
--
-- Replace "crm" with your actual schema name if different.


-- ── 7. VERIFY EVERYTHING ─────────────────────────────────
--
-- Check profiles table exists:
--   select * from public.profiles;
--
-- Check trigger exists:
--   select trigger_name from information_schema.triggers
--   where event_object_table = 'users'
--   and trigger_schema = 'auth';
--
-- Check RLS is enabled:
--   select tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public' and tablename = 'profiles';
