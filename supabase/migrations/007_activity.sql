-- =============================================================================
-- 007_activity.sql
-- Student activity tables: quiz_submissions, feedback_responses, student_progress
-- All scoped per (student, class) so the same student in two classes has
-- fully independent records in each.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- QUIZ SUBMISSIONS
-- One row per attempt. attempt_number increments per (student, quiz, class).
-- answers stores a snapshot of question text + options at submission time so
-- that archived/edited questions still render correctly in historical results.
--
-- answers shape (array of objects):
-- [{
--   question_id:                   uuid,
--   question_text_snapshot:        text,
--   selected_option_id:            text,
--   selected_option_text_snapshot: text,
--   correct_answer_id:             text,
--   is_correct:                    boolean,
--   points_earned:                 integer,
--   explanation_snapshot:          text | null
-- }]
-- -----------------------------------------------------------------------------
create table quiz_submissions (
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

create index on quiz_submissions(student_id, class_id);
create index on quiz_submissions(quiz_id, class_id);

alter table quiz_submissions enable row level security;

-- Students see their own submissions
create policy "quiz_submissions: student read own"
  on quiz_submissions for select to authenticated
  using (student_id = auth_profile_id());

-- Educators see submissions from their classes
create policy "quiz_submissions: educator read own classes"
  on quiz_submissions for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = quiz_submissions.class_id
              and classes.educator_id = auth_profile_id())
  );

-- Admins read all
create policy "quiz_submissions: admin read all"
  on quiz_submissions for select to authenticated
  using (auth_is_admin());

-- Students submit their own (application validates attempt limits before insert)
create policy "quiz_submissions: student insert own"
  on quiz_submissions for insert to authenticated
  with check (student_id = auth_profile_id() and auth_role() = 'student');

-- -----------------------------------------------------------------------------
-- FEEDBACK RESPONSES
-- One submission per (student, experiment, class). Students cannot re-submit.
-- answers stores a snapshot of question text at submission time.
--
-- answers shape (array of objects):
-- [{
--   question_id:            uuid,
--   question_text_snapshot: text,
--   answer:                 string | number  (text response or option id)
-- }]
-- -----------------------------------------------------------------------------
create table feedback_responses (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references feedback_forms(id) on delete cascade,
  student_id      uuid not null references profiles(id) on delete cascade,
  experiment_id   uuid not null references experiments(id) on delete cascade,
  class_id        uuid not null references classes(id) on delete cascade,
  answers         jsonb not null,
  submitted_at    timestamptz default now(),
  unique (student_id, experiment_id, class_id)
);

create index on feedback_responses(student_id, class_id);
create index on feedback_responses(form_id);

alter table feedback_responses enable row level security;

-- Students see their own responses
create policy "feedback_responses: student read own"
  on feedback_responses for select to authenticated
  using (student_id = auth_profile_id());

-- Educators see responses from their classes
create policy "feedback_responses: educator read own classes"
  on feedback_responses for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = feedback_responses.class_id
              and classes.educator_id = auth_profile_id())
  );

-- Admins read all
create policy "feedback_responses: admin read all"
  on feedback_responses for select to authenticated
  using (auth_is_admin());

-- Students submit their own
create policy "feedback_responses: student insert own"
  on feedback_responses for insert to authenticated
  with check (student_id = auth_profile_id() and auth_role() = 'student');

-- -----------------------------------------------------------------------------
-- STUDENT PROGRESS
-- Tracks which sections a student has completed within an experiment,
-- scoped to a specific class. One row per (student, experiment, class).
-- completed_section_ids holds experiment_sections.id values (not order_index)
-- so progress survives section reordering.
-- -----------------------------------------------------------------------------
create table student_progress (
  id                    uuid primary key default gen_random_uuid(),
  student_id            uuid not null references profiles(id) on delete cascade,
  experiment_id         uuid not null references experiments(id) on delete cascade,
  class_id              uuid not null references classes(id) on delete cascade,
  completed_section_ids uuid[] not null default '{}',
  last_section_id       uuid references experiment_sections(id) on delete set null,
  started_at            timestamptz default now(),
  last_accessed_at      timestamptz default now(),
  completed_at          timestamptz,
  total_time_seconds    integer not null default 0,
  unique (student_id, experiment_id, class_id)
);

create index on student_progress(student_id, class_id);

alter table student_progress enable row level security;

-- Students read and write their own progress
create policy "student_progress: student read own"
  on student_progress for select to authenticated
  using (student_id = auth_profile_id());

create policy "student_progress: student write own"
  on student_progress for all to authenticated
  using (student_id = auth_profile_id())
  with check (student_id = auth_profile_id() and auth_role() = 'student');

-- Educators see progress of students in their classes
create policy "student_progress: educator read own classes"
  on student_progress for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = student_progress.class_id
              and classes.educator_id = auth_profile_id())
  );

-- Admins read all
create policy "student_progress: admin read all"
  on student_progress for select to authenticated
  using (auth_is_admin());
