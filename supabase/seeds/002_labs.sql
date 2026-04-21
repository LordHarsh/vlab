-- =============================================================================
-- seeds/002_labs.sql
-- Seed the IoT Virtual Lab entry.
-- created_by is left null — update it after creating your admin account:
--
--   UPDATE labs SET created_by = (SELECT id FROM profiles WHERE email = 'your@email.com')
--   WHERE slug = 'iot-virtual-lab';
-- =============================================================================

insert into labs (slug, title, description, difficulty, tags, published, created_by)
values (
  'iot-virtual-lab',
  'IoT Virtual Laboratory',
  'Hands-on simulation of Arduino & Raspberry Pi experiments — from sensor interfacing to smart automation systems.',
  'beginner',
  array['Arduino', 'Raspberry Pi', 'IoT', 'Sensors', 'GPIO'],
  true,
  null
)
on conflict (slug) do nothing;
