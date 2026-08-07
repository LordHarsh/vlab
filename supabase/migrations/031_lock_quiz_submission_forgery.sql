-- 031_lock_quiz_submission_forgery.sql
--
-- HIGH. A student can write their own quiz grades straight into the database.
--
-- This is the same shape as the bug 028 fixed on `profiles` and 019 fixed on
-- `enrollments`: the policy checks WHO the row belongs to and nothing about WHAT
-- it says.
--
--   create policy "quiz_submissions: student insert own"
--     on quiz_submissions for insert to authenticated
--     with check (student_id = auth_profile_id() and auth_role() = 'student');
--
-- `authenticated` holds INSERT on every column, and lib/supabase/client.ts hands
-- the browser a Supabase client carrying the anon key plus a live Clerk token.
-- So a POST to /rest/v1/quiz_submissions with score/max_score/percentage/passed
-- of the attacker's choosing — against any class_id, enrolled or not — is
-- accepted. Every server-side control in lib/actions/quiz.ts (attempt cap,
-- enrollment gate, grading against the answer key) is bypassed by simply not
-- calling the server action.
--
-- The gradebook takes the HIGHEST percentage per student per quiz
-- (app/(educator)/educator/classes/[classId]/gradebook/page.tsx:125-131), so one
-- forged row outranks every genuine attempt and the educator sees 100% with no
-- indication anything is wrong. Students hold no UPDATE or DELETE on this table,
-- so forged rows are also permanent without service-role access.
--
-- Verified against this database inside a rolled-back DO block, acting as
-- `authenticated` with a student's Clerk sub:
--   EXPLOIT forge own perfect score (class never enrolled in) -> ACCEPTED
--   CONTROL forge a row for a DIFFERENT student              -> blocked 42501
--   CONTROL select quiz_questions.correct_answer             -> blocked 42501
-- The two controls blocking in the same transaction are what prove RLS was live
-- and the accepted insert is real.
--
-- The fix is the one 019 used: remove the policy and let the server action be
-- the only writer.
--
-- SHIPS WITH A CODE CHANGE — apply both together. lib/actions/quiz.ts must
-- insert through the service-role client, because after this migration the
-- RLS-bound client can no longer write the row. That call site already proves
-- identity (Clerk sub -> profiles) and active enrollment in `classId` before it
-- reaches the insert, and it computes score/max_score/percentage/passed itself
-- from quiz_questions.correct_answer — the client never supplies them.
--
-- Educator and admin reads are untouched ("quiz_submissions: admin read all",
-- "quiz_submissions: educator read own classes", "quiz_submissions: student read
-- own" all remain), so the gradebook and the student's own history keep working.

drop policy if exists "quiz_submissions: student insert own" on public.quiz_submissions;

comment on table public.quiz_submissions is
  'RLS: no student INSERT policy by design — see 031. The gradebook is written '
  'ONLY by submitQuiz() in lib/actions/quiz.ts through the service-role client, '
  'which grades server-side against quiz_questions.correct_answer. Do not add a '
  'student-facing insert policy: score, percentage and passed are not '
  'client-supplyable values.';
