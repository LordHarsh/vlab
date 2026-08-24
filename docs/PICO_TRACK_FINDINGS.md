# Pico track — feasibility findings

**Question:** can the six Raspberry Pi / Python experiments become real, buildable,
natively-simulated circuits, the way the Arduino ones are?

**Verdict: YES — via a Raspberry Pi Pico running MicroPython on `rp2040js`.** The
prior "D5" decision was right about the destination and I now have running code
rather than an argument. A real prebuilt MicroPython boots in the browser's
worker, a real student `.py` is typed into it over emulated USB, and the GPIO it
sets drives the **existing** analog solver to a current that matches hand-derived
theory to within 2 µA.

There is **one significant honest caveat, and it is not fixable**: the Pico track
runs at roughly **0.46x wall-clock**, against the Arduino track's 3.26x on the
same machine. Simulated time stays exact; wall-clock time runs about half speed.
Section 4 explains why this is a physical ceiling and not a missing optimisation.

Everything below is measured on this machine (Node 24, Windows 11), not
estimated. Reproduce with the spikes in `lib/simulator/__spikes__/p2-*.ts`.

---

## 1. Can `rp2040js` run in a browser worker the way `avr8js` does?

**Yes, with no caveats.**

| | |
|---|---|
| Version | `rp2040js@1.3.3`, published 2026-06-16 |
| Author | Uri Shaked / Wokwi — **the same author as `avr8js`** |
| Licence | MIT |
| Maturity | 90 releases since Feb 2021; it is what Wokwi's own Pico simulator runs on |
| Runtime dependencies | **zero** (`npm install rp2040js` → "added 1 package") |
| Module format | dual ESM + CJS, `exports` map, ships its own `.d.ts` |
| Bundle cost | 320 KB raw / **56 KB gzip** unminified, excluding the optional GDB server |

Browser-safety was checked, not assumed: a grep for `require(`, `node:*`, `fs`,
`net` and `process.` across `dist/esm` returns **nothing** outside the `gdb/`
directory, which we never import. The whole emulator is typed arrays and
`DataView`.

The one API to avoid is the convenience `Simulator.execute()` helper, which
self-paces with `setTimeout`. We do not use it — `PicoSimulationEngine.run(micros)`
drives `core.executeInstruction()` and `clock.tick()` directly, exactly as
`SimulationEngine.run()` drives `avrInstruction()` + `cpu.tick()`.

**One real cost to know about:** `new RP2040()` unconditionally allocates a
**16 MB** `Uint8Array` for the flash window (plus 264 KB SRAM). That is per
engine instance. It is fine for one worker; do not instantiate these casually.

---

## 2. How does MicroPython get loaded? (the crux)

Two static binary blobs, and **the answer to "is it multi-MB" is no — it is
245 KB gzipped.**

| asset | raw | gzip | brotli | what it is |
|---|---|---|---|---|
| `public/pico/bootrom.bin` | 16,384 B | **13.2 KB** | 12.6 KB | RP2040 mask ROM, rev B1. Not optional — the reset vector and the flash stage-2 handoff live in it. BSD-3-Clause. |
| `public/pico/micropython.bin` | 319,232 B | **226.1 KB** | 199.4 KB | MicroPython v1.20.0 for RPI_PICO, as a flat flash image. MIT. |
| **total** | 335,616 B | **≈239 KB** | ≈212 KB | |

The `.uf2` micropython.org publishes is **638,464 B**, but UF2 is a container
with exactly 256 useful bytes per 512-byte block — it is precisely 2x its
payload. `lib/simulator/pico/fetch-firmware.mts` strips the framing at build
time, so the download is halved for free. Both files are checked in next to the
existing `public/sim/*.hex` fixtures, and the script documents their provenance
and licences.

### How the student's `.py` gets in

**Over the emulated USB CDC REPL, in paste mode.** This is the part that had to
be worked out rather than looked up.

- `USBCDC(mcu.usbCtrl)` runs a **full emulated USB host enumeration** against
  rp2040js's USB device controller. This works. Without it MicroPython boots and
  then sits silently, because the REPL will not print to a port nobody opened.
- Once `>>>` appears, the engine sends `Ctrl-C` `Ctrl-E`, streams the script, then
  `Ctrl-D`. Paste mode is required, not cosmetic: in the ordinary REPL a blank
  line terminates an indented block, so any script with a blank line inside a
  `while` would be silently cut in half.
- The CDC TX FIFO is **512 entries and `FIFO.push()` drops silently when full**,
  so the script is trickled in as room appears. Shovelling a 2 KB script in one
  go loses most of it and produces a `SyntaxError` that looks like the student's
  fault. (`PicoSimulationEngine.pumpScript()`.)

### The route NOT taken, and why

Shipping a **LittleFS image containing `main.py`** also works and is what
rp2040js's own demo does. Rejected because rp2040js does not implement the SSI
peripheral — as its README says, *"the filesystem is not writeable"* — so every
edit would need a fresh image build **and a full reboot**, plus a LittleFS writer
in JS. The REPL costs neither and is what the student's real workflow (Thonny)
looks like.

**Consequence to be aware of:** the emulated MicroPython **cannot write files**.
Any experiment content that logs to CSV will fail. `dht11-rpi` does exactly this
(see §7).

### Startup latency — measured, and it is a non-issue

| | simulated | wall |
|---|---|---|
| power-on → `>>>` prompt | **0.020 s** | ~0.11 s |
| prompt → script running | < 0.001 s | — |

MicroPython boots essentially instantly. There is no multi-second "waiting for
the Pi to boot" experience to design around.

---

## 3. GPIO observability — is the PinBridge possible?

**Yes, and the mapping to `avr8js` is one-to-one.** This is unsurprising given
the shared author.

| our need | `avr8js` | `rp2040js` |
|---|---|---|
| observe a pin | `port.addListener(cb)` | `mcu.gpio[n].addListener(cb)` — per-pin, so unwatched pins cost literally nothing |
| read drive state | `port.pinState(bit)` → 4 states | `mcu.gpio[n].value` → **6** states |
| drive a pin externally | `port.setPin(bit, bool)` | `mcu.gpio[n].setInputValue(bool)` |
| feed the ADC | `adc.channelValues[ch]` in volts | `mcu.adc.channelValues[ch]` in volts |

Listeners fire only on an actual change (`checkForUpdates()` compares against
`lastValue`), and `setInputValue()` deliberately does **not** fire them — so
there is no feedback loop between the solver and the emulator.

Two genuine improvements over the AVR side:

- **Six pin states, not four.** The RP2040 adds `InputPullDown` and
  `InputBusKeeper`. `PicoPinDrive` carries `'pulldown'` as a first-class state;
  folding it into `'float'` would be invisible on an LED and wrong on a button.
  Bus-keeper is honestly downgraded to high-impedance **and declared in
  `snapshot().limitations`** rather than faked.
- **`GPIOPin.value` already accounts for function-select**, so a pad driven by
  the PWM or PIO block reports its state through the identical path. PWM speed
  control needs no special casing.

### A real finding: the RP2040's pads come out of reset with the **pull-down enabled**

`padValue` resets to `0b0110110`. A bare Pico pin is a ~55 kΩ resistor to ground
before firmware touches it, and that **really does load a high-impedance
divider** — a 10k/10k divider off 3V3 reads 1.512 V, not 1.650 V. This is pinned
by test E so nobody "fixes" it later.

---

## 4. Timing — is it fast enough? (the honest caveat)

**It runs, the memoisation works, and it is about 2x slower than wall clock.**

Measured on this machine, same blink workload, same process:

| | emulated cycles/s | vs realtime |
|---|---|---|
| `avr8js`, Uno blink, full engine | 52.2 M | **3.26x** |
| `rp2040js`, Pico MicroPython blink, full engine | 58.1 M | **0.46x** |

**The two emulators run at essentially the same JavaScript speed.** rp2040js is
in fact marginally *faster* per emulated cycle. The entire difference is that the
Pico is 7.8x faster silicon: 125 MHz versus 16 MHz. **This is a physical ceiling,
not a missing optimisation, and no amount of tuning our code will move it.**

Supporting measurements (`p2-rp2040-throughput.ts`):

| workload | instr/s | vs realtime |
|---|---|---|
| hand-written 2-instruction Thumb loop (absolute ceiling) | 104.8 M | 1.26x |
| MicroPython `while True: time.sleep(1)` | 31.7 M | 0.50x |
| MicroPython tight GPIO toggle, no sleep | 36.3 M | 0.48x — **68 k pin edges/s** |

Even the theoretical ceiling with no peripherals is only 1.26x, so there is no
headroom to recover.

**Idle-skipping does not save us.** The run loop does skip ahead when
`core.waiting` is set — but that covers only **8.5%** of simulated time during a
`time.sleep()`, because MicroPython's delay polls TinyUSB rather than parking in
WFE. On real hardware that idle costs nothing; in an emulator we pay for it.

**The memoisation trick ports intact.** The pin-state cache key, the 2-entry
cache for a blink and the 25 ms time-weighted display filter all work unchanged.
68 k pin edges/s is the pathological case (a `while True:` toggle with no sleep);
the AVR engine already copes with 9600-baud serial toggling `D1`, so this is well
inside what the design handles.

### What 0.46x actually means for a student

Simulated time is **exact** — a `time.sleep(0.5)` is 500.0 ms, measured to
0.1 ms. Sensor protocol timing, PWM and interrupts are all correct. What is wrong
is only the *wall-clock rate*: a 1 Hz blink visibly blinks at about 0.5 Hz.

Mitigations, in order of honesty:
1. **Say so in the UI.** The worker already reports `speedRatio`; surface it.
2. Prefer content that is event-driven over content that is stopwatch-driven.
3. The 2 ms worker slice (vs the AVR's 5 ms) keeps a rewire feeling immediate
   despite the slower emulation.

---

## 5. What I built

New files only. **I did not edit `parts.ts`, `examples.ts`, `devices.ts`,
`behavioural.ts`, `components/sections/**` or `supabase/migrations/**`.** I also
left `model/compile.ts` untouched, though it was not on the forbidden list,
because it is shared — see §6.

| file | what |
|---|---|
| `lib/simulator/pico/board.ts` | Pico `PartDefinition`: all 40 header pins in silkscreen order, GND bus, GP→index and GP→ADC-channel maps, SVG. Registers itself into `PART_LIBRARY` at import. |
| `lib/simulator/pico/firmware.ts` | UF2 → flat flash image, bootrom byte→word conversion, format sniffing. |
| `lib/simulator/pico/engine.ts` | `PicoSimulationEngine` — the PinBridge, the memoised DC solve, the display filter, the ADC bridge and the REPL feeder. |
| `lib/simulator/pico/fetch-firmware.mts` | Reproduces the two blobs in `public/pico/`, with provenance and licences. |
| `lib/simulator/worker/pico.worker.ts` | Worker: self-paced slices, MessageChannel yield, throttled snapshot, reset/reboot. |
| `lib/simulator/worker/pico-protocol.ts` | Message types. Firmware travels as `ArrayBuffer` so it can be transferred, not cloned. |
| `lib/simulator/__tests__/pico.test.ts` | **49 tests, 49 passing.** |
| `lib/simulator/__spikes__/p2-*.ts` | The three measurement spikes behind every number above. |
| `public/pico/{bootrom,micropython}.bin` | 336 KB of firmware. |
| `package.json` | `+ rp2040js@1.3.3` |

### Proof, with numbers

Every electrical expectation in `pico.test.ts` is derived **in the test file** by
bisection on the Shockley equation and a KVL loop — a different method from the
engine's Newton-on-a-stamped-matrix, and never a comparison against the engine's
own output.

The headline result — **real MicroPython, real solver, hand-derived answer**:

```
script: from machine import Pin / led = Pin(15, Pin.OUT) / led.value(1)

MicroPython reaches its REPL prompt ................................ PASS
the engine got the script pasted in ................................ PASS
the interpreter accepted it — no traceback ......................... PASS
machine.Pin(15, Pin.OUT).value(1) drives the pad high .............. PASS
and the LED carries the hand-derived 3.3 V current .. 5.1551 mA expected
                                                      5.1571 mA actual  PASS
```

**3.3 V is modelled properly, not copied from the 5 V Uno.** The same LED and the
same 220 Ω resistor:

| | rail | pad impedance | LED current |
|---|---|---|---|
| Arduino Uno | 5.0 V | 25 Ω | 12.394 mA |
| **Pico** | **3.3 V** | **50 Ω** | **5.155 mA** |

That is **41.6%** of the Uno's current — the LED's ~2 V forward drop eats a far
larger share of a 3.3 V budget. Test C asserts the ratio explicitly, because a
wrong-but-consistent rail solves perfectly well and would silently teach the
wrong resistor value. The sweep at 100 Ω / 330 Ω / 1000 Ω agrees with independent
theory to better than 3 µA at every point.

All electrical constants are re-derived from the RP2040 datasheet, not
inherited: `R_DRIVE` 50 Ω, `R_PULL` 55 kΩ, `VIL` 0.8 V, `VIH` 2.0 V (real Schmitt
hysteresis, not a fiat deadband), per-pin rating 12 mA, ADC **12-bit / 4095**
against 3.3 V rather than the AVR's 10-bit / 1023.

### Regressions

```
solver 179/179   document 55/55   compile 124/124   engine 45/45   transient 34/34
npx tsc --noEmit   0 errors
npx next build     exit 0
```

(`document` is 55, not the 51 in the brief — another workstream added four. Not
mine, and green.)

---

## 6. What is NOT done, and what needs wiring up

**Honest scope statement: this is a proven vertical slice, not a shipped
feature.** One board, one part, one script path, one LED. None of the six
experiments runs yet.

### Edits needed in files I do not own

1. **`lib/simulator/model/parts.ts`** — three one-line changes:
   - widen the union to `board: 'arduino_uno' | 'raspberry_pi_pico'` (this lets
     `board.ts` drop a cast that exists solely because the honest value does not
     currently typecheck);
   - add `raspberry_pi_pico: PICO_PART` to `PART_LIBRARY`;
   - add it to `PALETTE`.

   Until then `registerPicoPart()` inserts both at import time. **That mutation
   is a stopgap and should not survive** — note it also splices the Pico into
   `PALETTE` at index 1, which is a visible UI change any importer inherits.

2. **`lib/simulator/model/compile.ts`** — one line. The shorted-I/O-pin branch
   hardcodes `volts: 5`, which overstates a Pico fault by 52%. It should read the
   rail from the board. I worked around it inside the Pico engine rather than
   touching a shared file; the workaround should be deleted once compile is
   fixed. Recorded as `PICO_COMPILE_TODO` in `board.ts`.

   Everything *else* in `compile()` handles a Pico correctly with no change:
   rail stamping already keys off the pin ids `'5V'` / `'3.3V'`, and
   `mcuPorts` / `pinNets` / `analogNets` are all keyed by pin id.

3. **`lib/simulator/devices.ts`** — the over-current *thresholds* on `NortonPort`
   are per-instance and the Pico engine sets them (12 mA / 16 mA). The *message
   text* is hardcoded AVR wording: a Pico fault currently reads "this pin is
   destroyed", which is ATmega language and overstated for an RP2040 pad.
   Cosmetic, but it is the kind of dishonesty §2.3 is about.

4. **UI** — there is no `usePicoSimulator` hook. It should mirror
   `worker/useSimulator.ts` and additionally `fetch()` the two blobs from
   `/pico/*.bin` and hand them over as transferables.

### Missing device models (the real remaining work)

`behavioural.ts` implements **only DHT11**. The six experiments additionally need
a **DS18B20 (1-Wire slave)**, and probably a relay, an L298N and a ULN2003 +
stepper. The DS18B20 is the substantial one — ROM search, convert-T, scratchpad —
and it gates two experiments.

### Risks I have not closed

- **The DHT11 behavioural model has never been driven by MicroPython's `dht`
  module.** It was written against an AVR library's bit-banging. The protocol is
  the same, but the timing tolerances are not verified. This needs a test.
- **336 KB of binaries are now in git.** Justifiable (`public/sim/*.hex` sets the
  precedent, and `fetch-firmware.mts` makes them reproducible) but it is the
  owner's call, and Git LFS or a build-time fetch are alternatives.
- The 16 MB-per-instance flash allocation is untested under a browser worker's
  memory budget on low-end devices.

---

## 7. Phase 3 — content implications, per experiment (report only, nothing changed)

Every `RPi.GPIO` call has to become `machine.*`. Beyond that mechanical
substitution, the experiments differ enormously, and two of them hit a wall.

**Evidence for the networking verdict** — I asked the shipped interpreter
directly (`p2-micropython-modules.ts`):

```
HAVE machine  HAVE time  HAVE dht  HAVE onewire  HAVE ds18x20
HAVE os  HAVE json  HAVE math  HAVE rp2  HAVE _thread
MISS network     ImportError
MISS socket      ImportError
MISS urequests   ImportError
MISS requests    ImportError
MicroPython v1.20.0 on 2023-04-26 / rp2 / 'Raspberry Pi Pico with RP2040'
```

`dht`, `onewire` and `ds18x20` are **frozen in** — the two sensor experiments are
much easier than feared. **There is no networking of any kind** — and a Pico W
build would not rescue it, because rp2040js does not emulate the CYW43 radio and
an offline in-browser emulator has no network to reach anyway.

One happy accident: every BCM number the content uses (4, 5, 17, 18, 22, 23, 24,
27) exists as a `GP` number on a Pico, so **pin numbers can be preserved
verbatim**. The physical header positions differ completely, so every wiring
diagram must be redrawn.

---

### 1. `led-button-rpi` — **easy, no blockers**

- `GPIO.setup(17, GPIO.OUT)` → `Pin(17, Pin.OUT)`; `GPIO.PUD_DOWN` → `Pin.PULL_DOWN`.
  ~20 lines, direct 1:1.
- `GPIO.cleanup()` has no equivalent — drop it (or `machine.reset()`).
- All parts already exist (LED, resistor, push button). Pi and Pico are both
  3.3 V, so the **resistor values in the existing content are already correct**.
- Quiz needs edits: two questions are about `GPIO.BCM` and `GPIO.cleanup()`,
  neither of which exists in MicroPython.

### 2. `dht11-rpi` — **easy port, one real casualty**

- `Adafruit_DHT.read_retry(sensor, 4)` → `dht.DHT11(Pin(4))` + `.measure()` +
  `.temperature()` / `.humidity()`. Verified present.
- **Casualty: the CSV logging cannot work.** The code appends to `dht_log.csv`;
  the emulated flash is not writeable (§2). Rewrite to keep readings in a list and
  print them, or to stream over serial.
- The `dht11` part and its behavioural model already exist — but see the risk
  above: it has never been exercised by MicroPython's driver.
- Procedure step "install `Adafruit_DHT`" becomes "nothing to install".

### 3. `ds18b20-rpi` — **full rewrite, and it needs a new device model**

- The current code is not a GPIO program at all. It reads
  `/sys/bus/w1/devices/28*/w1_slave` — a **Linux kernel driver**, reached via
  `modprobe` and a device-tree overlay. None of that exists on a microcontroller.
- The MicroPython equivalent bit-bangs the bus in user code:
  `onewire.OneWire(Pin(4))` → `ds18x20.DS18X20(ow)` → `scan()` / `convert_temp()`
  / `read_temp(rom)`. Both modules are present.
- **Blocker: we have no DS18B20 device model.** This is the single largest piece
  of missing simulator work in the Pi set, and it gates this experiment and #6.
- Procedure loses its `raspi-config` / `/boot/config.txt` steps entirely.

### 4. `motor-control-rpi` — **portable code, missing parts, weak observables**

- Code ports cleanly: `GPIO.PWM(18, 1000)` + `ChangeDutyCycle(75)` →
  `PWM(Pin(18))` + `freq(1000)` + `duty_u16(...)`. rp2040js implements the PWM
  block and `GPIOPin.value` already reflects PWM-driven pads, so **the engine's
  time-averaged display filter will render speed control as a smooth current with
  no new code**. The ULN2003 stepper sequence is plain GPIO writes.
- **Missing parts:** no L298N, no ULN2003, no stepper motor. Only a generic
  `dc_motor` (a 120 Ω load) exists.
- **Weak observable:** the DC engine models a motor as a resistor. It reports
  current, not rotation, torque or step count. "`step(512)` — one full
  revolution" has nothing to show. Either add a rotation readout driven by step
  counting, or re-scope the section to what is genuinely simulated.
- One electrical note worth teaching: a Pi/Pico GPIO cannot drive a motor
  directly, which is *why* the L298N is there — that lesson survives intact.

### 5. `home-automation-rpi` — **fundamentally incompatible as written**

- The program **is** a Flask web server (`app.run(host='0.0.0.0', port=5000)`)
  serving an HTML toggle page. Verified: no `network`, no `socket`. There is no
  path to running this, and no partial version of it either.
- The GPIO half (four relay pins) is trivial and fine.
- **Options, in order of preference:**
  1. **Re-scope** to "four inputs switch four relay outputs" — pure GPIO. Keeps
     all the electrical learning; loses the web UI.
  2. Keep the Flask code as clearly-labelled **reference material** (this is how
     you'd do it on a real Pi) and make the *buildable* circuit the relay bank.
  3. Build the control panel as **lab UI that talks to the emulator over the
     serial/REPL channel**. Honest only if labelled — the student's browser is
     genuinely the client, but the transport is serial, not HTTP.
- Also needs a **relay part**, which does not exist.

### 6. `health-monitoring-rpi` — **the worst case; compounds every problem**

- **DS18B20 via `glob.glob('/sys/bus/w1/...')`** — Linux-only, same as #3, same
  missing device model.
- **MCP3008 SPI ADC** — needed on a Pi because *the Pi has no analog inputs*. A
  **Pico has three** (GP26–28), which the engine already bridges and test E
  proves. So the honest fix is to **delete the MCP3008 entirely** and wire the
  pulse sensor straight to GP26. That is a genuine pedagogical improvement, and
  it removes the need for an SPI-slave model.
- **ThingSpeak upload via `requests.get`** — same networking wall as #5. No
  `requests`, no `urequests`, no `socket`.
- **Recommendation:** re-scope to "read body temperature and pulse locally,
  evaluate thresholds, alert on the serial console", and present the cloud upload
  as reference code. The threshold logic (36.1–37.2 °C, 60–100 BPM) — which is
  the actual learning objective — survives completely.
- A pulse-sensor part would also be needed; a potentiometer is a defensible
  stand-in for a first pass.

---

### Summary table

| experiment | code port | parts needed | verdict |
|---|---|---|---|
| `led-button-rpi` | trivial | none | **ready to build** |
| `dht11-rpi` | easy | none (verify DHT11 model vs MicroPython) | **ready, minus CSV logging** |
| `ds18b20-rpi` | full rewrite | **DS18B20 model** | blocked on a device model |
| `motor-control-rpi` | easy | L298N, ULN2003, stepper | buildable; observables are weak |
| `home-automation-rpi` | **impossible as written** | relay | **must be re-scoped** — no networking |
| `health-monitoring-rpi` | **impossible as written** | DS18B20, pulse sensor | **must be re-scoped** — no networking |

Four of six are reachable. Two need a content decision from the owner before any
code is worth writing, and that decision is not a technical one — it is whether
"IoT cloud upload" stays in the syllabus when it cannot be simulated offline.
