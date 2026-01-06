-- ============================================================================
-- VIRTUAL LAB PLATFORM - COMPLETE DATABASE SETUP
-- This single file creates all tables and seeds initial data
-- ============================================================================

-- ============================================================================
-- 1. PROFILES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text UNIQUE NOT NULL,
  email text NOT NULL,
  first_name text,
  last_name text,
  avatar_url text,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'instructor', 'admin')),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT TO authenticated USING (clerk_user_id = (SELECT auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE TO authenticated USING (clerk_user_id = (SELECT auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.clerk_user_id = (SELECT auth.jwt()->>'sub') AND p.role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user_id ON profiles(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ============================================================================
-- 2. CATEGORIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  icon text,
  color text,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view categories" ON categories;
CREATE POLICY "Anyone can view categories" ON categories FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Admins can insert categories" ON categories;
CREATE POLICY "Admins can insert categories" ON categories FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = (SELECT auth.jwt()->>'sub') AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update categories" ON categories;
CREATE POLICY "Admins can update categories" ON categories FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = (SELECT auth.jwt()->>'sub') AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete categories" ON categories;
CREATE POLICY "Admins can delete categories" ON categories FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = (SELECT auth.jwt()->>'sub') AND role = 'admin'));

-- ============================================================================
-- 3. EXPERIMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  estimated_duration int NOT NULL CHECK (estimated_duration > 0),
  aim jsonb,
  theory jsonb,
  procedure jsonb,
  simulation jsonb,
  tags text[],
  prerequisites text[],
  published boolean DEFAULT false,
  featured boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by text NOT NULL
);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view published experiments" ON experiments;
CREATE POLICY "Anyone can view published experiments" ON experiments FOR SELECT TO authenticated, anon USING (published = true);

DROP POLICY IF EXISTS "Creators can view own experiments" ON experiments;
CREATE POLICY "Creators can view own experiments" ON experiments FOR SELECT TO authenticated USING (created_by = (SELECT auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Instructors can create experiments" ON experiments;
CREATE POLICY "Instructors can create experiments" ON experiments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = (SELECT auth.jwt()->>'sub') AND role IN ('instructor', 'admin')));

DROP POLICY IF EXISTS "Creators can update own experiments" ON experiments;
CREATE POLICY "Creators can update own experiments" ON experiments FOR UPDATE TO authenticated USING (created_by = (SELECT auth.jwt()->>'sub') OR EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = (SELECT auth.jwt()->>'sub') AND role = 'admin'));

DROP POLICY IF EXISTS "Creators can delete own experiments" ON experiments;
CREATE POLICY "Creators can delete own experiments" ON experiments FOR DELETE TO authenticated USING (created_by = (SELECT auth.jwt()->>'sub') OR EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = (SELECT auth.jwt()->>'sub') AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_experiments_category_id ON experiments(category_id);
CREATE INDEX IF NOT EXISTS idx_experiments_slug ON experiments(slug);
CREATE INDEX IF NOT EXISTS idx_experiments_published ON experiments(published);
CREATE INDEX IF NOT EXISTS idx_experiments_created_by ON experiments(created_by);

-- ============================================================================
-- 4. QUIZZES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid REFERENCES experiments(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('pretest', 'posttest')),
  title text NOT NULL,
  passing_percentage int DEFAULT 70 CHECK (passing_percentage >= 0 AND passing_percentage <= 100),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view quizzes for published experiments" ON quizzes;
CREATE POLICY "Anyone can view quizzes for published experiments" ON quizzes FOR SELECT TO authenticated, anon USING (EXISTS (SELECT 1 FROM experiments WHERE id = quizzes.experiment_id AND published = true));

DROP POLICY IF EXISTS "Instructors can create quizzes" ON quizzes;
CREATE POLICY "Instructors can create quizzes" ON quizzes FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiments e JOIN profiles p ON p.clerk_user_id = e.created_by WHERE e.id = quizzes.experiment_id AND (e.created_by = (SELECT auth.jwt()->>'sub') OR p.role = 'admin')));

CREATE INDEX IF NOT EXISTS idx_quizzes_experiment_id ON quizzes(experiment_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_type ON quizzes(experiment_id, type);

-- ============================================================================
-- 5. QUIZ QUESTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  question_type text DEFAULT 'multiple_choice',
  options jsonb NOT NULL,
  correct_answer text NOT NULL,
  explanation text,
  points int DEFAULT 1,
  order_number int NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view questions for published quizzes" ON quiz_questions;
CREATE POLICY "Anyone can view questions for published quizzes" ON quiz_questions FOR SELECT TO authenticated, anon USING (EXISTS (SELECT 1 FROM quizzes q JOIN experiments e ON e.id = q.experiment_id WHERE q.id = quiz_questions.quiz_id AND e.published = true));

DROP POLICY IF EXISTS "Instructors can create quiz questions" ON quiz_questions;
CREATE POLICY "Instructors can create quiz questions" ON quiz_questions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM quizzes q JOIN experiments e ON e.id = q.experiment_id WHERE q.id = quiz_questions.quiz_id AND (e.created_by = (SELECT auth.jwt()->>'sub') OR EXISTS (SELECT 1 FROM profiles WHERE clerk_user_id = (SELECT auth.jwt()->>'sub') AND role = 'admin'))));

CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_id ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_order ON quiz_questions(quiz_id, order_number);

-- ============================================================================
-- 6. SIMULATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid REFERENCES experiments(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  simulation_type text NOT NULL,
  config jsonb NOT NULL,
  code_template text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE simulations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view simulations for published experiments" ON simulations;
CREATE POLICY "Anyone can view simulations for published experiments" ON simulations FOR SELECT TO authenticated, anon USING (EXISTS (SELECT 1 FROM experiments WHERE id = simulations.experiment_id AND published = true));

CREATE INDEX IF NOT EXISTS idx_simulations_experiment_id ON simulations(experiment_id);

-- ============================================================================
-- 7. USER PROGRESS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  experiment_id uuid REFERENCES experiments(id) ON DELETE CASCADE,
  current_section text,
  completed_sections text[] DEFAULT '{}',
  started_at timestamp with time zone DEFAULT now(),
  last_accessed_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  UNIQUE(user_id, experiment_id)
);

ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own progress" ON user_progress;
CREATE POLICY "Users can view own progress" ON user_progress FOR SELECT TO authenticated USING (user_id = (SELECT auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Users can insert own progress" ON user_progress;
CREATE POLICY "Users can insert own progress" ON user_progress FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Users can update own progress" ON user_progress;
CREATE POLICY "Users can update own progress" ON user_progress FOR UPDATE TO authenticated USING (user_id = (SELECT auth.jwt()->>'sub'));

CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_experiment_id ON user_progress(experiment_id);

-- ============================================================================
-- 8. FEEDBACK TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  experiment_id uuid REFERENCES experiments(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comments text,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own feedback" ON feedback;
CREATE POLICY "Users can view own feedback" ON feedback FOR SELECT TO authenticated USING (user_id = (SELECT auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Users can insert own feedback" ON feedback;
CREATE POLICY "Users can insert own feedback" ON feedback FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.jwt()->>'sub'));

CREATE INDEX IF NOT EXISTS idx_feedback_experiment_id ON feedback(experiment_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Insert seed profile
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
  category_id, slug, title, description, difficulty, estimated_duration,
  aim, theory, procedure, simulation, tags, prerequisites, published, featured, created_by
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
) ON CONFLICT (slug) DO NOTHING;

-- Insert pretest quiz
INSERT INTO quizzes (experiment_id, type, title, passing_percentage)
SELECT id, 'pretest', 'Raspberry Pi Pre-Assessment', 70
FROM experiments WHERE slug = 'raspberry-pi-intro'
ON CONFLICT DO NOTHING;

-- Insert pretest questions
INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
SELECT
  q.id,
  'What does GPIO stand for in Raspberry Pi?',
  '["General Purpose Input Only", "General Purpose Input/Output", "Graphics Processing Input/Output", "General Processing Interface Organizer"]'::jsonb,
  '1',
  'GPIO stands for General Purpose Input/Output, which are pins used to interface with external hardware.',
  1
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.type = 'pretest'
ON CONFLICT DO NOTHING;

INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
SELECT
  q.id,
  'Which operating system is commonly used on Raspberry Pi?',
  '["Windows 11", "macOS", "Raspberry Pi OS (formerly Raspbian)", "Android"]'::jsonb,
  '2',
  'Raspberry Pi OS (formerly called Raspbian) is the official operating system.',
  2
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.type = 'pretest'
ON CONFLICT DO NOTHING;

INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
SELECT
  q.id,
  'What type of storage does Raspberry Pi use for its operating system?',
  '["Internal SSD", "Hard Drive", "microSD card", "USB Flash Drive"]'::jsonb,
  '2',
  'Raspberry Pi boots from a microSD card that contains the operating system and files.',
  3
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.type = 'pretest'
ON CONFLICT DO NOTHING;

-- Insert posttest quiz
INSERT INTO quizzes (experiment_id, type, title, passing_percentage)
SELECT id, 'posttest', 'Raspberry Pi Post-Assessment', 70
FROM experiments WHERE slug = 'raspberry-pi-intro'
ON CONFLICT DO NOTHING;

-- Insert posttest questions
INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
SELECT
  q.id,
  'When a GPIO pin is set to HIGH state, what voltage does it output?',
  '["5V", "3.3V", "1.8V", "12V"]'::jsonb,
  '1',
  'Raspberry Pi GPIO pins output 3.3V when set to HIGH state. Using 5V can damage the board.',
  1
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.type = 'posttest'
ON CONFLICT DO NOTHING;

INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
SELECT
  q.id,
  'What is the purpose of GPIO.cleanup() in Python code?',
  '["To delete Python files", "To reset the Raspberry Pi", "To release GPIO resources and reset pin states", "To clean the SD card"]'::jsonb,
  '2',
  'GPIO.cleanup() releases GPIO resources and resets pins to their default state.',
  2
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.type = 'posttest'
ON CONFLICT DO NOTHING;

INSERT INTO quiz_questions (quiz_id, question_text, options, correct_answer, explanation, order_number)
SELECT
  q.id,
  'Which pin numbering mode uses the Broadcom SOC channel numbers?',
  '["GPIO.BOARD", "GPIO.BCM", "GPIO.PHYSICAL", "GPIO.WPI"]'::jsonb,
  '1',
  'GPIO.BCM uses Broadcom SOC channel numbers (e.g., GPIO17, GPIO18).',
  3
FROM quizzes q
JOIN experiments e ON e.id = q.experiment_id
WHERE e.slug = 'raspberry-pi-intro' AND q.type = 'posttest'
ON CONFLICT DO NOTHING;

-- Done!
SELECT 'Database setup complete! You now have:' as message;
SELECT COUNT(*) as categories FROM categories;
SELECT COUNT(*) as experiments FROM experiments;
SELECT COUNT(*) as quizzes FROM quizzes;
SELECT COUNT(*) as questions FROM quiz_questions;
