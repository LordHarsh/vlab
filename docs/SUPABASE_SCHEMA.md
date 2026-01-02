# Supabase Database Schema for Virtual Lab Platform

## Overview
This schema supports a virtual laboratory platform with experiments, simulations, quizzes, and user progress tracking. All tables use Row Level Security (RLS) with Clerk authentication.

## Authentication Strategy
- **Clerk** handles authentication (user management, sessions)
- **Supabase** stores application data
- **RLS policies** restrict data access based on Clerk user ID
- **Webhooks** sync user data from Clerk to Supabase

---

## Core Tables

### 1. `profiles`
Stores user profile information synced from Clerk via webhooks.

```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  email text not null,
  first_name text,
  last_name text,
  avatar_url text,
  role text not null default 'student', -- 'student' | 'instructor' | 'admin'
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table profiles enable row level security;

-- Policies
create policy "Users can view their own profile"
  on profiles for select
  to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

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
      select 1 from profiles
      where clerk_user_id = (select auth.jwt()->>'sub')
      and role = 'admin'
    )
  );
```

---

### 2. `categories`
Experiment categories (IoT, Electronics, Computer Science, etc.)

```sql
create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  icon text, -- Icon name from lucide-react
  color text, -- Hex color for category
  display_order int not null default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS (Public read, Admin write)
alter table categories enable row level security;

-- Public read access
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
```

---

### 3. `experiments`
Main experiment information

```sql
create table experiments (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete cascade,
  slug text unique not null,
  title text not null,
  description text not null,
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  estimated_duration int not null, -- in minutes

  -- Content sections (stored as JSONB for flexibility)
  aim jsonb, -- { objectives: string[], outcomes: string[] }
  theory jsonb, -- { sections: [{ title, content, image? }] }
  procedure jsonb, -- { steps: [{ title, description, instructions: string[] }] }

  -- Metadata
  tags text[],
  prerequisites text[],
  published boolean default false,
  featured boolean default false,

  -- Timestamps
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  created_by text references profiles(clerk_user_id)
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

-- Admin/Instructor create access
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

-- Admin/Instructor update access
create policy "Instructors can update own experiments"
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
```

---

### 4. `simulations`
Interactive simulation configurations for experiments

```sql
create table simulations (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references experiments(id) on delete cascade,
  title text not null,
  description text,

  -- Simulation type and configuration
  simulation_type text not null, -- 'gpio', 'circuit', 'code', etc.
  config jsonb not null, -- Flexible config based on simulation type

  -- Example config for GPIO simulation:
  -- {
  --   "pins": [17, 18, 27, 22],
  --   "components": [
  --     { "type": "led", "pin": 17, "label": "LED 1" }
  --   ]
  -- }

  code_template text, -- Optional Python/JavaScript template

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
```

---

### 5. `quizzes`
Pre-test and post-test quizzes

```sql
create table quizzes (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references experiments(id) on delete cascade,
  quiz_type text not null check (quiz_type in ('pretest', 'posttest')),
  title text not null,
  passing_percentage int default 70,

  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table quizzes enable row level security;

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
```

---

### 6. `quiz_questions`
Individual quiz questions

```sql
create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes(id) on delete cascade,
  question_text text not null,
  options jsonb not null, -- Array of strings: ["Option 1", "Option 2", ...]
  correct_answer int not null, -- Index of correct option (0-based)
  explanation text, -- Shown after submission
  display_order int not null default 0,

  created_at timestamp with time zone default now()
);

-- Enable RLS
alter table quiz_questions enable row level security;

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
```

---

### 7. `user_progress`
Track user progress through experiments

```sql
create table user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default (select auth.jwt()->>'sub'),
  experiment_id uuid references experiments(id) on delete cascade,

  -- Progress tracking
  current_section text, -- 'aim', 'theory', 'pretest', etc.
  completed_sections text[] default '{}',
  started_at timestamp with time zone default now(),
  last_accessed_at timestamp with time zone default now(),
  completed_at timestamp with time zone,

  -- Unique constraint: one progress record per user per experiment
  unique(user_id, experiment_id)
);

-- Enable RLS
alter table user_progress enable row level security;

-- Users can only view/modify their own progress
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
```

---

### 8. `quiz_submissions`
Store quiz attempt results

```sql
create table quiz_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default (select auth.jwt()->>'sub'),
  quiz_id uuid references quizzes(id) on delete cascade,

  -- Submission data
  answers jsonb not null, -- { "question_id": selected_option_index }
  score int not null, -- Number of correct answers
  total_questions int not null,
  percentage int not null,
  passed boolean not null,

  -- Time tracking
  started_at timestamp with time zone,
  submitted_at timestamp with time zone default now()
);

-- Enable RLS
alter table quiz_submissions enable row level security;

create policy "Users can view own quiz submissions"
  on quiz_submissions for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy "Users can insert own quiz submissions"
  on quiz_submissions for insert
  to authenticated
  with check (user_id = (select auth.jwt()->>'sub'));

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
```

---

### 9. `feedback`
Experiment feedback from users

```sql
create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default (select auth.jwt()->>'sub'),
  experiment_id uuid references experiments(id) on delete cascade,

  -- Ratings (1-5 scale)
  ratings jsonb not null, -- { "content_quality": 5, "clarity": 4, ... }
  comments text,

  -- Metadata
  is_anonymous boolean default false,
  submitted_at timestamp with time zone default now()
);

-- Enable RLS
alter table feedback enable row level security;

create policy "Users can view own feedback"
  on feedback for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy "Users can insert own feedback"
  on feedback for insert
  to authenticated
  with check (user_id = (select auth.jwt()->>'sub'));

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
```

---

## Indexes for Performance

```sql
-- Profiles
create index idx_profiles_clerk_user_id on profiles(clerk_user_id);
create index idx_profiles_role on profiles(role);

-- Experiments
create index idx_experiments_category_id on experiments(category_id);
create index idx_experiments_slug on experiments(slug);
create index idx_experiments_published on experiments(published);
create index idx_experiments_created_by on experiments(created_by);

-- User Progress
create index idx_user_progress_user_id on user_progress(user_id);
create index idx_user_progress_experiment_id on user_progress(experiment_id);

-- Quiz Submissions
create index idx_quiz_submissions_user_id on quiz_submissions(user_id);
create index idx_quiz_submissions_quiz_id on quiz_submissions(quiz_id);

-- Feedback
create index idx_feedback_experiment_id on feedback(experiment_id);
```

---

## Functions & Triggers

### Auto-update timestamp trigger

```sql
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply to relevant tables
create trigger update_profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at_column();

create trigger update_categories_updated_at
  before update on categories
  for each row execute function update_updated_at_column();

create trigger update_experiments_updated_at
  before update on experiments
  for each row execute function update_updated_at_column();
```

---

## Storage Buckets (for images/files)

```sql
-- Create storage bucket for experiment media
insert into storage.buckets (id, name, public)
values ('experiment-media', 'experiment-media', true);

-- RLS for storage
create policy "Public read access"
  on storage.objects for select
  using (bucket_id = 'experiment-media');

create policy "Authenticated users can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'experiment-media');
```

---

## Migration Order

1. Create `profiles` table first (referenced by other tables)
2. Create `categories` table
3. Create `experiments` table
4. Create `simulations`, `quizzes`, `quiz_questions` tables
5. Create `user_progress`, `quiz_submissions`, `feedback` tables
6. Create indexes
7. Create functions and triggers
8. Set up storage buckets

---

## TypeScript Types

After creating tables, generate TypeScript types:

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > types/supabase.ts
```

This will auto-generate all types based on your schema.
