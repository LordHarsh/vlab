-- 018_lock_profile_role_escalation.sql
--
-- Fixes a privilege escalation found in QA.
--
-- The "profiles: own update" policy pinned is_admin but left role and
-- approval_status unconstrained. The app ships an authenticated browser client
-- (anon key + Clerk token), so a signed-in student could open devtools and run
--   supabase.from('profiles').update({ role:'educator', approval_status:'approved' })
-- against their OWN row — the USING clause scopes it to that row and the write
-- succeeded, promoting them straight past the educator gate.
--
-- Why pinning these is safe for every legitimate write: role and
-- approval_status are only ever set through the SERVICE-ROLE client — onboarding
-- in lib/actions/profile.ts (createAdminSupabaseClient) and admin approval in
-- lib/actions/admin.ts. The service role bypasses RLS entirely, so this policy
-- never governs a legitimate role change. It only governs a user editing their
-- own profile (name, avatar, registration number...), which must never change
-- these three columns. Admins keep their ability to change roles through the
-- separate "profiles: admin update all" policy.

-- The caller's CURRENT approval_status, mirroring auth_role() / auth_is_admin().
-- SECURITY DEFINER so the with_check below reads the committed value without
-- RLS re-entrancy on profiles.
create or replace function public.auth_approval_status()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select approval_status from profiles
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$function$;

-- Do NOT revoke EXECUTE on this function. Per migration 014: RLS policy
-- expressions are evaluated with the invoking role's privileges, so revoking
-- EXECUTE from anon/authenticated breaks every policy that calls it. The
-- function only ever returns the caller's own approval_status.

-- Pin role and approval_status the same way is_admin was already pinned.
alter policy "profiles: own update" on public.profiles
  with check (
    clerk_user_id = (select auth.jwt()->>'sub')
    and ((not is_admin) or auth_is_admin())
    and role = auth_role()
    and approval_status = auth_approval_status()
  );
