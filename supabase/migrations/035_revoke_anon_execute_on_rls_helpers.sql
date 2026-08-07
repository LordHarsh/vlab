-- 035: take the RLS helper functions away from the `anon` role.
--
-- Supabase's security advisor flags all ten as
-- `anon_security_definer_function_executable`: they are SECURITY DEFINER and
-- reachable unauthenticated at /rest/v1/rpc/<name>.
--
-- WHAT THE ACTUAL EXPOSURE WAS. Small, but real. Each function answers a
-- question about the CALLER, derived from their own JWT — "am I an admin",
-- "what is my profile id", "am I enrolled in this class". Called with no JWT
-- they answer for nobody, so this was never a data leak. What it did give an
-- anonymous caller is an oracle: `is_enrolled_in_class(<uuid>)` and
-- `can_read_experiment_content(<uuid>)` take an id argument, so the endpoints
-- could be used to probe which uuids exist and are meaningful. There is no
-- reason for a logged-out visitor to hold that.
--
-- WHY THE `authenticated` GRANT STAYS, and why the matching advisor warnings
-- for that role are expected rather than outstanding work: RLS policy
-- expressions execute as the invoking role, so `authenticated` genuinely needs
-- EXECUTE on every one of these. Revoking there would not harden anything — it
-- would break every policy that calls them, which is most of them.
--
-- SAFE BECAUSE THE ANON SURFACE DOES NOT USE THEM. The only two policies
-- granted to `public` are `labs: public read published` and
-- `experiments: read published`, and both are a bare `published = true` with no
-- function call. Verified against pg_policies before writing this.
--
-- Revoking from `public` as well as `anon` is deliberate: `public` is the
-- pseudo-role every role inherits, so a grant left there would keep anon's
-- access alive no matter what is revoked from anon itself. The explicit grants
-- back to `authenticated` and `service_role` are what preserve current
-- behaviour.

do $$
declare
  fn text;
  fns text[] := array[
    'public.auth_approval_status()',
    'public.auth_is_admin()',
    'public.auth_is_approved_educator()',
    'public.auth_profile_id()',
    'public.auth_role()',
    'public.can_read_experiment_content(uuid)',
    'public.can_read_form_content(uuid)',
    'public.can_read_quiz_content(uuid)',
    'public.is_educator_of_class(uuid)',
    'public.is_enrolled_in_class(uuid)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
