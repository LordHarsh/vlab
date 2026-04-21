-- =============================================================================
-- 010_fix_rls_recursion.sql
-- Fix infinite recursion in profiles RLS policies.
-- The auth helper functions query the profiles table, but are called FROM
-- profiles RLS policies — causing infinite recursion.
-- Adding SECURITY DEFINER makes them run as the function owner (bypassing RLS).
-- =============================================================================

create or replace function auth_profile_id()
returns uuid language sql stable security definer
set search_path = public
as $$
  select id from profiles
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$$;

create or replace function auth_is_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from profiles
     where clerk_user_id = (select auth.jwt()->>'sub')
     limit 1),
    false
  )
$$;

create or replace function auth_role()
returns text language sql stable security definer
set search_path = public
as $$
  select role from profiles
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$$;
