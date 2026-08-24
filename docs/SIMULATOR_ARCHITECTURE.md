# VLab Simulator — Architecture Decision Document

**Status:** Recommended for build. Supersedes the Tinkercad iframe in `SimulationSection`.
**Author:** Chief architect, synthesising 6 research domains, 4 council proposals, 4 adversarial verifications.
**Audience:** The engineer who will build this.

---

## 0. Decisions locked by the product owner (2026-07-22)

These close open questions from §11. They are settled; do not relitigate.

| # | Decision | Consequence |
|---|---|---|
| **D1** | **Students build the circuit themselves.** Free-form breadboard editing is the core interaction, not a stretch goal. | `interaction_level` still exists (§4.3) but `free` is the default, not `guided`. Phase 1 is the critical path. |
| **D2** | **Autograding is optional, not required for v1.** | Phase 6 moves after the pilot. **Exception: the safety check ships anyway** — it is nearly free once the solver exists and is the most vivid teaching moment in the product. |
| **D3** | **New experiments must be addable with no code change.** | Admins author experiments in the *same editor students use*. See §7.1. Adding a new *component type* remains a dev task. |
| **D4** | **"Runs on real hardware" means source portability only.** No Web Serial flashing in v1. | Zero additional work — already guaranteed by compiling with real `avr-gcc`. Web Serial upload is a clean post-v1 addition (~2–3 weeks, Chrome/Edge only) and nothing here forecloses it. |
| **D5** | **Python track re-platforms to Raspberry Pi Pico + MicroPython** (`rp2040js`, MIT). Option A in §6. | The 5–6 Pi experiments get rewritten for Pico. Real emulation, real analog coupling through the same `PinBridge`, a real on-chip ADC. ~4–6 weeks instead of 8–12. Their existing Tinkercad embeds stay until the rewrite lands. |
| **D6** | **Component palette for v1 is ~40 parts**: the ~25 the 12 experiments need, plus the analog teaching set (op-amp, 555, MOSFET, zener, thermistor, inductor, logic gates, 74HC595). | The analog set is what justifies a SPICE engine — it enables teaching fundamentals, not just sensor interfacing. Not the full 60+ from the prototype. |

**The through-line:** the product is Tinkercad-shaped but deliberately simpler — one board family plus Pico, ~40 parts, real analog, no hardware flashing, grading optional. Everything cut in §12 stays cut.

---

## 1. The decision, in one page

**Build an event-driven quasi-static analog engine co-resident with a vendored `avr8js` in a single Web Worker, and keep real ngspice server-side as the truth oracle. Do not build a fixed-timestep transient co-simulator. Do not ship ngspice-WASM to the browser in v1.**

The single most important finding in the whole dossier is this, from the adversarial benchmark:

> Removing junction limiting from a fixed-step transient solver made Newton converge **faster** (1.01 iterations, zero reported failures) while reporting a peak node voltage of **3.2 V where the correct answer was 5.8 V**.

A fixed-timestep MNA solver with no step rejection does not throw "convergence failed." It returns a smooth, plausible, confidently wrong waveform. Every metric an engineering team normally watches — framerate, error logs, "did it converge" — stays green while it happens. For a product whose entire pitch is *the numbers are real*, that is a worse failure than a crash, and nobody on a small team will catch it.

The second most important finding is the performance measurement:

| Circuit size | i7-13700HX | Celeron N4020 (÷3.4) |
|---|---|---|
| 6 unknowns | 3.30× realtime | **0.97×** |
| 10 unknowns | 2.93× | **0.86×** |
| 20 unknowns | 1.93× | **0.57×** |
| 40 unknowns | 0.68× | **0.20×** |

Headless. No React, no SVG redraw, no scope trace, no compositor. And `avr8js` **alone** on that Celeron is 0.7–1.1× realtime — the MCU consumes the entire realtime budget before a single matrix is stamped.

Both problems have the same root cause: running a 10 µs lock-step transient integration. That decision is unforced. It buys live waveform fidelity for oscillators and inductive loads, and it costs the entire performance and correctness budget.

**Remove it, and the architecture becomes tractable, faster, *and more accurate* for the circuits actually in the syllabus.**

---

## 2. Recommended architecture

### 2.1 The core move: solve operating points on events, not timesteps

The interactive analog engine is a **DC operating-point solver, re-solved on events** — pin-state change, knob drag, sensor change — with memoisation. There is no time integration in the hot loop.

Walk the product owner's three stated fidelity tests:

| Requirement | What it actually is |
|---|---|
| "220R → 20 mA bright; 10k → dim; none → burns out" | A DC operating point |
| "Multimeter reads real node voltages" | A DC operating point |
| "Oscilloscope shows real PWM duty cycle" | `avr8js` gives cycle-exact edges; HIGH and LOW are two DC operating points |

None of them is a transient problem.

**The PWM case deserves emphasis, because it is where this design is strictly *better* than the alternative.** A 10 µs fixed-step solver would alias 62.5 kHz fast PWM into garbage and would resolve 490 Hz PWM with 20 samples per period. The event-driven design composes the trace from `avr8js`'s exact edge timestamps and two cached DC solves — the result is the *exact* waveform, at zero per-sample cost, at any PWM frequency. Fidelity goes up, cost goes to zero.

### 2.2 Reactive elements: analytic relaxation, not integration

Capacitors and inductors are handled by **first-order analytic relaxation**, not companion-model stamping:

1. Solve the DC operating point with caps open and inductors shorted. This is the *final* value.
2. Extract the Thévenin resistance at each reactive element's terminals from the already-LU-factored matrix (a couple of back-substitutions). τ = R_th·C or L/R_th.
3. Each node relaxes exponentially from its last value toward the new DC target.

This is **exact** for a circuit with one reactive element and accurate for well-separated, weakly-coupled time constants — which describes every RC debounce, RC filter, decoupling cap, and PWM-smoothing case in the syllabus.

Threshold crossings during relaxation are solved in **closed form** — `t = -τ·ln((V_th - V_∞)/(V_0 - V_∞))` — and scheduled into `avr8js` via `cpu.addClockEvent`. That is *cycle-exact*, versus the fixed-dt design's 160-cycle quantisation. Again: better, not worse.

### 2.3 The domain boundary is enforced, not hoped for

The netlist builder **detects and refuses** what the interactive engine cannot do honestly:

- ≥2 reactive elements in a coupled node cluster
- Any feedback loop through a reactive element (except via a whitelisted behavioural part)
- Any inductor in a switched path without a flyback diode (this is a *safety violation*, not a simulation failure — see below)

On refusal the student is routed to **Analyse** (server-side ngspice), with an explicit message. The failure mode is a **refusal, never a wrong number.** This is the discipline the "teaching correctness" council member argued for, achieved structurally rather than by a runtime lie-detector.

Specific hard cases and their disposition:

| Case | Disposition |
|---|---|
| 555 astable | Behavioural (comparators at ⅓/⅔ Vcc + flip-flop) driven by analytic RC. Frequency and duty are *exactly* the textbook formula. ngspice-validated in CI. |
| Op-amp, linear feedback | DC solve with a finite-gain + output-limit macromodel. Correct. |
| Op-amp comparator with hysteresis | Behavioural threshold part + analytic RC. |
| Relay / motor / solenoid inductive kickback | Coil is R in the matrix + behavioural mechanical model. The *lesson* ("no flyback diode → transistor dies") is delivered by a **safety check**, not a waveform. Waveform available via Analyse. |
| LC / multi-pole filters | Analyse only. Not in the current syllabus. |

### 2.4 Memoisation makes the analog cost approximately zero

Cache DC solutions keyed on `(topology version, quantised knob vector, quantised sensor vector, pin-state vector)`.

A pin toggling PWM alternates between two pin-state vectors → **two solves total, ever**, not 2,000/second. Knob drags invalidate, but a human turns a pot at ≤60 events/second. Realistic steady-state re-solve rate: tens per second, at ~20–50 µs each on a Celeron.

**Consequence: the binding performance constraint is `avr8js` alone.** Measured 0.7–1.1× realtime on the worst target device. That is acceptable with an honest speed badge, and on a mid-range laptop we throttle to exactly 1.0× and are genuinely realtime. This is a dramatically better performance story than any proposal in the council, and it falls directly out of the DC + memoisation choice.

**Phase 0 must verify this before anything else is built.**

### 2.5 System diagram

```
┌─ Main thread (React 19) ────────────────────────────────────┐
│  SVG editor · instruments UI · Monaco · zustand             │
└──────────────────┬──────────────────────────────────────────┘
                   │ postMessage (Transferable ArrayBuffers)
┌──────────────────▼─ ONE dedicated Web Worker ───────────────┐
│  avr8js (vendored fork)  ←── PinBridge ──→  DC solver       │
│    · clock master                            · MNA + Newton │
│    · onADCRead → synchronous solve           · ≤15 unknowns │
│    · port.addListener → Norton restamp       · memoised     │
│    · addClockEvent ← exact threshold crossing               │
│  Behavioural parts (buses, sensors, 555, mechanics)         │
│  OffscreenCanvas: scope trace                               │
└─────────────────────────────────────────────────────────────┘
                   │ (async, on demand)
┌──────────────────▼─ Vercel Function (Node) ─────────────────┐
│  ngspice-WASM  →  "Analyse" plots · authoritative grading   │
│                   · golden-master oracle (also in CI)       │
└─────────────────────────────────────────────────────────────┘
┌─ Vercel Sandbox (Firecracker) ──────────────────────────────┐
│  arduino-cli → .hex, content-addressed cache in Vercel Blob │
└─────────────────────────────────────────────────────────────┘
```

**Single-threaded everywhere. No SharedArrayBuffer. No COOP/COEP.** Clerk, Supabase Storage images, YouTube sections and the legacy Tinkercad embeds all keep working untouched. This is only affordable because we chose an engine that doesn't need threads.

### 2.6 The PinBridge interface (abstract it on day one)

```ts
interface PinBridge {
  advanceTo(simTimeNs: bigint): bigint;          // returns actual time reached
  setPinDrive(pinId: string, G: number, I: number): void;  // Norton pair
  readNode(netId: string): number;               // volts
  scheduleCrossing(netId: string, v: number, dir: 'rise'|'fall', cb: () => void): void;
}
```

Every MCU pin is **permanently Norton-stamped** so the sparsity pattern never changes and symbolic factorisation happens once:

| Pin state | (G, I) |
|---|---|
| Output LOW | (1/25 Ω, 0) |
| Output HIGH | (1/25 Ω, 5/25) |
| Input | (1e-8 S, 0) |
| Input pull-up | (1/20 kΩ, 5/20 kΩ) |

Digital input thresholds are **ours**: VIL 0.3·Vcc / VIH 0.6·Vcc **with hysteresis from day one**. Without hysteresis a node near 2.5 V chatters thousands of spurious pin-change interrupts per second and livelocks the MCU — and it fails silently, as wrong interrupt counts.

Abstracting `PinBridge` is non-negotiable: it is what lets a Pico or a Pyodide backend plug into the same solver later without a second, incompatible simulator.

---

## 3. The stack, layer by layer

| Layer | Choice | Licence | Notes |
|---|---|---|---|
| **MCU emulation** | `avr8js` 0.21.0, **hard-forked and vendored** at a pinned commit | MIT | Only permissive browser-native cycle-accurate AVR emulator. Bus factor 1, maintainer's day job is a competitor → vendor it. Core is ~1,100 readable TS lines. |
| **avr8js additions we write** | Analog comparator; VIL/VIH + hysteresis layer; Timer1 input capture (#125); correct reset (#107) | ours | The comparator **does not exist upstream** — every threshold/555/op-amp lab silently does nothing without it. Sleep modes (#139) deferred. |
| **Interactive analog** | Our own MNA DC solver, TypeScript, dense LU on `Float64Array`, Newton with junction limiting, gmin + source stepping | ours | ~1,200–1,800 lines over a **closed** library of ~30 device models. No transient integration. Rust→WASM only if measurement demands it. |
| **Truth engine / oracle** | `ngspice` 46 → WASM, built from `eelab-dev/EEcircuit-engine`'s Docker scripts. **Sparse 1.3, not KLU. `src/xspice/icm/table` deleted.** Runs in **Node on the server + CI**. | ngspice core BSD-3-Clause; wrapper MIT | Server-side only in v1 → **no distribution → no LGPL/GPL obligation attaches at all**. Must call `getError()` on every run (confirmed stale-data bug: a failed run returns the previous run's points). |
| **Editor rendering** | React 19 + **plain SVG DOM**. One root `<g transform>` for pan/zoom; drag mutates refs, commits to zustand on `pointerup`. | — | **Delete `konva`, `react-konva`, `use-image`** from `package.json` (check nothing else uses them first). Konva was chosen by inertia; it forces rasterising SVG art, losing zoom fidelity, SVG-id pin hit regions, CSS theming and any screen-reader story — to buy throughput we don't need at 30 parts. |
| **Scope rendering** | Plain Canvas2D on an `OffscreenCanvas` transferred to the worker | — | No scene-graph library needed. |
| **Component art + pin metadata** | `wokwi-elements` — **harvest SVG + `pinInfo` at build time**, do not mount the Lit components | MIT | `pinInfo` is the connector table for free, with no ShareAlike. Audit gaps part-by-part; expect misses on LM741, 555, L298N, DS18B20, HC-SR04, 74HC series. |
| **Breadboard-view art gaps** | `fritzing-parts`, isolated in `/assets/fritzing/` with its own LICENSE + attribution | CC-BY-SA 3.0 | ShareAlike is viral **on the artwork**. Isolate from day one; retrofitting is painful. Prefer redrawing if the gap is small. |
| **Schematic symbols (later)** | KiCad `kicad-symbols` from **GitLab** (the GitHub mirror is archived) | CC-BY-SA 4.0 **with an explicit exception waiving ShareAlike on generated designs** | Best licensing fact in the dossier: student-generated schematics carry no obligation. |
| **Document model** | Fritzing `.fzp` shape: parts declare `connectors` (semantic ids: A/C, B/C/E) + `buses`. **The breadboard is one part with ~130 buses**, not a special case. | ours | Serialise Wokwi-`diagram.json`-shaped: `parts[]` + `connections[]`. |
| **Netlist extraction** | Union-find over connectors ∪ wires ∪ inserted pins; each DSU root is a node; the GND set is forced to node 0 | ours | ~300 lines, O(N·α(N)), recomputed wholesale on every edit. Read MIT `circuit-json-to-spice` for the card mapping; **reimplement, don't depend** (2 stars, one contributor). |
| **Netlist hardening** | 1 GΩ leak from every node to ground; 10 mΩ series R on every source; never emit R=0 | ours | Mechanical, verified fixes for the three student-mistake classes that otherwise produce singular matrices. |
| **Compile service** | **Vercel Sandbox** (Firecracker microVM) running `arduino-cli` 1.5.1, fully pre-baked, **zero network egress** | arduino-cli GPL-3.0 (subprocess, never distributed → no obligation); avr-gcc GPL-3.0 + Runtime Library Exception (output unencumbered) | **NOT Cloud Run** — its container contract forbids the capabilities/mounts nsjail needs, and 1st-gen gVisor documents that rlimits are *not enforced*, so the confirmed `#include "/dev/random"` OOM has no backstop there. |
| **Compile cache** | Content-addressed in Vercel Blob. Key = sha256(normalised sources ‖ FQBN ‖ **toolchain image digest** ‖ library lockfile ‖ exact flag string). **Cache failures too.** Pre-compile every reference sketch at content-publish time. | — | Concurrency, not vCPU-seconds, is the real cost (Compiler Explorer caps at 2 concurrent compiles/instance; Wokwi ships a visible "Build Servers Busy" state). Cache hits are the only way 60 simultaneous students get sub-second compiles. |
| **Persistence** | Supabase, migration `015`. Details in §7. | — | Reference circuits and hidden checks **must be admin/educator-read-only** — the current `simulations: read using (true)` policy would publish the answer key to the REST endpoint. |
| **Framework** | Bump Next.js to **≥16.2** (repo is on `^16.1.1`) | — | `vercel/next.js#84782` (Worker fails to load WASM under Turbopack's blob: URL context) is fixed in 16.2. Also serve any `.wasm` from `/public` with an explicit hashed fetch, not `new URL(..., import.meta.url)`. |
| **Offline** | Service worker caching the sim chunk + SVG sprite sheet in Cache Storage; IndexedDB write-through for `sim_attempts`, debounced 3 s PATCH to Supabase | — | Campus wifi drops. Losing 40 minutes of wiring kills adoption harder than any missing feature. |

### Prohibited — read only, never link

| Project | Licence | Why it's fatal |
|---|---|---|
| CircuitJS1 (Falstad) | GPL-2.0-or-later | GPL has **no network-use exemption** (that's AGPL). The FSF's own FAQ states explicitly that JavaScript served to a browser is distributed and must be released under GPL. Plus Java/GWT in a Next.js codebase. |
| AVR8js-Falstad | GPL-2.0 | Derivative of the above. Its coupling is also electrically wrong (ideal 0/5 V source, no series R). |
| Velxio | AGPL-3.0 + paid commercial | §13 network-use would oblige publishing all of VLab. Read `docs/RASPBERRYPI3_EMULATION.md`; copy nothing. |
| `github.com/virtual-labs` | AGPL-3.0, several with **no licence at all** | Unlicensed is worse than AGPL — no rights granted. Given VLab is modelled on vlab.co.in, verify nothing has already been copied. |
| simavr, SimulIDE, Logisim-evolution, Digital, Qucs-S | GPL-2/3 | Study only. |
| `willymcallister/circuit-sandbox` | **No LICENSE file** | Legally unusable. Copy the JSON serialisation *design* only. |
| `libavoid-js` | LGPL-2.1, 43 stars, one maintainer | Autorouting is a problem to decline, not solve. |
| edx-platform `<schematicresponse>` | AGPL-3.0 | Copy the grading *design* (5% relative tolerance), not the code. |

**Clean-room rule, written down and enforced in code review:** anyone who reads GPL/AGPL source for design ideas does not write the corresponding module.

---

## 4. Where the council disagreed — and how I adjudicated

The four council members converged on more than they diverged on. Recording the disagreements honestly:

### 4.1 Is there a transient solver in the interactive loop? — **No. 3 against 1.**

Three members (ship-this-term, 3-year-maintenance, and implicitly the teaching-correctness member's "truth engine" split) argued against fixed-dt transient in the hot loop. One (student-experience) kept it at dt=20 µs with a 15-unknown cap.

**Adjudication: no transient.** The dissenter's own numbers defeat the position — 0.57× realtime at 20 unknowns on target hardware, before any rendering. And the verifier's silent-wrong-answer finding makes it a correctness issue, not a performance one. The DC + analytic-relaxation design is *more* accurate for everything in scope, not a compromise.

**What is genuinely lost:** live transient waveforms of oscillators and coupled reactive networks in the interactive view. They are available on demand via Analyse. I flag this to the owner in §11 as a decision you can overrule — with the cost of overruling it stated.

### 4.2 Does ngspice-WASM ship to the browser? — **No in v1. 2 against 2, tiebroken on evidence.**

Two members wanted it client-side (one for offline resilience, one for a lazily-loaded "Analyse" button). Two wanted it server/CI only.

**Adjudication: server-side and CI in v1; client-side is a Phase-6 optimisation behind a flag.** Five reasons:

1. Grading must be server-authoritative anyway, so the server needs ngspice regardless. Building it once for the server is unavoidable; building it twice is optional.
2. 6.16 MB wasm + 20.4 MB JS (5.7 MB gzip) + 359 ms init **on a fast machine** is a multi-second stall on shared campus wifi, on exactly the devices we're protecting.
3. Server-side means **no distribution at all**, so the LGPL numparam obligation (which the verifier proved is *not* configurable out — there is no `--disable-numparam`) and the GPLv2 `icm/table` question never even attach in v1.
4. Analyse is inherently async. A spinner plus a round-trip is a fine UX for it. Interactive work stays 100% offline-capable.
5. It preserves the client-side option later with zero re-architecture: same netlist, same wasm artifact, same result schema.

### 4.3 Free-form editor in v1, or authored circuits? — **Both. Build the editor; ship experiments in guided mode.**

Three members wanted an editor-first phase. One wanted authored circuits with guarded knobs, arguing it deletes the entire student-created-singular-matrix class.

**Adjudication:** the dissenter is right about risk and wrong about sequencing. The document model and union-find netlist are identical either way — you need them for authored circuits too. The difference is only *what the student may do*. So: build the editor, and add a per-experiment `interaction_level` field:

- `guided` — fixed topology, swap component values from a whitelist, drag knobs, probe anywhere
- `assisted` — add/remove parts from a whitelist onto a pre-wired base
- `free` — full breadboard

Ship the first experiments `guided`. This gets the risk reduction *and* the editor-first sequencing, at the cost of one enum.

### 4.4 Compile platform: Vercel Sandbox vs Fly.io + nsjail — **Vercel Sandbox, measured in Phase 0.**

Three members chose Fly.io Firecracker + nsjail; one chose Vercel Sandbox. All four correctly rejected Cloud Run.

**Adjudication: Vercel Sandbox.** The maintenance argument wins for a small team: a second cloud vendor is a permanent ops tax on a team with no ops person. More importantly, Vercel Sandbox gives per-invocation microVM isolation *by construction*, which removes the entire nsjail configuration surface — and the verifier showed that surface is exactly where Judge0 shipped a host-root chain and where Compiler Explorer, *running nsjail correctly*, was still breached via the artifact-reading path outside the jail.

**But:** Vercel Sandbox is iad1-only (~250 ms+ RTT from India) and its creation latency is UNVERIFIED. Phase 0 must measure cold and warm compile latency from an Indian connection. **Documented fallback: a single always-on Fly.io Firecracker machine in an Indian region.** The cache is what makes latency acceptable either way — invest there first.

On `arduino-cli` vs driving `avr-g++` directly: one member argued for direct, to remove the GPL-3.0 ambiguity and the network-capable installer. **Use `arduino-cli` in v1** — the GPL concern is answered (unmodified binary, process boundary, never distributed), and the installer risk is closed by an empty network namespace with everything pre-baked. Migrate to direct `avr-g++` only if cache-key determinism actually bites.

### 4.5 Timeline — **the outlier is wrong.**

One member proposed shipping 5 Arduino experiments with real analog in **7 weeks**. The other three cluster at 22–37 weeks for Arduino-complete plus autograding.

**Adjudication: the 7-week estimate is not credible** and I say so in §9. It omits the editor (5–7 weeks alone), the component-model library, the instruments, and content authoring. Do not plan against it.

---

## 5. What the adversarial verifiers refuted — honestly

Four claims from the research were stress-tested. Two were substantially refuted. Everything below is a correction to the research, not a defence of it.

### 5.1 REFUTED: "163 Mcycle/s = 10.2× realtime" for avr8js

The co-simulation architecture's entire frame budget ("MCU = 1.6 ms of a 16 ms frame, 10%") rested on this. It **did not reproduce**. Measured on the same CPU class with a real fetch/execute loop:

| Configuration | Mcycle/s | ×realtime @16 MHz |
|---|---|---|
| CPU only | 59.4 | 3.71× |
| + timers + ports | 59.8 | 3.74× |
| + port listener | 54.9 | 3.43× |
| + demand-driven ADC | **40.1** | **2.51×** |

Note the two research domains already contradicted each other (49–107 vs 163); the architecture was budgeted on the optimistic outlier. **The realistic figure is 2.5–3.7× on a fast i7, i.e. 0.7–1.1× on a Celeron-class laptop.** All planning uses the lower number.

Also unverified in *either* direction: every benchmark used **synthetic instruction loops**, not real avr-gcc output. Real firmware has a different instruction mix and far heavier interrupt traffic, which can move this 2–3× either way. **Phase 0 must re-derive it from a real `.hex`.**

### 5.2 REFUTED: "gpiozero MockFactory gets you the devices for nearly free"

At the constructor level, in gpiozero master `input_devices.py`, **`MotionSensor` (PIR), `LineSensor` (IR) and `DistanceSensor` (HC-SR04) each call `self._queue.start()` inside `__init__`** — i.e. `threading.Thread.start()`. Stock Pyodide raises `RuntimeError: can't start new thread`. Three of the six named devices fail *on construction*. PIR and HC-SR04 are both on the required component list.

The proposed mitigation ("patch the single class `gpiozero.threads.GPIOThread`") is insufficient: `Button.wait_for_press()` and friends block on `threading.Event.wait()`, and `input_devices.py` imports `Event` and `Lock` directly. Single-threaded, `Event.wait()` can **never** be satisfied — a permanent hang, not an exception, and a different failure mechanism needing a different patch.

Also refuted: "**real, unmodified `w1thermsensor` works verbatim**." It calls `subprocess.call(..., shell=True)` in `set_resolution()` and modprobes on a missing base directory. `subprocess` does not exist in Pyodide. The MEMFS `/sys/bus/w1/.../w1_slave` trick is genuinely good — the library still needs patching.

### 5.3 REFUTED: "nsjail on Cloud Run, ~$10–70/month, 1–2 weeks of engineering"

Three separate failures:

1. **Cloud Run's container contract forbids** capability changes, privilege escalation and internal mounting — exactly what nsjail needs. Judge0 and Piston fail there for the same reason. The primary deployment target was invalid.
2. **Cloud Run 1st-gen is gVisor**, whose own docs state resource limits are *not enforced within the sandbox*. The rlimit backstop for the confirmed `#include "/dev/random"` OOM was decorative.
3. **"1–2 weeks" is not credible.** Compiler Explorer runs nsjail correctly and was still breached via symlinked build outputs read by the web-server account *outside* the jail. The threat model must include the cache writer and response serializer.

Also: the cost model priced average vCPU-seconds when the binding constraint is **burst concurrency**. And the assumed 45% cache-hit rate contradicts the same document's claim that unique broken student code dominates lab traffic. **Plan for a permanently-owned security surface, and pre-warm from the class timetable in Supabase rather than assuming a hit rate.**

### 5.4 CORRECTED: the licensing verdict (direction right, three details wrong)

The core reasoning **holds** — the FSF's own GPL FAQ explicitly states that GPL'd JavaScript distributed when a user visits a site must be released under GPL. But:

1. **"Compile ngspice without KLU *and without numparam*" is not achievable.** There is no `--disable-numparam`; `src/frontend/numparam` is emitted unconditionally and implements `.param`/subcircuit substitution. **KLU is avoidable and cheap to avoid** (ngspice defaults to Sparse 1.3, MIT; KLU is runtime opt-in). Do not promise counsel a pure-BSD artifact.
2. **The LGPL burden was overstated.** Since the wasm blob contains only upstream ngspice, there is no combined work. LGPL-2.1 §6 is fully discharged by publishing the build repo. One public repo, done. (And in v1 it's server-side — no distribution, no obligation at all.)
3. **`--enable-xspice` was recommended in one domain without noting that `src/xspice/icm/table` is GPLv2-or-newer.** Enabling XSPICE without pruning it would ship GPLv2 code to browsers — the exact trap. Make "`icm/table` absent from the linked artifact" a **build acceptance test**.

### 5.5 What survived

The core fidelity claim is real and measured. ngspice produces exactly the required pedagogy out of the box: **220R → 13.76 mA, 1k → 3.12 mA, 10k → 0.32 mA, no resistor → 1419 mA / 7.1 W (destroyed).** And it is worth knowing that Wokwi's own documentation states plainly: *"if you add any resistors to your analog circuit, the simulator will ignore them."* Our floor is above the incumbent's ceiling.

---

## 6. Raspberry Pi — the plain answer

**Raspberry Pi Linux/Python simulation at the fidelity bar set for Arduino is not viable in v1, and should not be attempted on the same timeline or budget.**

Not "hard." Not viable. Here is why, concretely:

- The Pi is a Linux SBC, so no MCU emulation transfers. There is no `avr8js` equivalent.
- The Pyodide path needs a **forked gpiozero concurrency layer**, not a pin factory (§5.2). Three required devices fail on construction; `Event.wait()` deadlocks are a separate bug class.
- We must write `RPi.GPIO` from scratch (~400–600 lines). PyPI `RPi.GPIO` is an armv6l C extension, last released 2022.
- No threads → **no `pyodide.setInterruptBuffer`**, because that needs SharedArrayBuffer → COOP/COEP → breaks Clerk's OAuth popup path. A student's `while True: pass` is uninterruptible; recovery is `worker.terminate()` plus restore from autosave.
- Pyodide's `time.sleep` is currently a **busy-loop**, not `Atomics.wait`. It must be monkeypatched or it starves the solver at 100% CPU.
- ~12 MB of assets and 3–6 s cold start on the exact laptops we're protecting.
- **The Pi has no ADC.** Any existing RPi experiment assuming an analog read (photoresistor, soil moisture, LM35) is *physically wrong on real hardware too*.
- Bit-banged DHT11, 1-Wire and HC-SR04 echo timing cannot be simulated at pin level. They become declared library-level fakes — a student writing their own bit-banging loop, which several Pi lab sheets ask for, gets nothing.
- **No prior art couples Pi GPIO to a real analog solver.** Velxio explicitly does not; it fakes PWM as binary (>50% duty = HIGH) with no I2C and no SPI.

Realistic effort: **8–12 weeks**, not the 2–4 the research suggested — and the product at the end teaches library API usage, not electronics.

### What to do instead — three options, ranked

**Option A (recommended): re-platform the Python experiments onto Raspberry Pi Pico + MicroPython.**

Use `rp2040js` (MIT, 516 stars, same author as `avr8js`, same GPIO-listener + ADC-hook API shape). This gives:

- Real Python that students write and that runs unchanged on real hardware
- Real cycle-accurate emulation of a real chip
- **Real coupling to our analog solver through the same `PinBridge`** — so resistor values matter on the Python track too
- A real on-board ADC, which makes the analog-sensor experiments *correct* instead of merely simulatable
- No Linux problem at all

**Cost: rewriting 5–6 experiments' content and telling faculty the board changed.** That is a product decision, not an engineering one — but it is unambiguously the technically superior answer, and it is roughly a quarter of the effort of the Pyodide path for a strictly better result.

**Option B: keep the Pi, ship a deliberately reduced Python track in Phase 6.**

Pyodide + our own `RPi.GPIO` + a forked gpiozero concurrency layer (cooperative scheduler replacing `GPIOThread` and `Event`) + MEMFS `/sys/bus/w1` + patched `w1thermsensor`, coupled through `PinBridge`. DHT11/DS18B20/HC-SR04 are **declared** library-level fakes, stated in the lesson text. Add an **MCP3008** to any experiment assuming an analog read — this fixes the content, not just the simulation. Any experiment teaching Linux itself (apt, ssh, systemd, camera) leaves the simulator and stays as text/video.

8–12 weeks. Deliverable is honest but reduced.

**Option C: server-side QEMU `raspi3b` (Velxio's approach). Reject.**

30–60 s boot, 5.4 GiB image, ~200 MB RAM per session, container-per-student, AGPL reference implementation — and it **still doesn't connect to an analog solver**, so it fails Decision #1 anyway while costing the most. Named here only so it isn't re-proposed.

### Until then

The 5–6 RPi experiments **keep their existing Tinkercad/video sections.** Do not remove `'tinkercad'` from the `simulations_type_check` constraint — not now, not ever. It is the permanent fallback.

---

## 7. Data model

Migration `015_native_simulator.sql`. Deliberately smaller than the research proposed — five tables, not the full autograding surface up front.

```sql
alter table simulations drop constraint simulations_type_check;
alter table simulations add constraint simulations_type_check
  check (type in ('tinkercad', 'native'));

-- Authored circuits. role='reference' is the answer key.
create table circuits (
  id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references simulations(id) on delete cascade,
  role text not null check (role in ('starter','reference')),
  version integer not null default 1,
  board text not null check (board in ('arduino_uno','arduino_nano','rp2040','raspberry_pi')),
  interaction_level text not null default 'guided'
    check (interaction_level in ('guided','assisted','free')),
  graph jsonb not null,   -- parts[], wires[], nets[] (nets DERIVED, cached for grading)
  code  jsonb not null default '{"files":[]}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  unique (simulation_id, role, version)
);

create table sim_checks (
  id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references simulations(id) on delete cascade,
  order_index integer not null,
  label text not null,
  kind text not null check (kind in
    ('safety','dc_voltage','dc_current','pin_state','timing','serial_match','topology')),
  spec jsonb not null,
  points integer not null default 1,
  hint text,
  is_hidden boolean not null default false,
  created_at timestamptz default now()
);

-- Live autosaved work. One row per (student, simulation, class).
create table sim_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  simulation_id uuid not null references simulations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  graph jsonb not null,
  code jsonb not null default '{"files":[]}'::jsonb,
  build_status text check (build_status in ('ok','compile_error','runtime_error')),
  build_log text,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (student_id, simulation_id, class_id)
);

-- Immutable graded submissions.
create table sim_submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  simulation_id uuid not null references simulations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  attempt_number integer not null default 1,
  graph_snapshot jsonb not null,
  code_snapshot jsonb not null,
  results jsonb not null,
  score integer not null,
  max_score integer not null,
  percentage numeric(5,2) not null,
  passed boolean not null,
  engine_version text not null,   -- solver + emulator + ngspice build hash
  submitted_at timestamptz default now(),
  unique (student_id, simulation_id, class_id, attempt_number)
);

-- Coarse session telemetry, written once at session end.
create table sim_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  simulation_id uuid not null references simulations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  started_at timestamptz default now(),
  ended_at timestamptz,
  metrics jsonb not null default '{}'::jsonb
);
```

**Three RLS rules that are load-bearing:**

1. `circuits` where `role = 'reference'`, and `sim_checks` where `is_hidden = true`, are **admin/educator-read-only**. Under the existing `simulations: read using (true)` pattern a student would fetch the answer key straight from the Supabase REST endpoint.
2. `sim_submissions` has **no client insert path that lets the student supply `score`**. Written only by a server action. (The existing `quiz_submissions` policy does allow this — do not repeat it.)
3. `sim_attempts` copies `student_progress` verbatim: student read/write own, educator read own classes, admin read all.

**`engine_version` is non-negotiable.** When you ship a solver fix, old grades must remain explainable.

---

## 7.1 Adding experiments without code changes (D3)

The requirement: an admin can add experiment #13, #14, #50 forever, without a developer.

**This works because the editor is the authoring tool.** There is exactly one canvas component.
Students open it in solve mode; admins open it in author mode. Same document model, same netlist
extraction, same solver. No second codebase, no drift between "what the admin drew" and "what the
student sees".

### The authoring flow — zero code

```
Admin: /admin/labs/<lab>/experiments/<exp>
  1. Create experiment row            (already exists today)
  2. Add sections: aim, theory,
     procedure, code, references      (already exists today)
  3. Add a 'simulation' section
       -> opens the SAME editor
       -> drag parts, wire them up
       -> saves as circuits.role='starter'   (what the student opens)
       -> optionally save a 'reference'      (the worked solution)
  4. Paste the reference sketch        -> circuits.code
  5. Publish
```

Steps 1, 2 and 5 are the admin UI VLab already has. Only step 3 is new, and it is the same editor
Phase 1 delivers anyway. **The marginal cost of no-code authoring is roughly one route and a save
button** — it is nearly free, because it falls out of D1 (students build circuits, so a circuit
editor must exist regardless).

### The seam: new component types

A new *experiment* is data. A new *component type* is not, and this is where the "no code" promise
has to be honest. A part needs four things:

| Needs | Data or code? |
|---|---|
| SVG artwork | data |
| Pin metadata (id, name, x/y, electrical type) | data |
| Electrical model | **depends — see below** |
| Protocol/behaviour | code |

Because we chose a real SPICE engine, the electrical model splits cleanly:

**Tier 1 — data-only.** Any part expressible as a SPICE subcircuit is *pure data*: a JSON file with
pins, SVG and a `.subckt` string. That covers resistors, capacitors, inductors, diodes, zeners,
LEDs, transistors, MOSFETs, op-amps, the 555, regulators, and every sensor that is electrically just
a variable resistance (thermistor, photoresistor, potentiometer, soil moisture). This is most of the
~40-part palette, and standard SPICE models for these are freely available from manufacturers.

**Tier 2 — code.** Parts that talk a wire protocol or hold internal state: DHT11, DS18B20 (1-Wire),
HC-SR04 (echo timing), LCD/OLED (I2C/SPI displays), NeoPixel (WS2812 timing), shift registers.
These are behavioural state machines bound to `avr8js` pin listeners. They are a dev ticket.

**So the accurate promise to faculty is:** *"You can add any experiment you like using the existing
parts, yourself, today. New analog parts are a JSON file. New sensors that speak a protocol need a
developer."* Do not promise more than that.

A Tier-1 declarative part loader is **not** in the v1 plan — with a ~40-part palette curated up
front, it is speculative. Build it when a second person actually asks for a part we don't have.
What v1 *must* do is keep the part registry data-driven internally, so adding that loader later is
additive rather than a refactor.

---

## 8. Autograding

Three tiers, behaviour-dominant, graded **server-side on ngspice**, client-side only for instant feedback.

```jsonc
// safety — the most vivid pedagogical moment in the product, and uniquely ours
{ "kind":"safety", "assert":"no_part_exceeds_rating",
  "message":"Your LED is drawing 62 mA. On real hardware it would burn out." }

// analog — the resistor-value-matters check
{ "kind":"dc_current", "through":{"part":"LED1"}, "expected":0.020, "tol_rel":0.25 }
{ "kind":"dc_voltage", "probe":{"net":"LED_ANODE"}, "expected":2.0,
  "tol_rel":0.10, "tol_abs":0.05 }

// behavioural — Wokwi's scenario vocabulary, which educators can author without code
{ "kind":"timing",
  "stimulus":[{"at":"1s","set":{"part":"dht11","control":"temperature","value":30}}],
  "assert":{"pin":{"part":"uno","pin":"D13"},"becomes":"HIGH"},
  "after":"1s", "within":"2s" }

// topology — FEEDBACK ONLY, never a grading gate
{ "kind":"topology", "assert":"series",
  "between":[{"type":"led"},{"type":"resistor","value":{"min":150,"max":470}}],
  "message":"The LED needs a current-limiting resistor in series." }
```

Design notes:

- **Tolerance model from Open edX `<schematicresponse>`** (MITx 6.002x): pass if `|expected - measured| < max(tol_rel × |expected|, tol_abs)`. The absolute floor matters near 0 V.
- **Authoring UX is the adoption gate.** Wokwi's YAML vocabulary (`delay` / `set-control` / `wait-serial` / `expect-pin`) is human-readable and teachers already know it. Extend it with `expect-voltage` and `expect-current` — that gap is precisely where our analog solver earns its keep versus Wokwi.
- **Topology never gates.** Full netlist isomorphism over-constrains and punishes valid alternative designs, and nothing off-the-shelf exists. Cheap subgraph pattern assertions on the DSU, for feedback.
- **~40% hidden checks.** Otherwise students reverse-engineer the assertions instead of the circuit.
- **Determinism is a correctness invariant.** Fixed solve tolerances, seeded sensor noise, `engine_version` pinned, and every reference circuit re-run in CI on every solver commit. A flaky autograder destroys trust faster than no autograder.

**Educator telemetry** (coarse aggregates only, written once at session end — **no keystroke or mouse logging**, which is a privacy liability with student data and bloats jsonb): time-to-first-run, compile error histogram (top 3 messages — the single most actionable signal for a lecturer), per-check pass rate across the class, safety-violation counts, submission counts, wire churn ratio. A check that 90% of a class fails is a broken check or a missing lecture.

---

## 9. Staged delivery plan

Effort is **one strong full-time engineer**. Halve the calendar with two, but not the first two phases (they serialise).

| Phase | Scope | Effort |
|---|---|---|
| **0. Spikes** | The five prototypes in §10. Blocking — nothing else starts. | **1–2 weeks** |
| **1. Editor, no simulation** | SVG canvas, breadboard, ~15 parts, drag-from-pin wiring with magnetic snap and no modes, union-find netlist, DSU pre-solve validation in student language, net highlighting, auto-colour VCC red / GND black, undo/redo, IndexedDB autosave, **full touch support**. Ship to one class as a "build the circuit" exercise with validation only. Independently valuable; zero numerical risk. | **5–7 weeks** |
| **2. MCU + firmware** | `avr8js` fork in a worker + comparator + threshold/hysteresis layer + compile service + hex cache + Serial monitor. Digital-only: LEDs light, buttons work, real compiled sketches run. **This is the biggest perceived student win.** Reference `.hex` is a permanent fallback path, not a phase. | **5–6 weeks** |
| **3. Analog** | DC solver, ~30 device models, memoisation, `PinBridge`, safety/SOA model with a thermal time constant, multimeter, scope from edge timeline + analytic relaxation, node-budget counter in the editor. Launch on **one** experiment (LED + resistor) alongside its Tinkercad embed behind a flag. Acceptance gate: 220R/1k/10k/none within 5% of ngspice, verified in CI. | **6–8 weeks** |
| **4. ngspice oracle + Analyse** | ngspice-WASM build (Sparse not KLU, `icm/table` pruned and asserted absent), Vercel Function, golden-master CI harness across every reference circuit, LTspice cross-check once. **Do not defer this** — it is what makes the solver maintainable for three years. | **2–3 weeks** |
| **5. Arduino breadth** | Remaining Arduino experiments one at a time, each gated on its own golden master. Behavioural bus/sensor models (I2C, SPI, 1-Wire, DHT11, HC-SR04, WS2812) with lesson-text disclosure. Instrument polish. | **6–8 weeks** |
| **6. Autograding** | Schema, scenario-YAML authoring UI for educators, server-side re-grade, partial credit, hidden tests, telemetry, regression suite. | **5–6 weeks** |
| **7. Pilot + tail** | One real cohort, one full lab session, bug tail, perf tuning on real devices. | **4 weeks** |
| **8. Python track** | Option A (Pico + `rp2040js`): **4–6 weeks** engineering + content rewrite. Option B (Pyodide + forked gpiozero): **8–12 weeks**. | **4–12 weeks** |

**Content authoring** (11–14 circuits, reference sketches, check specs, lesson-text updates for every declared limitation) runs alongside from Phase 3 and is **3–4 weeks of combined engineer + educator time**. It is a real line item, not a rounding error.

### Total effort, honestly

- **Arduino-complete, graded, piloted: 34–44 engineer-weeks ≈ 8–10 months for one engineer**, or ~5 months for two.
- **Including the Python track: 38–56 engineer-weeks ≈ 9–13 months for one engineer.**
- First thing a student can *use*: end of Phase 1, ~7–9 weeks in.
- First experiment with real analog in front of a class: end of Phase 3, ~18–23 weeks in.

One council member proposed 7 weeks to five experiments with real analog. **That is not credible** — it omits the editor, the component-model library, the instruments and content authoring. Do not plan against it.

Ongoing cost after launch: compile service $25–65/month, plus a **permanent** security-owner obligation on the compile sandbox (not a sprint — Compiler Explorer runs nsjail correctly and was still breached).

---

## 10. Prototype first — five spikes, 1–2 weeks, blocking

Everything downstream depends on these. Do not start Phase 1 until they are answered.

**P0-1 — `avr8js` throughput on real firmware, on a real cheap laptop. (3 days)**
Compile a real sketch with `avr-gcc` (Blink, and the DHT11 reference sketch — real instruction mix and interrupt traffic, not a synthetic loop). Run in a Web Worker, in Chrome, on an actual sub-₹30,000 Celeron/low-end-i3, **with the breadboard SVG and scope rendering live**. Report Mcycle/s and ×realtime. Test Firefox too — an older data point claims a large Chrome/Firefox gap for `avr8js`.
**Kill criterion:** below ~0.5× realtime on that machine with rendering on → stop and re-plan before any product code exists.

**P0-2 — DC solver + memoisation cost. (2 days)**
Build the 6-unknown LED+resistor+PWM case. Measure: solves per second under 490 Hz PWM with the pin-state cache on and off; per-solve wall time at 6/10/15/20 unknowns on the same Celeron; Newton iteration counts.
**This is the load-bearing claim of the whole architecture.** If memoisation does not collapse PWM to two solves, the design changes.

**P0-3 — ngspice-WASM build and oracle harness. (2 days)**
Build from `eelab-dev/EEcircuit-engine`'s Docker scripts with Sparse 1.3 (not KLU) and `src/xspice/icm/table` deleted. Assert `icm/table` is absent from the linked artifact **as a build test**. Run in Node, verify `getError()` handling on a deliberately failing netlist (confirm the stale-data bug and the guard against it). Produce one golden fixture for the LED+resistor sweep.

**P0-4 — Compile latency, cold and warm, from India. (1 day)**
Vercel Sandbox running `arduino-cli`: measure sandbox creation, cold compile, warm compile, and end-to-end RTT from an Indian connection. Compare against a Fly.io machine in an Indian region if the number is bad.
**Decides:** Vercel Sandbox vs Fly.io, and how hard the cache must work.

**P0-5 — Netlist extraction end-to-end. (2 days)**
Hand-author one experiment's breadboard in the `.fzp` bus model, run union-find, diff the resulting netlist against a hand-written reference, and feed it to ngspice from P0-3. Include one deliberately broken variant (floating node) and confirm the DSU validation catches it before the solver runs.

**P0-6 — Python track reality check. (2 days, only if the owner chooses Option B in §6)**
Prototype a gpiozero **`DistanceSensor` or `MotionSensor`** experiment in Pyodide — not Button+LED. The threaded devices are the ones that fail first, and they are the ones that decide the estimate.

---

## 11. Open questions the owner must decide

**Q1 — RESOLVED (D5): re-platform to Pico + MicroPython.** (§6) The biggest decision in the document. Option A gives full fidelity, real analog coupling, a real ADC, and roughly a quarter of the effort — at the cost of rewriting 5–6 experiments' content and telling faculty the board changed. Option B preserves the content and delivers a degraded, honest simulator in 8–12 weeks. **Answer this before Phase 0.**

**Q2 — Is "SPICE-grade numbers live, SPICE-grade waveforms on demand" an acceptable reading of Decision #1?** The interactive engine gives exact DC voltages and currents, exact PWM waveforms, exact threshold crossings, and correct 555 frequency/duty — all ngspice-validated. It does **not** give live transient waveforms for oscillators and coupled reactive networks; those come from Analyse. Overruling this costs: 0.20× realtime at 40 unknowns on target hardware, and a solver whose failure mode is a plausible wrong number.

**Q3 — Audit the 11–14 experiments now: how many exceed 15 analog unknowns?** Home automation and the L298N motor-driver experiment are the suspects. Any that do must be split, partially behavioural, or Analyse-only. **Discover this in Phase 0, not week 20 when the editor starts rejecting the course's own reference circuits.**

**Q4 — RESOLVED (D1): students build the circuit; `free` is the default.** This is a pedagogy call. Guided deletes the entire student-created-singular-matrix class.

**Q5 — Is realtime-or-slower acceptable with a visible speed badge?** A 1 Hz blink taking 1.4 s on a Celeron. Simulated time is the only time shown; `millis()` never sees wall clock. If the answer is "no, it must be realtime," the node budget drops further.

**Q6 — Provenance of the teammate's 60+ component SVGs.** If any were traced from Fritzing or Tinkercad, a CC-BY-SA or worse obligation may already exist. Audit before building on them.

**Q7 — Fork the teammate's prototype, or start clean?** Its 779-line regex JS interpreter is worthless (Decision #2 rejects it) and it has no analog solver. Its breadboard editor, wire routing and SVGs may be reusable — subject to Q6. This is a 1-day evaluation.

**Q8 — Target device spec.** What is actually in the labs, and are any students on tablets? This sets the performance floor and the minimum-zoom touch constraints. A 0.1 inch breadboard hole is ~4 px at 1× — far below a 44 px touch target.

**Q9 — Is offline operation a requirement?** Interactive simulation works fully offline in this design; Analyse needs network. If offline Analyse is required, ngspice-WASM moves client-side and the payload argument in §4.2 reopens.

**Q10 — RESOLVED (D2): optional; follows the pilot. The safety check ships regardless.** It is Phase 6 as planned. Pulling it earlier costs ~5 weeks from Arduino breadth.

**Q11 — Who authors content?** 11–14 circuits, reference sketches, check specs and lesson-text updates. Engineer time or educator time, and does the authoring UI need to exist first?

**Q12 — Legal sign-off on the licence manifest.** Specifically: the GPL-JavaScript-is-distribution position (which drives the CircuitJS1 exclusion), the ngspice build manifest, and whether `arduino-cli` as an undistributed subprocess is acceptable to whoever owns risk. Get this reviewed before anyone writes code against a GPL project.

---

## 12. Things that are cut, and what it costs

Stated plainly so nobody is surprised in month six.

| Cut | Cost |
|---|---|
| Fixed-timestep transient in the interactive loop | No live waveforms for oscillators/coupled reactive networks. Available via Analyse. **Buys: correctness and 3–5× performance.** |
| ngspice-WASM in the browser (v1) | Analyse needs network. **Buys: ~6 MB of payload on the target device, and zero copyleft obligation.** |
| Analog resolution below ~10 µs | SPI, I2C, 1-Wire, DHT11, DS18B20, HC-SR04 echo, WS2812 and fast PWM at prescaler 1 are behavioural, bound to `avr8js` pin listeners. A student who writes their own bit-banging loop gets a working simulation but not a signal-level one. **Must be stated in the lesson text.** |
| Guaranteed realtime | Visible "0.8× real time" badge. Students accept slow; they do not accept wrong. **This belongs in the product spec, not the engineering notes.** |
| Circuits above ~15 analog unknowns | Enforced with a live counter in the editor. Some existing experiments will need splitting (Q3). |
| The phrase "cycle-accurate co-simulation" | It is true MCU→analog and, for scheduled crossings, true analog→MCU. We say "event-exact" and mean it. |
| micro:bit | No in-browser nRF52 emulator exists. The Foundation's simulator recompiles firmware to WASM, so there are no pins to couple to a solver. Leave it in the palette as unsimulated art, or remove it. |
| Arduino Mega / Leonardo / Nano 33 / ESP32 | `avr8js` has no Timer3/4/5 configs and no USB. Uno + Nano only. |
| Sleep modes (`LowPower.h`) | avr8js #139. Sketches run at full speed with wrong power behaviour. |
| Autorouting | Manual bendpoints, Wokwi's relative-ortho routing mini-language (`["v10","h5","*","v-15"]`) — ~100 lines, deterministic, human-editable. |
| Netlist isomorphism as a grading gate | Topology checks give feedback only. |
| In-browser compilation | No maintained WASM `avr-gcc` exists; `cib` has no LICENSE file at all and `emception` is dormant. |
| Linux on the Pi (any option) | No apt, no ssh, no systemd, no camera. Experiments teaching Linux itself stay as text/video. |

---

## 13. The one-paragraph version, for anyone who reads only this

Vendor `avr8js` (MIT) as the MCU. Write our own DC operating-point MNA solver in TypeScript, re-solved on events and memoised on pin state, co-resident in a single Web Worker — no fixed-timestep transient, because the adversarial benchmark proved it is both 3–5× too slow on the target hardware and capable of returning confidently wrong numbers with no error raised. Handle reactive elements by analytic first-order relaxation with closed-form threshold crossings, which is *more* accurate than a 10 µs integrator for everything in the syllabus and costs nothing. Enforce the domain boundary in the netlist builder so the failure mode is a refusal, never a wrong answer. Keep real ngspice (BSD-3, Sparse not KLU, `icm/table` pruned) server-side as the truth oracle for Analyse, for authoritative grading, and for a golden-master CI suite that diffs every reference circuit on every solver commit. Build the editor in plain SVG DOM, not Konva. Compile in Vercel Sandbox with an aggressive content-addressed cache pre-warmed from the class timetable. Ship experiments in guided mode first. **Tell the product owner plainly that Raspberry Pi Linux/Python simulation is not viable at this fidelity bar, and that re-platforming those experiments onto a Pico with MicroPython gives a strictly better result for a quarter of the effort.** Budget 8–10 months of one strong engineer to a graded, piloted Arduino product, and do the five Phase-0 spikes first — especially re-deriving `avr8js` throughput from real compiled firmware on a real cheap laptop, because the number the original architecture was budgeted on did not reproduce.