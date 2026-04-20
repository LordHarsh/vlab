-- =============================================================================
-- 004_feedback.sql
-- Feedback tables: feedback_forms, feedback_questions
-- Admin configures forms per experiment. Educator can override visibility per class.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FEEDBACK FORMS
-- One form per experiment. Admin controls the questions and master on/off switch.
-- Educator can override is_enabled per class via class_feedback_settings.
-- -----------------------------------------------------------------------------
create table feedback_forms (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null unique references experiments(id) on delete cascade,
  title           text not null default 'Experiment Feedback',
  description     text,
  is_enabled      boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table feedback_forms enable row level security;

-- Publicly readable
create policy "feedback_forms: read"
  on feedback_forms for select
  using (true);

-- Only admins write
create policy "feedback_forms: admin write"
  on feedback_forms for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on feedback_forms
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- FEEDBACK QUESTIONS
-- Archive pattern same as quiz_questions: edit = archive old + insert new.
--
-- question_type shapes:
--   rating:          config = { "min": 1, "max": 5 }
--   scale:           config = { "min": 1, "max": 10, "label_min": "Poor", "label_max": "Excellent" }
--   multiple_choice: options = [{ "id": "a", "text": "Option" }, ...]
--   text:            options and config = null
-- -----------------------------------------------------------------------------
create table feedback_questions (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references feedback_forms(id) on delete cascade,
  question_text   text not null,
  question_type   text not null
                  check (question_type in ('rating', 'text', 'scale', 'multiple_choice')),
  options         jsonb,
  config          jsonb,
  is_required     boolean not null default true,
  order_index     integer not null,
  status          text not null default 'active'
                  check (status in ('active', 'archived')),
  archived_at     timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index on feedback_questions(form_id, order_index);

alter table feedback_questions enable row level security;

-- Students and educators see only active questions
create policy "feedback_questions: read active"
  on feedback_questions for select to authenticated
  using (status = 'active');

-- Admins see all including archived
create policy "feedback_questions: admin read all"
  on feedback_questions for select to authenticated
  using (auth_is_admin());

-- Only admins write
create policy "feedback_questions: admin write"
  on feedback_questions for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on feedback_questions
  for each row execute function set_updated_at();
