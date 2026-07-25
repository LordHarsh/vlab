# Transient (time-domain) analysis — design spec

Status: design, for implementation. Author: main-thread engineering pass.
Supersedes the DC-only capacitor stub in `compile.ts` (the 1e12 Ω "open").

This is the numerical spec. It is deliberately prescriptive about the maths and
the validation, because a sign error or a stale-state bug in a transient loop is
exactly the "ok:true, wrong picture" failure the DC solver was hardened against.
Every constant and every companion equation below is to be pinned by a
hand-derived test, never by the engine's own output.

## 0. Scope

Must-have (validate rigorously against closed-form theory):
1. A **Capacitor** device (backward-Euler companion) and an **Inductor** device.
2. A **transient stepping API** on `Circuit`: given a timestep `h`, advance one
   step — update companion sources from stored state, run the EXISTING Newton
   solve (diodes/LEDs stay nonlinear), then store the new reactive state.
3. Wire capacitors (and inductors) into `compile.ts` as real reactive devices
   when present, replacing the 1e12 Ω stub.

Stretch (best-effort, behind a `hasReactive` branch; report how far it got):
4. Couple the transient loop into `engine.ts` so a reactive circuit driven by an
   MCU pin evolves in time (RC charging after `digitalWrite(HIGH)`).

Explicitly OUT of scope: trapezoidal integration (backward Euler only — it is
L-stable and robust, which beats 2nd-order accuracy for a teaching tool that
must not ring or blow up on a student's switching circuit), adaptive LTE-based
timestep control (fixed or time-constant-derived step is enough).

## 1. Backward-Euler companion models

Timestep `h` (seconds). Node voltages `va`, `vb`; branch voltage `v = va - vb`.
The existing stamp helpers in `devices.ts` are:
- `stampConductance(ctx, a, b, g)` — a conductance g between a and b.
- `stampCurrent(ctx, a, b, i)` — a source pushing `i` amps a→b: `b[ia]-=i; b[ib]+=i`.

### 1.1 Capacitor

`i_C = C dv/dt`. Backward Euler over one step:

    i_C(t) = C·(v(t) − v_prev)/h = (C/h)·v(t) − (C/h)·v_prev

So the companion is a conductance in parallel with a current source:

    Geq = C / h
    Ieq = Geq · v_prev            // v_prev = branch voltage at the END of the previous accepted step

Stamp:
- `stampConductance(ctx, a, b, Geq)`
- a current source injecting `Ieq` INTO node a (out of b): `stampCurrent(ctx, b, a, Ieq)`
  (equivalently `stampCurrent(ctx, a, b, -Ieq)`).

**SIGN IS LOAD-BEARING.** If flipped, an RC charging cap will diverge or charge
the wrong way. Do NOT guess it — wire it, run the RC-charge test in §3.1, and if
the curve rises the wrong way or blows up, the sign is flipped. The test pins it.

State update, AFTER the Newton solve for this step converges:

    v_prev ← voltage(a) − voltage(b)      // read from the converged solution

Reported current (for the MEASUREMENTS panel), from the converged step:

    i_C = Geq·(v(t) − v_prev_before_update)   // == C·dv/dt for this step

Initial condition at t=0: `v_prev = 0` (uncharged), unless the caller supplies one.

Numerical floor: as `h→0`, `Geq = C/h → ∞`. Clamp `Geq` so it never exceeds the
same conductance ceiling a wire uses (`1/MIN_RESISTANCE = 1e3 S`); a step so small
that C/h > 1e3 is finer than the solver can represent anyway. Also require `h > 0`.

### 1.2 Inductor

`v = L di/dt`. Backward Euler:

    i_L(t) = i_L(t−h) + (h/L)·v(t)

Norton companion:

    Geq = h / L
    Ieq = i_prev                  // previous branch current

Stamp: `stampConductance(ctx, a, b, Geq)` plus a source pushing `Ieq` a→b:
`stampCurrent(ctx, a, b, Ieq)`. **Validate the sign with the RL test (§3.3).**

State update after convergence:

    i_L ← i_prev + Geq·(va − vb)         // = i_prev + (h/L)·v(t)

Initial condition: `i_prev = 0`.

Note: at DC steady state a cap is an open (i→0) and an inductor is a short (v→0);
the backward-Euler companions approach that as the transient settles. Inductors
are not in the palette today, so they exist to (a) enable RLC validation and
(b) complete D6's analog set. Capacitor is the one an experiment actually needs.

## 2. The stepping API

Add to `Circuit` (solver.ts), without disturbing the DC `solve()`:

    beginTransient(): void        // reset all reactive devices to their initial state, t=0
    transientStep(h: number): SolveResult
        // 1. set h on every reactive device (so stamp() uses the right Geq/Ieq)
        // 2. call the existing Newton solve() — companions make caps/inductors linear,
        //    diodes/LEDs stay nonlinear, so this JUST WORKS through the existing loop
        // 3. on success, tell every reactive device to advance its stored state from
        //    the converged voltages; on failure, do NOT advance (return ok:false)

Do not change `solve()` itself. The reactive devices’ `stamp()` reads their own
`h` and `v_prev`/`i_prev` fields, which `transientStep` sets before solving and
advances after. A reactive `Device` needs two extra methods (add to the class,
not the shared interface unless clean): `setStep(h)` and `advance(ctx)`.

`extraUnknowns = 0` for both cap and inductor (Norton companions need no branch
current unknown — that is the whole point of using them over ideal-element MNA).

## 3. Validation — every expected value hand-derived, NEVER read off the engine

Build these as `CircuitDoc`s or directly as `Circuit`s and step them. Each is a
closed-form check. Put them in a new `lib/simulator/__tests__/transient.test.ts`
following the existing suites’ table-harness style (exit non-zero on failure).

### 3.1 RC charging (THE anchor test; also pins the capacitor sign)
5 V source — R=1 kΩ — C=1 µF — ground. τ = RC = 1e-3 s.
Closed form: `v_C(t) = 5·(1 − e^(−t/τ))`.
Step with `h = τ/1000 = 1e-6` s. Assert:
- at t=τ, `v_C ≈ 5·(1−e^−1) = 3.1606 V` (63.2 %). Backward Euler undershoots
  slightly at finite h; allow a tolerance that TIGHTENS as h shrinks (derive the
  BE error: for h=τ/1000 the discrete solution is 5·(1−(1+h/τ)^(−t/h)); compare
  against THAT for an exact check, and against the continuous form to ~0.1 %).
- monotonic increase, asymptotes to 5 V, never overshoots.
- reported `i_C` at t=0+ ≈ 5 V / 1 kΩ = 5 mA, decaying to ~0.

### 3.2 RC discharging
Pre-charge C=1 µF to 5 V, then R=1 kΩ across it, source removed.
`v_C(t) = 5·e^(−t/τ)`. Assert 5·e^−1 = 1.8394 V at t=τ; monotonic decay to 0.

### 3.3 RL rise
5 V — R=100 Ω — L=10 mH. τ = L/R = 1e-4 s. `i_L(t) = (5/100)(1−e^(−t/τ))`.
Assert i→50 mA, 63.2 % at t=τ. Pins the inductor sign.

### 3.4 RLC — the three damping regimes (uses cap + inductor together)
Series R–L–C, L=1 mH, C=1 µF ⇒ ω0 = 1/√(LC) = 31623 rad/s, and R_crit = 2√(L/C) = 63.2 Ω.
- **Underdamped** R=10 Ω: ringing at ωd = ω0·√(1−ζ²), ζ = R/(2√(L/C)). Assert the
  observed oscillation period matches 2π/ωd to a few %, and the envelope decays.
- **Overdamped** R=200 Ω: no oscillation, two real poles, monotonic after the peak.
- **Critically damped** R≈63.2 Ω: fastest non-oscillating; assert no zero-crossing
  of the derivative beyond the first.
Derive ωd, ζ by hand in the test comments.

### 3.5 Stability / long-run
Run the underdamped RLC for 50 000 steps. Assert nothing is NaN/Inf, the energy
envelope is non-increasing (passive circuit), and it settles to the DC point.
Backward Euler is L-stable, so this MUST hold; if it grows, the companion is wrong.

### 3.6 MCU-coupled (only if §0 stretch is done)
Uno, `digitalWrite(D8, HIGH)`, D8 — R=10 kΩ — C=10 µF — GND. τ=0.1 s.
Drive D8 high via the real avr8js pin (through its ~25 Ω source R + 10 kΩ), step
transient, assert the cap follows `1−e^(−t/τ)` with the observed τ within ~5 %
(the pin’s 25 Ω is negligible against 10 kΩ). If the coupling is not done, say so.

## 4. Integration points

- `compile.ts`: where a capacitor is currently stamped as `new Resistor(id, a, b, 1e12)`
  and pushes the "not simulated" limitation — replace with `new Capacitor(id, a, b, farads)`
  and set `circuit.hasReactive = true`. Same for an inductor. REMOVE the limitation
  string for caps/inductors once they are really simulated (but keep the honest
  banner for anything still unsupported). The palette capacitor’s farads value:
  check `parts.ts` for its `electrical` config; if it carries no capacitance, add a
  sensible default (e.g. 1 µF) and a prop so a student can set it.
- `engine.ts` (stretch): if `hasReactive`, the pin-state memoisation MUST be
  disabled (cap voltage is state the pin vector does not capture — caching by pin
  state alone would freeze the charge curve, the same class of bug as the
  anti-phase averaging one just fixed). Advance a transient loop on a fixed or
  τ-derived `h`, synchronised to avr8js sim-time. If this proves too entangled to
  land safely, STOP at the core, keep caps working for a pure-analog transient run,
  and report the coupling as a follow-up — do not ship a half-wired engine.

## 5. Non-negotiables

- Do NOT weaken any DC test. `solver.test.ts` (179), `document.test.ts` (51),
  `compile.test.ts` (124), `engine.test.ts` (45) all stay green.
- Do NOT change `solve()`, `linalg.ts`, or the DC device stamps.
- Every transient expected value is hand-derived closed-form in the test comment.
  A value read from the engine and asserted against itself is worthless — the
  reviewer will reject it.
- Backward Euler only. Robustness over order.
