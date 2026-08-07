-- 033_bind_student_writes_to_enrollment.sql
--
-- MEDIUM. A student can write activity rows into classes they have never been
-- enrolled in, and can delete their own activity history.
--
-- Same shape as 031, smaller blast radius. Three policies check WHO the row
-- belongs to and nothing about the class it is attributed to:
--
--   student_progress:   student write own  (FOR ALL)
--   sim_attempts:       student write own  (FOR ALL)
--   feedback_responses: student insert own (INSERT)
--
-- all of the form `student_id = auth_profile_id() and auth_role() = 'student'`.
-- `class_id` is a free parameter, so a student holding any class UUID (they leak
-- through shared URLs and screen-shares) can seed phantom rows in a stranger's
-- gradebook, progress report and feedback summary. Because two of the three are
-- FOR ALL, students can also UPDATE themselves to "completed" and DELETE their
-- own attempt history.
--
-- Verified against this database inside a rolled-back DO block, as a student
-- actively enrolled in class A and never enrolled in class B:
--   write student_progress   into class B -> ACCEPTED
--   write sim_attempts       into class B -> ACCEPTED
--   write feedback_responses into class B -> ACCEPTED
--   update own progress to completed      -> ACCEPTED
--   delete own sim_attempts               -> ACCEPTED
--   CONTROL self-enroll into class B      -> blocked 42501
--   CONTROL move own enrollment           -> blocked 42501
--   CONTROL read any other student's rows -> 0 rows, every table
-- Cross-tenant READS are clean; this is purely a write-side gap.
--
-- Breaks nothing. Both server actions that write these tables already prove
-- active enrollment before writing — lib/actions/progress.ts:18-38
-- (`enrolledProfileId`) and lib/actions/simulator.ts:32-56 (`studentContext`),
-- and lib/actions/feedback.ts does the same. This migration moves that
-- app-layer gate down into RLS, which is where it has to be while the browser
-- holds a Clerk-authenticated Supabase client (lib/supabase/client.ts).
--
-- DELETE is removed rather than re-scoped: no code path deletes any of these
-- rows (progress.ts upserts, simulator.ts upserts, feedback.ts inserts), and
-- participation evidence should not be erasable by the participant. SELECT is
-- unaffected — the separate "student read own" policies still cover it, so a
-- student who drops a class keeps reading their own history.

-- ---------------------------------------------------------------------------
-- student_progress
-- ---------------------------------------------------------------------------

drop policy if exists "student_progress: student write own" on public.student_progress;

create policy "student_progress: student insert own"
  on public.student_progress for insert to authenticated
  with check (
    student_id = auth_profile_id()
    and auth_role() = 'student'
    and is_enrolled_in_class(class_id)
  );

create policy "student_progress: student update own"
  on public.student_progress for update to authenticated
  using (student_id = auth_profile_id() and is_enrolled_in_class(class_id))
  with check (
    student_id = auth_profile_id()
    and auth_role() = 'student'
    and is_enrolled_in_class(class_id)
  );

-- ---------------------------------------------------------------------------
-- sim_attempts
-- ---------------------------------------------------------------------------

drop policy if exists "sim_attempts: student write own" on public.sim_attempts;

create policy "sim_attempts: student insert own"
  on public.sim_attempts for insert to authenticated
  with check (
    student_id = auth_profile_id()
    and auth_role() = 'student'
    and is_enrolled_in_class(class_id)
  );

create policy "sim_attempts: student update own"
  on public.sim_attempts for update to authenticated
  using (student_id = auth_profile_id() and is_enrolled_in_class(class_id))
  with check (
    student_id = auth_profile_id()
    and auth_role() = 'student'
    and is_enrolled_in_class(class_id)
  );

-- ---------------------------------------------------------------------------
-- feedback_responses
-- ---------------------------------------------------------------------------

drop policy if exists "feedback_responses: student insert own" on public.feedback_responses;

create policy "feedback_responses: student insert own"
  on public.feedback_responses for insert to authenticated
  with check (
    student_id = auth_profile_id()
    and auth_role() = 'student'
    and is_enrolled_in_class(class_id)
  );

comment on table public.sim_attempts is
  'RLS: student writes are bound to an ACTIVE enrollment in class_id (033). '
  'No student DELETE by design. SELECT stays open to the owning student so '
  'history survives dropping the class.';
