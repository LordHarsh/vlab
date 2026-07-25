-- =============================================================================
-- 013_gate_content_on_enrollment.sql
--
-- Two holes closed here.
--
-- 1. ANSWER LEAK
--    "quiz_questions: read active" granted SELECT on every column to every
--    authenticated user — including correct_answer and explanation. Any signed-in
--    student could read the answer key straight from the anon-key client before
--    submitting. RLS cannot express this: it filters rows, not columns.
--    Fixed with column-level GRANTs. Consequence: the `authenticated` role can no
--    longer read those two columns AT ALL, admins included. Every server-side
--    reader of correct_answer/explanation must use the service-role client
--    (lib/supabase/admin.ts).
--
-- 2. UNGATED CONTENT
--    experiment_sections / simulations / quizzes / feedback_forms /
--    feedback_questions were readable by anyone (`using (true)` or status-only).
--    Enrollment was enforced only in the app layer, so the UI gate held but the
--    REST API did not. Now gated on an active enrollment in a class that has the
--    parent lab assigned.
--
-- DELIBERATELY LEFT PUBLIC: `labs` and `experiments`. These are catalogue
-- metadata (title, description, difficulty, duration) and the public /labs page
-- counts published experiments per lab. No experiment *content* lives there.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ACCESS HELPERS
-- SECURITY DEFINER so the enrollment/class lookup itself bypasses RLS — without
-- it these re-enter the policies that call them and recurse (same failure mode
-- as 010 and 012).
-- -----------------------------------------------------------------------------

-- Admins see everything. Students see experiments in labs assigned to a class
-- they are actively enrolled in. Educators see experiments in labs assigned to
-- a class they own (needed by the gradebook, which reads sections and quizzes).
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

-- The helpers join class_labs on lab_id; 005 only indexed (class_id, order_index).
create index if not exists idx_class_labs_lab_id on class_labs(lab_id);
create index if not exists idx_enrollments_student_class_status
  on enrollments(student_id, class_id, status);

-- -----------------------------------------------------------------------------
-- COLUMN-LEVEL LOCKDOWN ON quiz_questions
-- RLS still governs which ROWS are visible; these grants govern which COLUMNS.
-- correct_answer and explanation are omitted from the grant list on purpose.
-- INSERT/UPDATE are untouched, so the admin write policy still works.
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

-- -----------------------------------------------------------------------------
-- EXPERIMENT SECTIONS
-- -----------------------------------------------------------------------------
drop policy if exists "experiment_sections: read active" on experiment_sections;

create policy "experiment_sections: read active"
  on experiment_sections for select to authenticated
  using (status = 'active' and can_read_experiment_content(experiment_id));

-- -----------------------------------------------------------------------------
-- SIMULATIONS
-- -----------------------------------------------------------------------------
drop policy if exists "simulations: read" on simulations;

create policy "simulations: read"
  on simulations for select to authenticated
  using (can_read_experiment_content(experiment_id));

-- -----------------------------------------------------------------------------
-- QUIZZES
-- -----------------------------------------------------------------------------
drop policy if exists "quizzes: read" on quizzes;

create policy "quizzes: read"
  on quizzes for select to authenticated
  using (can_read_experiment_content(experiment_id));

-- -----------------------------------------------------------------------------
-- QUIZ QUESTIONS
-- Row gate added on top of the column gate above.
-- -----------------------------------------------------------------------------
drop policy if exists "quiz_questions: read active" on quiz_questions;

create policy "quiz_questions: read active"
  on quiz_questions for select to authenticated
  using (status = 'active' and can_read_quiz_content(quiz_id));

-- -----------------------------------------------------------------------------
-- FEEDBACK FORMS
-- -----------------------------------------------------------------------------
drop policy if exists "feedback_forms: read" on feedback_forms;

create policy "feedback_forms: read"
  on feedback_forms for select to authenticated
  using (can_read_experiment_content(experiment_id));

-- -----------------------------------------------------------------------------
-- FEEDBACK QUESTIONS
-- -----------------------------------------------------------------------------
drop policy if exists "feedback_questions: read active" on feedback_questions;

create policy "feedback_questions: read active"
  on feedback_questions for select to authenticated
  using (status = 'active' and can_read_form_content(form_id));
