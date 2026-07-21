-- =============================================================================
-- 014_harden_function_surface.sql
--
-- Hygiene pass over the trigger functions. 013 is what closed the actual holes.
--
-- 1. `set_updated_at` (10 triggers attached) had a mutable search_path.
-- 2. `update_updated_at_column` was a leftover from the pre-rebuild schema with
--    zero triggers attached.
-- =============================================================================

alter function set_updated_at() set search_path = public;

drop function if exists update_updated_at_column();

-- =============================================================================
-- DO NOT revoke EXECUTE on the auth_* / can_read_* / is_* helpers.
--
-- The Supabase security advisor flags all eight as "SECURITY DEFINER function
-- executable by anon/authenticated" and suggests revoking EXECUTE. Doing so
-- breaks every RLS policy that calls them:
--
--   ERROR: 42501: permission denied for function can_read_experiment_content
--
-- RLS policy expressions ARE evaluated against the invoking role's privileges,
-- so the invoking role must retain EXECUTE. This was confirmed the hard way
-- against the live database — an enrolled student went from 66 readable
-- sections to a hard error, and the grants had to be restored.
--
-- Note the trap that hides this: `revoke execute ... from anon, authenticated`
-- appears to succeed and changes nothing, because those roles hold no direct
-- grant — they inherit EXECUTE from PUBLIC. Only revoking from PUBLIC has any
-- effect, and that is precisely what breaks RLS.
--
-- The warning is acceptable here. Each helper returns a boolean about the
-- *caller's own* access, derived from the caller's own JWT, so calling it
-- directly reveals nothing the caller could not learn by querying the table.
-- =============================================================================
