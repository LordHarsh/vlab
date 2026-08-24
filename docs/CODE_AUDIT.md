# Code audit — `main` @ `b37f685`

Read-only audit. No source was modified. Every finding is tagged **[verified]** (I ran it,
read the line, or proved absence by exhaustive search) or **[suspected]** (reasoned, with the
reasoning shown).

**How the evidence was produced.** All 20 simulator suites were run to completion
(`npx tsx` each, 3,309 assertions, all pass, every suite exit 0). `npx tsc --noEmit` exits 0.
`npm run build` exits 0. `npm run lint` reports 0 errors / 2 warnings. `PART_LIBRARY` was
imported at runtime rather than counted by grep. Dead-symbol claims come from a whole-repo
identifier scan across `app components lib types scripts proxy.ts`, then each survivor was
re-checked by hand against `.ts .tsx .mjs .mts .json .md .sql .html`, including dynamic and
string references.

Repo scale for context: 46.2k lines of source, 22.7k lines of tests, 1.4k lines of spikes.

---

# Part 1 — Documentation accuracy

## Summary

| File | Verdict |
|---|---|
| `README.md` | **Accurate** — one overstatement (§1.1) |
| `docs/BUILD_NOTES.md` | **Accurate** |
| `docs/DESIGN.md` | **Accurate as a reference doc** |
| `docs/TRANSIENT_DESIGN.md` | **Accurate — spec that was built** |
| `docs/WIRE_RENDERING_SPEC.md` | **Accurate — spec that was built** |
| `docs/AVR_COMPILE_FINDINGS.md` | **Accurate** |
| `docs/PICO_TRACK_FINDINGS.md` | **Accurate** |
| `docs/PHASE0_RESULTS.md` | **Accurate** |
| `docs/TINKERCAD_DEVICE_PARITY.md` | **Stale-but-clearly-historical** |
| `docs/DESIGN_REFERENCE_SRMEEEVLAB.md` | **Stale-but-clearly-historical** |
| `docs/DEVICE_CONTROLS_AUDIT.md` | **Actively misleading** — gap list is mostly closed |
| `docs/OUR_DEVICE_CAPABILITIES.md` | **Actively misleading** — every citation is off by hundreds of lines |
| `docs/PROJECT_CONTEXT.md` | **Actively misleading** — and README sends you here first |
| `docs/SIMULATOR_ARCHITECTURE.md` | **Actively misleading** — already known, disclaimer is in the wrong file |

**Three docs are actively misleading.** A fourth (`docs/DEVICE_CONTROLS_AUDIT.md`) is borderline
and is counted above as the third of a related pair; see §1.11 for why I separate it.

---

## 1.1 `README.md` — accurate, with one overstatement

You asked for these to be checked rather than trusted. Each was verified independently.

| Claim | Verdict | Evidence |
|---|---|---|
| 30 parts | **[verified]** | Imported `PART_LIBRARY` at runtime: exactly 30 entries. `PALETTE` also 30, and the two sets are identical — no part is in one and not the other. |
| 3 boards | **[verified]** | `electrical.kind === 'mcu'` → `arduino_uno`, `arduino_mega`, `raspberry_pi_pico`. |
| 20 test files | **[verified]** | `ls lib/simulator/__tests__/*.test.ts` → 20. |
| ~3,300 assertions | **[verified]** | Ran all 20. Sum of the `N/N passed` footers is **3,309**, all passing, every suite exit 0. "~3,300" is if anything modest. |
| Real avr-gcc-as-WASM compilation | **[verified]** | `lib/simulator/avr/build-worker.mjs:130-133` maps `cc1plus.wasm`, `avr-as.wasm`, `avr-ld.wasm`, `avr-objcopy.wasm`; runs them in a `worker_thread` against `.cache/avr/ArduinoCore-avr-1.8.7`. No interpreter, no library interception. |
| MNA + Newton–Raphson + backward-Euler transient | **[verified]** | `solver.ts:2` (MNA), `solver.ts:309` `newton()`, `solver.ts:283` `gminStepping()`, `solver.ts:151` `transientStep()` (backward Euler). |
| Timestep tuned from the circuit's own smallest time constant | **[verified]** | `engine.ts:578` and `pico/engine.ts:531` both call `smallestTimeConstant()`; `STEPS_PER_TAU = 50`. |
| Board-less solving via `lib/simulator/passive.ts` | **[verified]** | File exists (133 lines), imported by `components/simulator/CircuitEditor.tsx:35` — real UI wiring, not just a test. |
| `npm run build` string | **[verified]** | Matches `package.json:7` exactly. Build run to completion, exit 0. |
| No `npm test` | **[verified]** | No `test` script; no CI; no git hooks; no husky. |

### The one overstatement — [verified]

> `lib/simulator/model/prop-reachability.ts` **fails the build** when a part declares a
> property that never reaches the solver.

**Nothing fails the build.** Specifically:

1. `prop-reachability.ts` is imported by **test files only** — `compile.test.ts:35-37`,
   `lcd.test.ts:59`, `sources.test.ts:47`. Nothing in `app/`, `components/` or the rest of
   `lib/` imports it, so it never enters the Next bundle.
2. `npm run build` is `build-avr-hex.mjs --toolchain-only && next build --webpack`. There is
   no test step.
3. There is **no CI** — no `.github/`, no workflow file anywhere in the repo.
4. No git hooks (`.git/hooks` has only samples), no husky, no `lint-staged`, no `prepare`.
5. The sibling guard that *does* run at import time — `propDeclarationProblems()`, invoked at
   `parts.ts:3484` — is **deliberately non-throwing**. Its own comment says so:
   *"Non-throwing on purpose. This is a wiring bug in a part declaration, not a reason to take
   a student's editor down mid-lab."* It calls `console.error` and continues.

So the guard runs only when a human remembers to type the command. Because the README also
calls `npm run build` "the gate for main", a reader will reasonably conclude the guard is
enforced by that gate. It is not. This matters more than a normal doc nit: the guard exists
*because* the LED-colour bug shipped silently once, and the README currently overstates the
protection against it happening again.

Suggested wording: "…fails `compile.test.ts`", plus a note that the suites are run by hand.

### Minor

- "30 parts" counts the 3 boards and the breadboard. The same table separately says "3
  boards", so a reader could total 33. Both numbers are individually true.

---

## 1.2 `docs/PROJECT_CONTEXT.md` — **actively misleading**

This is the highest-impact doc problem, because `README.md` labels it
*"Project context, owner's aims, hard-won lessons — **read this first**"*. It is stamped
*"Last updated: 2026-07-22. Current main: `b81572f`"* — 5 commits and a whole simulator ago.

The aims (§2), git workflow (§6) and most "Hard-Won Lessons" (§4) are still good and are the
reason the file should be repaired rather than deleted. But §3 "Current Architecture" is
presented as as-built and is wrong in five places:

| Claim | Reality | Evidence |
|---|---|---|
| "Next.js 16.1.1 (App Router, **Turbopack**)" | Turbopack **cannot build this app**; `--webpack` is mandatory | `package.json:7`; `docs/BUILD_NOTES.md`; `README.md` — all three say the opposite of this line **[verified]** |
| "Supabase (`@supabase/supabase-js` + **`@supabase/ssr`**)" | `@supabase/ssr` is imported **nowhere**; all three clients use `supabase-js` directly | `lib/supabase/{server,client,admin}.ts` **[verified]** |
| "**Konva** (canvas), Recharts" | The canvas is **plain SVG**; zero imports of konva/react-konva/recharts in `app components lib` | `CircuitCanvas.tsx:1344` `<svg` **[verified]** |
| "**14 migrations** (001_profiles → 014_harden_function_surface)" | **27 migrations**, 001 → 027 | `ls supabase/migrations` **[verified]** |
| "**Simulations:** Tinkercad embeds only (migration 011)" | Migration 015 adds `native`; 016 adds `builtin`. Constraint is now `('tinkercad','native','builtin')` | `015_native_simulator.sql:18-20`, `016_backfill_authored_content.sql:25` **[verified]** |

Two further points:

- **§4 "Hard-Won Lessons" predates two security migrations.** `018_lock_profile_role_escalation.sql`
  and `019_close_self_enroll_bypass.sql` are exactly the class of invariant that section
  exists to record, and neither is mentioned. A new session reading §4 as the complete list
  of access-control traps would not know they exist. **[verified]**
- **§7's closing note says the `scripts/` helpers "went with them"** (deleted). `scripts/`
  exists and holds `build-avr-hex.mjs` — which `npm run build` depends on — plus
  `verify-schema.mjs`. **[verified]**

**Still accurate and worth keeping:** the warning that `seeds/003_experiments.sql` inserts
`type='builtin_js'` and will fail the constraint. I checked — it still says `'builtin_js'`
(lines 85, 164, 229, 264) and the constraint still does not allow it. That warning has aged
correctly. **[verified]**

---

## 1.3 `docs/SIMULATOR_ARCHITECTURE.md` — **actively misleading** (already known)

You already knew this one. Confirming the specifics, and flagging a structural problem with
how it is currently handled.

Header reads **"Status: Recommended for build … Audience: The engineer who will build this"**,
with a §0 table of decisions "locked by the product owner" that says *"They are settled; do
not relitigate."* Nothing inside the file marks it as superseded.

Verified contradictions with the shipped code:

| Doc says | Code does | Evidence |
|---|---|---|
| §2.2 "Capacitors and inductors are handled by **first-order analytic relaxation, not companion-model stamping**" | Backward-Euler **companion stamping**, exactly what the doc rules out | `solver.ts:151` `transientStep()`; `docs/TRANSIENT_DESIGN.md §1` **[verified]** |
| §4.1 "**Adjudication: no transient.** … Do not build a fixed-timestep transient co-simulator" | A transient loop exists and is driven from both engines | `engine.ts:961`, `pico/engine.ts:902` **[verified]** |
| "ngspice-validated **in CI**" (§2.3, §3, §5, §6) | **There is no CI.** No `.github/`, no workflow, no hooks | **[verified]** |
| ngspice as a live server-side oracle | ngspice appears in the repo only as **reference numbers in comments** — no binary, no build, no route | `devices.ts:1768`, `linalg.ts:6`, `parts.ts:1080` are all prose **[verified]** |
| §3 "Build the editor in plain SVG DOM, not Konva" | **This one came true** — canvas is SVG | **[verified]** |
| Header: "Supersedes the Tinkercad iframe in `SimulationSection`" | Tinkercad is still the **default** `SimulationKind` and migration 015 calls it *"the permanent fallback … Never remove it"* | `SimulationSection.tsx:9,38` **[verified]** |

**The structural problem:** the disclaimer lives in `README.md`
("*`docs/SIMULATOR_ARCHITECTURE.md` is design intent, not an as-built record*"), not in
`docs/SIMULATOR_ARCHITECTURE.md`. Anyone who opens the 57 KB file directly — which is what its own
"Audience: the engineer who will build this" invites — never sees it. A four-line status block
at the top of the file itself would close this, and is the single cheapest doc fix available.

---

## 1.4 `docs/OUR_DEVICE_CAPABILITIES.md` — **actively misleading**

You specifically asked whether the quoted limitation strings still exist and whether the cited
lines still point at them. Both halves were checked separately, and they give different answers.

**The quoted strings: still real.** Spot-checked seven verbatim quotes; all still exist in
source, some reworded slightly. So the doc's *substance* is largely sound.

**The line numbers: systematically wrong.** The doc declares its provenance up front —
*"Repo state: read at commit `4dfa91f` … 25 palette parts (`lib/simulator/model/parts.ts:1954-1989`)"* —
and the files have grown enormously since:

| File | @ `4dfa91f` | @ `b37f685` | Growth |
|---|---|---|---|
| `lib/simulator/devices.ts` | 2,213 | 3,852 | +74 % |
| `lib/simulator/model/compile.ts` | 898 | 1,564 | +74 % |
| `lib/simulator/model/parts.ts` | 2,407 | 3,487 | +45 % |
| `components/simulator/CircuitCanvas.tsx` | 1,950 | 2,989 | +53 % |

I extracted all **293** `file:line` citations mechanically. Every one resolves to a file that
exists and a line within that file's range — which is exactly why the rot is invisible. The
lines simply point at unrelated code now:

| Doc says | Cited line actually contains |
|---|---|
| `parts.ts:1954-1989` — "25 palette parts" | Stepper motor SVG art. `PALETTE` is now at **2838**, and holds **30** |
| `parts.ts:1668-1680` — relay_4ch `activeLow` prop | PIR motion detection cone geometry (`relay_4ch` is at **2100**) |
| `parts.ts:1319-1322` — "the classic way to cook one of these" | Potentiometer knob prop (real string is at **devices.ts:824**) |
| `parts.ts:1175-1191` — "diode declares no props" | `ledBodyFill()` / `ledGlowFill()` (diode is at **1511**) |
| `parts.ts:1521-1536` — stepper art | A comment about sensor GND pin typing |
| `compile.ts:457-462` — "speed still follows current" | Real string is at **compile.ts:692** |
| `devices.ts:930-967` — "no back-EMF to oppose it" | Real string is at **devices.ts:2326** |
| `devices.ts:1580-1594` — `step(4096) = one turn` | Real string is at **devices.ts:3099** |

**Also stale: the "Known gaps" section reports a gap that has been fixed.** It says the
vestigial `{kind:'load'; ohms; label}` union variant *"still exists in the union
(`parts.ts:78`) and still has a live branch in `compile()`"*. It does not — `parts.ts:88` now
reads *"`{kind:'load'; ohms; label}` used to sit here"*, and `compile()` has no such branch.
**[verified]**

**Assessment.** This is misleading in a specific, expensive way: the citations are precise
enough to be trusted and wrong enough to waste an hour each. The fix is not to re-number them
by hand — they will rot again within a week at this rate — but to cite **symbol names** rather
than line numbers, or to drop the numbers and keep the quotes (which are greppable and have
aged fine).

---

## 1.5 `docs/DEVICE_CONTROLS_AUDIT.md` — **actively misleading** (as a gap list)

Dated 2026-07-24, framed as *"Research and specification only."* Its §5 "Prioritised gap list"
is the operative content, and **most of it has since been built**:

| Gap listed as open | Status now | Evidence |
|---|---|---|
| #1 Editable MicroPython editor for the Pico track — **M** | **Built** | `components/simulator/CodePanel.tsx` (1,065 lines) **[verified]** |
| #2 Free-entry values with unit selectors — **S–M** | **Built** | `OHM_UNITS` / `FARAD_UNITS` / `HENRY_UNITS` / `AMP_UNITS` wired to every `type:'number'` prop **[verified]** |
| #3 LED colour as a per-instance prop — **S** | **Built** | `parts.ts:1208` `key: 'color'`, backed by `LED_COLOURS` **[verified]** |
| #4 On-canvas interaction for pot, LDR, pushbutton — **M** | **Built** | `knob:` / `slider:` / `momentary:` declarations; `canvas-controls.test.ts` (124 assertions) **[verified]** |
| #5 Editable Arduino C++ — **XL, and blocked** | **Built, and unblocked** | Server-side WASM compile in `app/api/compile/` **[verified]** |
| #6 Instruments and power sources — **L** | **Power sources built** (4 parts); instruments not | `battery_9v`, `coin_cell_3v`, `battery_pack_1v5`, `power_supply` **[verified]** |
| #7 Blocks editor — **XL** | Not built (correctly still open) | |
| #8 Servo — **M** | Not built (correctly still open) | |

Also stale: it cites `PropControl` at `components/simulator/CircuitEditor.tsx` **line 236**.
`PropControl` is now at **line 537**. **[verified]**

The date in the header is the only thing signalling that this is a snapshot. Given that six of
nine gaps are closed, a reader skimming for "what's missing" is being actively misdirected. A
one-line status banner ("gaps #1–#6 closed as of `b37f685`") would fix it.

---

## 1.6 `docs/TRANSIENT_DESIGN.md` — accurate; a spec that was built

Prescriptive spec (*"Status: design, for implementation"*), and the implementation matches it.
Verified: backward-Euler companions only, no trapezoidal (§0); `Geq = C/h`, `Ieq = Geq·v_prev`
(§1.1); inductor Norton `Geq = h/L` (§1.2); `extraUnknowns = 0` for both. `transientStep()`
sets `h` on every reactive device then runs the existing Newton solve, exactly as §2 specifies.
`transient.test.ts` (158 assertions) validates against closed-form theory as §3 demands, and
passes. No contradiction found.

## 1.7 `docs/WIRE_RENDERING_SPEC.md` — accurate; a spec that was built

Verdict is *"straight polylines with small circular-arc fillets … radius 10 world units
(= exactly one 0.1 in breadboard pitch)"*. Implemented in `lib/simulator/model/wire-path.ts` —
`fillet()` at :88, `filletPath()` at :134, and `BEND_RADIUS = PITCH` at :39 where `PITCH = 10`
(`parts.ts:23`). The spec's own caveat that the fillet must shrink on short segments is
honoured (`wire-path.ts:36`). Backed by `wirepath.test.ts` / `wirehit.test.ts` /
`wiredraft.test.ts` (175 assertions, all pass). **[verified]**

## 1.8 `docs/BUILD_NOTES.md` — accurate

The `--webpack` rationale matches `package.json:7` exactly, and the quoted Turbopack error
string matches the comment in `lib/simulator/avr/build.ts:1-8`, which is why that file imports
`crypto` bare rather than `node:crypto`. Build verified passing with `--webpack`. I did not
re-test whether Turbopack still fails — that is the one claim here I did not independently
reproduce. **[verified except as noted]**

## 1.9 `docs/AVR_COMPILE_FINDINGS.md` — accurate

Spike report, dated, every claim tagged `[observed]`/`[inferred]`. Its verdict — *works in the
browser, but cannot lawfully be shipped there, so run it server-side* — is precisely what
`app/api/compile/route.ts` implements, and that route's header comment cites this document by
name. The evidence artefacts it lists (`__spikes__/fixtures/wasm-{blink,dht11}.hex`) still
exist and are consumed by `wasmhex.test.ts` (36 assertions, passing). **[verified]**

## 1.10 `docs/PICO_TRACK_FINDINGS.md` — accurate

Verdict *"YES — via a Raspberry Pi Pico running MicroPython on `rp2040js`"* is implemented
(`lib/simulator/pico/`, `pico.test.ts` 154 assertions passing). Its stated caveat — the Pico
track runs ~0.46× wall-clock against Arduino's 3.26× — is a measurement I did not reproduce,
but it is presented as a measurement with a method, and the honesty of the surrounding
document is high. Its three referenced spikes (`p2-*.ts`) all exist. **[verified except the
throughput numbers]**

## 1.11 `docs/PHASE0_RESULTS.md` — accurate, and unusually honest

Leads with a measurement warning that a re-run of P0-1 produced 0.81× where it had produced
2.84×, and explains why (CPU stopped turboing). Marks **P0-3 "NOT STARTED"** and
**P0-4 "PARTIAL (local only)"** — which is why there is no `p0-3` or `p0-4` spike file, and the
doc says so rather than leaving you to discover it.

Its claim *"All spikes are runnable: `npx tsx lib/simulator/__spikes__/<name>.ts`"* — I tested
this. Ran 7 of the 12 spikes (`p0-2`, `p0-5`, `lcd-font-proof`, `p1-adc`, `p1-pwm`, `p1-dht11`,
`p1-engine`); **all exit 0**. The remaining 5 are long-running throughput benchmarks I skipped
for time, not for suspicion. **[verified]**

## 1.12 `docs/DESIGN.md` — accurate as a reference doc

Titled *"Design System Inspired by Airbnb"* and written in the third person about Airbnb's
site, so it reads as a reference rather than an as-built record. The tokens it describes were
genuinely implemented: `--palette-rausch: #ff385c`, `--palette-text-primary: #222222`,
`--palette-border: #c1c1c1`, and the exact three-layer card shadow
`rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 6px, rgba(0,0,0,0.1) 0 4px 8px` are all in
`app/globals.css:29-38`. `#ff385c` is used throughout `app/(admin)/`. **[verified]**

One divergence, and it is the correct one: the doc describes Airbnb Cereal VF; the app uses a
system font stack (`globals.css:47`). That is a proprietary font that cannot be used, and the
doc does not claim the app ships it.

## 1.13 `docs/TINKERCAD_DEVICE_PARITY.md` — stale-but-clearly-historical

A dated (2026-07-25), first-hand catalogue of a **third-party product**. Nothing in this repo
can invalidate it, and it is explicitly framed as an observation log with every line tagged
`[observed]`/`[inferred]`. Its counterpart file's staleness (§1.4) does not transfer to it.
No action.

## 1.14 `docs/DESIGN_REFERENCE_SRMEEEVLAB.md` — stale-but-clearly-historical

States its purpose in the first line: *"Reference material for restyling VLab … Compiled by
fetching the live site's raw HTML/CSS/data."* Forward-looking research, not an as-built claim,
and the restyle it proposes has not happened (the app is still on the Airbnb tokens of §1.12).
Unambiguously framed. No action.

---

# Part 2 — Code findings

Ordered by what would actually cost someone time.

## 2.1 The test suites are the only guard, and nothing runs them — [verified]

**This is the highest-value finding in the audit.** It is the code-side of §1.1.

The repo has 3,309 hand-derived assertions across 22,662 lines of test code. They are
excellent — expected values derived from theory rather than captured from the engine, and two
of the suites specifically exist to catch "correct data that nothing reads". They all pass.

**Nothing runs them automatically.** Verified absences:

- no `.github/` directory, no workflow file anywhere in the repo
- no `test` script in `package.json`; `build` is toolchain-fetch + `next build`
- no git hooks (`.git/hooks` contains only `.sample` files)
- no husky, no `lint-staged`, no `prepare` script
- no `vercel.json` with a custom build/test command

So the two guards written *after real bugs* — `prop-reachability.ts` (LED colour solved as red
for everyone) and the SVG-difference assertions (wire bending shipped unwired) — protect
nothing unless a human remembers a command that is documented only in prose.

The gap between "3,309 assertions" and "3,309 assertions that run" is the single largest
lever here, and it is small: a `"test"` script that loops the suites, plus either a
pre-push hook or a 20-line GitHub Actions workflow. The suites already exit non-zero on
failure, so they are CI-ready as written. Note the compile-dependent suites need
`.cache/avr/`, which `scripts/build-avr-hex.mjs --toolchain-only` already provisions.

## 2.2 `compile()` is a 1,114-line function with an 18-branch device chain — [verified]

`lib/simulator/model/compile.ts:451-1564` — the function runs from line 451 to the end of the
file. Measured: 465 code lines, 406 comment lines, ~148 branch points, and **35 bindings
declared at function scope** that stay live across the whole span.

Inside it, `lib/simulator/model/compile.ts:583-1365` is a single `for (const part of doc.parts)`
containing an **18-way `else if` chain on `el.kind`** spanning 782 lines. Several arms are
themselves large: `character_lcd` ~109 lines (1152-1261), `source` ~94 (1271-1365),
`relay_module` ~96 (844-940), `mcu` ~84 (1068-1152).

Why this is worth flagging rather than tolerating — and I want to be precise, because the long
comments here are genuinely an asset and I am not proposing they be removed:

- **Adding a part means editing a 1,100-line function.** There is no seam. Every new device
  kind lengthens the same chain.
- **35 function-scope bindings are in scope in every arm.** Nothing structurally stops arm #14
  from reading a variable that arm #3 mutated. That is the exact shape of the bug class this
  codebase has already been bitten by twice.
- **Only 3 section markers exist across 1,114 lines** (`:562`, `:1368`, `:1388`), so navigating
  it is scrolling, not jumping.
- It is also the file whose line numbers `docs/OUR_DEVICE_CAPABILITIES.md` cites most heavily (32
  citations), and its 74 % growth is what broke them.

The lowest-risk improvement is mechanical and preserves every comment: lift each `el.kind` arm
into a named function taking an explicit context object. That converts 35 ambient bindings into
a declared parameter list without touching any physics.

**Every branch is reachable** — I cross-checked the 18 handled kinds against the kinds actually
produced by `PART_LIBRARY` at runtime. No dead arms. `variable_resistor` is used (photoresistor).

## 2.3 Two engines, 25 parallel methods, 92 lines byte-identical — [verified]

You flagged `engine.ts` / `pico/engine.ts` specifically. Measured, per method, after stripping
comments and blank lines:

**All 25 of the AVR engine's methods have a same-named Pico counterpart.** The Pico engine adds
4 of its own (`pumpRepl`, `pumpScript`, `queue`, `limitations`). Ten methods are
**byte-identical**, totalling 92 lines:

| Method | Lines | AVR | Pico |
|---|---|---|---|
| `evaluate` | 27 | `engine.ts:901-931` | `pico/engine.ts:848-878` |
| `setDocument` | 12 | `:500-511` | `:466-477` |
| `forgetDevice` | 10 | `:736-745` | `:697-706` |
| `averagedBrightness` | 8 | `:1027-1034` | `:1060-1067` |
| `captureReactive` | 7 | `:526-532` | `:486-492` |
| `averagedCurrents` | 7 | `:1036-1042` | `:1069-1075` |
| `stampDrive` | 6 | `:600-605` | `:547-552` |
| `stampPins` | 6 | `:853-858` | `:804-809` |
| `settle` | 5 | `:895-899` | `:842-846` |
| `partProps` | 4 | `:777-780` | `:541-544` |

A further six are 75–93 % identical: `states` (93 %), `startTransient` (88 %), `faults` (81 %),
`buildBehavioural` (80 %), `contextFor` (76 %), `publish` (75 %).

**Important context, and it changes the recommendation.** This duplication is **deliberate and
documented**. `pico/engine.ts:5-10` states it plainly: *"Deliberately parallel to ../engine.ts
… so that the two boards stay comparable and a fix to one is obviously portable to the other.
What is NOT shared is every electrical constant, because a Pico is a 3.3 V part and an Uno is a
5 V part."* I checked the divergences and they are all correct:

- `tuneStep` differs only because AVR counts CPU cycles and Pico counts nanoseconds — same
  logic, correctly adapted.
- `faults` differs because Pico reports a *pad* rating (`PIN_RATED_CURRENT`) where AVR reports a
  *pin* rating. Correct.
- `VIH`/`VIL` look like a unit mismatch at a glance (`0.6 * 5` vs `2.0`) but both resolve to
  absolute volts and are consumed by the identical hysteresis expression
  (`engine.ts:768`, `pico/engine.ts:782`). **Not a bug** — I checked this specifically because
  it looked like one.
- `states()` even carries a comment noting it deliberately calls the *shared*
  `analogDeviceStates()` because *"a capacitor that reports its voltage on an Uno and not on a
  Pico is precisely the drift a second copy would have caused."*

So I am **not** recommending the engines be merged. The stated rationale is sound and the
riskiest shared logic has already been factored out. The narrower, low-risk finding is this:

**Four board-independent tuning constants are defined twice with no single source** —
`STEPS_PER_TAU = 50`, `MAX_CACHE_ENTRIES = 4096`, `G_FLOAT = 1e-8`, `HOLD_STEP_SECONDS = 1e-9`.
These are solver/engine tuning, not electrical, so the "3.3 V vs 5 V" rationale does not cover
them. Tuning one and not the other would make the two boards disagree numerically for a reason
no comment explains. They belong in a shared module alongside the electrical constants that
*should* stay separate. `MIN_STEP`/`MAX_STEP` are the same values expressed in different units
(20 µs / 5 ms), so they are arguably a fifth.

## 2.4 Two genuinely unused dependencies — [verified]

Excluding `konva`, `react-konva`, `use-image`, `recharts` and the `@radix-ui/*` packages as
instructed.

| Package | Where | Evidence |
|---|---|---|
| **`@supabase/ssr`** ^0.8.0 | `dependencies` (ships) | Zero imports. All three clients — `lib/supabase/server.ts`, `client.ts`, `admin.ts` — use `createClient` from `@supabase/supabase-js` directly (Clerk-native integration, not cookie-based SSR). Its only mention in the repo is `docs/PROJECT_CONTEXT.md:62`, which is itself stale (§1.2). |
| **`dotenv`** ^17.2.3 | `devDependencies` | Zero references anywhere — not imported, not in any script, not in any config. `scripts/build-avr-hex.mjs` and `scripts/verify-schema.mjs` import only `node:` builtins. |

**Checked and cleared — do not remove:**

- **`@wokwi/elements`** (devDependency) has zero *TypeScript* imports, which makes it look dead.
  It is not. `public/vendor/harvest.html` loads
  `node_modules/@wokwi/elements/dist/wokwi-elements.bundle.min.js`, which is the input to the
  component-art harvest that produces the committed `wokwi-art.generated.json`. The bundle is
  gitignored precisely because the dependency regenerates it. **[verified]**
- `tailwindcss-animate` (used in `tailwind.config.ts`), `autoprefixer` (used in
  `postcss.config.mjs`) — both wired via config, not imports.
- `react-hook-form` / `@hookform/resolvers` / `zod` — used by `app/onboarding/page.tsx`.

## 2.5 Dead exported symbols — [verified]

Method: scanned 600 exported symbols across `app components lib types scripts proxy.ts`, then
re-checked every candidate by hand against `.ts .tsx .mjs .mts .json .md .sql .html` for
dynamic access, string keys and doc references. Each symbol below occurs **exactly once in the
entire repository** — its own declaration.

| Symbol | Location | Note |
|---|---|---|
| `VOLT_UNITS` | `lib/simulator/model/parts.ts:525` | See below — the interesting one |
| `getMyProfile()` | `lib/actions/profile.ts:150` | Server action, never called |
| `cacheSize()` | `lib/simulator/avr/build.ts:351` | Compile-cache introspection; not even used by `compile.test.ts` |
| `lcdGlyphKnown()` | `lib/simulator/lcd-font.ts:193` | `lcd.test.ts` does not use it |
| `hasWokwiArt()` | `lib/simulator/model/wokwi.ts:130` | |
| `pendingKeys()` | `lib/simulator/persistence.ts:167` | |
| `PICO_HEADER_GPIOS` | `lib/simulator/pico/board.ts:30` | |
| `formatDate()`, `formatDuration()`, `calculateScore()` | `lib/utils.ts:8,16,27` | Boilerplate helpers, never adopted |

**`VOLT_UNITS` is the one worth two minutes of thought.** Every sibling units array is wired to
a prop: `OHM_UNITS` → resistor + potentiometer, `FARAD_UNITS` → capacitor, `HENRY_UNITS` →
inductor, `AMP_UNITS` → bench-supply current limit. `VOLT_UNITS` is wired to nothing. I checked
why: there is no `type:'number'` voltage prop, because the bench supply's `voltage` is
deliberately a `range` so the on-canvas knob can drive it (`parts.ts:2602-2606` explains this,
and `propDeclarationProblems()` enforces it). So `VOLT_UNITS` is not a missing feature — it is
a leftover from before that decision, and it is the only units array with no test coverage.

**Also dead: `{ kind: 'passive' }` in the electrical union** (`parts.ts:197`). Confirmed at
runtime — zero of the 30 parts use it, and `compile()` has no branch for it, so a part
declaring it would silently contribute nothing to the netlist. This is the same shape as the
`{kind:'load'}` variant that was already removed for exactly this reason (`parts.ts:88`
records the removal). **[verified]**

**Deliberately kept, correctly — not findings.** `usart1Config2560` / `usart2Config2560` /
`usart3Config2560` (`avr/atmega2560.ts:514-556`) are unreferenced, but their comment explains
they are *"recorded but NOT instantiated … so the addresses are written down once, from the
datasheet"*, and that the engine runs USART0 only because the editor has a single Serial pane.
That is a documented decision, not rot. Similarly `TablesInsert` / `Constants` in
`types/database.ts` are Supabase codegen boilerplate.

## 2.6 `__spikes__` should stay — [verified]

You asked directly. **Yes, it should ship — but `fixtures/` is not optional.**

- `lib/simulator/__tests__/wasmhex.test.ts:83` reads
  `lib/simulator/__spikes__/fixtures` at runtime. Deleting the directory breaks a passing
  36-assertion suite. This is a **load-bearing** dependency, not an artefact.
- The `.ts` spikes are covered by `tsconfig.json`'s `**/*.ts`, so they are typechecked on every
  `npx tsc --noEmit` — and it passes. They are not rotting silently.
- They still run. I executed 7 of 12; all exit 0.
- They are the cited reproduction method for `docs/PHASE0_RESULTS.md` and `docs/PICO_TRACK_FINDINGS.md`.
  Deleting them would turn two accurate documents into unfalsifiable ones.

The only thing I would change is the name: `__spikes__` reads as throwaway, and one directory
inside it is a test fixture root. A comment in the directory saying "fixtures/ is consumed by
wasmhex.test.ts — do not delete" would prevent a future cleanup from breaking the build.

## 2.7 Duplicated UI, small but real — [verified]

Found by normalised 8-line block matching across `app components lib` (comments and blanks
stripped), then confirmed by reading each hit.

- **`CopyButton` is defined twice**, near-identically:
  `app/(educator)/educator/classes/[classId]/settings/settings-client.tsx:48-63` and
  `app/(educator)/educator/classes/[classId]/students/students-client.tsx:78-95`. Same
  clipboard call, same 2000 ms reset, same 100-character className. They have **already
  drifted**: one renders `'Copied'`, the other `'Copied!'`, and only the second accepts a
  `label` prop. This is the clearest case in the repo of copy-paste producing a user-visible
  inconsistency.
- **The difficulty `<select>`** — identical 8-line block with the same four options and the
  same className — appears three times:
  `app/(admin)/admin/labs/[labSlug]/experiments/[expSlug]/_components/experiment-info-editor.tsx:69-79`,
  `app/(admin)/admin/labs/[labSlug]/_components/add-experiment-form.tsx:105-115`,
  `app/(admin)/admin/labs/[labSlug]/_components/lab-info-editor.tsx:71-81`.
- **The quiz option-row editor** is duplicated between
  `.../quiz/_components/add-question-form.tsx:87-98` and
  `.../quiz/_components/questions-list.tsx:204-215`.
- **The admin breadcrumb** is duplicated between the experiment `feedback/page.tsx:54-61` and
  `quiz/page.tsx:48-55`.

None of these are in the simulator and none affect correctness beyond the `Copied`/`Copied!`
split. Listed low deliberately.

## 2.8 The test harness is copy-pasted 20 times — [verified]

Every suite in `lib/simulator/__tests__/` carries its own copy of the same `record` / `truth` /
`near` / `group` helpers plus the ~30-line table printer and exit-code footer — roughly 1,000
duplicated lines across 22,662.

This *is* deliberate: the README's "each suite is a standalone script" is a real design
property, and it is why `npx tsx <one file>` works with no runner. But standalone-ness would
survive a shared `_harness.ts` imported relatively — `tsx` resolves that fine, and no runner is
introduced. The current cost is visible in the drift: the helpers already vary between files
(`near` defaults to `'mA'` in `engine.test.ts`, `'V'` in `sources.test.ts`, and takes no unit at
all in `lcd.test.ts`), and `solver.test.ts` has evolved a different footer format
(`"179/179 passed, 0 regressions, 0 known gaps"`).

Lowest priority of the real findings. Mentioned because if §2.1 is acted on and the suites get
a runner, this is the natural moment to do it.

## 2.9 Micro-findings — [verified]

- **Stale cross-reference in two comments.** `app/(dev)/dev/editor/page.tsx:6` and
  `app/(dev)/dev/sims/page.tsx:5` both say *"gated the same way as `/dev/simulator`"*. There is
  no `/dev/simulator` route — it is `/dev/editor` and `/dev/sims`.
- **`public/tinkercad-test.html` is orphaned.** Committed (not gitignored), zero references from
  any `.ts`, `.tsx` or `.md`.

---

# What I checked and found clean

Recording these because a "no finding" is only useful if you know it was looked for.

- **No `TODO`, `FIXME`, `HACK`, `XXX` or `WIP` comments anywhere** in `app components lib
  scripts types proxy.ts`. Zero. This is unusual for a codebase this size and is worth stating
  plainly — there was nothing to triage.
- **`npx tsc --noEmit` exits 0**, including the spikes.
- **`npm run build` exits 0** end to end (toolchain step + `next build --webpack`).
- **`npm run lint`: 0 errors, 2 warnings**, both `@next/next/no-img-element` on genuinely
  external images (`StudentShell.tsx:116`, `SimulationSection.tsx:293`).
- **All 20 test suites pass, 3,309/3,309 assertions, every suite exit 0.**
- **The LED-brightness consolidation held.** `ledBrightnessFor()` is defined once
  (`analog-state.ts:67`) and consumed by `engine.ts`, `pico/engine.ts` and `passive.ts`. No
  second copy anywhere. The four-way duplication you mentioned is genuinely gone.
- **`components/simulations/` (1,069 lines) is NOT dead** — I nearly filed it as such. The
  `type === 'builtin'` branch in `SimulationSection.tsx:74` looks unreachable because migration
  011 restricted the constraint to `'tinkercad'`, but **migration 016 re-adds `'builtin'`**
  (`016_backfill_authored_content.sql:25`) and inserts rows using it. `SIM_REGISTRY` is live.
- **Every `el.kind` branch in `compile()` is reachable** — cross-checked the 18 handled kinds
  against runtime `PART_LIBRARY` output. No dead arms.
- **`PART_LIBRARY` and `PALETTE` are perfectly in sync** — 30 each, no member of one missing
  from the other.
- **Dev routes are correctly double-gated.** `/dev/*` is exempted in `proxy.ts` only when
  `NODE_ENV === 'development'`, *and* each page calls `notFound()` in production. The
  filesystem-writing `POST /api/dev/harvest` has the same production guard
  (`app/api/dev/harvest/route.ts:18`). No exposure.
- **`public/vendor/`** (446 KB bundle) is gitignored — it is not committed and does not deploy.
- **`app/api/tinkercad-preview/route.ts` is live**, called from `SimulationSection.tsx:220`.
- **`VIH`/`VIL` across the two engines are consistent** — checked specifically because the
  declarations look like a unit mismatch. Both are absolute volts.
- **`lib/supabase/` is 138 lines across three clients** with no duplication between them.
