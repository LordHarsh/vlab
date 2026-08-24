# VLab — Project Context & Owner's Aims

> Handoff document for any Claude Code session (local or remote) working on this repo.
> Owner: Harsh (LordHarsh). Last updated: 2026-07-22. Current main: `b81572f`.

---

## 1. What This Project Is

**VLab** is a Virtual Lab platform (inspired by vlab.co.in) where students run interactive
science/engineering experiments in the browser. Each experiment walks the student through
structured sections — aim, theory, pretest, procedure, simulation, posttest, feedback —
with progress tracked in a database.

The platform serves three roles:
- **Students** — join classes via join code, complete experiments, take quizzes, submit feedback
- **Educators** — create/manage classes, view rosters and gradebooks, override quiz settings (requires admin approval to become an educator)
- **Admins** — full CRUD over labs/experiments/quizzes/feedback forms, approve educators, manage users

## 2. The Owner's Aims (in priority order)

These are the standing goals. Any work on this repo should serve them:

1. **Everything fetches real data from the database.** No mock data, no hardcoded
   experiment content in page components. This was a repeated problem early on
   (pages silently rendering hardcoded content while looking "done"). If a page shows
   content, it must come from Supabase.

2. **Schema, seed data, and TypeScript types must always agree.** We lost significant
   time to drift between the SQL schema, the seed files, and `types/database.ts`
   (e.g. a seed file referencing a column named `type` when the table had `quiz_type`).
   When changing any one of the three, update the other two in the same commit.

3. **Prefer single, idempotent SQL files over helper scripts.** The owner explicitly
   does not want extra Node scripts for DB setup when one SQL file pasted into the
   Supabase SQL editor can do the job. Seeds must be safe to run multiple times
   (`ON CONFLICT DO NOTHING`, `IF NOT EXISTS`).

4. **The build must always pass on main.** `npm run build` is the gate. TypeScript
   errors are fixed, not suppressed (a whole series of commits exists just for
   null-narrowing, Zod transform types, and query-shape alignment).

5. **Working auth end to end.** Clerk handles auth; every auth-adjacent route the UI
   links to must actually exist (a `/sign-in` 404 shipped once because the middleware
   allowed the route but no page existed). Role-based access must be enforced.

6. **Student progress must be genuinely trackable.** Enrollment (class join codes),
   per-section progress, quiz submissions, and feedback all persist per user.

7. **Clean git history.** Work happens on feature branches cut from an up-to-date
   `main` (always `git checkout main && git pull` before starting). We once had a
   branch with *no common ancestor* with main (orphaned history) and had to rebuild
   it — never create branches from stale or orphaned starting points.

## 3. Current Architecture (post-rebuild)

The platform was fully rebuilt in commit `774ed68` ("Build full VLab platform") and
refined by ~29 follow-up commits. The old `app/labs/[category]/[experimentId]` structure
is **gone** — any docs/branches referencing it are historical.

**Stack:** Next.js 16.1.1 (App Router, Turbopack), React 19, Clerk (`@clerk/nextjs`),
Supabase (`@supabase/supabase-js` + `@supabase/ssr`), shadcn/ui + Radix, Tailwind,
react-hook-form + Zod, Konva (canvas), Recharts. Middleware lives in `proxy.ts`
(Next 16 exports middleware as `proxy`).

**Route groups:**
```
app/
├── (admin)/admin/        # labs/experiments/quizzes/feedback CRUD, approvals, users
├── (educator)/educator/  # classes, rosters, gradebook, settings
├── (student)/            # dashboard, experiment viewer (12 section types), quizzes
├── (public)/labs/        # public lab browsing
├── onboarding/           # 2-step role-based profile completion
├── pending-approval/     # educators awaiting admin approval
├── profile/              # Clerk UserProfile
├── sign-in/ sign-up/     # Clerk auth pages
└── api/
```

**Database:** 14 migrations in `supabase/migrations/` (001_profiles → 014_harden_function_surface),
covering profiles, labs, experiments, sections, quizzes, feedback forms, classes,
enrollments, progress, activity, approval status, Tinkercad-only simulations, and
content access control.
Seeded content: 12 IoT experiments with sections, simulations, quizzes, feedback forms.

> **Seeds are currently out of date with the schema.** `seeds/003_experiments.sql`
> inserts simulations as `type='builtin_js'`, but migration 011 constrains the column
> to `'tinkercad'`, so those inserts fail. Deliberately left as-is pending the
> simulator rebuild — fix the simulation rows as part of that work.

**Simulations:** Tinkercad embeds only (migration 011). Fetched server-side; the client
gets a stable `designId` and renders a preview image + launch flow, loading the iframe
on demand.

**Design:** Airbnb-inspired design system documented in `docs/DESIGN.md`. Follow it for any
UI work (font weights, button/input/select tokens were specifically normalized).

## 4. Hard-Won Lessons (don't repeat these)

- **RLS recursion:** `classes` ↔ `enrollments` policies referenced each other and
  caused infinite recursion. Fixed with `SECURITY DEFINER` helper functions
  (migrations 010 and 012). Be careful writing new policies that cross-reference tables.
- **RLS vs. server operations:** Onboarding profile upsert and join-by-code class lookup
  must use the **service-role (admin) client** — the anon client gets blocked by RLS
  before the user has a profile row. See `df525a7`, `9b465cc`, `3ea3518`.
- **RLS filters rows, not columns.** `quiz_questions` was readable by every authenticated
  user including `correct_answer` and `explanation`, so any signed-in student could pull
  the answer key from the anon-key client. Migration 013 fixes this with column-level
  `GRANT`s. Consequence: the `authenticated` role cannot read those two columns *at all*,
  **admins included** — any server-side reader of the answer key must use the
  service-role client. Three places do: `lib/actions/quiz.ts` (grading),
  `lib/actions/admin.ts` (`editQuizQuestion` merge), and the admin quiz editor page.
- **Never revoke EXECUTE on the RLS helper functions.** The Supabase security advisor
  flags all eight `auth_*` / `can_read_*` / `is_*` helpers as publicly executable and
  suggests revoking EXECUTE. Doing so breaks every gated read with
  `42501: permission denied for function ...` — RLS policy expressions *are* evaluated
  against the invoking role's privileges. The trap: `revoke ... from anon, authenticated`
  reports success but changes nothing (they inherit from PUBLIC), so only revoking from
  PUBLIC has an effect — and that is the one that breaks it. The warning is acceptable;
  each helper reports only on the caller's own access. Written up in migration 014.
- **App-layer gating is not access control.** Enrollment used to be enforced only in
  `[expSlug]/layout.tsx`, so the UI was gated but the REST API was wide open. Migration
  013 moves the gate into RLS via `can_read_experiment_content()`. `labs` and
  `experiments` stay public on purpose — they are catalogue metadata and the public
  `/labs` page counts published experiments per lab.
- **First admin:** There is no pre-created seed admin. Promote the first real user
  manually (instructions in repo — see `4dcf2f9`).
- **Next 16 quirks:** `params` is a Promise (must `await`); middleware is exported as
  `proxy`; `await` only in async server components (`e0fc167`).
- **JSON in SQL:** Postgres JSONB literals reject `\'` escape sequences — write seed
  content without apostrophe-escaping hacks.

## 5. Environment Setup

Required in `.env.local` (values are with the owner — never commit them):

```
NEXT_PUBLIC_SUPABASE_URL=        # https://odaocqfnhqarewoimrma.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # required: onboarding + enrollment use admin client
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Supabase dashboard: https://supabase.com/dashboard/project/odaocqfnhqarewoimrma
Apply migrations by running the files in `supabase/migrations/` in order in the SQL
editor (or `supabase db push` if the CLI is linked).

Commands: `npm run dev` / `npm run build` / `npm run lint`.

## 6. Git Workflow

1. `git checkout main && git pull origin main` — always start current.
2. Branch from main: `claude/<topic>-9VF8s` naming has been used for Claude sessions.
3. Commit with clear messages; push with `git push -u origin <branch>`.
4. Never force-push main; never branch from anything with orphaned history.
5. Obsolete: local/remote branch `claude/analyze-virtual-lab-9VF8s` predates the
   rebuild and shares no useful state with the current app — do not build on it.

## 7. Where to Look First

| Need | Location |
|---|---|
| Design system rules | `docs/DESIGN.md` |
| Schema (source of truth) | `supabase/migrations/` (001–014, in order) |
| DB types | `types/database.ts` — must mirror migrations |
| Auth + route protection | `proxy.ts` |
| Content access rules | `supabase/migrations/013_gate_content_on_enrollment.sql` |
| Admin features | `app/(admin)/admin/` |
| Educator features | `app/(educator)/educator/` |
| Student experiment viewer | `app/(student)/` |

> The pre-rebuild docs (`VIRTUAL_LAB_ANALYSIS.md`, `SETUP_GUIDE.md`, `SETUP_DATABASE.md`,
> `SIMPLIFIED_TECH_STACK.md`, `QUICK_SETUP.sh`, `docs/`) described the old
> `categories` / `user_progress` schema and were deleted on 2026-07-22. The Node DB
> helper scripts (`scripts/`) went with them, per aim #3. Recover from git history if
> ever needed.
