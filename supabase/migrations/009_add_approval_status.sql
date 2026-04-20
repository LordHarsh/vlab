-- =============================================================================
-- 009_add_approval_status.sql
-- Educator approval workflow.
-- Students: auto-approved on onboarding (approval_status = 'approved')
-- Educators: pending until an admin approves (approval_status = 'pending')
-- =============================================================================

alter table profiles
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('approved', 'pending', 'rejected'));

create index if not exists idx_profiles_approval
  on profiles(approval_status, role)
  where approval_status = 'pending';
