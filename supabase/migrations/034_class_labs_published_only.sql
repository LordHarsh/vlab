-- 034_class_labs_published_only.sql
--
-- MEDIUM. An educator can attach a lab they are not allowed to see, and thereby
-- read all of its unpublished content.
--
-- `class_labs: educator write own` checks only `is_educator_of_class(class_id)`.
-- It never checks anything about `lab_id`. But attaching a lab is exactly what
-- unlocks its content: `can_read_experiment_content()` resolves an educator's
-- access by walking classes -> class_labs -> experiments, with no `published`
-- predicate anywhere on that path.
--
-- Meanwhile `labs: educator read published` means an educator can only SELECT
-- published labs. So the write policy lets them attach a row whose target they
-- cannot even read — a clean confused-deputy: guess or leak a lab UUID, attach
-- it, and the draft lab's sections, simulations, quizzes and circuits all become
-- readable.
--
-- Verified against this database inside a rolled-back DO block: an educator with
-- `labs_visible = 0` (the only lab in this project is unpublished) successfully
-- inserted a class_labs row for that lab and went from 0 to 111 readable
-- experiment_sections. See 032 — that probe is the same one, and 032 stops the
-- *unapproved* case. This migration stops the *approved* case, which 032 does
-- not: an approved educator can still attach any draft lab today.
--
-- ---------------------------------------------------------------------------
-- !! HOLD THIS ONE UNTIL YOUR LABS ARE PUBLISHED !!
--
--   select count(*) from labs where published;      -- 0 at the time of audit
--   select count(*) from labs where not published;  -- 1 at the time of audit
--
-- Every lab in this project is currently unpublished, so applying this as-is
-- would refuse ALL lab assignment, including the legitimate one. Publish the
-- labs you intend educators to use first, then apply. Admins are unaffected
-- either way — "class_labs: admin write all" is a separate policy and still
-- allows attaching a draft lab for authoring and preview.
-- ---------------------------------------------------------------------------

drop policy if exists "class_labs: educator write own" on public.class_labs;

create policy "class_labs: educator write own"
  on public.class_labs for all to authenticated
  using (
    is_educator_of_class(class_id)
    and auth_is_approved_educator()
  )
  with check (
    is_educator_of_class(class_id)
    and auth_is_approved_educator()
    -- You may only assign a lab you are allowed to see. Mirrors
    -- "labs: educator read published".
    and exists (
      select 1 from labs
      where labs.id = class_labs.lab_id
        and labs.published = true
    )
  );

comment on table public.class_labs is
  'RLS: assigning a lab is what unlocks its content for the class, so the '
  'educator write policy requires the lab to be PUBLISHED (034) and the '
  'educator to be APPROVED (032). Admins bypass both via "admin write all".';
