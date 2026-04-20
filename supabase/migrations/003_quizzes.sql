-- =============================================================================
-- 003_quizzes.sql
-- Quiz tables: quizzes, quiz_questions
-- Admin creates/edits. Questions use archive pattern (never hard-deleted).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- QUIZZES
-- One quiz per experiment per type (pretest / posttest / practice).
-- Default settings can be overridden per class in class_quiz_settings.
-- -----------------------------------------------------------------------------
create table quizzes (
  id                          uuid primary key default gen_random_uuid(),
  experiment_id               uuid not null references experiments(id) on delete cascade,
  type                        text not null check (type in ('pretest', 'posttest', 'practice')),
  title                       text not null,
  description                 text,
  time_limit_minutes          integer,                 -- null = no limit
  default_max_attempts        integer default 1,       -- null = unlimited
  default_passing_percentage  integer default 70,
  default_show_score          boolean default true,
  -- When to reveal correct answers to student:
  default_show_answers        text not null default 'after_submission'
                              check (default_show_answers in (
                                'immediately', 'after_submission', 'after_due_date', 'never'
                              )),
  randomize_questions         boolean default false,
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);

alter table quizzes enable row level security;

-- Publicly readable (content is locked by enrollment at app layer)
create policy "quizzes: read"
  on quizzes for select
  using (true);

-- Only admins write
create policy "quizzes: admin write"
  on quizzes for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on quizzes
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- QUIZ QUESTIONS
-- Archive pattern: when admin edits a question the old row is archived
-- (status='archived', superseded_by=<new_id>) and a new row is created.
-- quiz_submissions store a text snapshot at submission time, so archived
-- questions still render correctly in past results.
--
-- options shape:  [{ "id": "a", "text": "Option text" }, ...]
-- correct_answer: the option id string (e.g. "a")
-- -----------------------------------------------------------------------------
create table quiz_questions (
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
  -- Points to the replacement question when this one was archived due to an edit
  superseded_by   uuid references quiz_questions(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index on quiz_questions(quiz_id, order_number);

alter table quiz_questions enable row level security;

-- Students and educators see only active questions
create policy "quiz_questions: read active"
  on quiz_questions for select to authenticated
  using (status = 'active');

-- Admins see all including archived (for audit / history)
create policy "quiz_questions: admin read all"
  on quiz_questions for select to authenticated
  using (auth_is_admin());

-- Only admins write
create policy "quiz_questions: admin write"
  on quiz_questions for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

create trigger set_updated_at
  before update on quiz_questions
  for each row execute function set_updated_at();
