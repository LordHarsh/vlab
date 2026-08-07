# VLab — security and data-access audit

**Scope:** branch `claude/security-audit`, cut from `main` at `b712bc5`. Live Supabase project
`odaocqfnhqarewoimrma` (`vlab`, ap-northeast-2), plus `supabase/migrations/*.sql`, `lib/actions/`,
`lib/supabase/`, `proxy.ts`, every route-group `layout.tsx`, and `app/api/`.

**This audit supersedes the previous one** (which covered `main` at `b37f685`). The headline change:
the previous **C1** — self-granted platform admin — **is fixed**, by `028_lock_profile_insert_escalation.sql`.
I re-tested it and it now blocks. The previous **H1** and **H2** are **still live and unfixed**; no
migration after 028 touches security (029 and 030 are content fixes). H2 is materially worse than
previously recorded.

**Findings: 2 high · 4 medium · 6 low · 2 observations. Nothing critical remains open.**

Each finding is **CONFIRMED** (I executed the exploit against the live database and it succeeded) or
**THEORETICAL** (the code reads wrong but I could not, or should not, execute it). No secret value
appears anywhere in this document.

---

## How the live tests were run, and why you can trust them

`execute_sql` runs privileged, and `SET LOCAL` outside a transaction is a silent no-op — so naive
impersonation proves nothing. Every probe therefore ran inside a single `DO $$ … $$` block (one
statement = one transaction) that:

- created its own fixtures, so no real user row was ever the subject of a test,
- switched role with `perform set_config('role','authenticated', true)`,
- set identity with `perform set_config('request.jwt.claims','{"sub":"…"}', true)`,
- carried **negative controls** alongside every exploit,
- ended in `raise exception`, which rolled the whole transaction back.

The negative controls are the point. In the same transaction that accepted a forged grade, an attempt
to forge a row for a *different* student returned `42501` and a `select correct_answer` returned
`42501`. That is what proves RLS was live and the positive result is real rather than an artefact of
a privileged connection.

**Post-conditions verified after every probe and dry-run** — `total_policies = 81` (unchanged),
`profiles = 11`, `classes = 4`, `enrollments = 5`, `quiz_submissions = 2`, `student_progress = 25`,
`sim_attempts = 12`, `feedback_responses = 1`, `class_labs = 4`, zero rows matching the probe
fixtures, and the proposed helper function absent. Nothing persisted.

**No migration was applied.** Migrations 031–034 are written to `supabase/migrations/` and left for
you. I dry-ran them inside rolled-back transactions (Postgres DDL is transactional) to prove they
both block the exploit and leave the legitimate path working; results are quoted under each finding.

---

## HIGH

### H1 — A student can write their own quiz grades straight into the database

**CONFIRMED.** Carried over from the previous audit, still unfixed.

**Where.** Policy `quiz_submissions: student insert own`, from `007_activity.sql:67-69`. Live
`with_check` is exactly:

```
(student_id = auth_profile_id()) AND (auth_role() = 'student'::text)
```

It validates *who* the row belongs to. It validates nothing about `score`, `max_score`, `percentage`,
`passed`, `attempt_number` or `class_id` — none of which carry a CHECK constraint either. This is the
same shape as the bug 028 fixed on `profiles`: correct about identity, silent about privilege.

**How I proved it.** Acting as `authenticated` with a fixture student's Clerk `sub`:

```
ROLLBACK-PROBE-1 >> acting_as=authenticated auth_profile_id_matches=t auth_role=student
  | enrolled_in_target_class=0
  | EXPLOIT_forge_own_perfect_score=ACCEPTED
  | CTRL_forge_for_other_student=blocked:42501
  | CTRL_read_correct_answer=blocked:42501
  | forged_rows_visible_to_educator=1
```

A row of `score=100, max_score=100, percentage=100.00, passed=true` was accepted against a real
`quiz_id` and a `class_id` the student **had no enrollment in**. Both controls blocked.

**Why the browser can reach it.** `lib/supabase/client.ts:41-57` hands client components a Supabase
client built from `NEXT_PUBLIC_SUPABASE_ANON_KEY` with `accessToken()` returning the live Clerk
token. RLS is the only thing between the browser and PostgREST. Every server-side control is bypassed
by not calling the server action:

| Control | Where | Bypassed by a direct POST? |
|---|---|---|
| Attempt cap | `lib/actions/quiz.ts:109-120` | yes |
| Active-enrollment check | `lib/actions/quiz.ts:127-146` | yes |
| Grading against the answer key | `lib/actions/quiz.ts:177-192` | yes — the client supplies the score |

**What an attacker gains.** A perfect grade in any class, including classes they are not in. The
gradebook takes the **highest** percentage per student per quiz
(`app/(educator)/educator/classes/[classId]/gradebook/page.tsx:125-131`), so one forged row silently
outranks every genuine attempt and the educator's view shows 100% with no anomaly. Students hold no
UPDATE or DELETE on the table, so forged rows are permanent without service-role access. On a
platform whose stated aim is that student progress be "genuinely trackable", this is the assessment
record being writable by the person being assessed.

**Fix — `031_lock_quiz_submission_forgery.sql`, plus the code change in the same commit.** Drop the
policy (the remedy 019 used for the identical bug on `enrollments`) and route the insert through the
service-role client, which is the only writer left. `lib/actions/quiz.ts` already proves identity and
active enrollment before it reaches the insert, and computes every graded value server-side.

Dry-run, both applied inside a rolled-back transaction:

```
DRYRUN-A(031+033) >> FIX031_forge_grade=blocked:42501
```

---

### H2 — An unapproved educator gets the platform's entire content library

**CONFIRMED**, and **worse than the previous audit recorded** (it measured 9 leaked sections; the
real figure is 111 plus the whole quiz and circuit set).

**Where.** `approval_status` is enforced in exactly one place in the entire codebase:
`app/(educator)/layout.tsx:26-27`. That is a render-time redirect. It does not run for a server-action
POST, and it certainly does not run for a direct PostgREST call. The policies underneath check
`auth_role() = 'educator'` or class ownership and never consult approval:

- `classes: educator write own` — `educator_id = auth_profile_id() AND auth_role() = 'educator'`
- `class_labs: educator write own` — `is_educator_of_class(class_id)`
- the educator branch of `can_read_experiment_content()` — class ownership only
- `circuits: educator read reference` — class ownership only

**How I proved it.** Acting as `authenticated`, `role='educator'`, `approval_status='pending'`:

```
ROLLBACK-PROBE-2 >> acting_as=authenticated role=educator approval_status=pending
  | gated_sections_before=0
  | EXPLOIT_create_class=ACCEPTED
  | EXPLOIT_assign_unpublished_lab=ACCEPTED
  | gated_sections_after=111  simulations=12  quizzes=12  quiz_questions=48  circuits=12  labs_visible=0
  | CTRL_profiles_visible=1
  | CTRL_other_educators_classes_visible=0
  | CTRL_quiz_submissions_visible=0
  | CTRL_self_approve=blocked:42501
  | CTRL_self_admin=blocked:42501
```

Two writes by an account no admin has approved turned **zero** content access into the entire
library. Every control blocked, so RLS was live throughout.

**What an attacker gains.** Sign up, pick "Educator" at onboarding (`lib/actions/profile.ts:96` sets
`approval_status='pending'`), get bounced to `/pending-approval` — then ignore the UI. Two open paths:
the server actions in `lib/actions/classes.ts` (`createClass`, `assignLab`, `generateInviteLink`,
`regenerateJoinCode`, `addStudentManual`, …), none of which consult `approval_status`; or PostgREST
directly. Either yields a working class with a live join code, every gated `experiment_sections`,
`simulations`, `quizzes`, `quiz_questions` and `circuits` row for any lab they attach, and read access
to the activity of anyone who joins their class.

Two things bound it, and both are worth stating precisely:

- **Student PII is not exposed.** `profiles` carries only `own read` and `admin read all`. The probe
  educator could see exactly **one** profile — their own. Confirmed.
- **The worked-solution leak is latent, not live.** `circuits: educator read reference` would hand
  over the solutions, but `select count(*) from circuits where role <> 'starter'` is **0** today. The
  day a reference circuit is authored, this finding gains an answer-key leak.

**Fix — `032_enforce_educator_approval.sql`.** Enforce approval where the data lives. Adds
`auth_is_approved_educator()` and applies it to all seven educator write policies, to the educator
branch of `can_read_experiment_content()`, to `circuits: educator read reference`, and to the educator
reads of student activity — so a *rejected* educator also loses classes they already own.

Dry-run inside a rolled-back transaction:

```
DRYRUN-B(032) >> pending: approved_educator()=f
  | FIX032_pending_create_class=blocked:42501
  | FIX032_pending_gated_sections=0
 || approved: approved_educator()=t
  | OK_approved_create_class=ACCEPTED
  | OK_approved_assign_lab=ACCEPTED
  | OK_approved_gated_sections=111
  | OK_approved_reads_own_class=1
```

The pending educator is fully shut out; the approved educator is unaffected.

Also add an approval check to `getEducatorProfile()` (`lib/actions/classes.ts:13-25`) so the server
actions refuse loudly rather than writing zero rows.

---

## MEDIUM

### M1 — Students can write activity into classes they were never in, and delete their own history

**CONFIRMED.** Same shape as H1, smaller blast radius.

`student_progress: student write own` and `sim_attempts: student write own` are **FOR ALL**;
`feedback_responses: student insert own` is INSERT. All three check only
`student_id = auth_profile_id() AND auth_role() = 'student'`. `class_id` is a free parameter.

```
ROLLBACK-PROBE-3 >> acting_as=authenticated role=student
  | EXPLOIT_progress_into_unenrolled_class=ACCEPTED
  | EXPLOIT_sim_attempt_into_unenrolled_class=ACCEPTED
  | EXPLOIT_feedback_into_unenrolled_class=ACCEPTED
  | EXPLOIT_self_mark_complete=ACCEPTED
  | EXPLOIT_delete_own_sim_attempts=ACCEPTED
  | CTRL_other_students_submissions=0  CTRL_other_students_progress=0
    CTRL_other_students_attempts=0     CTRL_other_students_feedback=0
    CTRL_profiles_visible=1  CTRL_classes_visible=1  CTRL_enrollments_visible=1  CTRL_invites_visible=0
  | CTRL_self_enroll=blocked:42501
  | CTRL_move_own_enrollment=blocked:42501
```

**What an attacker gains.** Phantom rows in a stranger's progress report and feedback summary (class
UUIDs leak through shared URLs and screen-shares); self-declared completion of any experiment; and
erasure of their own attempt history. Note the controls: **cross-tenant reads are completely clean**,
and 019's self-enroll fix still holds.

**Fix — `033_bind_student_writes_to_enrollment.sql`.** Add `is_enrolled_in_class(class_id)` to all
three, split the FOR ALL policies into INSERT + UPDATE so students no longer hold DELETE, and leave
SELECT alone so history survives dropping a class. Breaks nothing: `lib/actions/progress.ts:18-38`
and `lib/actions/simulator.ts:32-56` already prove active enrollment before writing.

```
DRYRUN-A(031+033) >> FIX033_progress_unenrolled=blocked:42501 | FIX033_attempt_unenrolled=blocked:42501
  | OK_progress_enrolled=ACCEPTED | OK_progress_update=ACCEPTED
  | OK_attempt_enrolled=ACCEPTED | OK_attempt_update=ACCEPTED
  | OK_read_own_progress=1 rows | FIX033_delete_own=no-op(0 rows)
```

---

### M2 — An educator can attach a lab they are not allowed to read, unlocking unpublished content

**CONFIRMED.** A confused deputy, and independent of H2 — it applies to *approved* educators too, so
032 does not fix it.

`class_labs: educator write own` checks `is_educator_of_class(class_id)` and nothing at all about
`lab_id`. But attaching a lab is precisely what unlocks its content: `can_read_experiment_content()`
walks `classes → class_labs → experiments` with no `published` predicate anywhere on that path.
Meanwhile `labs: educator read published` means the educator can only SELECT published labs.

The probe above is the proof: `labs_visible=0` — the educator could not read a single lab row — yet
`EXPLOIT_assign_unpublished_lab=ACCEPTED` and gated sections went 0 → 111. They attached a lab whose
existence was invisible to them.

**What an attacker gains.** Any educator holding or guessing a lab UUID reads that draft lab's
sections, simulations, quizzes and starter circuits before publication.

**Fix — `034_class_labs_published_only.sql`. HOLD THIS ONE.** It requires `labs.published` on the
educator write path — but `select count(*) from labs where published` is **0** in your database today
(one lab exists and it is unpublished). Applying it as-is would refuse *all* lab assignment. Publish
the labs you intend educators to use, then apply. Admins are unaffected via `class_labs: admin write all`.

---

### M3 — `submitQuiz` never binds `quizId` to `classId`

**CONFIRMED by code reading; currently LATENT in your data.** New in this audit.

`lib/actions/quiz.ts` verifies the caller is actively enrolled in `classId` (lines 127-146) and then
treats `quizId` as a free parameter. Nothing ties the two together. Three consequences:

1. The service-role read at line 152 returns `correct_answer` and `explanation` for **any** quiz on
   the platform. This is the *only* route to the answer key — the column revoke in migration 013 is
   otherwise holding (`CTRL_read_correct_answer=blocked:42501` in probe 1) — so this call site
   quietly defeats it.
2. `class_quiz_settings` is looked up by `(quizId, classId)`. Submit under a different class you
   belong to, find no settings row, and the code falls back to the quiz defaults — bypassing a
   class's `max_attempts`, `passing_percentage` and `show_answers='never'`.
3. The attempt counter is per `(quiz_id, class_id, student_id)`, so switching `classId` resets it.

**Why it is latent today, stated honestly:** `class_quiz_settings` has **0 rows**, all 12 quizzes hang
off the single lab, and **0 students are enrolled in more than one class** — so there is currently no
`(quiz, class)` pair a student can reach that they could not reach legitimately. Every one of those
three facts is a content-authoring accident, not a control. The first second class, second lab, or
`class_quiz_settings` row makes this live.

**Fix — code change on this branch**, committed alongside 031: resolve the quiz's experiment → lab and
require a matching `class_labs` row before the answer-key read. Also hoists the service-role client so
it is created only after all four gates have passed.

---

### M4 — `/api/dev/harvest` is an unauthenticated write of caller-supplied content to disk

**CONFIRMED by inspection; not executed** (I did not attack a running server).

`app/api/dev/harvest/route.ts:17-44` has no authentication whatsoever. Its only gate is
`if (process.env.NODE_ENV === 'production') return 404`. It then writes attacker-supplied JSON to a
fixed path inside the source tree, `lib/simulator/model/wokwi-art.generated.json`. `proxy.ts:17` also
exempts `/api/dev(.*)` from Clerk in development.

**What an attacker gains.** Nothing in production. In any non-production deployment — a staging build
left at `NODE_ENV=development`, `NODE_ENV=test`, or a dev server bound to a LAN interface — it is an
unauthenticated arbitrary-content write into the source tree, which on a machine running `next dev`
means influencing code that the dev server will load.

**Fix.** Delete the route, or gate it behind a shared secret in addition to `NODE_ENV`. It is a
harvesting tool, not a product surface.

---

## LOW

**L1 — A student can move their enrollment row to another class while dropping it. CONFIRMED.**
`enrollments: student drop own` has `with check ((student_id = auth_profile_id()) AND (status = 'dropped'))`
— `class_id` is unconstrained.
```
ROLLBACK-PROBE-4 >> L2_move_enrollment_as_dropped=ACCEPTED (now class B? t)
  | is_enrolled_in_class(B)=f | reactivate_own_enrollment=blocked:42501
```
It grants no access — the row lands `dropped`, and reactivation is blocked. The real (small) effect is
that a student can erase themselves from a class roster. Fix: pin `class_id` in the `with check`.

**L2 — Join codes and invite tokens come from `Math.random()`.** `lib/actions/classes.ts:7-11`
(3 + 4 base36 characters) and `:234-237`. Not cryptographically random and short. The join-code lookup
in `lib/actions/enrollment.ts:32-40` is unthrottled and runs on the service-role client, and its error
strings distinguish "no such code" from "class full/expired", forming an enumeration oracle. Use
`crypto.randomUUID()`/`randomBytes` and add rate limiting. Note `class_invites` tokens currently have
**no redemption path at all** — nothing in the codebase reads the table — so that half is inert today.

**L3 — `anon` holds broad table grants; only the absence of anon-facing policies stops it.** Every
table grants SELECT/INSERT/UPDATE/DELETE to `anon`. The only `{public}`-role policies are
`experiments: read published` and `labs: public read published`, so the effective anon surface is the
public catalogue. This is fail-closed but fragile: any future policy written without a `to authenticated`
clause is immediately anon-readable. Revoke the unused grants.

**L4 — `/api/tinkercad-preview` interpolates unvalidated input into a server-side fetch.**
`app/api/tinkercad-preview/route.ts:8-16`. The host is a fixed literal so this is not full SSRF, but
`designId` is unencoded and can inject path segments and query/fragment characters, and the endpoint is
an unrate-limited server-side fetch proxy. Validate the id and rate-limit.

**L5 — Admin actions mass-assign the client's object.** `lib/actions/admin.ts:79, 170, 518, 617` spread
`...data` directly into `.update()`. Guarded by `requireAdmin()`, so this is defence-in-depth, not a
hole. Whitelist the columns.

**L6 — `proxy.ts:10` exempts `/api/webhooks(.*)`, which does not exist.** A stale public exemption that
will silently make the first webhook handler someone adds unauthenticated. Remove it until needed.

---

## Observations (not vulnerabilities)

**O1 — `vendor/simulator/` is a second, tracked auth surface.** 30 tracked source files comprising a
Vite app with its own Supabase client (`vendor/simulator/src/database/supabaseClient.ts`) that uses
**Supabase Auth, not Clerk**, and reads/writes `circuits`. It is not part of the Next build and holds
no hardcoded keys, but it is a parallel identity model pointed at the same project shape. Consider
removing it from the repo.

**O2 — Authorization outside `lib/actions/admin.ts` is layout-only.** Server Components under
`app/(admin)/` carry no in-function check — including the service-role answer-key read at
`app/(admin)/admin/labs/[labSlug]/experiments/[expSlug]/quiz/page.tsx:41`, which is authorized purely
by `app/(admin)/layout.tsx` being composed above it. That holds today. It stops holding if a route is
moved out of the group or reached through a parallel/intercepted route. Prefer an explicit
`requireAdmin()` in any component that touches the service-role client.

---

## Checked and found clean

These were specifically attacked or audited and did **not** yield a finding. Recording them so they
are not re-litigated:

- **Profile privilege escalation is fixed.** 028 holds. `CTRL_self_admin=blocked:42501` and
  `CTRL_self_approve=blocked:42501` in probe 2. The INSERT `with check` now pins `is_admin = false`
  and forbids `role='educator' AND approval_status='approved'`; the UPDATE `with check` pins
  `role = auth_role()` and `approval_status = auth_approval_status()`. `clerk_user_id` is UNIQUE, so
  the second-profile-row variant is closed too.
- **The quiz answer key is not readable by students.** Migration 013's column-level revoke is real and
  live: `authenticated` has no SELECT on `quiz_questions.correct_answer` or `.explanation`, `anon` has
  no SELECT on the table at all, and a direct read returned `42501` in probe 1. `QuizSection.tsx:77-82`
  also excludes both columns. (The one hole is M3's server-side route, not the client fetch.)
- **Cross-tenant reads are solid.** As a student: 0 other students' `quiz_submissions`,
  `student_progress`, `sim_attempts`, `feedback_responses`; 1 profile (self); 1 class (enrolled only);
  1 enrollment (own); 0 `class_invites`. As an educator: 0 other educators' classes, 0 foreign
  submissions, 1 profile.
- **Self-enrollment is closed.** 019 holds — `CTRL_self_enroll=blocked:42501`.
- **Grades are computed server-side.** `lib/actions/quiz.ts:177-192` grades against
  `quiz_questions.correct_answer`; the client sends only `answers` (question id → option id) and
  `timeTakenSeconds`. The client never supplies a score. (H1 is a bypass *of* this function, not a
  flaw in it.)
- **Every admin action is gated.** All 18 exports in `lib/actions/admin.ts` call `await requireAdmin()`
  as their first statement (verified individually). `requireAdmin()` re-derives the Clerk id from the
  session and reads `is_admin` through the RLS-bound client. `approveEducator`/`rejectEducator` add
  `.eq('role','educator')` so they cannot touch a student row. These writes use the RLS-bound client,
  not the service-role client — good defence in depth.
- **All 21 tables have RLS enabled, and none has zero policies.** Full inventory in the appendix.
- **The `accessToken()` seam in `lib/supabase/server.ts` is safe.** The `constructed` flag suppresses
  exactly one call — the synchronous Realtime priming call inside `createClient()` — and is set `true`
  before the function returns, so every PostgREST request that follows gets a live Clerk token. The
  failure mode if it ever regressed is **fail-closed**, not a leak: a token-less request runs as `anon`,
  and `anon` has policies on nothing but published labs and experiments, so it returns zero rows.
- **Service-role call sites.** Five exist. `lib/actions/profile.ts:129` (`completeOnboarding`) —
  identity from `auth()`, `clerk_user_id` server-derived so the upsert can only hit the caller's own
  row, `is_admin` never in the payload, `approval_status` derived server-side. `lib/actions/enrollment.ts:18`
  (`joinByCode`) — both ids server-derived, correct shape. `lib/actions/admin.ts:354` and the admin
  quiz page — behind `requireAdmin()` / the admin layout. `lib/actions/quiz.ts:152` — the one with a
  gap; see M3.
- **Secrets.** No live secret value is committed. `git ls-files` tracks exactly one env file,
  `.env.example`, containing placeholders only. The `NEXT_PUBLIC_*` surface is correct: only
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
  all of which are designed to be public. `SUPABASE_SERVICE_ROLE_KEY` and `CLERK_SECRET_KEY` are read
  only from `process.env` in server modules. CI uses literal placeholder strings.

## Could not test

- **Whether Clerk is on production keys.** The previous audit flagged development keys locally; I have
  no access to the deployed environment's variables. Verify `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` starts
  `pk_live_` in production. Development instances have relaxed session security and a shared domain.
- **The compile route's rate limiting under load** (`app/api/compile/route.ts`). Its concurrency lock is
  per-process, so it over-admits across serverless instances. Assessing the real effect needs a load
  test against the deployment.
- **`/api/dev/harvest` in a live non-production deployment** (M4) — inspection only; I did not attack a
  running server.

---

## Advisors

**Security advisors** returned 19 items, all `WARN`, and all of them are one of two things:

- **18 × "SECURITY DEFINER function executable by `anon`/`authenticated`"** for the nine `auth_*` /
  `can_read_*` / `is_*_of_class` helpers. These are **by design** — they are the helpers the RLS
  policies are built from, they take no privileged action, and each one derives its answer from
  `auth.jwt()->>'sub'` rather than from an argument, so calling one directly only ever tells you about
  yourself. The three that take a UUID argument (`can_read_experiment_content`, `can_read_form_content`,
  `can_read_quiz_content`, `is_educator_of_class`, `is_enrolled_in_class`) return only a boolean about
  the caller's own access. All have `SET search_path TO 'public'` pinned (migration 014). **No action
  needed**, though revoking EXECUTE from `anon` would silence the lint at no cost, since no
  anon-facing policy uses them.
- **1 × "Leaked password protection disabled."** **Not applicable** — Clerk is the identity provider;
  Supabase Auth issues no passwords in this project.

**Performance advisors** returned 75 items, none security-relevant: 43 × `multiple_permissive_policies`
(WARN), 19 × `unindexed_foreign_keys` (INFO), 10 × `unused_index` (INFO), 3 × `auth_rls_initplan` (WARN).

The 43 permissive-policy warnings are the notable ones, concentrated on the six class-scoped tables
that carry four policies each (`classes`, `enrollments`, `class_labs`, `class_invites`,
`class_quiz_settings`, `class_feedback_settings`, `invite_emails`). Postgres must evaluate every
permissive policy for every row, and each of these calls a `SECURITY DEFINER` helper that itself
queries `profiles`. That is a real cost at scale, but it is a **correctness-neutral** one — merging
the admin and owner branches into a single policy per command would fix it. Note that 032 does not
make this worse (it replaces policies rather than adding them); 033 splits two FOR ALL policies into
INSERT + UPDATE, which does not increase the count evaluated for any single command.

---

## Migrations written (NOT applied)

All four are in `supabase/migrations/`, unapplied. Each carries a full comment block explaining the
bug, the probe output that proved it, and why the fix breaks nothing.

| File | Fixes | Ships with code? | Safe to apply now? |
|---|---|---|---|
| `031_lock_quiz_submission_forgery.sql` | H1 | **Yes — `lib/actions/quiz.ts` must ship in the same deploy** | Yes, together with the code |
| `032_enforce_educator_approval.sql` | H2 | Optional follow-up in `lib/actions/classes.ts` | Yes |
| `033_bind_student_writes_to_enrollment.sql` | M1 | No | Yes |
| `034_class_labs_published_only.sql` | M2 | No | **No — hold until labs are published** |

**Ordering.** 032 creates `auth_is_approved_educator()`, which 034 uses. Apply 031 → 032 → 033, and
034 only after publishing labs.

**One deployment hazard to plan for:** 031 drops the policy the browser currently relies on. If the
migration lands before the new `lib/actions/quiz.ts`, quiz submission fails closed (students see
"Failed to save submission") until the code deploys. Ship them together, code first if you must split.

---

## Overall posture

Better than the finding count suggests. The read side is genuinely well built: I attacked cross-tenant
reads from a student and from an educator, and every single control came back empty — no student can
see another student's grades, progress, attempts or feedback; no educator can see another educator's
class; nobody but an admin can see another user's profile. Student PII is not exposed anywhere. The
answer key is protected by a column-level revoke that actually works. The three prior privilege-escalation
fixes (018, 019, 028) all hold under direct attack. `requireAdmin()` is applied consistently across all
18 admin actions, and the service-role client is used sparingly with identity proven first in four of
its five call sites.

The weakness is systematic and has one signature: **write policies that authenticate the row's owner
but never constrain the row's contents.** That is the same mistake 028 fixed on `profiles` and 019 fixed
on `enrollments`, and it is still present, unfixed, on `quiz_submissions`, `student_progress`,
`sim_attempts` and `feedback_responses` — every table where a student writes. The second theme is
**authorization enforced in a React layout rather than in the database**, which is what makes the
unapproved-educator hole work.

Neither is exotic, and both are closed by the four migrations here. The thing I would fix this week is
H1: it is a one-line REST call, it requires no special knowledge, the forged row is permanent and
invisible to the educator, and it makes the gradebook — the product's core claim — untrustworthy.

---

# Appendix — full RLS inventory

All 21 public tables: **RLS enabled on every one**, `relforcerowsecurity` false on every one (immaterial
— no policy relies on it, and table owners do not serve traffic). 81 policies total. Every policy is
`to authenticated` except the two marked `{public}`.

| Table | RLS | # | Policies (cmd — expression) |
|---|---|---|---|
| `circuits` | on | 3 | ALL admin write — `auth_is_admin()` · SELECT educator read reference — class-ownership via simulations→experiments→class_labs→classes · SELECT read starter — `role='starter' AND can_read_experiment_content(...)` |
| `class_feedback_settings` | on | 5 | ALL admin write all · ALL educator write own — `is_educator_of_class(class_id)` · SELECT admin read all · SELECT educator read own · SELECT student read enrolled — `is_enrolled_in_class(class_id)` |
| `class_invites` | on | 4 | ALL admin write all · ALL educator write own — `is_educator_of_class(class_id)` · SELECT admin read all · SELECT educator read own |
| `class_labs` | on | 6 | ALL admin write all · ALL educator write own — `is_educator_of_class(class_id)` · SELECT admin read all · SELECT educator read own (inline classes subquery) · SELECT educator read own classes (helper) · SELECT student read enrolled |
| `class_quiz_settings` | on | 5 | ALL admin write all · ALL educator write own · SELECT admin read all · SELECT educator read own · SELECT student read enrolled |
| `classes` | on | 5 | ALL admin write all · ALL educator write own — `educator_id = auth_profile_id() AND auth_role()='educator'` **(H2)** · SELECT admin read all · SELECT educator read own · SELECT student read enrolled |
| `enrollments` | on | 6 | ALL admin write all · ALL educator write own classes · SELECT admin read all · SELECT educator read own classes · SELECT student read own · UPDATE student drop own — check `student_id = self AND status='dropped'` **(L1)** |
| `experiment_sections` | on | 3 | ALL admin write · SELECT admin read all · SELECT read active — `status='active' AND can_read_experiment_content(experiment_id)` |
| `experiments` | on | 3 | ALL admin write · SELECT admin read all · **SELECT read published `{public}`** — `published = true` |
| `feedback_forms` | on | 2 | ALL admin write · SELECT read — `can_read_experiment_content(experiment_id)` |
| `feedback_questions` | on | 3 | ALL admin write · SELECT admin read all · SELECT read active — `status='active' AND can_read_form_content(form_id)` |
| `feedback_responses` | on | 4 | INSERT student insert own — `student_id = self AND auth_role()='student'` **(M1)** · SELECT admin read all · SELECT educator read own classes · SELECT student read own |
| `invite_emails` | on | 4 | ALL admin write all · ALL educator write own (invite→class ownership) · SELECT admin read all · SELECT educator read own |
| `labs` | on | 4 | ALL admin write · SELECT admin read all · SELECT educator read published — `published AND auth_role()='educator'` · **SELECT public read published `{public}`** |
| `profiles` | on | 5 | INSERT insert own — pins `is_admin=false`, forbids self-approved educator **(028, holds)** · SELECT admin read all · SELECT own read · UPDATE admin update all · UPDATE own update — pins `is_admin`, `role`, `approval_status` **(018, holds)** |
| `quiz_questions` | on | 3 | ALL admin write · SELECT admin read all · SELECT read active — `status='active' AND can_read_quiz_content(quiz_id)`. **Column-level revoke on `correct_answer` + `explanation` (013) — holds.** |
| `quiz_submissions` | on | 4 | INSERT student insert own — `student_id = self AND auth_role()='student'` **(H1)** · SELECT admin read all · SELECT educator read own classes · SELECT student read own |
| `quizzes` | on | 2 | ALL admin write · SELECT read — `can_read_experiment_content(experiment_id)` |
| `sim_attempts` | on | 4 | **ALL** student write own — `student_id = self` / check adds `auth_role()='student'` **(M1)** · SELECT admin read all · SELECT educator read own classes · SELECT student read own |
| `simulations` | on | 2 | ALL admin write · SELECT read — `can_read_experiment_content(experiment_id)` |
| `student_progress` | on | 4 | **ALL** student write own — `student_id = self` / check adds `auth_role()='student'` **(M1)** · SELECT admin read all · SELECT educator read own classes · SELECT student read own |

### Helper functions (all `STABLE SECURITY DEFINER`, `search_path` pinned to `public`)

| Function | Returns |
|---|---|
| `auth_profile_id()` | caller's `profiles.id` from `auth.jwt()->>'sub'` |
| `auth_role()` | caller's `profiles.role` |
| `auth_is_admin()` | caller's `is_admin`, `coalesce(…, false)` |
| `auth_approval_status()` | caller's `approval_status` |
| `is_educator_of_class(uuid)` | caller owns that class |
| `is_enrolled_in_class(uuid)` | caller has an **active** enrollment in that class |
| `can_read_experiment_content(uuid)` | admin **or** active-enrolled student **or** owning educator **(no approval check — H2)** |
| `can_read_form_content(uuid)` | delegates to `can_read_experiment_content` via the form's experiment |
| `can_read_quiz_content(uuid)` | delegates to `can_read_experiment_content` via the quiz's experiment |
| `set_updated_at()` | trigger, sets `updated_at = now()` |

### Table grants

`anon` and `authenticated` both hold `SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE` on
all 21 tables, **except** `quiz_questions`, where table-level SELECT is revoked and replaced by a
column-level grant to `authenticated` that omits `correct_answer` and `explanation` — and `anon` gets
no SELECT on it at all. That single exception is the quiz-integrity control, and it works. See L3 on
the breadth of the remaining grants.
