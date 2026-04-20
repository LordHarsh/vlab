-- =============================================================================
-- seeds/001_admin_profile.sql
-- Seed admin profile required as created_by FK for labs.
-- clerk_user_id must be updated to match the real Clerk user ID after sign-in.
-- =============================================================================

insert into profiles (clerk_user_id, email, first_name, last_name, role, is_admin)
values (
  'seed_admin_replace_me',   -- TODO: replace with real Clerk user ID
  'admin@vlab.edu',
  'Lab',
  'Admin',
  'educator',
  true
)
on conflict (clerk_user_id) do nothing;
