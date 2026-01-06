-- ============================================================================
-- VIRTUAL LAB PLATFORM - SEED DATA ONLY
-- This file seeds data into your existing database schema
-- Run this AFTER your schema is already created
-- ============================================================================

-- Insert seed profile (required for foreign key)
INSERT INTO profiles (clerk_user_id, email, role)
VALUES ('seed_user_id', 'seed@example.com', 'admin')
ON CONFLICT (clerk_user_id) DO NOTHING;

-- Insert categories
INSERT INTO categories (slug, name, description, icon, color, display_order) VALUES
  ('iot', 'Internet of Things', 'Learn about IoT devices, sensors, and connectivity', 'Cpu', '#10b981', 1),
  ('electronics', 'Electronics', 'Explore circuits, components, and electronic systems', 'Zap', '#f59e0b', 2),
  ('computer-science', 'Computer Science', 'Study algorithms, data structures, and programming', 'Code', '#3b82f6', 3)
ON CONFLICT (slug) DO NOTHING;

-- Insert Raspberry Pi experiment
INSERT INTO experiments (
  category_id,
  slug,
  title,
  description,
  difficulty,
  estimated_duration,
  aim,
  theory,
  procedure,
  tags,
  prerequisites,
  published,
  featured,
  created_by
) VALUES (
  (SELECT id FROM categories WHERE slug = 'iot'),
  'raspberry-pi-intro',
  'Introduction to Raspberry Pi',
  'Learn the basics of Raspberry Pi, its components, and how to set it up for your first project.',
  'beginner',
  45,
  '{"objectives": ["Understand what Raspberry Pi is and its applications", "Identify the key components of a Raspberry Pi board", "Set up Raspberry Pi OS and connect peripherals", "Learn about GPIO pins and their functions", "Write and run a simple Python program on Raspberry Pi"], "outcomes": ["Successfully boot and configure Raspberry Pi", "Navigate the Raspberry Pi OS interface", "Understand GPIO pin layout and numbering", "Execute basic Python scripts", "Prepare for hardware interfacing projects"]}'::jsonb,
  '{"sections": [{"title": "What is Raspberry Pi?", "content": "Raspberry Pi is a series of small single-board computers developed by the Raspberry Pi Foundation. It is designed to promote teaching of basic computer science in schools and developing countries."}, {"title": "Key Components", "content": "Understanding the components of your Raspberry Pi is essential for effective use.", "components": [{"name": "GPIO Pins", "description": "40-pin header for interfacing with external hardware"}, {"name": "USB Ports", "description": "Connect keyboard, mouse, and other USB devices"}, {"name": "HDMI Port", "description": "Video output to monitors and TVs"}]}]}'::jsonb,
  '{"steps": [{"title": "Unboxing and Initial Setup", "description": "Prepare your Raspberry Pi for first use", "instructions": ["Carefully remove the Raspberry Pi from its packaging", "Check all components", "Inspect for damage"]}, {"title": "Installing the Operating System", "description": "Set up Raspberry Pi OS on your SD card", "instructions": ["Download Raspberry Pi Imager", "Insert SD card", "Write OS to card"]}]}'::jsonb,
  ARRAY['raspberry-pi', 'iot', 'gpio', 'python', 'beginner'],
  ARRAY['Basic computer knowledge'],
  true,
  true,
  'seed_user_id'
) ON CONFLICT (slug) DO NOTHING;

-- Insert simulation for Raspberry Pi
INSERT INTO simulations (experiment_id, title, description, simulation_type, config, code_template)
SELECT
  id,
  'GPIO Pin Controller',
  'Interactive GPIO pin simulation with LED visualization',
  'gpio',
  '{"gpio_pins": [17, 18, 27, 22], "instructions": ["Connect LED to GPIO pin", "Run the Python code"], "learning_points": ["GPIO basics", "LED control"]}'::jsonb,
  'import RPi.GPIO as GPIO
GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.OUT)

# Turn LED ON
GPIO.output(17, GPIO.HIGH)

# Turn LED OFF
GPIO.output(17, GPIO.LOW)

# Cleanup
GPIO.cleanup()'
FROM experiments WHERE slug = 'raspberry-pi-intro'
ON CONFLICT DO NOTHING;

-- Insert pretest quiz (note: column is 'quiz_type' not 'type')
INSERT INTO quizzes (experiment_id, quiz_type, title, passing_percentage)
SELECT id, 'pretest', 'Raspberry Pi Pre-Assessment', 70
FROM experiments WHERE slug = 'raspberry-pi-intro'
ON CONFLICT DO NOTHING;

-- Insert pretest questions (note: correct_answer is integer, column is 'display_order' not 'order_number')
INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, display_order)
SELECT
  q.id,
  'What does GPIO stand for in Raspberry Pi?',
  '["General Purpose Input Only", "General Purpose Input/Output", "Graphics Processing Input/Output", "General Processing Interface Organizer"]'::jsonb,
  1,
  'GPIO stands for General Purpose Input/Output, which are pins used to interface with external hardware.',
  1
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.quiz_type = 'pretest'
ON CONFLICT DO NOTHING;

INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, display_order)
SELECT
  q.id,
  'Which operating system is commonly used on Raspberry Pi?',
  '["Windows 11", "macOS", "Raspberry Pi OS (formerly Raspbian)", "Android"]'::jsonb,
  2,
  'Raspberry Pi OS (formerly called Raspbian) is the official operating system.',
  2
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.quiz_type = 'pretest'
ON CONFLICT DO NOTHING;

INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, display_order)
SELECT
  q.id,
  'What type of storage does Raspberry Pi use for its operating system?',
  '["Internal SSD", "Hard Drive", "microSD card", "USB Flash Drive"]'::jsonb,
  2,
  'Raspberry Pi boots from a microSD card that contains the operating system and files.',
  3
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.quiz_type = 'pretest'
ON CONFLICT DO NOTHING;

-- Insert posttest quiz
INSERT INTO quizzes (experiment_id, quiz_type, title, passing_percentage)
SELECT id, 'posttest', 'Raspberry Pi Post-Assessment', 70
FROM experiments WHERE slug = 'raspberry-pi-intro'
ON CONFLICT DO NOTHING;

-- Insert posttest questions
INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, display_order)
SELECT
  q.id,
  'When a GPIO pin is set to HIGH state, what voltage does it output?',
  '["5V", "3.3V", "1.8V", "12V"]'::jsonb,
  1,
  'Raspberry Pi GPIO pins output 3.3V when set to HIGH state. Using 5V can damage the board.',
  1
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.quiz_type = 'posttest'
ON CONFLICT DO NOTHING;

INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, display_order)
SELECT
  q.id,
  'What is the purpose of GPIO.cleanup() in Python code?',
  '["To delete Python files", "To reset the Raspberry Pi", "To release GPIO resources and reset pin states", "To clean the SD card"]'::jsonb,
  2,
  'GPIO.cleanup() releases GPIO resources and resets pins to their default state.',
  2
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.quiz_type = 'posttest'
ON CONFLICT DO NOTHING;

INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, display_order)
SELECT
  q.id,
  'Which pin numbering mode uses the Broadcom SOC channel numbers?',
  '["GPIO.BOARD", "GPIO.BCM", "GPIO.PHYSICAL", "GPIO.WPI"]'::jsonb,
  1,
  'GPIO.BCM uses Broadcom SOC channel numbers (e.g., GPIO17, GPIO18).',
  3
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.quiz_type = 'posttest'
ON CONFLICT DO NOTHING;

-- Verify the data
SELECT 'Seed complete! Summary:' as message;
SELECT COUNT(*) || ' categories' as result FROM categories;
SELECT COUNT(*) || ' experiments' as result FROM experiments;
SELECT COUNT(*) || ' simulations' as result FROM simulations;
SELECT COUNT(*) || ' quizzes' as result FROM quizzes;
SELECT COUNT(*) || ' quiz questions' as result FROM quiz_questions;
