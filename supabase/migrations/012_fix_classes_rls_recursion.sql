-- =============================================================================
-- 012_fix_classes_rls_recursion.sql
-- Fix infinite recursion between classes ↔ enrollments RLS policies.
--
-- The cycle:
--   "classes: student read enrolled" → SELECT from enrollments
--   "enrollments: educator read own classes" → SELECT from classes
--   → infinite loop
--
-- Fix: two SECURITY DEFINER helper functions that bypass RLS on the
-- cross-table lookup, breaking the cycle.
-- =============================================================================

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

-- CLASSES
drop policy if exists "classes: student read enrolled" on classes;
drop policy if exists "classes: educator read own" on classes;
drop policy if exists "classes: educator write own" on classes;
create policy "classes: student read enrolled" on classes for select to authenticated using (is_enrolled_in_class(id));
create policy "classes: educator read own" on classes for select to authenticated using (educator_id = auth_profile_id());
create policy "classes: educator write own" on classes for all to authenticated using (educator_id = auth_profile_id() and auth_role() = 'educator') with check (educator_id = auth_profile_id() and auth_role() = 'educator');

-- ENROLLMENTS
drop policy if exists "enrollments: educator read own classes" on enrollments;
drop policy if exists "enrollments: educator write own classes" on enrollments;
create policy "enrollments: educator read own classes" on enrollments for select to authenticated using (is_educator_of_class(class_id));
create policy "enrollments: educator write own classes" on enrollments for all to authenticated using (is_educator_of_class(class_id)) with check (is_educator_of_class(class_id));

-- CLASS_LABS
drop policy if exists "class_labs: student read enrolled" on class_labs;
drop policy if exists "class_labs: educator read own classes" on class_labs;
drop policy if exists "class_labs: educator write own" on class_labs;
create policy "class_labs: student read enrolled" on class_labs for select to authenticated using (is_enrolled_in_class(class_id));
create policy "class_labs: educator read own classes" on class_labs for select to authenticated using (is_educator_of_class(class_id));
create policy "class_labs: educator write own" on class_labs for all to authenticated using (is_educator_of_class(class_id)) with check (is_educator_of_class(class_id));

-- CLASS_QUIZ_SETTINGS
drop policy if exists "class_quiz_settings: educator read own" on class_quiz_settings;
drop policy if exists "class_quiz_settings: educator write own" on class_quiz_settings;
drop policy if exists "class_quiz_settings: student read enrolled" on class_quiz_settings;
create policy "class_quiz_settings: educator read own" on class_quiz_settings for select to authenticated using (is_educator_of_class(class_id));
create policy "class_quiz_settings: educator write own" on class_quiz_settings for all to authenticated using (is_educator_of_class(class_id)) with check (is_educator_of_class(class_id));
create policy "class_quiz_settings: student read enrolled" on class_quiz_settings for select to authenticated using (is_enrolled_in_class(class_id));

-- CLASS_FEEDBACK_SETTINGS
drop policy if exists "class_feedback_settings: educator read own" on class_feedback_settings;
drop policy if exists "class_feedback_settings: educator write own" on class_feedback_settings;
drop policy if exists "class_feedback_settings: student read enrolled" on class_feedback_settings;
create policy "class_feedback_settings: educator read own" on class_feedback_settings for select to authenticated using (is_educator_of_class(class_id));
create policy "class_feedback_settings: educator write own" on class_feedback_settings for all to authenticated using (is_educator_of_class(class_id)) with check (is_educator_of_class(class_id));
create policy "class_feedback_settings: student read enrolled" on class_feedback_settings for select to authenticated using (is_enrolled_in_class(class_id));

-- CLASS_INVITES
drop policy if exists "class_invites: educator read own" on class_invites;
drop policy if exists "class_invites: educator write own" on class_invites;
create policy "class_invites: educator read own" on class_invites for select to authenticated using (is_educator_of_class(class_id));
create policy "class_invites: educator write own" on class_invites for all to authenticated using (is_educator_of_class(class_id)) with check (is_educator_of_class(class_id));

-- QUIZ_SUBMISSIONS
drop policy if exists "quiz_submissions: educator read own classes" on quiz_submissions;
create policy "quiz_submissions: educator read own classes" on quiz_submissions for select to authenticated using (is_educator_of_class(class_id));

-- FEEDBACK_RESPONSES
drop policy if exists "feedback_responses: educator read own classes" on feedback_responses;
create policy "feedback_responses: educator read own classes" on feedback_responses for select to authenticated using (is_educator_of_class(class_id));

-- STUDENT_PROGRESS
drop policy if exists "student_progress: educator read own classes" on student_progress;
create policy "student_progress: educator read own classes" on student_progress for select to authenticated using (is_educator_of_class(class_id));
