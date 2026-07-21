# Phase 0 spike results

Measured 2026-07-22. Host: Node 24.15 / win32-x64, i7-class. All spikes are runnable:
`npx tsx lib/simulator/__spikes__/<name>.ts`

## P0-1 — avr8js throughput on real firmware — PASS

Fixtures compiled locally with arduino-cli 1.5.1 / avr-gcc 7.3.0 / arduino:avr 1.8.8.
Not synthetic loops: `blink.hex` (delay/Timer0 ISR) and `dht11.hex` (VLab Experiment 01
against the real Adafruit DHT library).

| configuration | Mcycle/s | x realtime |
|---|---|---|
| CPU only | 62–64 | 3.9–4.0x |
| + timers + ports + USART | 45 | 2.8x |
| + port listener (solver seam) | 43–48 | 2.7–3.0x |
| + demand-driven ADC | 44–45 | 2.8x |

Worst full config **2.69x**; projected on a Celeron N4020 (/3.4) **0.79x** — inside the
0.7–1.1x the architecture doc predicted, above the 0.5x kill criterion.

**This confirms the adversarial verifier, not the original research.** The research claimed
163 Mcycle/s (10.2x) and the architecture was budgeted on it; the real figure is ~3x lower.

## P0-2 — DC solver + memoisation — PASS

Reproduces the ngspice reference sweep (§5.5) within 2%:

| R | reference | measured | err |
|---|---|---|---|
| 220 Ω | 13.76 mA | 13.77 mA | 0.1% |
| 1 kΩ | 3.12 mA | 3.18 mA | 2.0% |
| 10 kΩ | 0.32 mA | 0.32 mA | 1.4% |
| none | 1419 mA | 1422.7 mA | 0.3% |

**Memoisation confirmed: 980 PWM edges → 2 solves.** This was the load-bearing claim of the
whole architecture. Solve cost 0.005 ms @ 7 unknowns to 0.025 ms @ 41 — the analog layer is
effectively free next to the MCU.

## P0-5 — netlist extraction — PASS

Real half-size breadboard (450 pins, 86 nets) with the Experiment-01 topology. All 12
topology assertions correct: strips merge, banks stay separate, rails are continuous and
independent, all three Uno GND pins collapse to net 0. Open circuit (missing ground wire) is
detectable before the solver runs. Extraction cost 0.21 ms, recomputed per edit.

## P0-4 — compile latency — PARTIAL (local only)

arduino-cli 1.5.1 locally: Blink cold **5.55 s**, DHT11 cold **2.13 s**, DHT11 warm **1.27 s**.
Still owed: Vercel Sandbox vs Fly.io measurement from an Indian connection.

## P0-3 — ngspice oracle — NOT STARTED

## Bug found and fixed

`NortonPort.stamp` had the current-source polarity reversed, driving pins to −5 V instead of
+5 V. **The solver converged happily and reported success** — exactly the silent-wrong-answer
failure mode §5 warns about. P0-2 missed it because that spike only counted solves. A polarity
regression guard is now in the spike.

## In-browser reality check — INCONCLUSIVE, still open

`/dev/simulator` runs the real Blink firmware coupled to the solver, now with the engine in a
Web Worker. Functionally correct: 220 Ω → 12.40 mA bright, 10 kΩ → 0.32 mA dim, none →
109.82 mA DESTROYED. (110 mA rather than the bench's 1422 mA is correct — a real AVR pin drives
through ~25 Ω and cannot source 1.4 A.) Memoisation confirmed in-browser: 8 pin edges → 2
solves, 7 cache hits.

**The in-browser throughput number is NOT yet trustworthy.** The worker reported 0.75–0.79x
realtime against 2.69x headless. Before treating that as a real ceiling, the same integer-heavy
loop was run in both environments as a calibration:

| environment | Mops |
|---|---|
| Node 24 | 367.5 |
| Chrome page (via devtools eval) | 66.1 |

A 5.6x gap on plain integer arithmetic between two V8s is not credible as a real property of
the browser. The measurement environment is confounded: React DevTools was attached, the
automation harness evaluates in an isolated world, and the tab was very likely unfocused during
the timed runs (Chrome throttles background tabs).

Switching the worker's yield from `setTimeout(…, 0)` (clamped to ~4 ms once nested) to a
`MessageChannel` round trip moved the number only 0.75 → 0.79x, which further suggests the
limiter is not the loop pacing.

**Action:** P0-1's in-browser leg is unfinished. Re-measure on a clean Chrome profile — no
extensions, foreground tab, no devtools — on the actual target laptop, before trusting any
in-browser figure against the 0.5x kill criterion. Until then the only defensible throughput
number is the headless one.
