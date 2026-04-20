-- =============================================================================
-- 001_profiles.sql
-- User profiles table + auth helper functions
-- Compatible with Clerk JWT (auth.jwt()->>'sub' = clerk_user_id)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PROFILES TABLE
-- Created first so auth helper functions can reference it
-- -----------------------------------------------------------------------------
create table profiles (
  id               uuid primary key default gen_random_uuid(),
  clerk_user_id    text unique not null,
  email            text not null,
  first_name       text,
  last_name        text,
  avatar_url       text,
  role             text not null default 'student'
                   check (role in ('student', 'educator')),
  is_admin         boolean not null default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- AUTH HELPER FUNCTIONS
-- Stable SQL functions used throughout RLS policies.
-- Defined after profiles exists.
-- -----------------------------------------------------------------------------

-- Returns the profiles.id of the currently authenticated user
create or replace function auth_profile_id()
returns uuid language sql stable as $$
  select id from profiles
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$$;

-- Returns true if the current user has is_admin = true
create or replace function auth_is_admin()
returns boolean language sql stable as $$
  select coalesce(
    (select is_admin from profiles
     where clerk_user_id = (select auth.jwt()->>'sub')
     limit 1),
    false
  )
$$;

-- Returns 'student' or 'educator' for the current user
create or replace function auth_role()
returns text language sql stable as $$
  select role from profiles
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$$;

-- -----------------------------------------------------------------------------
-- UPDATED_AT TRIGGER FUNCTION
-- Shared by all tables that have an updated_at column
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table profiles enable row level security;

-- Users can read their own profile
create policy "profiles: own read"
  on profiles for select to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

-- Admins can read all profiles
create policy "profiles: admin read all"
  on profiles for select to authenticated
  using (auth_is_admin());

-- Users can update own profile but cannot self-promote to admin
create policy "profiles: own update"
  on profiles for update to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'))
  with check (
    clerk_user_id = (select auth.jwt()->>'sub')
    and is_admin = (select is_admin from profiles
                    where clerk_user_id = (select auth.jwt()->>'sub'))
  );

-- Admins can update any profile (role changes, granting is_admin, etc.)
create policy "profiles: admin update all"
  on profiles for update to authenticated
  using (auth_is_admin());

-- Application inserts a profile row on first sign-in
create policy "profiles: insert own"
  on profiles for insert to authenticated
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

-- -----------------------------------------------------------------------------
-- TRIGGER
-- -----------------------------------------------------------------------------
create trigger set_updated_at
  before update on profiles
  for each row execute function set_updated_at();
