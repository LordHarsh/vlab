-- =============================================================================
-- 008_profiles_extended_fields.sql
-- Add institution-specific fields to profiles.
-- All new fields are nullable — enforced by onboarding flow, not DB constraint.
-- profile_completed flag gates platform access.
-- =============================================================================

alter table profiles
  -- Common fields
  add column if not exists phone           text,
  add column if not exists department      text,
  -- Student-specific
  add column if not exists registration_no text,      -- e.g. "21BCE1234"
  add column if not exists year            integer     check (year between 1 and 6),
  add column if not exists class_section   text,      -- e.g. "A", "B", "L39"
  -- Educator-specific
  add column if not exists employee_no     text,      -- staff/employee ID
  -- Onboarding gate: set true once user completes their profile
  add column if not exists profile_completed boolean not null default false;

-- Index for quick lookup of incomplete profiles (used in middleware)
create index if not exists idx_profiles_completed
  on profiles(clerk_user_id, profile_completed);
