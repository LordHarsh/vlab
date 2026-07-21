# VLab

Virtual Lab platform for interactive science and engineering experiments. Students join a
class with a code, work through structured experiment sections (aim, theory, procedure,
simulation, quizzes, feedback), and their progress persists per class.

Next.js 16 (App Router) · React 19 · TypeScript · Clerk · Supabase · Tailwind + shadcn/ui

## Getting started

```bash
npm install
cp .env.example .env      # fill in the values
npm run dev
```

### Environment

All six variables in `.env.example` are required. `SUPABASE_SERVICE_ROLE_KEY` is not
optional — onboarding, class join-by-code, and quiz grading all go through the
service-role client and fail without it.

### Database

Apply `supabase/migrations/*.sql` in numeric order in the Supabase SQL editor, or
`supabase db push` if the CLI is linked. There is no seed admin: sign up normally,
complete onboarding, then promote yourself.

```sql
update profiles set is_admin = true, approval_status = 'approved'
where email = 'you@example.com';
```

Sign out and back in — you will land on `/admin`.

## Commands

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build — the gate for main |
| `npm run lint` | eslint |

## Where things live

| | |
|---|---|
| **Project context, owner's aims, hard-won lessons** | [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) — **read this first** |
| Design system | [`DESIGN.md`](./DESIGN.md) |
| Schema (source of truth) | `supabase/migrations/` |
| DB types (must mirror migrations) | `types/database.ts` |
| Auth + route protection | `proxy.ts` (Next 16 exports middleware as `proxy`) |
| Server actions | `lib/actions/` |
| Supabase clients | `lib/supabase/` — `server`, `client`, `admin` (service role) |

## Access model

Roles are `student` / `educator` on `profiles.role`, with `is_admin` as an orthogonal
flag. Educators need admin approval before their dashboard unlocks; students are
auto-approved.

Route access is enforced in each route group's `layout.tsx`. Data access is enforced by
RLS — including content, which is gated on an active enrollment in a class that has the
parent lab assigned (`013_gate_content_on_enrollment.sql`). Quiz answer keys are
protected by column-level grants and are readable only through the service-role client.
