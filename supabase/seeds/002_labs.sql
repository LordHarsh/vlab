-- =============================================================================
-- seeds/002_labs.sql
-- Seed the IoT Virtual Lab lab entry.
-- =============================================================================

insert into labs (slug, title, description, difficulty, tags, published, created_by)
values (
  'iot-virtual-lab',
  'IoT Virtual Laboratory',
  'Hands-on simulation of Arduino & Raspberry Pi experiments — from sensor interfacing to smart automation systems.',
  'beginner',
  array['Arduino', 'Raspberry Pi', 'IoT', 'Sensors', 'GPIO'],
  true,
  (select id from profiles where clerk_user_id = 'seed_admin_replace_me')
)
on conflict (slug) do nothing;
