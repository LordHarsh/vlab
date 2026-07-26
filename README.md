# VLab

Virtual Lab platform for interactive science and engineering experiments. Students join a
class with a code, work through structured experiment sections (aim, theory, procedure,
simulation, quizzes, feedback), and their progress persists per class.

The simulation section is a circuit simulator built into the app — real emulated
microcontrollers running real compiled firmware against a real analog solver. It is the
bulk of the codebase; see [The simulator](#the-simulator).

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
| `npm test` | every simulator suite (~6.5 min — it runs real emulators) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npx tsx lib/simulator/__tests__/<name>.test.ts` | one suite on its own |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and the build on every
push to `main` and every pull request.

### Two things about the build

`npm run build` is `node scripts/build-avr-hex.mjs --toolchain-only && next build --webpack`,
and neither half is incidental.

The script fetches the ~23 MB WASM AVR toolchain into `.cache/avr/`, which is gitignored.
A clean deploy without it has no compiler, and students cannot compile a sketch.

`--webpack` is there because **Turbopack cannot build this app** — it panics writing the
file-trace manifest for the compile route (`NftJsonAsset: cannot handle filepath
node:crypto`). Isolated by building the same tree both ways. See
[`docs/BUILD_NOTES.md`](./docs/BUILD_NOTES.md), and retry without the flag after any
Turbopack upgrade.

## The simulator

A student places parts on a canvas, wires them, writes code, and runs it. Nothing is
mocked: the firmware is really compiled, the CPU is really emulated, and the voltages
come out of a real solver.

**Boards** — Arduino Uno and Mega 2560 (avr8js, Arduino C++) and Raspberry Pi Pico
(rp2040js, MicroPython). One board runs at a time; two are refused with an explanation,
because each is its own CPU with its own clock.

**Compilation** is real. `app/api/compile/` runs `avr-gcc`/`cc1plus` compiled to WASM in a
worker thread against the actual Arduino core sources, and returns Intel HEX plus genuine
GCC diagnostics. There is no sketch interpreter and no library interception.

**The analog side** is modified nodal analysis. Linear devices stamp conductances;
nonlinear ones (diodes, LEDs, transistor-class models) are solved by Newton–Raphson with
gmin stepping. When the circuit holds a reactive element — a capacitor, an inductor, a
motor or relay winding — the engine additionally steps a backward-Euler transient, with
the timestep tuned from the circuit's own smallest time constant.

**A circuit needs no microcontroller.** Batteries and a bench supply are first-class
parts, and `lib/simulator/passive.ts` solves a board-less document, so battery → resistor
→ LED works and lights.

### Layout

| | |
|---|---|
| Part library — art, pins, props, 30 parts | `lib/simulator/model/parts.ts` |
| Document model, actions, undo | `lib/simulator/model/document.ts` |
| Netlist + device instantiation | `lib/simulator/model/compile.ts` |
| Device models (the physics) | `lib/simulator/devices.ts` |
| MNA solver, Newton, transient stepping | `lib/simulator/solver.ts` |
| AVR engine · Pico engine | `lib/simulator/engine.ts` · `lib/simulator/pico/engine.ts` |
| Protocol state machines (DHT11, 1-Wire, SPI, HD44780 …) | `lib/simulator/behavioural.ts` |
| Board-less DC solve | `lib/simulator/passive.ts` |
| Canvas + editor UI | `components/simulator/` |

### Tests

Each suite is a standalone script that prints a comparison table and exits non-zero on
failure — deliberately not a test framework, because those tables are what a human reads
when a number drifts.

```bash
npm test                                              # all of them
npx tsx lib/simulator/__tests__/transient.test.ts     # just one
```

20 files, 3,309 assertions, about 6.5 minutes — they boot real emulators and solve real
circuits rather than asserting against mocks. The house style is that **expected values are derived by
hand from theory, never captured from the engine's own output** — a test that records
what the code currently does proves only that it still does it.
`transient.test.ts` and `lcd.test.ts` are the ones to read before writing a new suite.

Two guards worth knowing about, both written after real bugs:

- `lib/simulator/model/prop-reachability.ts` catches a part that declares a property
  which never reaches the solver. It compiles the circuit twice with only that property
  changed and compares the serialised result, so a value nothing reads shows up as "no
  difference". The LED colour table sat complete in `parts.ts` while `compile.ts` never
  read it, and every LED solved as red. The module is deliberately non-throwing — it is
  asserted on by `compile.test.ts`, `lcd.test.ts` and `sources.test.ts` rather than
  failing the build on its own.
- Several suites render the real canvas and assert on the emitted SVG, then assert the
  *same* state with one input changed produces different pixels. Correct data that
  nothing reads looks identical to working code until you check the output.

## Where things live

| | |
|---|---|
| **Project context, owner's aims, hard-won lessons** | [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) — **read this first** |
| Design system | [`DESIGN.md`](./DESIGN.md) |
| Build gotchas | [`docs/BUILD_NOTES.md`](./docs/BUILD_NOTES.md) |
| What our parts can do | [`OUR_DEVICE_CAPABILITIES.md`](./OUR_DEVICE_CAPABILITIES.md) |
| Tinkercad feature comparison | [`TINKERCAD_DEVICE_PARITY.md`](./TINKERCAD_DEVICE_PARITY.md) |
| Schema (source of truth) | `supabase/migrations/` |
| DB types (must mirror migrations) | `types/database.ts` |
| Auth + route protection | `proxy.ts` (Next 16 exports middleware as `proxy`) |
| Server actions | `lib/actions/` |
| Supabase clients | `lib/supabase/` — `server`, `client`, `admin` (service role) |

`SIMULATOR_ARCHITECTURE.md` is design intent, not an as-built record — it describes
things that were never implemented. Trust the code.

## Access model

Roles are `student` / `educator` on `profiles.role`, with `is_admin` as an orthogonal
flag. Educators need admin approval before their dashboard unlocks; students are
auto-approved.

Route access is enforced in each route group's `layout.tsx`. Data access is enforced by
RLS — including content, which is gated on an active enrollment in a class that has the
parent lab assigned (`013_gate_content_on_enrollment.sql`). Quiz answer keys are
protected by column-level grants and are readable only through the service-role client.

**Do not revoke `EXECUTE` on the RLS helper functions.** Supabase's advisor flags them;
revoking breaks every gated read with `42501`, because policy expressions are evaluated
against the invoking role's privileges. Migration 014's comment block explains it.
