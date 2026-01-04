-- Virtual Lab Platform - Initial Schema Migration
-- This migration creates all core tables with Row Level Security (RLS)
-- Compatible with Clerk third-party authentication

-- ============================================================================
-- 1. PROFILES TABLE
-- Stores user profile information synced from Clerk via webhooks
-- ============================================================================

create table profiles (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  email text not null,
  first_name text,
  last_name text,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'instructor', 'admin')),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table profiles enable row level security;

-- Users can view their own profile
create policy "Users can view their own profile"
  on profiles for select
  to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

-- Users can update their own profile
create policy "Users can update their own profile"
  on profiles for update
  to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

-- Admins can view all profiles
create policy "Admins can view all profiles"
  on profiles for select
  to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.clerk_user_id = (select auth.jwt()->>'sub')
      and p.role = 'admin'
    )
  );

-- Index for performance
create index idx_profiles_clerk_user_id on profiles(clerk_user_id);
create index idx_profiles_role on profiles(role);

-- ============================================================================
-- 2. CATEGORIES TABLE
-- Experiment categories (IoT, Electronics, Computer Science, etc.)
-- ============================================================================

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  icon text,
  color text,
  display_order int not null default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table categories enable row level security;

-- Public read access (no auth required)
create policy "Anyone can view categories"
  on categories for select
  to authenticated, anon
  using (true);

-- Admin write access
create policy "Admins can insert categories"
  on categories for insert
  to authenticated
  with check (
    exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );

create policy "Admins can update categories"
  on categories for update
  to authenticated
  using (
    exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );

create policy "Admins can delete categories"
  on categories for delete
  to authenticated
  using (
    exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );

-- ============================================================================
-- 3. EXPERIMENTS TABLE
-- Main experiment information with content stored as JSONB
-- ============================================================================

create table experiments (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete cascade,
  slug text unique not null,
  title text not null,
  description text not null,
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  estimated_duration int not null check (estimated_duration > 0),

  -- Content sections
  aim jsonb,
  theory jsonb,
  procedure jsonb,
  simulation jsonb,

  -- Metadata
  tags text[],
  prerequisites text[],
  published boolean default false,
  featured boolean default false,

  -- Timestamps
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  created_by text not null references profiles(clerk_user_id) on delete restrict
);

-- Enable RLS
alter table experiments enable row level security;

-- Public read access for published experiments
create policy "Anyone can view published experiments"
  on experiments for select
  to authenticated, anon
  using (published = true);

-- Creators can view their own drafts
create policy "Creators can view own experiments"
  on experiments for select
  to authenticated
  using (created_by = (select auth.jwt()->>'sub'));

-- Instructors/Admins can create experiments
create policy "Instructors can create experiments"
  on experiments for insert
  to authenticated
  with check (
    exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role in ('instructor', 'admin')
    )
  );

-- Creators can update their own experiments, admins can update all
create policy "Creators can update own experiments"
  on experiments for update
  to authenticated
  using (
    created_by = (select auth.jwt()->>'sub')
    or exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );

-- Creators can delete their own experiments, admins can delete all
create policy "Creators can delete own experiments"
  on experiments for delete
  to authenticated
  using (
    created_by = (select auth.jwt()->>'sub')
    or exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );

-- Indexes
create index idx_experiments_category_id on experiments(category_id);
create index idx_experiments_slug on experiments(slug);
create index idx_experiments_published on experiments(published);
create index idx_experiments_created_by on experiments(created_by);

-- ============================================================================
-- 4. SIMULATIONS TABLE
-- Interactive simulation configurations
-- ============================================================================

create table simulations (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references experiments(id) on delete cascade,
  title text not null,
  description text,
  simulation_type text not null,
  config jsonb not null,
  code_template text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table simulations enable row level security;

-- Public read for published experiments
create policy "Anyone can view simulations for published experiments"
  on simulations for select
  to authenticated, anon
  using (
    exists (
      select 1 from experiments
      where id = simulations.experiment_id
      and published = true
    )
  );

-- Instructors can create simulations for their experiments
create policy "Instructors can create simulations"
  on simulations for insert
  to authenticated
  with check (
    exists (
      select 1 from experiments e
      join profiles p on p.clerk_user_id = e.created_by
      where e.id = simulations.experiment_id
      and (
        e.created_by = (select auth.jwt()->>'sub')
        or p.role = 'admin'
      )
    )
  );

-- Instructors can update their simulations
create policy "Instructors can update simulations"
  on simulations for update
  to authenticated
  using (
    exists (
      select 1 from experiments e
      where e.id = simulations.experiment_id
      and (
        e.created_by = (select auth.jwt()->>'sub')
        or exists (
          select 1 from profiles
          where clerk_user_id = (select auth.jwt()->>'sub')
          and role = 'admin'
        )
      )
    )
  );

-- ============================================================================
-- 5. QUIZZES TABLE
-- Pre-test and post-test quizzes
-- ============================================================================

create table quizzes (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references experiments(id) on delete cascade,
  type text not null check (type in ('pretest', 'posttest')),
  title text not null,
  passing_percentage int default 70 check (passing_percentage >= 0 and passing_percentage <= 100),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table quizzes enable row level security;

-- Public read for published experiments
create policy "Anyone can view quizzes for published experiments"
  on quizzes for select
  to authenticated, anon
  using (
    exists (
      select 1 from experiments
      where id = quizzes.experiment_id
      and published = true
    )
  );

-- Instructors can create quizzes
create policy "Instructors can create quizzes"
  on quizzes for insert
  to authenticated
  with check (
    exists (
      select 1 from experiments e
      join profiles p on p.clerk_user_id = e.created_by
      where e.id = quizzes.experiment_id
      and (
        e.created_by = (select auth.jwt()->>'sub')
        or p.role = 'admin'
      )
    )
  );

-- ============================================================================
-- 6. QUIZ QUESTIONS TABLE
-- Individual quiz questions with options and explanations
-- ============================================================================

create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes(id) on delete cascade,
  question_text text not null,
  question_type text default 'multiple_choice',
  options jsonb not null,
  correct_answer text not null,
  explanation text,
  points int default 1,
  order_number int not null default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table quiz_questions enable row level security;

-- Public read for published quizzes
create policy "Anyone can view questions for published quizzes"
  on quiz_questions for select
  to authenticated, anon
  using (
    exists (
      select 1 from quizzes q
      join experiments e on e.id = q.experiment_id
      where q.id = quiz_questions.quiz_id
      and e.published = true
    )
  );

-- Instructors can create questions
create policy "Instructors can create quiz questions"
  on quiz_questions for insert
  to authenticated
  with check (
    exists (
      select 1 from quizzes q
      join experiments e on e.id = q.experiment_id
      where q.id = quiz_questions.quiz_id
      and (
        e.created_by = (select auth.jwt()->>'sub')
        or exists (
          select 1 from profiles
          where clerk_user_id = (select auth.jwt()->>'sub')
          and role = 'admin'
        )
      )
    )
  );

-- ============================================================================
-- 7. USER PROGRESS TABLE
-- Track user progress through experiments
-- ============================================================================

create table user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(clerk_user_id) on delete cascade,
  experiment_id uuid references experiments(id) on delete cascade,
  current_section text,
  completed_sections text[] default '{}',
  started_at timestamp with time zone default now(),
  last_accessed_at timestamp with time zone default now(),
  completed_at timestamp with time zone,

  -- One progress record per user per experiment
  unique(user_id, experiment_id)
);

-- Enable RLS
alter table user_progress enable row level security;

-- Users can only view their own progress
create policy "Users can view own progress"
  on user_progress for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy "Users can insert own progress"
  on user_progress for insert
  to authenticated
  with check (user_id = (select auth.jwt()->>'sub'));

create policy "Users can update own progress"
  on user_progress for update
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy "Users can delete own progress"
  on user_progress for delete
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

-- Admins can view all progress
create policy "Admins can view all progress"
  on user_progress for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );

-- Indexes
create index idx_user_progress_user_id on user_progress(user_id);
create index idx_user_progress_experiment_id on user_progress(experiment_id);

-- ============================================================================
-- 8. QUIZ SUBMISSIONS TABLE
-- Store quiz attempt results
-- ============================================================================

create table quiz_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(clerk_user_id) on delete cascade,
  quiz_id uuid references quizzes(id) on delete cascade,
  answers jsonb not null,
  score int not null check (score >= 0),
  percentage int not null check (percentage >= 0 and percentage <= 100),
  submitted_at timestamp with time zone default now()
);

-- Enable RLS
alter table quiz_submissions enable row level security;

-- Users can view their own submissions
create policy "Users can view own quiz submissions"
  on quiz_submissions for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy "Users can insert own quiz submissions"
  on quiz_submissions for insert
  to authenticated
  with check (user_id = (select auth.jwt()->>'sub'));

create policy "Users can delete own quiz submissions"
  on quiz_submissions for delete
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

-- Admins can view all submissions
create policy "Admins can view all quiz submissions"
  on quiz_submissions for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );

-- Indexes
create index idx_quiz_submissions_user_id on quiz_submissions(user_id);
create index idx_quiz_submissions_quiz_id on quiz_submissions(quiz_id);

-- ============================================================================
-- 9. FEEDBACK TABLE
-- Experiment feedback from users
-- ============================================================================

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(clerk_user_id) on delete cascade,
  experiment_id uuid references experiments(id) on delete cascade,
  rating int not null check (rating >= 1 and rating <= 5),
  comments text,
  created_at timestamp with time zone default now()
);

-- Enable RLS
alter table feedback enable row level security;

-- Users can view their own feedback
create policy "Users can view own feedback"
  on feedback for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy "Users can insert own feedback"
  on feedback for insert
  to authenticated
  with check (user_id = (select auth.jwt()->>'sub'));

create policy "Users can delete own feedback"
  on feedback for delete
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

-- Admins can view all feedback
create policy "Admins can view all feedback"
  on feedback for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );

-- Indexes
create index idx_feedback_experiment_id on feedback(experiment_id);
create index idx_feedback_user_id on feedback(user_id);
create index idx_feedback_created_at on feedback(created_at);

-- Additional performance indexes
create index idx_experiments_featured on experiments(featured) where featured = true;
create index idx_experiments_difficulty on experiments(difficulty);
create index idx_user_progress_completed_at on user_progress(completed_at) where completed_at is not null;
create index idx_quiz_submissions_submitted_at on quiz_submissions(submitted_at);
create index idx_quiz_submissions_user_quiz on quiz_submissions(user_id, quiz_id);
create index idx_quiz_questions_quiz_id on quiz_questions(quiz_id);
create index idx_quiz_questions_order on quiz_questions(quiz_id, order_number);
create index idx_simulations_experiment_id on simulations(experiment_id);
create index idx_quizzes_experiment_id on quizzes(experiment_id);
create index idx_quizzes_type on quizzes(experiment_id, type);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Auto-update timestamp function
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply triggers to tables with updated_at
create trigger update_profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at_column();

create trigger update_categories_updated_at
  before update on categories
  for each row execute function update_updated_at_column();

create trigger update_experiments_updated_at
  before update on experiments
  for each row execute function update_updated_at_column();

create trigger update_simulations_updated_at
  before update on simulations
  for each row execute function update_updated_at_column();

create trigger update_quizzes_updated_at
  before update on quizzes
  for each row execute function update_updated_at_column();
