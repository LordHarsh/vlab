# Compiling Arduino C++ in the browser — findings

Spike run 2026-07-24. Every claim below is tagged **[observed]** (I ran it and read the
number off) or **[inferred]** (reasoned from something observed, and the reasoning is
shown). Nothing here is quoted from a vendor's README without saying so.

---

## Verdict

**Yes. Arduino C++ compiles in a browser, and the output runs.** [observed]

Not a bare `.c` file — a real sketch, with `#include <Arduino.h>`, `pinMode`,
`digitalWrite`, `analogRead`, `delay`, `Serial.print`, and a third-party sensor
library. Compiled in Chrome, linked against the Arduino core, emitted as Intel HEX,
loaded into this repository's own `avr8js` engine, and observed lighting an LED and
printing an expected number to the serial monitor.

The proof is in `lib/simulator/__tests__/wasmhex.test.ts` — 36 assertions, all passing.

| what | number | how |
|---|---|---|
| download, minimum viable set | **4.72 MB brotli** (6.37 MB gzip, 23.2 MB raw) | [observed] measured over the exact file set a compile touches |
| compile, Chrome desktop | **1.4 – 2.0 s** wall, of which ~0.54 s is an avoidable header fetch | [observed] Chrome 150, 24 threads |
| compile, same toolchain under Node | **0.36 s** median (blink), **0.47 s** (with DHT library) | [observed] 7 and 5 runs |
| peak memory, Chrome | **40.8 MB** linear memory in `cc1plus`, ≤ 5.8 MB in the others | [observed] the tools' own growth counters |
| output | byte-identical HEX from Chrome and from Node | [observed] sha256 `000c4595…` both ways |

**But I do not recommend shipping it.** The blocker is not technical — see
[Blocker 1](#blocker-1-the-licence-is-the-real-wall) — and my recommendation is to
**reverse D7 for v1**. Reasoning in [The D7 question](#the-d7-question).

---

## What was actually run

The toolchain is [`@horang-corp/avr-gcc-wasm@0.2.0`](https://www.npmjs.com/package/@horang-corp/avr-gcc-wasm),
published 2026-05-29 — GNU `cc1plus`, `avr-as`, `avr-ld` and `avr-objcopy` compiled to
WebAssembly with Emscripten, plus avr-libc headers and precompiled ATmega328P Arduino
core objects. It is, as far as I can find, **the only working AVR compiler for the
browser that exists**. [observed — npm registry search for `avr-gcc wasm`, `avr
webassembly`, `wasm-clang`, `emception`, `llvm-box`; nothing else targets AVR]

The alternatives do not close the gap:

- **clang/LLVM to WASM** (`wasmer` clang, `emception`, `clang-wasm`) — real and working,
  but they target wasm32/WASI, not AVR, and weigh ~100 MB uncompressed. LLVM does have
  an AVR backend, but `ClangBuiltArduino` exists precisely because Arduino sketches do
  *not* build cleanly with it: `__progmem__` is silently ignored (string constants land
  in RAM instead of flash), and there are open reports of Serial-using sketches
  misbehaving. [inferred from project documentation and issue trackers — I did not
  build LLVM myself]
- **Wasmino** compiles a sketch to WebAssembly *to run as WASM*, not to AVR machine
  code. It explicitly models an infinitely fast CPU with no instruction timing. It is a
  different product from ours and cannot drive `avr8js`. [inferred from its docs]

### The three sketches compiled

All three are committed under `scripts/sketches/`, and all three rebuild
byte-identically via `scripts/build-avr-hex.mjs`. [observed]

| sketch | target | flash | what it exercises |
|---|---|---|---|
| `blink-fast.cpp` | ATmega328P | 5,678 B | `pinMode`, `digitalWrite`, `delay`, `Serial.println` |
| `dht11.cpp` | ATmega328P | 8,988 B | the above + **DHT sensor library 1.4.7**, `float` printing |
| `traffic-mega.cpp` | **ATmega2560** | 4,308 B | `analogRead`, 16-bit maths, `Serial.print(int)`, 12 digital outputs |

### That the output is *correct*, not merely well-formed

This is the failure worth fearing: a compiler that emits a loadable `.hex` full of
subtly wrong code, which runs, prints nothing, and shows green everywhere. So the test
asserts observable behaviour, with hand-derived numbers.

The sharpest one — the Mega sketch computes `3000 + analogRead(A0) * 7` and prints it:

| pot | ADC | expected print | observed |
|---|---|---|---|
| 0 % | 0 | `Lane 1 Green: 3000ms` | ✅ [observed] |
| 50 % | 511 | `Lane 1 Green: 6577ms` | ✅ [observed] |
| 100 % | 1023 | `Lane 1 Green: 10161ms` | ✅ [observed] |

3000 + 511×7 = 6577 cannot appear unless the ADC multiplexer, the 16-bit multiply,
`Print::print(int)` and USART0 are all correct on a chip whose every register address
differs from the 328P's.

Two further controls:

- **The arduino-cli fixture as differential control.** `public/sim/blink.hex` (built by
  the old toolchain) and the WASM build drive the same circuit and differ only in a
  1000 ms vs 100 ms delay. Both consequences are asserted: 8.5× the pin edges, *and* an
  LED current damped to 12.39/(1+e⁻⁴) = 12.167 mA by the engine's 25 ms display filter.
  The measured value was 12.17 mA. [observed] A build that got the timing wrong breaks
  one of those two and cannot break neither.
- **Wrong-chip negative control.** The same Mega firmware, same circuit, run against
  avr8js's stock ATmega328P peripheral map, prints *nothing at all* — because USART0's
  UDRE vector sits at a different word address there. [observed]

---

## What must ship, measured rather than estimated

The upstream package is 52.7 MB raw / 8.2 MB brotli across 556 files. **Most of that is
dead weight.** I hooked the compiler's filesystem layer and recorded every file it
actually opens for a real sketch: **35 files, 415 KB.** [observed] The other 469 are
device headers for 311 AVR parts we do not emulate.

| component | files | raw | gzip | **brotli** |
|---|---:|---:|---:|---:|
| `cc1plus.wasm` | 1 | 13.20 MB | 4.32 MB | **3.27 MB** |
| `avr-ld.wasm` | 1 | 1.03 MB | 0.37 MB | 0.31 MB |
| `avr-as.wasm` | 1 | 0.73 MB | 0.30 MB | 0.25 MB |
| `avr-objcopy.wasm` | 1 | 0.69 MB | 0.28 MB | 0.23 MB |
| Emscripten JS glue | 4 | 0.57 MB | 0.14 MB | 0.12 MB |
| headers actually opened | 35 | 0.41 MB | 0.11 MB | 0.09 MB |
| Arduino core + library objects | 22 | 0.54 MB | 0.18 MB | 0.15 MB |
| `libgcc.a`, `libc.a`, `libm.a`, crt | 4 | 6.05 MB | 0.67 MB | 0.30 MB |
| linker script | 1 | 0.01 MB | — | — |
| **total** | **70** | **23.22 MB** | **6.37 MB** | **4.72 MB** |

[observed — every row measured with brotli quality 11]

**4.72 MB is the honest download number**, and it is far below the "10–30 MB" that D7
recorded as its risk. On the target audience's connection: [inferred, arithmetic only]

| link | first load | subsequent |
|---|---|---|
| 2 Mbps | ~19 s | 0 — HTTP cache / Cache Storage |
| 5 Mbps | ~7.5 s | 0 |
| 10 Mbps | ~3.8 s | 0 |

Adding a second board costs `libgcc.a` + `libc.a` + `libm.a` + crt for that multilib
(+6.05 MB raw, **+0.30 MB brotli**) plus its core objects. Cheap, because those archives
compress extraordinarily well. [observed — measured on the avr6 set]

### Compile latency

**Chrome 150, desktop (24 threads, 16 GB), fresh Worker per build:** [observed]

| run | wall | `cc1plus` instantiate | `cc1plus` compile | header fetch | link |
|---|---:|---:|---:|---:|---:|
| 1 | 1650 ms | 85 ms | 562 ms | 562 ms | 91 ms |
| 2 | 1953 ms | 91 ms | 499 ms | 536 ms | 95 ms |
| 3 | 1441 ms | 76 ms | 511 ms | 542 ms | 93 ms |

**~540 ms of every compile is fetching 504 header files over HTTP** — one request each,
because the package seeds its whole header tree before compiling. Serving only the 35
that are opened should remove most of it. [inferred, but the 35-file measurement it
rests on is observed]

**Same toolchain under Node, this machine:** blink 361 ms median (574 ms cold), DHT
470 ms median. [observed, 7 and 5 runs]

So a realistic in-browser compile on a good desktop is **~0.9–1.5 s** after the header
fix. On a mid-range Android phone — 4–8 slower cores, less memory bandwidth — **3–6 s**
is the honest expectation. [inferred; **I did not test on a phone**, and this is the
single biggest untested number in this document.]

---

## Named blockers

### Blocker 1: the licence is the real wall

`cc1plus.wasm` is compiled GCC. `avr-as`, `avr-ld`, `avr-objcopy` are compiled GNU
binutils. **Both are GPL-3.0-or-later**, and the package's own `THIRD_PARTY_NOTICES.md`
says so, adding that any public distribution "should also provide the corresponding
source, local patches, and build scripts used to reproduce these artifacts."

Serving those `.wasm` files from VLab to a student's browser **is conveying object code**
under GPLv3 §6. That obliges us to provide the Corresponding Source — which explicitly
includes the scripts used to control compilation.

**We cannot.** The upstream repository does not publish them. Its tree contains
`scripts/prepare-assets.mjs` and `scripts/spawn-file.mjs` (which fetch and build the
*Arduino* assets) and the prebuilt `tools/*.wasm` — **no Emscripten build script, no
patches, no Dockerfile.** [observed — full recursive tree listing of the GitHub repo]

So VLab redistributing these binaries as-is would be a licence violation, and it is not
one we can cure ourselves: you cannot supply corresponding source for a binary somebody
else built. Ways out, in increasing cost:

1. Ask the author to publish the build recipe. Free if they say yes; entirely outside
   our control.
2. Build GCC + binutils to WebAssembly ourselves and publish that. Legitimate and
   permanent — GCC's source is public — but this is specialist work. The upstream note
   that "the original unstripped WASM tools were about 106 MB" before section-stripping
   and memory tuning suggests a real project, not an afternoon.
3. **Do not redistribute at all.** Running GPL software on your own server is *not*
   conveying, and triggers no source obligation. This is the server-side option, and it
   is the only one available immediately.

*Not* a problem, for the avoidance of doubt: the compiler's **output**. GCC's Runtime
Library Exception covers `libgcc` linked into the student's firmware, and avr-libc is
BSD-style. The Arduino core is LGPL-2.1, so `public/sim/traffic-mega.hex` is a combined
work — satisfied by the core being a published pinned version (1.8.7) and the relinking
recipe being committed as `scripts/build-avr-hex.mjs`. The three pre-existing fixtures
in `public/sim/` already had exactly this property, so this is not new exposure.
[inferred — licence reading, not legal advice; worth 20 minutes of a lawyer's time
before any WASM toolchain ships]

### Blocker 2: there is no C compiler, only a C++ one

The package ships `cc1plus` and no `cc1`. Every Arduino core `.c` file must therefore be
compiled as C++. That is mostly harmless — `Arduino.h` wraps its declarations in
`extern "C"`, so the definitions inherit C linkage — but I hit a real failure building
the core for the Mega: [observed]

```
/arduino/core/hooks.c:31:6: error: 'void yield()' aliased to undefined symbol '__empty'
… then: wiring.c:(.text.delay+0x26): undefined reference to `yield'
```

`static void __empty()` gets C++ mangling, so `alias("__empty")` names a symbol that
does not exist, and every `delay()` fails to link. Worked around with a four-line
`extern "C"` shim (documented in `scripts/build-avr-hex.mjs`). **One such incompatibility
in fifteen translation units** — a rate that should be expected to bite again on any
library that ships C.

### Blocker 3: no preprocessor for `.S`, so `pulseIn()` cannot link

`wiring_pulse.S` is preprocessed assembly and the package ships no `cpp` driver for it.
Omitted from the Mega core build, which makes `pulseIn()` a **link error** rather than a
silent misbehaviour — the right failure mode, but a hole. HC-SR04 ultrasonic sketches,
which the part library is meant to grow toward (D8), are the obvious casualty.
[observed]

### Blocker 4: nothing converts `.ino` to `.cpp`

Students write `.ino`. Arduino's build system silently inserts `#include <Arduino.h>` and
hoists function prototypes so that a function can be called above its definition. **No
part of the WASM package does this**; I added the include by hand in all three sketches.
Reimplementing Arduino's prototype-hoisting correctly is a real parser task, and getting
it wrong produces confusing errors on the student's own valid code. [observed —
the transformation is absent; the difficulty is [inferred]]

### Blocker 5: the library set is frozen at build time

Libraries are shipped as **precompiled `.o` files** chosen by a manifest — DHT, Servo,
Wire, SPI, Firmata, Adafruit GFX/SSD1306/BusIO/BMP085, VL53L0X. A student cannot add a
library; adding one means rebuilding and redeploying the asset bundle. For a fixed
12-experiment syllabus that is tolerable. For "a free-form workspace where anyone can
build any circuit" (D7's own framing) it is a standing constraint. [observed — the
manifest and object groups]

### Blocker 6: no board but the Uno, upstream

The package ships ATmega328P objects and avr5 libraries only. I built Mega support
myself by recompiling the Arduino core from source for avr6 (15 translation units,
3.6 s) and pulling the avr6 multilib libraries out of the Arduino toolchain
distribution. It works — that is where `public/sim/traffic-mega.hex` came from — but in
a browser it means either shipping ~30 more prebuilt objects per board or paying that
3.6 s once per board per session. [observed]

### Blocker 7: single vendor, no track record

One company's proof of concept: 3 versions, all published on one day in May 2026,
**149 downloads in the last month**. [observed — npm registry] The `.wasm` binaries are
unauditable in practice. If it is abandoned we inherit binaries we cannot rebuild —
which is Blocker 1 again, from the other direction.

### Blocker 8: phones are untested

40.8 MB peak in `cc1plus` plus ~15 MB of loaded assets plus the emulator and the React
app, on a 3–4 GB Android device. I could not test this. [not observed — stated as a gap]

---

## The D7 question

D7 chose in-browser WASM over a server endpoint, before anyone knew what the WASM route
actually cost. Now we do.

### Honest comparison

| | in-browser WASM | server endpoint (arduino-cli) |
|---|---|---|
| **Licence** | ❌ cannot lawfully redistribute today (Blocker 1) | ✅ running ≠ conveying; no obligation |
| **Works today** | ⚠️ Uno yes; Mega only after work I did by hand | ✅ every board, every library, out of the box |
| **`.ino` handling** | ❌ must be written from scratch (Blocker 4) | ✅ arduino-cli does it correctly |
| **Student adds a library** | ❌ redeploy the bundle | ✅ `arduino-cli lib install` |
| **First load** | 4.72 MB, ~19 s at 2 Mbps, then cached | ~0 |
| **Per compile, network** | 0 | ~2 KB up, ~16 KB down |
| **Per compile, latency** | ~1 s desktop, ~3–6 s phone [inferred] | RTT + 1–2 s; ~1.5–2.5 s from India to a nearby region [inferred] |
| **Offline** | ✅ after first load | ❌ |
| **Marginal cost** | zero | small but real; needs sandboxing (arbitrary C++) |
| **Weak phone** | ⚠️ 40.8 MB + seconds of CPU | ✅ almost nothing |

Flaky college wifi cuts both ways, and the direction is not obvious: WASM pays 4.72 MB
once and then never needs the network; the server pays ~18 KB per compile but needs the
network at the exact moment the student presses Run.

### Recommendation: reverse D7 for v1

Not because the WASM route failed — it demonstrably works, and the download is a third
of what D7 feared — but because of what it cannot do *yet*:

1. **We cannot lawfully ship the only working artifact** (Blocker 1). This is the
   decisive one. It is not a preference or a performance trade; it is a legal bar on the
   sole existing implementation, and curing it means building GCC to WebAssembly
   ourselves.
2. **Students want libraries and `.ino` semantics.** Blockers 4 and 5 are each a real
   chunk of work, and arduino-cli has both solved.
3. **The audience is on weak phones.** Blocker 8 is untested, and the server route makes
   it moot rather than betting on it.

So: **build the compile endpoint, ship the editor, and keep WASM as a documented
fallback** with a clear re-entry condition — *if* we ever build (or are given) a
GPL-compliant AVR toolchain for the browser, the client side is a solved problem and
this spike is the proof, including the exact file list and sizes above.

The spike is not wasted either way: it produced the ATmega2560 firmware that unblocks
experiment 11 today, and a reproducible build script that retires three unreproducible
binary blobs.

---

## What shipped from this spike

| file | what |
|---|---|
| `public/sim/traffic-mega.hex` | **the first ATmega2560 firmware in the repo** — experiment 11's own published sketch, 4,308 B |
| `scripts/build-avr-hex.mjs` | reproducible builder; `--board uno\|mega`, downloads and checksums its own toolchain |
| `scripts/sketches/*.cpp` | the three sources, so every `.hex` has a source of truth |
| `lib/simulator/__tests__/wasmhex.test.ts` | 36 assertions that the compiled firmware *behaves* |
| `lib/simulator/__spikes__/fixtures/wasm-{blink,dht11}.hex` | Uno evidence artifacts |

`node scripts/build-avr-hex.mjs --board mega --sketch scripts/sketches/traffic-mega.cpp
--out public/sim/traffic-mega.hex` reproduces the shipped file **byte for byte from a
cold cache** — verified by sha256 after `rm -rf .cache/avr`. [observed] First run takes
~65 s including 55 MB of downloads; afterwards ~3.6 s.

### Unblocking experiment 11 — what remains

The firmware exists and is proven. The remaining change is in
`components/simulator/CircuitEditor.tsx`, **which another agent owns, so I have not
touched it.** It needs:

1. A board tag on the firmware list (line ~45), so a 328P image is never offered to a
   Mega:
   ```ts
   const FIRMWARE = [
     { url: '/sim/blink.hex',        label: 'Blink',   note: 'D13 on/off, 1 s',            board: 'arduino_uno' },
     { url: '/sim/dht11.hex',        label: 'DHT11',   note: 'Experiment 01 sketch',       board: 'arduino_uno' },
     { url: '/sim/pot.hex',          label: 'Pot',     note: 'analogRead(A0) → PWM on D9', board: 'arduino_uno' },
     { url: '/sim/traffic-mega.hex', label: 'Traffic', note: 'Experiment 11 sketch',       board: 'arduino_mega' },
   ]
   ```
2. `noFirmwareFor` (line ~994) to stop hard-coding "a Mega has no firmware", and instead
   return null when the list has an entry for the detected board.
3. The amber "No Mega firmware yet" banner (line ~1278) to be replaced by the normal
   selector, filtered to the detected board.

No engine change is needed: `engine.worker.ts` already sizes flash via
`chipForDoc(msg.doc).flashBytes`, so a Mega document loads a 256 KB image correctly
today. [observed — that path is what the new test exercises]

---

## One bug found on the way

`SimulationEngine` throws a `TypeError` — not a diagnostic — when constructed with a
document that wires a pin the given chip does not have (e.g. a Mega document with
`ATMEGA328P`). `rebuildWatchList()` drops pins missing from `chip.pinMap` when building
`watched`, but keeps them in `wiredPins`; `stateKey()` then does
`this.drives.get(name)![0]` on an absent entry. [observed — `lib/simulator/engine.ts`
~L761-774]

Unreachable from the app, where `chipForDoc()` always derives the chip from the same
document, so this is a robustness note rather than a live defect. **`engine.ts` is owned
by another agent right now, so I have not touched it.**

---

## What I could not determine

- **Phone performance.** No Android device available. The 3–6 s figure is scaled from
  desktop and could be wrong in either direction.
- **Whether the upstream author will publish the build recipe.** Not asked.
- **Whether a self-built GCC→WASM toolchain is a two-week or two-month job.** No
  attempt made; the 106 MB → 14 MB stripping work upstream describes suggests the
  latter end.
- **Real server-side latency from Indian campus networks.** The 1.5–2.5 s is arithmetic
  over a plausible RTT, not a measurement.
- **Whether clang/LLVM's AVR backend could replace GCC** and thereby dodge the GPLv3
  problem entirely (LLVM is Apache-2.0). This is the most promising unexplored lead —
  `ClangBuiltArduino`'s open issues say Arduino sketches do not build cleanly today, but
  that project is actively fixing exactly this, and a permissively licensed AVR compiler
  would change the D7 answer. Worth a follow-up spike.
