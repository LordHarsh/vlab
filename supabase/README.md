# Supabase database

Two sets of SQL live here, and they serve different jobs.

| Directory / file | What it is | When you run it |
| --- | --- | --- |
| `schema.sql` | **Consolidated.** The whole schema as one forward definition. | Standing up a **brand-new** Supabase project. |
| `migrations/` | **Incremental.** `001..NNN`, applied in order, historically. | Changing an **existing** database (including production). |
| `seeds/` | Content and setup notes. | After the schema exists, to populate a new instance. |

`schema.sql` and `migrations/` describe the **same database**. They are two views of one thing, not two things.

---

## (a) Brand-new Supabase instance

Create the project, then in the SQL Editor (or `psql`) run, in this order:

```
1.  supabase/schema.sql                                  <- schema only, no data
2.  supabase/seeds/002_labs.sql                          <- the IoT Virtual Lab row
3.  supabase/seeds/003_experiments.sql                   <- the 12 experiments
4.  supabase/migrations/016_backfill_authored_content.sql <- sections, quizzes, 48 questions,
                                                            feedback forms, builtin sims
5.  supabase/migrations/017_fix_smart_traffic_code_meta.sql
6.  supabase/migrations/020_native_experiments.sql       <- starter circuits (exp 1, 3)
7.  supabase/migrations/021_native_experiments_2_4_6.sql <- starter circuits (exp 2, 4, 6)
```

Steps 2-7 are **data only** against the schema from step 1 — run them only if you want the
IoT lab content. Steps 4-7 are idempotent and safe to re-run.

Then create your admin: sign up in the app, complete onboarding, and follow
`seeds/001_admin_profile.sql` (it is instructions, not executable SQL).

**Do not** run `migrations/001`–`015`, `018`, `019` on a new instance. `schema.sql` already
contains everything they do, in corrected final form. Replaying them would fail — several of
them alter objects that `schema.sql` already created correctly.

## (b) Existing database (production, staging, your own dev project)

Run only the numbered migrations that have not been applied yet, in ascending order.
**Never** run `schema.sql` against a database that already has these tables. It uses
`create table if not exists`, so it will silently skip existing tables and will *not*
retrofit changed columns or constraints — you would get a false sense of being up to date.

---

## The rule that keeps these two in sync

> **Every schema change must be written TWICE:**
> **once as a new numbered migration in `migrations/`, and once folded into `schema.sql`.**
> **Same pull request, both files.**

This is the whole point of keeping two sets. A migration alone drifts `schema.sql` and the
next new instance comes up wrong. Editing `schema.sql` alone means production never gets the
change. Neither failure is loud — both surface weeks later as "works on prod, broken on the
new project", which is the worst kind of bug to chase.

Two supporting rules:

- **Never edit an already-applied migration.** They have run against the live database;
  rewriting history desynchronises it. Fix forward with a new numbered file.
- **`schema.sql` is a *forward definition*, not a replay.** When a new migration corrects an
  older one, `schema.sql` states only the corrected end result. It does not narrow a
  constraint and then widen it again the way `011` → `015` → `016` did.

### Verifying you got it right

```bash
npm i -D @electric-sql/pglite      # one-time
node scripts/verify-schema.mjs
```

`scripts/verify-schema.mjs` builds two throwaway Postgres databases in memory, runs the
migration chain into one and `schema.sql` into the other, and diffs the system catalogs —
tables, columns, constraints, indexes, functions, RLS flags, policies, table grants, column
grants, triggers. Anything present in one and missing from the other is reported and the
script exits non-zero. It then asserts the security invariants still hold (answer key hidden,
content gated on enrollment, no self-enroll, no self-promotion, helper `EXECUTE` intact).

Run it whenever you touch either file. Zero differences is the bar.

---

## Things that will bite you

**Do not revoke `EXECUTE` on the `auth_*` / `can_read_*` / `is_*` helpers.** The Supabase
security advisor flags all nine as "SECURITY DEFINER function executable by
anon/authenticated" and recommends revoking it. Doing so breaks every RLS policy that calls
them (`ERROR: 42501: permission denied for function can_read_experiment_content`) because
policy expressions are evaluated with the *invoking* role's privileges. The trap: revoking
from `anon, authenticated` looks like it worked and changes nothing — those roles inherit
`EXECUTE` from `PUBLIC`. Only revoking from `PUBLIC` has an effect, and that is exactly what
breaks things. See `migrations/014` for the full write-up. The warning is accepted knowingly.

**The helpers must stay `SECURITY DEFINER` with a pinned `search_path`.** They are called from
the RLS policies on the tables they query; without `SECURITY DEFINER` the policy re-enters
itself and Postgres raises `infinite recursion detected in policy`. That bug was fixed three
times (`010`, `012`, `013`).

**`quiz_questions.correct_answer` and `.explanation` are not readable by the `authenticated`
role at all** — admins included. That is a column-level `REVOKE`/`GRANT` from `013`, because
RLS filters rows and cannot filter columns. Any server-side code that needs the answer key
must use the service-role client (`lib/supabase/admin.ts`).

**There is deliberately no `enrollments: student insert own` policy** (`019`). Enrollment goes
through `lib/actions/enrollment.ts` on the service-role client, which is where the join code,
invite and capacity checks live. Re-adding the policy reopens the bypass.

**`simulations.type` is `('tinkercad', 'native', 'builtin')` and should not be narrowed.**
`011` narrowed it to `tinkercad` alone and wiped every `config`; `015` and `016` had to add the
other two back. `tinkercad` is the permanent fallback for experiments the native simulator
cannot build yet (all the Raspberry Pi ones).

**`class_labs` carries two policies that do the same thing** — `educator read own` and
`educator read own classes`. `012` intended to replace the first but its `DROP` named a policy
that did not exist yet, so both survive on the live database. `schema.sql` reproduces both on
purpose, so new instances match production. Cleaning it up means a new migration *and* an edit
to `schema.sql`.
