-- 028_lock_profile_insert_escalation.sql
--
-- CRITICAL. Any signed-up user could make themselves a platform admin with a
-- single REST call.
--
-- Migration 018 pinned is_admin / role / approval_status on the profiles
-- *UPDATE* policy. The INSERT policy from 001_profiles.sql was never touched:
--
--   create policy "profiles: insert own"
--     on profiles for insert to authenticated
--     with check (clerk_user_id = (select auth.jwt()->>'sub'));
--
-- It checks only that the row carries your own Clerk id. `authenticated` holds
-- INSERT on every column, so a browser POST to /rest/v1/profiles carrying
-- is_admin=true, approval_status='approved' and profile_completed=true was
-- accepted. app/(admin)/layout.tsx gates on nothing but is_admin, so /admin
-- opened immediately.
--
-- Verified against this database inside a rolled-back DO block before writing
-- this migration: the insert was accepted and returned is_admin=t,
-- approval_status=approved, role=educator.
--
-- AND IT IS NOT A RACE. `ensureProfile()` in lib/actions/profile.ts — the
-- function that would have created the row server-side on first sign-in — is
-- dead code, called from nowhere. The only writer is completeOnboarding(),
-- which the user submits themselves. So the window never closes on its own.
--
-- Why pinning these is safe for every legitimate write: completeOnboarding()
-- upserts through the SERVICE-ROLE client, which bypasses RLS entirely, so this
-- policy does not govern the normal path at all. It governs only the fallback
-- taken when SUPABASE_SERVICE_ROLE_KEY is absent, and that fallback writes
-- exactly two shapes — a student who is auto-approved, and an educator who is
-- pending an admin's approval. Both still pass. Neither ever sets is_admin.
--
-- All three columns are NOT NULL with defaults (is_admin=false, role='student',
-- approval_status='approved'), so no COALESCE is needed here: a WITH CHECK that
-- evaluated to NULL would fail closed anyway, but it cannot arise.
--
-- Dry-run result on this database, policy applied and rolled back:
--   admin self-grant           -> BLOCKED
--   self-approved educator     -> BLOCKED
--   legitimate student         -> ACCEPTED
--   legitimate educator/pending-> ACCEPTED

drop policy if exists "profiles: insert own" on profiles;

create policy "profiles: insert own"
  on profiles for insert to authenticated
  with check (
    clerk_user_id = (select auth.jwt()->>'sub')
    -- No self-granted platform admin. Admin is conferred only through the
    -- service-role client in lib/actions/admin.ts, which bypasses RLS.
    and is_admin = false
    -- No self-approved educator. Educators are 'pending' until an admin
    -- approves them; a student inserting itself as 'approved' is the intended
    -- auto-approval and still passes.
    and not (role = 'educator' and approval_status = 'approved')
  );

comment on table profiles is
  'RLS: see 018 (update) and 028 (insert). Privilege columns — is_admin, role, '
  'approval_status — are writable only through the service-role client. Do not '
  'relax either policy without re-reading both comment blocks.';
