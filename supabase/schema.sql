-- =============================================================================
-- schema.sql — CONSOLIDATED SCHEMA FOR A BRAND-NEW SUPABASE INSTANCE
-- =============================================================================
--
-- Run this ONCE against an empty Supabase project. It produces the same end
-- state as running supabase/migrations/001..020 in order, expressed as a clean
-- forward definition instead of a replay of the historical churn.
--
-- WHAT THIS FILE CREATES
--   - 21 tables with their FINAL columns, defaults, checks and unique keys
--   - every index
--   - 10 functions: 9 SECURITY DEFINER RLS helpers + the set_updated_at trigger
--     function (all with search_path pinned)
--   - RLS enabled on all 21 tables + all 81 policies
--   - the column-level lockdown on quiz_questions.correct_answer / .explanation
--   - 12 set_updated_at triggers
--
-- WHAT THIS FILE DOES **NOT** CREATE
--   - No content. No labs, experiments, sections, simulations, quizzes,
--     questions, feedback forms or starter circuits. The tables come up empty.
--   - No admin user. See supabase/seeds/001_admin_profile.sql for how to
--     promote your first account after signing up.
--
--   To populate a fresh instance with the IoT Virtual Lab content, run AFTER
--   this file, in this order:
--       supabase/seeds/002_labs.sql            -- the lab row
--       supabase/seeds/003_experiments.sql     -- the 12 experiment rows
--       supabase/migrations/016_backfill_authored_content.sql
--                                              -- sections, quizzes, 48 questions,
--                                              --   feedback forms, builtin sims
--       supabase/migrations/017_fix_smart_traffic_code_meta.sql
--       supabase/migrations/020_native_experiments.sql
--                                              -- starter circuits + native sims
--   Those five files are data-only against this schema (016 also re-asserts the
--   simulations type check, which is already correct here — harmless).
--
-- PREREQUISITES
--   A stock Supabase project. This file assumes the `auth` schema with
--   auth.jwt() exists and that the roles anon / authenticated / service_role
--   exist. It does not create them. It will NOT run on bare Postgres unshimmed.
--
-- AUTH MODEL
--   Clerk issues the JWT; auth.jwt()->>'sub' is matched against
--   profiles.clerk_user_id. There is no Supabase Auth user table in play.
--
-- IDEMPOTENCY
--   Safe to re-run: every object uses `if not exists` / `or replace`, and every
--   policy and trigger is dropped before being recreated. Note that re-running
--   against a database whose tables already exist will NOT retrofit changed
--   columns or constraints — that is what the numbered migrations are for.
--
-- KEEPING THIS FILE HONEST
--   Any future schema change must be written TWICE: as a new numbered migration
--   in supabase/migrations/ (for the live database) AND folded into this file
--   (for new instances). See supabase/README.md.
--
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
-- Every primary key defaults to gen_random_uuid(), which is built into Postgres
-- 13+ and is also provided by pgcrypto. A stock Supabase project already has
-- pgcrypto installed in the `extensions` schema, so this whole block is a no-op
-- there. It is wrapped so the file still stands up on a Postgres build that does
-- not ship pgcrypto — the built-in gen_random_uuid() covers us either way.
create schema if not exists extensions;
do $$
begin
  create extension if not exists pgcrypto with schema extensions;
exception when others then
  raise notice 'pgcrypto unavailable (%) — relying on built-in gen_random_uuid()', sqlerrm;
end $$;


-- =============================================================================
-- 2. TABLES
-- Ordered so every foreign key target already exists.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PROFILES                                                    [001, 008, 009]
-- One row per Clerk user. `role` and `approval_status` are only ever written by
-- the service-role client (onboarding + admin approval); RLS pins them for
-- self-updates — see the "profiles: own update" policy below.
-- -----------------------------------------------------------------------------
create table if not exists profiles (
  id                 uuid primary key default gen_random_uuid(),
  clerk_user_id      text unique not null,
  email              text not null,
  first_name         text,
  last_name          text,
  avatar_url         text,
  role               text not null default 'student'
                     check (role in ('student', 'educator')),
  is_admin           boolean not null default false,
  -- [008] institution fields; nullable, enforced by the onboarding flow
  phone              text,
  department         text,
  registration_no    text,                                  -- e.g. "21BCE1234"
  year               integer check (year between 1 and 6),
  class_section      text,                                  -- e.g. "A", "L39"
  employee_no        text,
  profile_completed  boolean not null default false,        -- onboarding gate
  -- [009] students auto-approve; educators wait on an admin
  approval_status    text not null default 'approved'
                     check (approval_status in ('approved', 'pending', 'rejected')),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- LABS                                                             [002]
-- Top-level grouping. Catalogue metadata is deliberately public — see 013.
-- -----------------------------------------------------------------------------
create table if not exists labs (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,
  title          text not null,
  description    text,
  thumbnail_url  text,
  difficulty     text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  tags           text[] not null default '{}',
  published      boolean not null default false,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- EXPERIMENTS                                                      [002]
-- Also deliberately public: the /labs page counts published experiments per lab.
-- No experiment *content* lives here.
-- -----------------------------------------------------------------------------
create table if not exists experiments (
  id                  uuid primary key default gen_random_uuid(),
  lab_id              uuid not null references labs(id) on delete cascade,
  slug                text not null,
  title               text not null,
  description         text,
  order_index         integer not null default 0,
  difficulty          text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  estimated_duration  integer,                                        -- minutes
  published           boolean not null default false,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (lab_id, slug)
);

-- -----------------------------------------------------------------------------
-- EXPERIMENT SECTIONS                                              [002]
-- Ordered content blocks. `type` determines the shape of `content`:
--   aim:        { objectives: string[], outcomes: string[], note?: string }
--   theory:     { introduction: string, sections: [{heading, body}] }
--   components: { items: [{name, quantity, notes?}] }
--   circuit:    { svg_data?: string, connections: [{from, to}] }
--   procedure:  { steps: string[] }
--   code:       { language: "arduino_c"|"python", platform: string, code: string }
--   simulation: { simulation_id: uuid }   -- FK into simulations
--   quiz:       { quiz_id: uuid }         -- FK into quizzes
--   feedback:   { form_id: uuid }         -- FK into feedback_forms
--   references: { items: [{title, url, type?}] }
--   video:      { url: string, caption?: string }
--   text:       { content: string }
-- -----------------------------------------------------------------------------
create table if not exists experiment_sections (
  id             uuid primary key default gen_random_uuid(),
  experiment_id  uuid not null references experiments(id) on delete cascade,
  type           text not null check (type in (
                   'aim', 'theory', 'components', 'circuit',
                   'procedure', 'code', 'simulation', 'quiz',
                   'feedback', 'references', 'text', 'video'
                 )),
  title          text,
  order_index    integer not null,
  content        jsonb,
  is_required    boolean not null default true,
  status         text not null default 'active'
                 check (status in ('active', 'archived')),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- SIMULATIONS                                                 [002, 011/015/016]
-- Linked from experiment_sections where type = 'simulation'.
--
-- The type check has moved three times and this is the settled list. Do not
-- narrow it again:
--   tinkercad  external embed; the permanent fallback for anything the native
--              simulator cannot build (notably every Raspberry Pi experiment)
--              config: { design_id: string, height: integer }
--   native     the in-house circuit editor; the document lives in `circuits`
--              config: (unused; may still carry a legacy sim_type)
--   builtin    a purpose-built widget per experiment
--              config: { sim_type: "dht11"|"traffic"|"ultrasonic"|"flow"|
--                                  "rpi_led"|"pir_alarm"|"ds18b20"|"motor"|
--                                  "home_auto"|"smart_traffic"|"health" }
--
-- History for the record: 002 allowed ('builtin_js','wokwi','tinkercad','iframe');
-- 011 narrowed it to 'tinkercad' only and wiped every config; 015 re-added
-- 'native'; 016 re-added the widget kind under the new name 'builtin' and
-- backfilled all 12 experiments. 'builtin_js', 'wokwi' and 'iframe' are gone for
-- good and no row ever survived using them.
-- -----------------------------------------------------------------------------
create table if not exists simulations (
  id             uuid primary key default gen_random_uuid(),
  experiment_id  uuid not null references experiments(id) on delete cascade,
  type           text not null check (type in ('tinkercad', 'native', 'builtin')),
  title          text,
  description    text,
  config         jsonb not null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- QUIZZES                                                          [003]
-- One quiz per experiment per type. Defaults are overridable per class via
-- class_quiz_settings.
-- -----------------------------------------------------------------------------
create table if not exists quizzes (
  id                          uuid primary key default gen_random_uuid(),
  experiment_id               uuid not null references experiments(id) on delete cascade,
  type                        text not null check (type in ('pretest', 'posttest', 'practice')),
  title                       text not null,
  description                 text,
  time_limit_minutes          integer,                  -- null = no limit
  default_max_attempts        integer default 1,        -- null = unlimited
  default_passing_percentage  integer default 70,
  default_show_score          boolean default true,
  default_show_answers        text not null default 'after_submission'
                              check (default_show_answers in (
                                'immediately', 'after_submission', 'after_due_date', 'never'
                              )),
  randomize_questions         boolean default false,
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- QUIZ QUESTIONS                                              [003, 013]
-- Archive pattern: editing a question archives the old row
-- (status='archived', superseded_by=<new id>) and inserts a new one. Submissions
-- store a text snapshot, so archived questions still render in past results.
--
--   options shape:  [{ "id": "a", "text": "Option text" }, ...]
--   correct_answer: the option id string (e.g. "a")
--
-- correct_answer and explanation are NOT readable by the `authenticated` role —
-- see the column-level lockdown in section 7.
-- -----------------------------------------------------------------------------
create table if not exists quiz_questions (
  id              uuid primary key default gen_random_uuid(),
  quiz_id         uuid not null references quizzes(id) on delete cascade,
  question_text   text not null,
  question_type   text not null default 'multiple_choice'
                  check (question_type in ('multiple_choice', 'true_false')),
  options         jsonb not null,
  correct_answer  text not null,
  explanation     text,
  points          integer not null default 1,
  order_number    integer not null,
  status          text not null default 'active'
                  check (status in ('active', 'archived')),
  archived_at     timestamptz,
  superseded_by   uuid references quiz_questions(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- FEEDBACK FORMS                                                   [004]
-- One form per experiment. Educators override visibility per class via
-- class_feedback_settings.
-- -----------------------------------------------------------------------------
create table if not exists feedback_forms (
  id             uuid primary key default gen_random_uuid(),
  experiment_id  uuid not null unique references experiments(id) on delete cascade,
  title          text not null default 'Experiment Feedback',
  description    text,
  is_enabled     boolean not null default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- FEEDBACK QUESTIONS                                               [004]
-- Archive pattern, same as quiz_questions.
--   rating:          config = { "min": 1, "max": 5 }
--   scale:           config = { "min": 1, "max": 10, "label_min": ..., "label_max": ... }
--   multiple_choice: options = [{ "id": "a", "text": "Option" }, ...]
--   text:            options and config = null
-- -----------------------------------------------------------------------------
create table if not exists feedback_questions (
  id             uuid primary key default gen_random_uuid(),
  form_id        uuid not null references feedback_forms(id) on delete cascade,
  question_text  text not null,
  question_type  text not null
                 check (question_type in ('rating', 'text', 'scale', 'multiple_choice')),
  options        jsonb,
  config         jsonb,
  is_required    boolean not null default true,
  order_index    integer not null,
  status         text not null default 'active'
                 check (status in ('active', 'archived')),
  archived_at    timestamptz,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- CLASSES                                                          [005]
-- An educator's named student group. Students join by code or invite.
-- -----------------------------------------------------------------------------
create table if not exists classes (
  id                    uuid primary key default gen_random_uuid(),
  educator_id           uuid not null references profiles(id) on delete restrict,
  name                  text not null,
  description           text,
  academic_year         text,                                   -- e.g. "2025-26"
  semester              text check (semester in ('odd', 'even', 'summer')),
  join_code             text unique not null,
  join_code_expires_at  timestamptz,                            -- null = never
  max_students          integer,                                -- null = no cap
  status                text not null default 'active'
                        check (status in ('active', 'completed', 'archived')),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- CLASS LABS                                                       [005]
-- Which labs a class carries, in what order, and when they unlock.
-- -----------------------------------------------------------------------------
create table if not exists class_labs (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references classes(id) on delete cascade,
  lab_id       uuid not null references labs(id) on delete cascade,
  order_index  integer not null default 0,
  unlock_at    timestamptz,          -- null = available immediately
  unique (class_id, lab_id)
);

-- -----------------------------------------------------------------------------
-- CLASS INVITES                                                    [005]
--   link       shareable URL token, good for max_uses joins
--   email      single email invite
--   csv_batch  bulk upload; creates invite_emails rows
--   manual     educator adds a student by email
-- -----------------------------------------------------------------------------
create table if not exists class_invites (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  created_by  uuid not null references profiles(id) on delete restrict,
  type        text not null check (type in ('link', 'email', 'csv_batch', 'manual')),
  token       text unique not null,
  expires_at  timestamptz,           -- null = never
  max_uses    integer,               -- null = unlimited
  use_count   integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- INVITE EMAILS                                                    [005]
-- For csv_batch and email invites. On registration with a matching email the
-- app flips status to 'accepted' and creates the enrollment.
-- -----------------------------------------------------------------------------
create table if not exists invite_emails (
  id           uuid primary key default gen_random_uuid(),
  invite_id    uuid not null references class_invites(id) on delete cascade,
  email        text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'expired')),
  student_id   uuid references profiles(id) on delete set null,
  created_at   timestamptz default now(),
  accepted_at  timestamptz,
  unique (invite_id, email)
);

-- -----------------------------------------------------------------------------
-- ENROLLMENTS                                                      [005]
-- Dropping is a soft delete (status='dropped'); progress is never destroyed.
-- -----------------------------------------------------------------------------
create table if not exists enrollments (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references classes(id) on delete cascade,
  student_id    uuid not null references profiles(id) on delete cascade,
  status        text not null default 'active'
                check (status in ('active', 'dropped', 'completed')),
  enrolled_via  text check (enrolled_via in ('code', 'invite_link', 'email_invite', 'manual')),
  enrolled_at   timestamptz default now(),
  dropped_at    timestamptz,
  unique (class_id, student_id)
);

-- -----------------------------------------------------------------------------
-- CLASS QUIZ SETTINGS                                              [006]
-- Per-class overrides. Null column = fall back to the quiz-level default.
-- -----------------------------------------------------------------------------
create table if not exists class_quiz_settings (
  id                  uuid primary key default gen_random_uuid(),
  class_id            uuid not null references classes(id) on delete cascade,
  quiz_id             uuid not null references quizzes(id) on delete cascade,
  passing_percentage  integer,       -- null = quizzes.default_passing_percentage
  max_attempts        integer,       -- null = quizzes.default_max_attempts
  show_score          boolean,       -- null = quizzes.default_show_score
  show_answers        text check (show_answers in (
                        'immediately', 'after_submission', 'after_due_date', 'never'
                      )),            -- null = quizzes.default_show_answers
  due_date            timestamptz,   -- null = no deadline
  unlock_at           timestamptz,   -- null = available immediately
  is_graded           boolean not null default true,
  unique (class_id, quiz_id)
);

-- -----------------------------------------------------------------------------
-- CLASS FEEDBACK SETTINGS                                          [006]
-- -----------------------------------------------------------------------------
create table if not exists class_feedback_settings (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  form_id     uuid not null references feedback_forms(id) on delete cascade,
  is_enabled  boolean,               -- null = use feedback_forms.is_enabled
  unique (class_id, form_id)
);

-- -----------------------------------------------------------------------------
-- QUIZ SUBMISSIONS                                                 [007]
-- One row per attempt, scoped per (student, quiz, class).
-- answers shape:
-- [{ question_id, question_text_snapshot, selected_option_id,
--    selected_option_text_snapshot, correct_answer_id, is_correct,
--    points_earned, explanation_snapshot }]
-- -----------------------------------------------------------------------------
create table if not exists quiz_submissions (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references profiles(id) on delete cascade,
  quiz_id             uuid not null references quizzes(id) on delete cascade,
  class_id            uuid not null references classes(id) on delete cascade,
  attempt_number      integer not null default 1,
  answers             jsonb not null,
  score               integer not null,
  max_score           integer not null,
  percentage          numeric(5,2) not null,
  passed              boolean not null,
  time_taken_seconds  integer,
  submitted_at        timestamptz default now(),
  unique (student_id, quiz_id, class_id, attempt_number)
);

-- -----------------------------------------------------------------------------
-- FEEDBACK RESPONSES                                               [007]
-- One submission per (student, experiment, class). No re-submission.
-- answers shape: [{ question_id, question_text_snapshot, answer }]
-- -----------------------------------------------------------------------------
create table if not exists feedback_responses (
  id             uuid primary key default gen_random_uuid(),
  form_id        uuid not null references feedback_forms(id) on delete cascade,
  student_id     uuid not null references profiles(id) on delete cascade,
  experiment_id  uuid not null references experiments(id) on delete cascade,
  class_id       uuid not null references classes(id) on delete cascade,
  answers        jsonb not null,
  submitted_at   timestamptz default now(),
  unique (student_id, experiment_id, class_id)
);

-- -----------------------------------------------------------------------------
-- STUDENT PROGRESS                                                 [007]
-- completed_section_ids holds experiment_sections.id values (not order_index)
-- so progress survives reordering.
-- -----------------------------------------------------------------------------
create table if not exists student_progress (
  id                     uuid primary key default gen_random_uuid(),
  student_id             uuid not null references profiles(id) on delete cascade,
  experiment_id          uuid not null references experiments(id) on delete cascade,
  class_id               uuid not null references classes(id) on delete cascade,
  completed_section_ids  uuid[] not null default '{}',
  last_section_id        uuid references experiment_sections(id) on delete set null,
  started_at             timestamptz default now(),
  last_accessed_at       timestamptz default now(),
  completed_at           timestamptz,
  total_time_seconds     integer not null default 0,
  unique (student_id, experiment_id, class_id)
);

-- -----------------------------------------------------------------------------
-- CIRCUITS                                                         [015]
-- Authored circuit documents for the native simulator.
-- role='starter'   what a student opens with
-- role='reference' the worked solution; must never reach a student
--
-- graph holds parts[] + wires[]. Nets are DERIVED on load, never stored: a
-- stored copy is a copy that can disagree with the document it came from.
-- -----------------------------------------------------------------------------
create table if not exists circuits (
  id                 uuid primary key default gen_random_uuid(),
  simulation_id      uuid not null references simulations(id) on delete cascade,
  role               text not null check (role in ('starter', 'reference')),
  version            integer not null default 1,
  board              text not null default 'arduino_uno'
                     check (board in ('arduino_uno', 'arduino_nano', 'rp2040')),
  interaction_level  text not null default 'free'
                     check (interaction_level in ('guided', 'assisted', 'free')),
  graph              jsonb not null,
  code               jsonb not null default '{"files":[]}'::jsonb,
  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (simulation_id, role, version)
);

-- -----------------------------------------------------------------------------
-- SIM ATTEMPTS                                                     [015]
-- A student's live working copy, one row per (student, simulation, class),
-- overwritten as they work. This is autosave, not history.
-- -----------------------------------------------------------------------------
create table if not exists sim_attempts (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references profiles(id) on delete cascade,
  simulation_id  uuid not null references simulations(id) on delete cascade,
  class_id       uuid not null references classes(id) on delete cascade,
  graph          jsonb not null,
  code           jsonb not null default '{"files":[]}'::jsonb,
  updated_at     timestamptz default now(),
  created_at     timestamptz default now(),
  unique (student_id, simulation_id, class_id)
);


-- =============================================================================
-- 3. INDEXES
-- Names match what Postgres auto-generated for the unnamed `create index on`
-- statements in 002/003/004/005/007, so this file and the live database agree.
-- Unique constraints already carry their own implicit indexes.
-- =============================================================================

-- [008] middleware looks up incomplete profiles by clerk id
create index if not exists idx_profiles_completed
  on profiles(clerk_user_id, profile_completed);

-- [009] admin approval queue
create index if not exists idx_profiles_approval
  on profiles(approval_status, role)
  where approval_status = 'pending';

create index if not exists experiments_lab_id_order_index_idx
  on experiments(lab_id, order_index);

create index if not exists experiment_sections_experiment_id_order_index_idx
  on experiment_sections(experiment_id, order_index);

create index if not exists quiz_questions_quiz_id_order_number_idx
  on quiz_questions(quiz_id, order_number);

create index if not exists feedback_questions_form_id_order_index_idx
  on feedback_questions(form_id, order_index);

create index if not exists class_labs_class_id_order_index_idx
  on class_labs(class_id, order_index);

-- [013] can_read_experiment_content joins class_labs on lab_id, which 005 never indexed
create index if not exists idx_class_labs_lab_id
  on class_labs(lab_id);

create index if not exists enrollments_student_id_status_idx
  on enrollments(student_id, status);

create index if not exists enrollments_class_id_idx
  on enrollments(class_id);

-- [013] covering index for the enrollment lookup inside can_read_experiment_content
create index if not exists idx_enrollments_student_class_status
  on enrollments(student_id, class_id, status);

create index if not exists quiz_submissions_student_id_class_id_idx
  on quiz_submissions(student_id, class_id);

create index if not exists quiz_submissions_quiz_id_class_id_idx
  on quiz_submissions(quiz_id, class_id);

create index if not exists feedback_responses_student_id_class_id_idx
  on feedback_responses(student_id, class_id);

create index if not exists feedback_responses_form_id_idx
  on feedback_responses(form_id);

create index if not exists student_progress_student_id_class_id_idx
  on student_progress(student_id, class_id);

create index if not exists idx_circuits_simulation
  on circuits(simulation_id, role);

create index if not exists idx_sim_attempts_student
  on sim_attempts(student_id, class_id);


-- =============================================================================
-- 4. FUNCTIONS
--
-- Every auth_* / can_read_* / is_* helper is SECURITY DEFINER with a pinned
-- search_path. SECURITY DEFINER is not optional: these are called FROM the RLS
-- policies on the very tables they query, and without it the policy re-enters
-- itself and Postgres raises "infinite recursion detected in policy". That was
-- the bug fixed by 010, then again by 012, then again by 013.
--
-- ############################################################################
-- # DO **NOT** REVOKE EXECUTE ON THESE FUNCTIONS.                            #
-- #                                                                          #
-- # The Supabase security advisor flags all nine as "SECURITY DEFINER        #
-- # function executable by anon/authenticated" and suggests revoking EXECUTE.#
-- # Doing so breaks every RLS policy that calls them:                        #
-- #                                                                          #
-- #   ERROR: 42501: permission denied for function can_read_experiment_content
-- #                                                                          #
-- # RLS policy expressions ARE evaluated against the invoking role's          #
-- # privileges, so the invoking role must retain EXECUTE. This was confirmed  #
-- # the hard way against the live database — an enrolled student went from 66 #
-- # readable sections to a hard error, and the grants had to be restored.     #
-- #                                                                          #
-- # Note the trap that hides this: `revoke execute ... from anon,             #
-- # authenticated` appears to succeed and changes nothing, because those roles#
-- # hold no direct grant — they inherit EXECUTE from PUBLIC. Only revoking    #
-- # from PUBLIC has any effect, and that is precisely what breaks RLS.        #
-- #                                                                          #
-- # The warning is acceptable. Each helper returns a boolean (or a scalar)    #
-- # about the *caller's own* access, derived from the caller's own JWT, so    #
-- # calling it directly reveals nothing the caller could not learn by         #
-- # querying the table.                                    [014, restated 018]#
-- ############################################################################
-- =============================================================================

-- -----------------------------------------------------------------------------
-- IDENTITY HELPERS                                            [001, 010, 018]
-- -----------------------------------------------------------------------------

-- profiles.id of the currently authenticated Clerk user.
create or replace function auth_profile_id()
returns uuid language sql stable security definer
set search_path = public
as $$
  select id from profiles
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$$;

-- true when the caller has is_admin = true.
create or replace function auth_is_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from profiles
     where clerk_user_id = (select auth.jwt()->>'sub')
     limit 1),
    false
  )
$$;

-- 'student' or 'educator'.
create or replace function auth_role()
returns text language sql stable security definer
set search_path = public
as $$
  select role from profiles
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$$;

-- [018] The caller's CURRENT approval_status. Used by the profiles self-update
-- policy to pin the column, so a student cannot self-approve.
create or replace function auth_approval_status()
returns text language sql stable security definer
set search_path = public
as $$
  select approval_status from profiles
  where clerk_user_id = (select auth.jwt()->>'sub')
  limit 1
$$;

-- -----------------------------------------------------------------------------
-- CLASS MEMBERSHIP HELPERS                                        [012]
-- These break the classes <-> enrollments policy cycle:
--   "classes: student read enrolled"      -> SELECT from enrollments
--   "enrollments: educator read own classes" -> SELECT from classes
-- -----------------------------------------------------------------------------

create or replace function is_enrolled_in_class(p_class_id uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from enrollments
    where class_id = p_class_id
      and student_id = auth_profile_id()
      and status = 'active'
  )
$$;

create or replace function is_educator_of_class(p_class_id uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from classes
    where id = p_class_id
      and educator_id = auth_profile_id()
  )
$$;

-- -----------------------------------------------------------------------------
-- CONTENT ACCESS HELPERS                                          [013]
-- Admins see everything. Students see experiments in labs assigned to a class
-- they are actively enrolled in. Educators see experiments in labs assigned to
-- a class they own (the gradebook reads sections and quizzes).
-- -----------------------------------------------------------------------------

create or replace function can_read_experiment_content(p_experiment_id uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select
    auth_is_admin()
    or exists (
      select 1
      from experiments e
      join class_labs cl on cl.lab_id = e.lab_id
      join enrollments en on en.class_id = cl.class_id
      where e.id = p_experiment_id
        and en.student_id = auth_profile_id()
        and en.status = 'active'
    )
    or exists (
      select 1
      from experiments e
      join class_labs cl on cl.lab_id = e.lab_id
      join classes c on c.id = cl.class_id
      where e.id = p_experiment_id
        and c.educator_id = auth_profile_id()
    )
$$;

-- quiz_questions only carries quiz_id, so hop through quizzes.
create or replace function can_read_quiz_content(p_quiz_id uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select can_read_experiment_content(
    (select experiment_id from quizzes where id = p_quiz_id)
  )
$$;

-- feedback_questions only carries form_id, so hop through feedback_forms.
create or replace function can_read_form_content(p_form_id uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  select can_read_experiment_content(
    (select experiment_id from feedback_forms where id = p_form_id)
  )
$$;

-- -----------------------------------------------------------------------------
-- TRIGGER FUNCTION                                            [001, 014]
-- search_path pinned per 014. Attached to 12 tables in section 8.
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================
alter table profiles                enable row level security;
alter table labs                    enable row level security;
alter table experiments             enable row level security;
alter table experiment_sections     enable row level security;
alter table simulations             enable row level security;
alter table quizzes                 enable row level security;
alter table quiz_questions          enable row level security;
alter table feedback_forms          enable row level security;
alter table feedback_questions      enable row level security;
alter table classes                 enable row level security;
alter table class_labs              enable row level security;
alter table class_invites           enable row level security;
alter table invite_emails           enable row level security;
alter table enrollments             enable row level security;
alter table class_quiz_settings     enable row level security;
alter table class_feedback_settings enable row level security;
alter table quiz_submissions        enable row level security;
alter table feedback_responses      enable row level security;
alter table student_progress        enable row level security;
alter table circuits                enable row level security;
alter table sim_attempts            enable row level security;


-- =============================================================================
-- 6. POLICIES
-- Each is dropped first so the file re-runs cleanly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PROFILES                                                    [001, 018]
-- -----------------------------------------------------------------------------
drop policy if exists "profiles: own read"       on profiles;
drop policy if exists "profiles: admin read all" on profiles;
drop policy if exists "profiles: own update"     on profiles;
drop policy if exists "profiles: admin update all" on profiles;
drop policy if exists "profiles: insert own"     on profiles;

create policy "profiles: own read"
  on profiles for select to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'));

create policy "profiles: admin read all"
  on profiles for select to authenticated
  using (auth_is_admin());

-- [018] PRIVILEGE ESCALATION FIX. The original with_check pinned only is_admin,
-- so a signed-in student could run
--   supabase.from('profiles').update({ role:'educator', approval_status:'approved' })
-- from devtools against their own row and walk straight past the educator gate.
-- role and approval_status are only ever set legitimately through the
-- SERVICE-ROLE client (lib/actions/profile.ts onboarding, lib/actions/admin.ts
-- approval), which bypasses RLS entirely — so pinning them here costs nothing.
-- Admins change roles through "profiles: admin update all" below.
create policy "profiles: own update"
  on profiles for update to authenticated
  using (clerk_user_id = (select auth.jwt()->>'sub'))
  with check (
    clerk_user_id = (select auth.jwt()->>'sub')
    and ((not is_admin) or auth_is_admin())
    and role = auth_role()
    and approval_status = auth_approval_status()
  );

create policy "profiles: admin update all"
  on profiles for update to authenticated
  using (auth_is_admin());

create policy "profiles: insert own"
  on profiles for insert to authenticated
  with check (clerk_user_id = (select auth.jwt()->>'sub'));

-- -----------------------------------------------------------------------------
-- LABS                                                             [002]
-- "public read published" is intentionally unrestricted-by-role: the /labs
-- catalogue page is public. 013 left it that way on purpose — no experiment
-- content lives in this table.
-- -----------------------------------------------------------------------------
drop policy if exists "labs: public read published"  on labs;
drop policy if exists "labs: admin read all"         on labs;
drop policy if exists "labs: educator read published" on labs;
drop policy if exists "labs: admin write"            on labs;

create policy "labs: public read published"
  on labs for select
  using (published = true);

create policy "labs: admin read all"
  on labs for select to authenticated
  using (auth_is_admin());

create policy "labs: educator read published"
  on labs for select to authenticated
  using (published = true and auth_role() = 'educator');

create policy "labs: admin write"
  on labs for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- EXPERIMENTS                                                      [002]
-- Also deliberately public — catalogue metadata only. See 013's header.
-- -----------------------------------------------------------------------------
drop policy if exists "experiments: read published" on experiments;
drop policy if exists "experiments: admin read all" on experiments;
drop policy if exists "experiments: admin write"    on experiments;

create policy "experiments: read published"
  on experiments for select
  using (published = true);

create policy "experiments: admin read all"
  on experiments for select to authenticated
  using (auth_is_admin());

create policy "experiments: admin write"
  on experiments for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- EXPERIMENT SECTIONS                                         [002, 013]
-- 002 had `using (status = 'active')` with enrollment enforced only in the app
-- layer, so the UI gate held but the REST API did not. 013 closed it.
-- -----------------------------------------------------------------------------
drop policy if exists "experiment_sections: read active"    on experiment_sections;
drop policy if exists "experiment_sections: admin read all" on experiment_sections;
drop policy if exists "experiment_sections: admin write"    on experiment_sections;

create policy "experiment_sections: read active"
  on experiment_sections for select to authenticated
  using (status = 'active' and can_read_experiment_content(experiment_id));

create policy "experiment_sections: admin read all"
  on experiment_sections for select to authenticated
  using (auth_is_admin());

create policy "experiment_sections: admin write"
  on experiment_sections for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- SIMULATIONS                                                 [002, 013]
-- -----------------------------------------------------------------------------
drop policy if exists "simulations: read"        on simulations;
drop policy if exists "simulations: admin write" on simulations;

create policy "simulations: read"
  on simulations for select to authenticated
  using (can_read_experiment_content(experiment_id));

create policy "simulations: admin write"
  on simulations for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- QUIZZES                                                     [003, 013]
-- -----------------------------------------------------------------------------
drop policy if exists "quizzes: read"        on quizzes;
drop policy if exists "quizzes: admin write" on quizzes;

create policy "quizzes: read"
  on quizzes for select to authenticated
  using (can_read_experiment_content(experiment_id));

create policy "quizzes: admin write"
  on quizzes for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- QUIZ QUESTIONS                                              [003, 013]
-- Row gate here; the COLUMN gate that actually hides the answer key is in
-- section 7. RLS filters rows, not columns — it cannot express that hole.
-- -----------------------------------------------------------------------------
drop policy if exists "quiz_questions: read active"    on quiz_questions;
drop policy if exists "quiz_questions: admin read all" on quiz_questions;
drop policy if exists "quiz_questions: admin write"    on quiz_questions;

create policy "quiz_questions: read active"
  on quiz_questions for select to authenticated
  using (status = 'active' and can_read_quiz_content(quiz_id));

create policy "quiz_questions: admin read all"
  on quiz_questions for select to authenticated
  using (auth_is_admin());

create policy "quiz_questions: admin write"
  on quiz_questions for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- FEEDBACK FORMS                                              [004, 013]
-- -----------------------------------------------------------------------------
drop policy if exists "feedback_forms: read"        on feedback_forms;
drop policy if exists "feedback_forms: admin write" on feedback_forms;

create policy "feedback_forms: read"
  on feedback_forms for select to authenticated
  using (can_read_experiment_content(experiment_id));

create policy "feedback_forms: admin write"
  on feedback_forms for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- FEEDBACK QUESTIONS                                          [004, 013]
-- -----------------------------------------------------------------------------
drop policy if exists "feedback_questions: read active"    on feedback_questions;
drop policy if exists "feedback_questions: admin read all" on feedback_questions;
drop policy if exists "feedback_questions: admin write"    on feedback_questions;

create policy "feedback_questions: read active"
  on feedback_questions for select to authenticated
  using (status = 'active' and can_read_form_content(form_id));

create policy "feedback_questions: admin read all"
  on feedback_questions for select to authenticated
  using (auth_is_admin());

create policy "feedback_questions: admin write"
  on feedback_questions for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- CLASSES                                                     [005, 012]
-- -----------------------------------------------------------------------------
drop policy if exists "classes: educator read own"    on classes;
drop policy if exists "classes: admin read all"       on classes;
drop policy if exists "classes: educator write own"   on classes;
drop policy if exists "classes: admin write all"      on classes;
drop policy if exists "classes: student read enrolled" on classes;

create policy "classes: educator read own"
  on classes for select to authenticated
  using (educator_id = auth_profile_id());

create policy "classes: admin read all"
  on classes for select to authenticated
  using (auth_is_admin());

create policy "classes: educator write own"
  on classes for all to authenticated
  using (educator_id = auth_profile_id() and auth_role() = 'educator')
  with check (educator_id = auth_profile_id() and auth_role() = 'educator');

create policy "classes: admin write all"
  on classes for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- [012] is_enrolled_in_class() instead of an inline EXISTS on enrollments,
-- which recursed back into this policy through "enrollments: educator read own
-- classes".
create policy "classes: student read enrolled"
  on classes for select to authenticated
  using (is_enrolled_in_class(id));

-- -----------------------------------------------------------------------------
-- CLASS LABS                                                  [005, 012]
-- -----------------------------------------------------------------------------
drop policy if exists "class_labs: educator read own"     on class_labs;
drop policy if exists "class_labs: educator read own classes" on class_labs;
drop policy if exists "class_labs: admin read all"        on class_labs;
drop policy if exists "class_labs: educator write own"    on class_labs;
drop policy if exists "class_labs: admin write all"       on class_labs;
drop policy if exists "class_labs: student read enrolled" on class_labs;

-- NOTE — REDUNDANT POLICY, KEPT FOR PARITY WITH THE LIVE DATABASE.
-- 012 meant to replace this with "educator read own classes" below, but its
-- DROP named "class_labs: educator read own classes" (a policy that did not
-- exist yet), so the 005 original survived on the live DB and both are present.
-- They grant identically: SELECT on class_labs rows whose class the caller
-- teaches. Harmless, and not a recursion risk — no `classes` policy reads
-- class_labs. Reproduced here so a fresh instance matches production exactly.
-- If it is ever cleaned up, do it as a new numbered migration AND remove it
-- here in the same change.
create policy "class_labs: educator read own"
  on class_labs for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_labs.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_labs: educator read own classes"
  on class_labs for select to authenticated
  using (is_educator_of_class(class_id));

create policy "class_labs: admin read all"
  on class_labs for select to authenticated
  using (auth_is_admin());

create policy "class_labs: educator write own"
  on class_labs for all to authenticated
  using (is_educator_of_class(class_id))
  with check (is_educator_of_class(class_id));

create policy "class_labs: admin write all"
  on class_labs for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create policy "class_labs: student read enrolled"
  on class_labs for select to authenticated
  using (is_enrolled_in_class(class_id));

-- -----------------------------------------------------------------------------
-- CLASS INVITES                                               [005, 012]
-- -----------------------------------------------------------------------------
drop policy if exists "class_invites: educator read own"  on class_invites;
drop policy if exists "class_invites: admin read all"     on class_invites;
drop policy if exists "class_invites: educator write own" on class_invites;
drop policy if exists "class_invites: admin write all"    on class_invites;

create policy "class_invites: educator read own"
  on class_invites for select to authenticated
  using (is_educator_of_class(class_id));

create policy "class_invites: admin read all"
  on class_invites for select to authenticated
  using (auth_is_admin());

create policy "class_invites: educator write own"
  on class_invites for all to authenticated
  using (is_educator_of_class(class_id))
  with check (is_educator_of_class(class_id));

create policy "class_invites: admin write all"
  on class_invites for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- INVITE EMAILS                                                    [005]
-- -----------------------------------------------------------------------------
drop policy if exists "invite_emails: educator read own"  on invite_emails;
drop policy if exists "invite_emails: admin read all"     on invite_emails;
drop policy if exists "invite_emails: educator write own" on invite_emails;
drop policy if exists "invite_emails: admin write all"    on invite_emails;

create policy "invite_emails: educator read own"
  on invite_emails for select to authenticated
  using (
    exists (
      select 1 from class_invites
      join classes on classes.id = class_invites.class_id
      where class_invites.id = invite_emails.invite_id
        and classes.educator_id = auth_profile_id()
    )
  );

create policy "invite_emails: admin read all"
  on invite_emails for select to authenticated
  using (auth_is_admin());

create policy "invite_emails: educator write own"
  on invite_emails for all to authenticated
  using (
    exists (
      select 1 from class_invites
      join classes on classes.id = class_invites.class_id
      where class_invites.id = invite_emails.invite_id
        and classes.educator_id = auth_profile_id()
    )
  )
  with check (
    exists (
      select 1 from class_invites
      join classes on classes.id = class_invites.class_id
      where class_invites.id = invite_emails.invite_id
        and classes.educator_id = auth_profile_id()
    )
  );

create policy "invite_emails: admin write all"
  on invite_emails for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- ENROLLMENTS                                            [005, 012, 019]
--
-- [019] THERE IS DELIBERATELY NO "enrollments: student insert own" POLICY.
-- It used to exist with `with check (student_id = auth_profile_id() and
-- auth_role() = 'student')`, which let a student insert their own enrollment row
-- straight from the browser client. Every real gate — join code, live invite,
-- capacity — lives in lib/actions/enrollment.ts, and a direct insert skips all
-- of it; with a leaked class_id UUID a student could join any class and unlock
-- its gated content. Removing it breaks no legitimate path: join-code enrollment
-- uses the service-role client (bypasses RLS), educator manual enrollment is
-- covered by "educator write own classes", admin writes by "admin write all".
-- DO NOT RE-ADD IT.
-- -----------------------------------------------------------------------------
drop policy if exists "enrollments: student read own"          on enrollments;
drop policy if exists "enrollments: educator read own classes" on enrollments;
drop policy if exists "enrollments: admin read all"            on enrollments;
drop policy if exists "enrollments: student insert own"        on enrollments;
drop policy if exists "enrollments: student drop own"          on enrollments;
drop policy if exists "enrollments: educator write own classes" on enrollments;
drop policy if exists "enrollments: admin write all"           on enrollments;

create policy "enrollments: student read own"
  on enrollments for select to authenticated
  using (student_id = auth_profile_id());

create policy "enrollments: educator read own classes"
  on enrollments for select to authenticated
  using (is_educator_of_class(class_id));

create policy "enrollments: admin read all"
  on enrollments for select to authenticated
  using (auth_is_admin());

-- Students may still drop themselves, and only to 'dropped'.
create policy "enrollments: student drop own"
  on enrollments for update to authenticated
  using (student_id = auth_profile_id())
  with check (student_id = auth_profile_id() and status = 'dropped');

create policy "enrollments: educator write own classes"
  on enrollments for all to authenticated
  using (is_educator_of_class(class_id))
  with check (is_educator_of_class(class_id));

create policy "enrollments: admin write all"
  on enrollments for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- CLASS QUIZ SETTINGS                                         [006, 012]
-- -----------------------------------------------------------------------------
drop policy if exists "class_quiz_settings: educator read own"     on class_quiz_settings;
drop policy if exists "class_quiz_settings: student read enrolled" on class_quiz_settings;
drop policy if exists "class_quiz_settings: admin read all"        on class_quiz_settings;
drop policy if exists "class_quiz_settings: educator write own"    on class_quiz_settings;
drop policy if exists "class_quiz_settings: admin write all"       on class_quiz_settings;

create policy "class_quiz_settings: educator read own"
  on class_quiz_settings for select to authenticated
  using (is_educator_of_class(class_id));

create policy "class_quiz_settings: student read enrolled"
  on class_quiz_settings for select to authenticated
  using (is_enrolled_in_class(class_id));

create policy "class_quiz_settings: admin read all"
  on class_quiz_settings for select to authenticated
  using (auth_is_admin());

create policy "class_quiz_settings: educator write own"
  on class_quiz_settings for all to authenticated
  using (is_educator_of_class(class_id))
  with check (is_educator_of_class(class_id));

create policy "class_quiz_settings: admin write all"
  on class_quiz_settings for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- CLASS FEEDBACK SETTINGS                                     [006, 012]
-- -----------------------------------------------------------------------------
drop policy if exists "class_feedback_settings: educator read own"     on class_feedback_settings;
drop policy if exists "class_feedback_settings: student read enrolled" on class_feedback_settings;
drop policy if exists "class_feedback_settings: admin read all"        on class_feedback_settings;
drop policy if exists "class_feedback_settings: educator write own"    on class_feedback_settings;
drop policy if exists "class_feedback_settings: admin write all"       on class_feedback_settings;

create policy "class_feedback_settings: educator read own"
  on class_feedback_settings for select to authenticated
  using (is_educator_of_class(class_id));

create policy "class_feedback_settings: student read enrolled"
  on class_feedback_settings for select to authenticated
  using (is_enrolled_in_class(class_id));

create policy "class_feedback_settings: admin read all"
  on class_feedback_settings for select to authenticated
  using (auth_is_admin());

create policy "class_feedback_settings: educator write own"
  on class_feedback_settings for all to authenticated
  using (is_educator_of_class(class_id))
  with check (is_educator_of_class(class_id));

create policy "class_feedback_settings: admin write all"
  on class_feedback_settings for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- QUIZ SUBMISSIONS                                            [007, 012]
-- -----------------------------------------------------------------------------
drop policy if exists "quiz_submissions: student read own"          on quiz_submissions;
drop policy if exists "quiz_submissions: educator read own classes" on quiz_submissions;
drop policy if exists "quiz_submissions: admin read all"            on quiz_submissions;
drop policy if exists "quiz_submissions: student insert own"        on quiz_submissions;

create policy "quiz_submissions: student read own"
  on quiz_submissions for select to authenticated
  using (student_id = auth_profile_id());

create policy "quiz_submissions: educator read own classes"
  on quiz_submissions for select to authenticated
  using (is_educator_of_class(class_id));

create policy "quiz_submissions: admin read all"
  on quiz_submissions for select to authenticated
  using (auth_is_admin());

create policy "quiz_submissions: student insert own"
  on quiz_submissions for insert to authenticated
  with check (student_id = auth_profile_id() and auth_role() = 'student');

-- -----------------------------------------------------------------------------
-- FEEDBACK RESPONSES                                          [007, 012]
-- -----------------------------------------------------------------------------
drop policy if exists "feedback_responses: student read own"          on feedback_responses;
drop policy if exists "feedback_responses: educator read own classes" on feedback_responses;
drop policy if exists "feedback_responses: admin read all"            on feedback_responses;
drop policy if exists "feedback_responses: student insert own"        on feedback_responses;

create policy "feedback_responses: student read own"
  on feedback_responses for select to authenticated
  using (student_id = auth_profile_id());

create policy "feedback_responses: educator read own classes"
  on feedback_responses for select to authenticated
  using (is_educator_of_class(class_id));

create policy "feedback_responses: admin read all"
  on feedback_responses for select to authenticated
  using (auth_is_admin());

create policy "feedback_responses: student insert own"
  on feedback_responses for insert to authenticated
  with check (student_id = auth_profile_id() and auth_role() = 'student');

-- -----------------------------------------------------------------------------
-- STUDENT PROGRESS                                            [007, 012]
-- -----------------------------------------------------------------------------
drop policy if exists "student_progress: student read own"          on student_progress;
drop policy if exists "student_progress: student write own"         on student_progress;
drop policy if exists "student_progress: educator read own classes" on student_progress;
drop policy if exists "student_progress: admin read all"            on student_progress;

create policy "student_progress: student read own"
  on student_progress for select to authenticated
  using (student_id = auth_profile_id());

create policy "student_progress: student write own"
  on student_progress for all to authenticated
  using (student_id = auth_profile_id())
  with check (student_id = auth_profile_id() and auth_role() = 'student');

create policy "student_progress: educator read own classes"
  on student_progress for select to authenticated
  using (is_educator_of_class(class_id));

create policy "student_progress: admin read all"
  on student_progress for select to authenticated
  using (auth_is_admin());

-- -----------------------------------------------------------------------------
-- CIRCUITS                                                         [015]
-- role='reference' is the answer key: admins and the owning educator only.
-- -----------------------------------------------------------------------------
drop policy if exists "circuits: read starter"            on circuits;
drop policy if exists "circuits: educator read reference" on circuits;
drop policy if exists "circuits: admin write"             on circuits;

create policy "circuits: read starter"
  on circuits for select to authenticated
  using (
    role = 'starter'
    and can_read_experiment_content(
      (select experiment_id from simulations where simulations.id = circuits.simulation_id)
    )
  );

create policy "circuits: educator read reference"
  on circuits for select to authenticated
  using (
    auth_is_admin()
    or exists (
      select 1
      from simulations s
      join experiments e on e.id = s.experiment_id
      join class_labs cl on cl.lab_id = e.lab_id
      join classes c on c.id = cl.class_id
      where s.id = circuits.simulation_id
        and c.educator_id = auth_profile_id()
    )
  );

create policy "circuits: admin write"
  on circuits for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- SIM ATTEMPTS                                                     [015]
-- Mirrors student_progress exactly.
-- -----------------------------------------------------------------------------
drop policy if exists "sim_attempts: student read own"          on sim_attempts;
drop policy if exists "sim_attempts: student write own"         on sim_attempts;
drop policy if exists "sim_attempts: educator read own classes" on sim_attempts;
drop policy if exists "sim_attempts: admin read all"            on sim_attempts;

create policy "sim_attempts: student read own"
  on sim_attempts for select to authenticated
  using (student_id = auth_profile_id());

create policy "sim_attempts: student write own"
  on sim_attempts for all to authenticated
  using (student_id = auth_profile_id())
  with check (student_id = auth_profile_id() and auth_role() = 'student');

create policy "sim_attempts: educator read own classes"
  on sim_attempts for select to authenticated
  using (is_educator_of_class(class_id));

create policy "sim_attempts: admin read all"
  on sim_attempts for select to authenticated
  using (auth_is_admin());


-- =============================================================================
-- 7. GRANTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BASELINE
-- On a stock Supabase project these are already in force via
--   alter default privileges in schema public
--     grant all on tables to postgres, anon, authenticated, service_role;
-- so the two statements below are no-ops there. They are stated explicitly so
-- this file also produces a working database when run by a role that does not
-- inherit those defaults (plain psql against a self-hosted instance).
-- They MUST come before the quiz_questions lockdown, or they would undo it.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- COLUMN-LEVEL LOCKDOWN ON quiz_questions                          [013]
--
-- THE ANSWER LEAK. "quiz_questions: read active" granted SELECT on every column
-- to every authenticated user — including correct_answer and explanation. Any
-- signed-in student could read the answer key straight from the anon-key client
-- before submitting. RLS cannot express this: it filters rows, not columns.
--
-- Consequence: the `authenticated` role can no longer read those two columns AT
-- ALL, admins included. Every server-side reader of correct_answer/explanation
-- must use the service-role client (lib/supabase/admin.ts).
--
-- INSERT/UPDATE are untouched, so the admin write policy still works.
-- `anon` is left with no SELECT on this table whatsoever.
-- -----------------------------------------------------------------------------
revoke select on quiz_questions from authenticated, anon;

grant select (
  id,
  quiz_id,
  question_text,
  question_type,
  options,
  points,
  order_number,
  status,
  archived_at,
  superseded_by,
  created_at,
  updated_at
) on quiz_questions to authenticated;


-- =============================================================================
-- 8. TRIGGERS
-- set_updated_at on every table that has an updated_at column (12 of them).
-- class_labs / class_invites / invite_emails / enrollments / the settings and
-- activity tables have no updated_at and get no trigger.
-- =============================================================================
drop trigger if exists set_updated_at on profiles;
create trigger set_updated_at before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on labs;
create trigger set_updated_at before update on labs
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on experiments;
create trigger set_updated_at before update on experiments
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on experiment_sections;
create trigger set_updated_at before update on experiment_sections
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on simulations;
create trigger set_updated_at before update on simulations
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on quizzes;
create trigger set_updated_at before update on quizzes
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on quiz_questions;
create trigger set_updated_at before update on quiz_questions
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on feedback_forms;
create trigger set_updated_at before update on feedback_forms
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on feedback_questions;
create trigger set_updated_at before update on feedback_questions
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on classes;
create trigger set_updated_at before update on classes
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on circuits;
create trigger set_updated_at before update on circuits
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at on sim_attempts;
create trigger set_updated_at before update on sim_attempts
  for each row execute function set_updated_at();


-- =============================================================================
-- END. Next steps for a brand-new instance:
--   1. seeds/002_labs.sql, seeds/003_experiments.sql
--   2. migrations/016, 017, 020   (content backfill — data only)
--   3. sign up in the app, then follow seeds/001_admin_profile.sql to promote
--      your account to admin
-- =============================================================================
