-- 032_enforce_educator_approval.sql
--
-- HIGH. The educator approval gate is UI-only. An educator awaiting (or refused)
-- admin approval gets a working class and the platform's entire content library.
--
-- `approval_status` was enforced in exactly one place — app/(educator)/layout.tsx
-- — which is a render-time redirect. It never runs for a server action POST, and
-- it certainly never runs for a direct PostgREST call made with the anon key and
-- the user's own Clerk token (lib/supabase/client.ts hands the browser exactly
-- that). Every policy below checked `auth_role() = 'educator'` or class
-- ownership, and none of them checked whether that educator had been approved.
--
-- Verified against this database inside a rolled-back DO block, acting as
-- `authenticated` with role='educator', approval_status='pending':
--   gated experiment_sections readable BEFORE ->   0
--   create a class                          -> ACCEPTED
--   assign a lab to it                      -> ACCEPTED
--   gated experiment_sections readable AFTER -> 111
--   simulations 12 · quizzes 12 · quiz_questions 48 · circuits 12
--   CONTROL self-approve  -> blocked 42501
--   CONTROL self-admin    -> blocked 42501
-- Two unapproved-account writes turned zero content access into the whole
-- library. The controls blocking prove RLS was live throughout.
--
-- Student PII is NOT part of this exposure and was not before: `profiles` has
-- only "own read" and "admin read all", and the probe educator could see exactly
-- one profile row — their own. What leaks is authored content (sections,
-- simulations, quizzes, circuits) plus the class-scoped student activity of
-- anyone who subsequently joins their class.
--
-- The fix is to enforce approval where the data lives rather than in a layout.
-- One helper, applied to (a) every educator WRITE policy, (b) the educator
-- branches of the content-read helpers, and (c) the educator reads of student
-- activity — so a rejected educator also loses the classes they already own.
--
-- Reads of a class's own roster/settings rows are deliberately left alone: they
-- expose nothing an unapproved educator did not already put there themselves,
-- and narrowing them buys nothing once (a) blocks the writes.

create or replace function public.auth_is_approved_educator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select role = 'educator' and approval_status = 'approved'
     from profiles
     where clerk_user_id = (select auth.jwt()->>'sub')
     limit 1),
    false
  )
$function$;

comment on function public.auth_is_approved_educator() is
  'True only for an educator an admin has approved. Added by 032 because '
  'approval_status was previously enforced only by a layout redirect.';

-- ---------------------------------------------------------------------------
-- (a) educator WRITE policies
-- ---------------------------------------------------------------------------

drop policy if exists "classes: educator write own" on public.classes;
create policy "classes: educator write own"
  on public.classes for all to authenticated
  using (educator_id = auth_profile_id() and auth_is_approved_educator())
  with check (educator_id = auth_profile_id() and auth_is_approved_educator());

drop policy if exists "class_labs: educator write own" on public.class_labs;
create policy "class_labs: educator write own"
  on public.class_labs for all to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator())
  with check (is_educator_of_class(class_id) and auth_is_approved_educator());

drop policy if exists "class_invites: educator write own" on public.class_invites;
create policy "class_invites: educator write own"
  on public.class_invites for all to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator())
  with check (is_educator_of_class(class_id) and auth_is_approved_educator());

drop policy if exists "class_quiz_settings: educator write own" on public.class_quiz_settings;
create policy "class_quiz_settings: educator write own"
  on public.class_quiz_settings for all to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator())
  with check (is_educator_of_class(class_id) and auth_is_approved_educator());

drop policy if exists "class_feedback_settings: educator write own" on public.class_feedback_settings;
create policy "class_feedback_settings: educator write own"
  on public.class_feedback_settings for all to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator())
  with check (is_educator_of_class(class_id) and auth_is_approved_educator());

drop policy if exists "enrollments: educator write own classes" on public.enrollments;
create policy "enrollments: educator write own classes"
  on public.enrollments for all to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator())
  with check (is_educator_of_class(class_id) and auth_is_approved_educator());

drop policy if exists "invite_emails: educator write own" on public.invite_emails;
create policy "invite_emails: educator write own"
  on public.invite_emails for all to authenticated
  using (
    auth_is_approved_educator()
    and exists (
      select 1 from class_invites
      join classes on classes.id = class_invites.class_id
      where class_invites.id = invite_emails.invite_id
        and classes.educator_id = auth_profile_id()
    )
  )
  with check (
    auth_is_approved_educator()
    and exists (
      select 1 from class_invites
      join classes on classes.id = class_invites.class_id
      where class_invites.id = invite_emails.invite_id
        and classes.educator_id = auth_profile_id()
    )
  );

-- ---------------------------------------------------------------------------
-- (b) educator branches of the content-read helpers
-- ---------------------------------------------------------------------------

-- Gates experiment_sections, simulations, quizzes, quiz_questions,
-- feedback_forms, feedback_questions and the starter circuits.
create or replace function public.can_read_experiment_content(p_experiment_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
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
    or (
      auth_is_approved_educator()
      and exists (
        select 1
        from experiments e
        join class_labs cl on cl.lab_id = e.lab_id
        join classes c on c.id = cl.class_id
        where e.id = p_experiment_id
          and c.educator_id = auth_profile_id()
      )
    )
$function$;

-- The worked-solution circuits. `select count(*) from circuits where
-- role <> 'starter'` is 0 today, so this is latent — but it is the answer key
-- for the simulator and must not be reachable by an unapproved account.
drop policy if exists "circuits: educator read reference" on public.circuits;
create policy "circuits: educator read reference"
  on public.circuits for select to authenticated
  using (
    auth_is_admin()
    or (
      auth_is_approved_educator()
      and exists (
        select 1
        from simulations s
        join experiments e on e.id = s.experiment_id
        join class_labs cl on cl.lab_id = e.lab_id
        join classes c on c.id = cl.class_id
        where s.id = circuits.simulation_id
          and c.educator_id = auth_profile_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- (c) educator reads of student activity
-- ---------------------------------------------------------------------------

drop policy if exists "quiz_submissions: educator read own classes" on public.quiz_submissions;
create policy "quiz_submissions: educator read own classes"
  on public.quiz_submissions for select to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator());

drop policy if exists "student_progress: educator read own classes" on public.student_progress;
create policy "student_progress: educator read own classes"
  on public.student_progress for select to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator());

drop policy if exists "sim_attempts: educator read own classes" on public.sim_attempts;
create policy "sim_attempts: educator read own classes"
  on public.sim_attempts for select to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator());

drop policy if exists "feedback_responses: educator read own classes" on public.feedback_responses;
create policy "feedback_responses: educator read own classes"
  on public.feedback_responses for select to authenticated
  using (is_educator_of_class(class_id) and auth_is_approved_educator());

-- Also enforce it in the app layer, so the server actions refuse rather than
-- silently writing zero rows: add an approval check to getEducatorProfile()
-- in lib/actions/classes.ts. See SECURITY_AUDIT.md.
