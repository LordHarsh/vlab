# VLab — security and data-access audit

**Scope:** `main` at `b37f685`. Read-only review of `supabase/migrations/*.sql`, `supabase/schema.sql`,
`lib/actions/`, `lib/supabase/`, `proxy.ts`, every route-group `layout.tsx`, `app/api/`, and the
compile toolchain under `lib/simulator/avr/`.
**Live database:** Supabase project `odaocqfnhqarewoimrma` (the `vlab` project named in
`PROJECT_CONTEXT.md`). All live tests ran inside `DO $$` blocks terminated by `raise exception`,
so every fixture row was rolled back. Verified afterwards: zero probe rows remain. No secret value
is reproduced anywhere in this document.

**Findings: 1 critical · 2 high · 2 medium · 7 low · 1 observation.**

Every finding is tagged **[verified]** (established by a query I ran or a specific file:line) or
**[suspected]** (reasoned from the code but not executed).

---

## How the live tests were run

The trap recorded in this project is real: `execute_sql` runs privileged, and `SET LOCAL` outside a
transaction is a silent no-op, so naive impersonation proves nothing. Every probe below therefore:

- ran inside a single `DO $$ … $$` block (one statement = one transaction),
- switched role with `perform set_config('role','authenticated', true)`,
- set the identity with `perform set_config('request.jwt.claims', '{"sub":"…"}', true)`,
- surfaced results with `raise exception`, which also rolled the whole thing back.

**Probe 2 carried two negative controls**, and both came back `blocked: 42501` — inserting a
submission attributed to a *different* student, and selecting `quiz_questions.correct_answer`.
That is what makes the positive results in this report trustworthy: RLS was demonstrably being
enforced in the same transaction that the accepted writes succeeded in.

---

## CRITICAL

### C1 — Any user who signs up can make themselves a platform admin in one REST call

**[verified]**

**Location**
- `supabase/migrations/001_profiles.sql:101-103` — policy `profiles: insert own`
- `supabase/schema.sql:850-852` — same policy, same gap, in the consolidated schema
- Live: `pg_policies` shows `with_check = (clerk_user_id = (SELECT auth.jwt() ->> 'sub'))` and nothing else

Migration 018 pinned `is_admin`, `role` and `approval_status` on the **UPDATE** policy. The
**INSERT** policy was never touched. It constrains only that the row you insert carries your own
Clerk id — not what privileges that row grants you.

**Evidence**

Column grants confirm the columns are writable by the browser role:

```
information_schema.column_privileges → profiles / authenticated / INSERT
  approval_status, avatar_url, class_section, clerk_user_id, created_at, department,
  email, employee_no, first_name, id, is_admin, last_name, phone, profile_completed,
  registration_no, role, updated_at, year
```

Live probe, impersonating a signed-in Clerk user with **no profile row yet**:

```sql
perform set_config('request.jwt.claims','{"sub":"user_SECAUDIT_PROBE_0001",...}', true);
perform set_config('role','authenticated', true);
insert into public.profiles
  (clerk_user_id, email, role, is_admin, approval_status, profile_completed)
values (v_sub, 'probe@example.invalid', 'educator', true, 'approved', true);
```

```
PROBE RESULT (rolled back) | running_as=authenticated | insert_accepted=YES
  | is_admin=t | role=educator | approval_status=approved | auth_is_admin()=t
```

**This is not a race.** `ensureProfile()` in `lib/actions/profile.ts:29` is the function that would
have created the row server-side on first sign-in — and **it is never called anywhere**
(`grep -rn ensureProfile app lib components` returns only its own definition and its own error log).
The only writer of a profile row is `completeOnboarding`, which fires when the user submits the
onboarding form. An attacker simply never submits it. The window is open from sign-up until they
choose to close it.

**What an attacker can actually do.** Sign up through the normal `/sign-up` page. Read the Clerk
session token out of their own browser. POST to `https://<ref>.supabase.co/rest/v1/profiles` with the
public `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the same key `lib/supabase/client.ts:46` ships to every
visitor — and the row above. They set `profile_completed: true` in the same insert, and
`app/(admin)/layout.tsx:7-25` checks nothing but `is_admin`, so `/admin` opens immediately. From
there: full CRUD on labs, experiments, sections, quizzes and questions; read every profile; read
every class, enrollment, submission and progress row; approve or reject educators; and read the quiz
answer key through the admin quiz editor, which uses the service-role client
(`app/(admin)/admin/labs/[labSlug]/experiments/[expSlug]/quiz/page.tsx:41`).

**Why it survived QA.** `scripts/verify-schema.mjs:441` asserts *"student CANNOT self-promote to
educator [018]"* — and the body of that test is an `UPDATE`. There is no INSERT equivalent. The
guard rail checks that the door 018 closed is still closed, and never looks at the other one.
(Contrast `scripts/verify-schema.mjs:428`, the 019 test, which correctly probes an INSERT.)

**Suggested fix.** Pin the same three columns on insert. Nothing legitimate needs them: onboarding
writes through the service-role client, which bypasses RLS entirely.

```sql
alter policy "profiles: insert own" on public.profiles
  with check (
    clerk_user_id = (select auth.jwt()->>'sub')
    and not is_admin
    and role = 'student'
    and approval_status = 'approved'
  );
```

Defaults satisfy this (`is_admin` defaults false, `role` defaults `'student'`,
`approval_status` defaults `'approved'`), so a plain insert of the safe columns still works.
Belt and braces: `revoke insert (is_admin, role, approval_status) on profiles from authenticated, anon;`.
Add the INSERT case to `verify-schema.mjs` in the same change, and mirror both into `supabase/schema.sql`
per the two-files rule in `supabase/README.md`.

---

## HIGH

### H1 — A student can write their own quiz grades straight into the database

**[verified]**

**Location**
- `supabase/migrations/007_activity.sql:67-69` — policy `quiz_submissions: student insert own`
- Live `with_check`: `((student_id = auth_profile_id()) AND (auth_role() = 'student'::text))`

The policy validates *who* the row belongs to. It validates nothing about `score`, `max_score`,
`percentage`, `passed`, `attempt_number` or `class_id`.

**Evidence** — live probe as an impersonated student enrolled in **no** classes:

```
PROBE2 (rolled back) | enrolled_in_target_class=0
  | forge_own_perfect_score=ACCEPTED
  | ctrl_forge_for_other_student=blocked: 42501
  | ctrl_read_correct_answer=blocked: 42501
```

The accepted row was `score=100, max_score=100, percentage=100.00, passed=true` against a real
`quiz_id` and a real `class_id` the student had no enrollment in. The two controls blocking with
`42501` prove RLS was live for that same transaction.

**What an attacker can actually do.** Every server-side control on quizzes is in `lib/actions/quiz.ts`
and every one of them is bypassed by not calling it:

| Control | Where | Bypassed by direct insert? |
|---|---|---|
| Attempt limit | `lib/actions/quiz.ts:109-120` | yes |
| Active-enrollment check | `lib/actions/quiz.ts:127-146` | yes |
| Grading against the answer key | `lib/actions/quiz.ts:177-192` | yes — score is supplied by the client |

The impact is not cosmetic. The gradebook picks the **highest** percentage per student per quiz:

```ts
// app/(educator)/educator/classes/[classId]/gradebook/page.tsx:125-131
if (!existing || sub.percentage > existing.percentage) { … }
```

So one forged row silently outranks every genuine attempt, and the educator's view shows 100% with
no indication anything is wrong. On a platform whose stated purpose is that "student progress must be
genuinely trackable" (`PROJECT_CONTEXT.md` aim 6), this is the assessment record being writable by
the person being assessed.

Students have no UPDATE or DELETE policy on `quiz_submissions`, so forged rows are permanent — which
also means an educator cannot remove them without service-role access.

**Suggested fix.** The same fix 019 applied to enrollments: delete the policy and let the server
action be the only writer.

```sql
drop policy if exists "quiz_submissions: student insert own" on public.quiz_submissions;
```

Then switch the insert at `lib/actions/quiz.ts:211` to the service-role client (identity and
enrollment are already verified above it, at lines 46-63 and 127-146). If a client-side write must
stay, the honest form is a `SECURITY DEFINER` RPC that takes only `quiz_id`, `class_id` and the
answers, and computes the score server-side.

`feedback_responses: student insert own` (`007_activity.sql:119-121`) and
`student_progress: student write own` (`007_activity.sql:153-156`) have the same shape. Their blast
radius is much smaller — fake feedback and fake progress rows, no grade — but the app-layer
enrollment gates in `lib/actions/feedback.ts:39-49` and `lib/actions/progress.ts:29-37` are likewise
unenforced at the RLS layer.

---

### H2 — The educator approval gate is UI-only; an unapproved educator gets a working class and all gated content

**[verified]**

**Location**
- `approval_status` is checked in exactly one enforcement site: `app/(educator)/layout.tsx:26-27`
- `lib/actions/classes.ts:36` — `createClass` checks `profile.role !== 'educator'` and nothing else
- Live policy `classes: educator write own` — `educator_id = auth_profile_id() AND auth_role() = 'educator'`
- `can_read_experiment_content()` (`013_gate_content_on_enrollment.sql:53-60`) — educator branch checks class ownership only
- `circuits: educator read reference` (`015_native_simulator.sql:64-77`) — same

A `grep -rn approval_status app lib components` returns 18 hits; every one outside
`app/(educator)/layout.tsx` is either a display badge, the admin approvals page, or the
onboarding/approval *writers*. Nothing else gates on it.

**Evidence** — live probe as a profile with `role='educator'`, `approval_status='pending'`:

```
PROBE3 (rolled back) | sections_before_owning_class=0 sections
  | create_class=ACCEPTED
  | assign_lab=ACCEPTED
  | sections_after=9 sections
  | profiles_readable=1 profiles visible
```

A pending educator went from **0** readable `experiment_sections` to **9** by creating a class and
assigning a published lab to it — both accepted by RLS, no admin involved.

**What an attacker can actually do.** Sign up, pick "Educator" at onboarding (`lib/actions/profile.ts:96`
sets `approval_status='pending'`), get bounced to `/pending-approval` by the layout — and then ignore
the UI entirely. Two paths, both open:

1. **Server actions.** `createClass`, `assignLab`, `generateInviteLink`, `regenerateJoinCode`,
   `addStudentManual`, `updateEnrollment`, `updateClassQuizSettings` in `lib/actions/classes.ts` are
   POST endpoints. The layout redirect never runs for them, and none of them consults
   `approval_status`.
2. **PostgREST directly**, with the anon key and their Clerk token, as the probe above did.

Either way they get: a class, a working join code, unlocked access to every gated
`experiment_sections` / `simulations` / `quizzes` / `quiz_questions` / `feedback_forms` row for any
lab they assign to themselves, and read access to `enrollments`, `quiz_submissions`,
`student_progress` and `sim_attempts` for anybody who joins their class.

Two things bound the damage, and both are worth stating precisely:

- **Student PII is not exposed.** `profiles` carries only `own read` and `admin read all` — verified
  live, 5 policies total, no educator read. The probe educator could see exactly one profile: their
  own.
- **The reference-circuit leak is latent, not live.** `circuits: educator read reference` would hand
  the class owner the worked solutions, but `select count(*) from circuits where role='reference'`
  returns **0** today. The moment a reference circuit is authored, this finding gains an answer-key
  leak.

**Suggested fix.** Enforce approval where the data lives, not in a layout.

```sql
alter policy "classes: educator write own" on public.classes
  using (educator_id = auth_profile_id() and auth_role() = 'educator'
         and auth_approval_status() = 'approved')
  with check (educator_id = auth_profile_id() and auth_role() = 'educator'
              and auth_approval_status() = 'approved');
```

`auth_approval_status()` already exists (migration 018) and is already SECURITY DEFINER with a pinned
`search_path`. Add the same predicate to the educator branch of `can_read_experiment_content()` and
to `circuits: educator read reference`, and add an approval check to `getEducatorProfile()` in
`lib/actions/classes.ts:13-25` so the server actions refuse too.

---

## MEDIUM

### M1 — Clerk is on development keys

**[verified]** for the local environment; **could not check** production.

`.env` (gitignored, read for key *prefix* only — no value reproduced):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
CLERK_SECRET_KEY=sk_test_…
```

`.env.example:4-5` documents the same `pk_test_` / `sk_test_` shapes, so a fresh deploy is steered
toward a development instance too.

**What this means plainly.** A Clerk development instance is not a production trust root. It is
capped at 100 users, it is heavily rate-limited, it issues tokens from a shared
`*.clerk.accounts.dev` domain rather than one you control, and its sessions are not bound to your
production origin. Because the Supabase third-party-auth integration trusts *the Clerk domain* to
mint identities (`.env.example:32-37`), the issuer of every `auth.jwt()->>'sub'` that every RLS
policy in this app keys off is a development instance. Anything that can obtain a token from that
instance is, as far as Postgres is concerned, a user of this platform. Swapping to production keys
also invalidates every existing session and every existing `clerk_user_id`, so this is not a
zero-cost change to defer.

Related: `PROJECT_CONTEXT.md:143` lists `CLERK_WEBHOOK_SECRET` as required, but it is absent from both
`.env` and `.env.example`, and there is no webhook route in `app/api/` — while `proxy.ts:10`
already exempts `/api/webhooks(.*)` from auth. See L7.

**Cannot confirm** what the Vercel production project actually has set; I have no access to it. The
statement above is about what is in the repository and the local environment.

---

### M2 — The compile route's rate limits are per-process, and the semaphore over-admits

**[verified]** by inspection; **[suspected]** for the deployed effect (no load test run).

The compile route is genuinely well defended for a service that runs a real compiler on a stranger's
text — auth-gated twice, size-capped in bytes, hard-killed on timeout. Three gaps remain.

**a) Both limiters are module-level state.**

```ts
// app/api/compile/route.ts:58
const inFlight = new Set<string>()
// lib/simulator/avr/build.ts:147-148
let active = 0
const waiting: (() => void)[] = []
```

On Vercel these live per lambda instance. "One compile in flight per student" and `MAX_CONCURRENT = 4`
are therefore per-instance ceilings, not global ones. Under fan-out, one user's concurrent requests
can land on different instances and each will admit them.

**b) The semaphore can exceed its own cap.** `release()` decrements `active` and *then* resolves a
waiter, but the waiter only re-increments when its continuation runs on a later microtask
(`build.ts:150-163`). A fresh `acquire()` executing synchronously in that gap sees a free slot and
takes it. Both then proceed, and `active` drifts above `MAX_CONCURRENT`. Fix by moving the increment
into `release()` before resolving, or by not decrementing when handing the slot straight to a waiter.

**c) `acquire()` has no queue bound and no timeout.** Queued requests wait forever, each holding a
function invocation open. There is also no per-user quota over time — the only gate is possession of
a Clerk session, and the Clerk instance in use is a development one where sign-up is open (M1).

For calibration: a cold Mega build is ~3.6 s of CPU per the comment at `build.ts:47-53`, and the
identical-source cache does not help an attacker, who simply appends a different comment each time to
force a miss.

**Suggested fix.** A shared rate limiter (Vercel KV / Upstash) keyed on the Clerk user id, a bounded
queue that 503s rather than parking, and the semaphore correction above.

---

## LOW

### L1 — `saveAttempt` does not validate `simulationId` against `classId` — confirmed still low

**[verified]** — the previously recorded assessment holds.

`lib/actions/simulator.ts:62-94`. `studentContext()` (lines 32-56) re-derives the student from the
Clerk session and requires an **active enrollment in `classId`** before anything is written. But
`simulationId` is passed straight into the upsert, and the RLS backstop
(`sim_attempts: student write own`, verified live) checks only `student_id = auth_profile_id()` and
`auth_role() = 'student'`.

**What a student could actually falsify.** They can create or overwrite `sim_attempts` rows keyed
`(their own student_id, any simulation_id in the database, a class they are genuinely enrolled in)`.
Concretely: park an arbitrary circuit document and code bundle under a simulation belonging to a
different lab or a different experiment, so a junk autosave appears in that class's
`sim_attempts: educator read own classes` view for a simulation that is not part of that class's
curriculum. That is the whole of it.

What they **cannot** do, each checked:

- write to another student's row — `student_id` is pinned by both the action and RLS;
- write into a class they are not enrolled in — `studentContext` refuses, and there is no other writer;
- read anything new — `loadAttempt` (lines 103-158) reads `circuits` through the **RLS** client, which
  gates on `can_read_experiment_content()`, so a foreign `simulationId` returns nothing;
- reach a `role='reference'` circuit — `loadAttempt` filters `role='starter'` *and* RLS blocks it.

Integrity only, own rows, no privilege gain and no content gain. **Low is still the right rating.**
A `simulationId → experiment → lab → class_labs → classId` check in `studentContext` closes it
cheaply, and the same helper would then cover `loadAttempt`.

### L2 — A student can move their dropped enrollment to another class

**[verified]** — `supabase/migrations/005_classes.sql:267-270`; live `with_check` is
`((student_id = auth_profile_id()) AND (status = 'dropped'))`. The `USING` clause allows the update
and the `WITH CHECK` pins only the owner and the status, so `class_id` is mutable. The result is
always a `dropped` row, which grants no content access — `is_enrolled_in_class()` requires
`status='active'`. Self-affecting; worth pinning `class_id` for tidiness.

### L3 — Join codes and invite tokens come from `Math.random()`

**[verified]** — `lib/actions/classes.ts:7-11` (join code: 3 + 4 base36 characters),
`:234-237` (invite link token), `:281-284` (manual invite token). `Math.random()` is not a CSPRNG;
V8's xorshift128+ internal state is recoverable from a small number of observed outputs, so an
educator who has seen a handful of codes from one server process can predict others. This matters
because a join code is the *only* gate on enrolling into a class, and enrollment is what unlocks all
gated content (013). Use `crypto.randomBytes` / `crypto.randomUUID`.

Related observation: nothing in the codebase ever redeems `class_invites.token` — the only enrollment
path is `joinByCode` (`lib/actions/enrollment.ts`). The invite-link feature appears to be
half-implemented, which is worth knowing before someone finishes it against these tokens.

### L4 — `/api/tinkercad-preview` interpolates unvalidated input into a fetch URL

**[verified]** — `app/api/tinkercad-preview/route.ts:8-21`. `designId` goes unvalidated into
`` `https://www.tinkercad.com/things/${designId}` ``.

Cross-host SSRF is **not** reachable: the authority component is terminated by the `/` before the
interpolation point, so `@`, `:` and `../` cannot move the request off `www.tinkercad.com`. The route
is also auth-gated (it is not in `isPublicRoute`, so `proxy.ts` applies `auth.protect()`).

What remains is minor: a signed-in user can make the server fetch arbitrary *paths* on tinkercad.com
and learn from the response whether they exist, plus one regex-extracted `og:image` value; and
`next: { revalidate: 3600 }` mints a new data-cache entry per distinct id, which is unbounded.
Validate with `/^[A-Za-z0-9_-]{1,64}$/`.

### L5 — `anon` holds broad table grants; only the absence of anon-facing policies stops it

**[verified]** — `supabase/schema.sql:1432` runs
`grant all on all tables in schema public to anon, authenticated, service_role`. Live
`information_schema.column_privileges` confirms `anon` holds INSERT, UPDATE and SELECT on every
column of `profiles`, and INSERT/UPDATE on `quiz_questions`.

Nothing is exploitable today, because every policy in the schema is written `to authenticated` and
RLS denies by default when no policy matches a role. But it means the safety margin is one omitted
`to authenticated` clause wide: the first policy someone writes without a role clause becomes
anon-reachable immediately. `revoke insert, update, delete on all tables in schema public from anon;`
costs nothing — the 013 revoke already proves the pattern works here.

### L6 — Admin actions mass-assign the client's object into `.update()`

**[verified]** — `lib/actions/admin.ts:79`, `:170`, `:518`, `:617` spread `...data` directly.
Each is behind `requireAdmin()` and uses the RLS-scoped server client, so this is hardening rather
than a hole; an admin can already write those columns. Worth an explicit allow-list if these ever
gain an educator-callable sibling.

### L7 — `proxy.ts` exempts a webhook path that does not exist

**[verified]** — `proxy.ts:10` lists `/api/webhooks(.*)` in `isPublicRoute`, and `find app/api -type f`
shows no such route. A dead matcher today; the hazard is that whoever adds a Clerk webhook handler
lands on an unauthenticated path by default and has to remember to verify the Svix signature
themselves. `CLERK_WEBHOOK_SECRET` is named in `PROJECT_CONTEXT.md:143` but exists in neither `.env`
nor `.env.example`. Either remove the matcher or add the handler with signature verification.

---

## Observation (not a vulnerability)

**Educators cannot read their own students' profile rows.** `profiles` carries five policies and none
of them is an educator read (verified live). The gradebook embeds `profiles` through `enrollments`
(`app/(educator)/educator/classes/[classId]/gradebook/page.tsx:134-151`), so `p` resolves to `null`
and student names render as `'Unknown'` with empty emails. That is a functional consequence of the
access model, not a security defect — flagged only because the obvious "fix" is to add an educator
read policy on `profiles`, and that policy must be scoped to students actively enrolled in a class
the educator owns, or it becomes a directory of every user on the platform.

Related dead code: `ensureProfile()` (`lib/actions/profile.ts:29-72`) is never called. Its docblock
says "Call this from authenticated layouts to bootstrap the profile on first sign-in", which is no
longer true and is load-bearing for C1's exploitability.

---

## Checked and found clean

Each of these was actively verified, not assumed.

1. **RLS is enabled on all 21 public tables.** Live query over `pg_class.relrowsecurity` for
   `relkind='r'` in `public`: 21 rows, all `true`, all with at least two policies. No table has RLS off.
2. **No policy uses `USING (true)` or `WITH CHECK (true)`.** Live query over `pg_policies` filtering
   for `qual = 'true' or with_check = 'true'` returned nothing. The `using (true)` policies that
   001-004 originally shipped were all replaced by 013 and are gone from the live database.
3. **The only `{public}`-role policies are the deliberate catalogue reads.** `labs: public read published`
   and `experiments: read published`, both `(published = true)` — exactly what
   `013_gate_content_on_enrollment.sql:23-25` says it is leaving public, and no experiment *content*
   lives in either table.
4. **`profiles: admin update all` has no `WITH CHECK`, and that is harmless.** Postgres falls back to
   the `USING` expression, so the check is `auth_is_admin()` — caller-derived, always true for the
   admin performing the write. It does not widen anything an admin does not already have.
5. **Quiz answer keys are protected.** `information_schema.column_privileges` shows the
   `authenticated` SELECT grant on `quiz_questions` covers 12 columns and **omits `correct_answer`
   and `explanation`**; `anon` has **no SELECT at all** on that table. Confirmed at runtime by the
   negative control in probe 2: `select correct_answer from quiz_questions` as an impersonated
   student → `42501`. All three service-role readers are behind an authorisation check first —
   `lib/actions/quiz.ts:152` (after identity *and* enrollment, lines 46-63 and 127-146),
   `lib/actions/admin.ts:354` (after `requireAdmin()`), and the admin quiz page behind the `(admin)`
   layout.
6. **Migration 018 is still in force.** Live `profiles: own update` `with_check` reads
   `((clerk_user_id = …) AND ((NOT is_admin) OR auth_is_admin()) AND (role = auth_role())
   AND (approval_status = auth_approval_status()))`. The UPDATE-side escalation is genuinely closed.
7. **Migration 019 is still in force.** `enrollments` has 6 live policies and
   `enrollments: student insert own` is not among them. Students have SELECT (own) and UPDATE
   (own, to `dropped`) and no INSERT.
8. **No later migration reopened either.** `grep -niE 'create policy|drop policy|alter policy|enable row level|grant |revoke |security definer|create or replace function'`
   across 016, 017 and 020-027 returns **zero matches** — those eight files are content seeding only.
9. **The service-role key cannot reach the browser.** Only `lib/supabase/admin.ts:11` reads
   `SUPABASE_SERVICE_ROLE_KEY`. Its five importers are all server modules and none carries
   `'use client'` (checked individually). Grepping the built output for the literal key value: it
   appears only under `.next/dev/cache/turbopack/` (server-side dev artifacts, gitignored) and
   **nowhere under `.next/static/`**, which is what the browser is served. `next.config.ts` has no
   `env` block re-exporting server variables.
10. **No secrets are committed.** `git ls-files` matching env/secret/key patterns returns only
    `.env.example`. `git log --all --diff-filter=A -- '.env' '.env.local' '.env.*' '*.pem'` shows the
    example file as the only such file ever added. A `git grep` for live and test key shapes
    (`sk_live`, `pk_live`, `sk_test_…`, Supabase JWT prefix, `sb_secret_…`) over all tracked files hits
    only the placeholder line in `.env.example`. `.gitignore:28-33` covers `.env`, `.env*.local` and
    `*.zip` ("archives — these have held copies of .env"), and `/.clerk/`.
11. **The compile route is authenticated and validates its input.** `auth()` at
    `app/api/compile/route.ts:67`, *plus* `proxy.ts` `auth.protect()` (the route is not in
    `isPublicRoute`). `source` must be a string, `board` is checked against a closed two-value enum
    (`isCompileBoard`), and the size cap is measured in **bytes** not UTF-16 units
    (`route.ts:96`, `MAX_SOURCE_BYTES = 64 KB` at `build.ts:44`) — so astral-plane padding cannot walk
    past it.
12. **Path traversal into the compile route is not reachable.** No user-controlled value ever reaches
    the host `fs` module. The only user data is the prepared `cpp` string, written to
    `/build/sketch.cpp` inside Emscripten MEMFS (`build-worker.mjs:392-393`); every host-side
    `fs.readFileSync` path is built from `process.cwd()` plus hard-coded constants. Verified the
    sandbox is total: `grep -o 'NODEFS\|NODERAWFS\|mountNode'` over
    `.cache/avr/wasm/package/tools/cc1plus.mjs` returns **zero** occurrences, so the WASM compiler has
    no host filesystem mounted at all — `#include "/etc/passwd"` cannot resolve to anything, and
    neither can any `..` sequence.
13. **Compile output is never written to disk and cannot be read by a later request.** The only
    persistence is the in-process `Map` at `build.ts:109`, keyed on
    `sha256(board + ' ' + source)` (`build.ts:124-126`). Retrieving an entry requires already
    possessing the exact bytes that produced it, so the shared cache leaks nothing between students.
    The response carries `Cache-Control: no-store` (`route.ts:169`).
14. **Compile time is genuinely bounded.** 20 s hard timeout with `worker.terminate()` on every path
    (`build.ts:199-222`), running in a `worker_thread` precisely so synchronous WASM can be killed —
    the reasoning is written out at `build-worker.mjs:3-11` and it is correct.
15. **Every server action re-derives the caller and checks ownership.** All eight files in
    `lib/actions/` start from `auth()` and none trusts a user id from the client. `admin.ts` gates all
    21 exports behind `requireAdmin()` (`:10-24`). `classes.ts` re-verifies
    `.eq('educator_id', profile.id)` on the class before every single mutation. `quiz.ts`,
    `feedback.ts`, `progress.ts` and `simulator.ts` each verify an active enrollment in the named
    class before writing. The gaps found above are in the **RLS backstop**, not in these actions.
16. **Dev-only surfaces are double-gated.** `proxy.ts:16-18` exempts `/dev`, `/sim`, `/vendor` and
    `/api/dev` only when `NODE_ENV === 'development'`, *and* both `(dev)` pages independently call
    `notFound()` in production (`app/(dev)/dev/editor/page.tsx:13`, `app/(dev)/dev/sims/page.tsx:12`),
    *and* `app/api/dev/harvest/route.ts:18-20` returns 404 in production. Its write target is a fixed
    constant path (`:27`), not user-supplied.
17. **Client-side Supabase usage is limited and safe.** Only `components/sections/QuizSection.tsx` and
    `components/sections/FeedbackSection.tsx` use `useSupabaseClient`. Neither selects
    `correct_answer` or `explanation` (`QuizSection.tsx:78`), and the column grant would refuse them
    anyway.
18. **Supabase security advisors show nothing new.** The only findings are the 18
    SECURITY-DEFINER-executable warnings across the 9 RLS helpers — the exact warnings migration 014
    documents as knowingly accepted, with the correct explanation that revoking `EXECUTE` from
    `PUBLIC` breaks every gated read with `42501`. **Do not act on them.** No missing-RLS advisory, no
    exposed `auth.users`, no SECURITY DEFINER view.
19. **Live data was not mutated.** After all three probes:
    `probe_profiles_left = 0`, `probe_submissions_left = 0`, `total_profiles = 10`, `admins = 4`,
    `classes = 4`, `quiz_questions = 48`.

---

## Could not check

- **Vercel production environment variables.** I have no access to the Vercel project
  (`prj_4L9YmL30JjFvSrGM6PsF9D6A00Zn`). M1 reports what is in the repository and the local `.env`;
  whether production runs live Clerk keys is unverified either way.
- **Clerk dashboard configuration** — whether sign-up is open or restricted to a domain, the allowed
  redirect origins, and which Clerk domain the Supabase third-party-auth integration is configured to
  trust. C1's ease of exploitation depends on sign-up being open; the hole exists regardless.
- **Supabase dashboard settings outside the SQL surface** — whether the anon key is a legacy JWT or a
  publishable key, PostgREST `max-rows` and exposed schemas, and network restrictions.
- **No end-to-end HTTP exploit was performed.** C1, H1 and H2 were proved at the database
  authorisation layer with impersonated, rolled-back transactions rather than by registering a real
  Clerk user and driving PostgREST from a browser. The one remaining assumption is that a browser can
  hold a Clerk token and reach `/rest/v1` with the anon key — which is precisely what
  `lib/supabase/client.ts:40-58` does on every page of the app, and what migrations 018 and 019 were
  both written in response to.
- **M2's deployed behaviour under load** was not measured; the semaphore over-admission is a
  code-inspection finding and the per-instance limitation is inferred from Vercel's execution model.
- **`.env` was read for variable names and key prefixes only.** No secret value was printed, logged,
  or transmitted.
