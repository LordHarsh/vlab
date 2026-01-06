-- Virtual Lab Platform - Quick Seed Data
-- Run this AFTER running the migration (001_initial_schema.sql)

-- Insert Categories
INSERT INTO categories (slug, name, description, icon, color, display_order) VALUES
  ('iot', 'Internet of Things', 'Learn about IoT devices, sensors, and connectivity', 'Cpu', '#10b981', 1),
  ('electronics', 'Electronics', 'Explore circuits, components, and electronic systems', 'Zap', '#f59e0b', 2),
  ('computer-science', 'Computer Science', 'Study algorithms, data structures, and programming', 'Code', '#3b82f6', 3);

-- Insert a dummy profile for experiment creator (required for foreign key)
INSERT INTO profiles (clerk_user_id, email, role) VALUES
  ('seed_user_id', 'seed@example.com', 'admin');

-- Insert Raspberry Pi Experiment
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
  simulation,
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
  '{"gpio_pins": [17, 18, 27, 22], "instructions": ["Connect LED to GPIO pin", "Run the Python code"], "code_example": "import RPi.GPIO as GPIO\\nGPIO.setmode(GPIO.BCM)\\nGPIO.setup(17, GPIO.OUT)", "learning_points": ["GPIO basics", "LED control"]}'::jsonb,
  ARRAY['raspberry-pi', 'iot', 'gpio', 'python', 'beginner'],
  ARRAY['Basic computer knowledge'],
  true,
  true,
  'seed_user_id'
);

-- Insert Pretest Quiz
INSERT INTO quizzes (experiment_id, type, title, passing_percentage)
VALUES (
  (SELECT id FROM experiments WHERE slug = 'raspberry-pi-intro'),
  'pretest',
  'Raspberry Pi Pre-Assessment',
  70
);

-- Insert Pretest Questions
INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
VALUES
  (
    (SELECT id FROM quizzes WHERE type = 'pretest' AND experiment_id = (SELECT id FROM experiments WHERE slug = 'raspberry-pi-intro')),
    'What does GPIO stand for in Raspberry Pi?',
    '["General Purpose Input Only", "General Purpose Input/Output", "Graphics Processing Input/Output", "General Processing Interface Organizer"]'::jsonb,
    '1',
    'GPIO stands for General Purpose Input/Output, which are pins used to interface with external hardware.',
    1
  ),
  (
    (SELECT id FROM quizzes WHERE type = 'pretest' AND experiment_id = (SELECT id FROM experiments WHERE slug = 'raspberry-pi-intro')),
    'Which operating system is commonly used on Raspberry Pi?',
    '["Windows 11", "macOS", "Raspberry Pi OS (formerly Raspbian)", "Android"]'::jsonb,
    '2',
    'Raspberry Pi OS (formerly called Raspbian) is the official operating system.',
    2
  ),
  (
    (SELECT id FROM quizzes WHERE type = 'pretest' AND experiment_id = (SELECT id FROM experiments WHERE slug = 'raspberry-pi-intro')),
    'What type of storage does Raspberry Pi use for its operating system?',
    '["Internal SSD", "Hard Drive", "microSD card", "USB Flash Drive"]'::jsonb,
    '2',
    'Raspberry Pi boots from a microSD card that contains the operating system and files.',
    3
  );

-- Insert Posttest Quiz
INSERT INTO quizzes (experiment_id, type, title, passing_percentage)
VALUES (
  (SELECT id FROM experiments WHERE slug = 'raspberry-pi-intro'),
  'posttest',
  'Raspberry Pi Post-Assessment',
  70
);

-- Insert Posttest Questions
INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
VALUES
  (
    (SELECT id FROM quizzes WHERE type = 'posttest' AND experiment_id = (SELECT id FROM experiments WHERE slug = 'raspberry-pi-intro')),
    'When a GPIO pin is set to HIGH state, what voltage does it output?',
    '["5V", "3.3V", "1.8V", "12V"]'::jsonb,
    '1',
    'Raspberry Pi GPIO pins output 3.3V when set to HIGH state. Using 5V can damage the board.',
    1
  ),
  (
    (SELECT id FROM quizzes WHERE type = 'posttest' AND experiment_id = (SELECT id FROM experiments WHERE slug = 'raspberry-pi-intro')),
    'What is the purpose of GPIO.cleanup() in Python code?',
    '["To delete Python files", "To reset the Raspberry Pi", "To release GPIO resources and reset pin states", "To clean the SD card"]'::jsonb,
    '2',
    'GPIO.cleanup() releases GPIO resources and resets pins to their default state.',
    2
  ),
  (
    (SELECT id FROM quizzes WHERE type = 'posttest' AND experiment_id = (SELECT id FROM experiments WHERE slug = 'raspberry-pi-intro')),
    'Which pin numbering mode uses the Broadcom SOC channel numbers?',
    '["GPIO.BOARD", "GPIO.BCM", "GPIO.PHYSICAL", "GPIO.WPI"]'::jsonb,
    '1',
    'GPIO.BCM uses Broadcom SOC channel numbers (e.g., GPIO17, GPIO18).',
    3
  );
