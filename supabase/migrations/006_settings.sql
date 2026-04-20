-- =============================================================================
-- 006_settings.sql
-- Per-class override settings for quizzes and feedback forms.
-- Educators set these per class. Null columns mean "use the platform default".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CLASS QUIZ SETTINGS
-- Educator overrides for a specific quiz in a specific class.
-- Any column left null falls back to the quiz-level default.
-- -----------------------------------------------------------------------------
create table class_quiz_settings (
  id                    uuid primary key default gen_random_uuid(),
  class_id              uuid not null references classes(id) on delete cascade,
  quiz_id               uuid not null references quizzes(id) on delete cascade,
  -- null = use quizzes.default_passing_percentage
  passing_percentage    integer,
  -- null = use quizzes.default_max_attempts
  max_attempts          integer,
  -- null = use quizzes.default_show_score
  show_score            boolean,
  -- null = use quizzes.default_show_answers
  show_answers          text check (show_answers in (
                          'immediately', 'after_submission', 'after_due_date', 'never'
                        )),
  due_date              timestamptz,  -- null = no deadline
  unlock_at             timestamptz,  -- null = available immediately
  is_graded             boolean not null default true,
  unique (class_id, quiz_id)
);

alter table class_quiz_settings enable row level security;

create policy "class_quiz_settings: educator read own"
  on class_quiz_settings for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_quiz_settings.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_quiz_settings: student read enrolled"
  on class_quiz_settings for select to authenticated
  using (
    exists (select 1 from enrollments
            where enrollments.class_id = class_quiz_settings.class_id
              and enrollments.student_id = auth_profile_id()
              and enrollments.status = 'active')
  );

create policy "class_quiz_settings: admin read all"
  on class_quiz_settings for select to authenticated
  using (auth_is_admin());

create policy "class_quiz_settings: educator write own"
  on class_quiz_settings for all to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_quiz_settings.class_id
              and classes.educator_id = auth_profile_id())
  )
  with check (
    exists (select 1 from classes
            where classes.id = class_quiz_settings.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_quiz_settings: admin write all"
  on class_quiz_settings for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());

-- -----------------------------------------------------------------------------
-- CLASS FEEDBACK SETTINGS
-- Educator can toggle feedback form visibility per class.
-- is_enabled = null means use feedback_forms.is_enabled (the admin default).
-- -----------------------------------------------------------------------------
create table class_feedback_settings (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references classes(id) on delete cascade,
  form_id      uuid not null references feedback_forms(id) on delete cascade,
  is_enabled   boolean,  -- null = use feedback_forms.is_enabled
  unique (class_id, form_id)
);

alter table class_feedback_settings enable row level security;

create policy "class_feedback_settings: educator read own"
  on class_feedback_settings for select to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_feedback_settings.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_feedback_settings: student read enrolled"
  on class_feedback_settings for select to authenticated
  using (
    exists (select 1 from enrollments
            where enrollments.class_id = class_feedback_settings.class_id
              and enrollments.student_id = auth_profile_id()
              and enrollments.status = 'active')
  );

create policy "class_feedback_settings: admin read all"
  on class_feedback_settings for select to authenticated
  using (auth_is_admin());

create policy "class_feedback_settings: educator write own"
  on class_feedback_settings for all to authenticated
  using (
    exists (select 1 from classes
            where classes.id = class_feedback_settings.class_id
              and classes.educator_id = auth_profile_id())
  )
  with check (
    exists (select 1 from classes
            where classes.id = class_feedback_settings.class_id
              and classes.educator_id = auth_profile_id())
  );

create policy "class_feedback_settings: admin write all"
  on class_feedback_settings for all to authenticated
  using (auth_is_admin())
  with check (auth_is_admin());
