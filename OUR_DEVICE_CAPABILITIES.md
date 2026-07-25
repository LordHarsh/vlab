# What a student can currently DO with every device in our simulator

Source-derived inventory of the VLab circuit simulator, produced for a
device-by-device diff against `TINKERCAD_DEVICE_PARITY.md`. Every claim carries a
`file:line` citation. Nothing here was observed in a browser — this is read off
the code.

Repo state: read at commit `4dfa91f` ("Wires you can actually draw and bend"),
25 palette parts (`lib/simulator/model/parts.ts:1954-1989`). Line numbers were
spot-checked against that tree after writing.

---

## How to read this

Each device row has seven fields, in the same order every time:

1. **Inspector props** — the control **as rendered**, not as declared. A declared
   prop and a usable control are not the same thing; the mapping from
   declaration to widget is in `components/simulator/CircuitEditor.tsx:533-646`
   and is reproduced in the matrix below.
2. **Canvas interactions** — what can be manipulated on the artwork itself.
3. **Reported state** — Measurements panel (a current, in mA) and Device-state
   panel (`describeDevice` output).
4. **Simulation behaviour** — what the model does, and every `limitations` /
   "not simulated" string it pushes.
5. **Safety checks** — every `safety()` and its thresholds.
6. **Pins** — count and labels.
7. **Fidelity** — datasheet model or simplification, quoting the code.

### Control-type rendering matrix

`PropControl` (`components/simulator/CircuitEditor.tsx:533-646`) picks the widget
from the prop's SHAPE, never from the part:

| Declared | Rendered as | Where |
|---|---|---|
| `range` with `min:0 max:1 step:1` | **checkbox** (`isToggle`) | `CircuitEditor.tsx:345-347`, `545-561` |
| `range` otherwise | **HTML `<input type=range>`** + live numeric readout with `prop.unit` suffix | `CircuitEditor.tsx:563-586` |
| `number` | **free text box + SI unit `<select>`** (Tinkercad's VALUE_AND_UNIT), with `options` offered as a `<datalist>` of suggestions, inline validation and clamp messages | `CircuitEditor.tsx:374-521`, `588-590` |
| `choice` | **`<select>` over strings** + hint line | `CircuitEditor.tsx:598-620` |
| `select` | **`<select>` over numbers**, labelled `0 → "none (wire)"`, `≥1000 → "${o/1000} k${unit}"`, else `"${o} ${unit}"` | `CircuitEditor.tsx:622-645` |

There is **no** colour picker, no name/label field, no "hidden/visible" toggle,
no per-part notes field, and no rotation field in the inspector — rotation is a
button (`CircuitEditor.tsx:2296-2301`).

### Reported-state plumbing

- **Measurements** shows only parts in `compiled.meters`, as
  `Math.abs(current*1000).toFixed(2)` mA, keyed by raw part id
  (`CircuitEditor.tsx:2418-2436`). `meters` is populated for: resistor
  (`compile.ts:299`), variable_resistor (`336`), load (`344`, unused), buzzer
  (`353`), motor (`377`), stepper (`456`), reactive (`613`), diode (`620`), LED
  (`648`), button (`723`). **Not** the potentiometer, **not** the L298N,
  **not** the ULN2003, **not** the relay board, **not** any sensor.
- **Device state** only appears for kinds in `REPORTS_STATE`
  (`CircuitEditor.tsx:1004-1015`): `buzzer, motor, sensor, stepper, relay_module,
  reactive, potentiometer, variable_resistor, diode, button`. The first five
  report through a behavioural model; the last five are read out of the solve by
  `lib/simulator/analog-state.ts:124-257`.
- **Resistor, LED, capacitor-as-a-meter and the two driver ICs therefore have NO
  device-state row at all** — an LED's only readout is its glow and its
  milliamps.

---

# Editor-level capabilities

| Capability | Exists? | Detail | Cite |
|---|---|---|---|
| **Place part** | Yes | Click a palette tile. Lands at the first collision-free grid slot scanned row-major from (20,20) to (1800,1400), 20-unit step, 20-unit gap | `CircuitEditor.tsx:216-234`, `260-285` |
| **Palette artwork** | Yes | Each tile renders the part's real SVG letterboxed into 64×56 | `CircuitEditor.tsx:323-331` |
| **Search palette** | Yes | Substring match on `def.label`, case-insensitive; "No parts match that search." on empty | `CircuitEditor.tsx:252-258`, `304-308` |
| **Drag part** | Yes | Pointer-drag on the artwork, snapped to the 10-unit (0.1 in) grid | `CircuitCanvas.tsx:909-921`, `760-768`; `document.ts:188-190` |
| **Rotate** | Yes, **inspector button only** | +90° per press, four positions. **No keyboard shortcut, no canvas handle, no free angle** | `CircuitEditor.tsx:2296-2301`; `document.ts:354-359` |
| **Delete part** | Yes, **inspector button only** | Also deletes every wire touching it. **No Delete/Backspace key binding anywhere** | `CircuitEditor.tsx:2302-2311`; `document.ts:361-368` |
| **Copy / paste / duplicate** | **No** | No such action in `DocAction`, no clipboard handler in either component | `document.ts:194-237` (exhaustive union) |
| **Multi-select** | **No** | `selected` is a single `string \| null` | `CircuitEditor.tsx:1143` |
| **Undo / redo** | Yes | Toolbar buttons, 100-entry stack. Drag frames after the first are marked `transient` and ride one entry | `CircuitEditor.tsx:1862-1877`; `document.ts:250`, `260-264` |
| **Undo keyboard shortcut** | **No** | Buttons only | — |
| **Wire: drag to draw** | Yes | Press a pin, drag, release on another pin | `CircuitCanvas.tsx:1022-1040` |
| **Wire: click-to-route** | Yes | Click a pin, click canvas points to lay turns, click a pin to finish. Escape cancels (capture-phase, so it does not also exit fullscreen) | `CircuitCanvas.tsx:1074-1094`, `526-535` |
| **Wire: bend an existing wire** | Yes | Grab the wire body and drag past `DRAG_SLOP` → a waypoint is inserted at that segment | `CircuitCanvas.tsx:726-757`; `document.ts:392-401` |
| **Wire: move a bend** | Yes | Drag its handle; snapped to grid | `CircuitCanvas.tsx:746-757`; `document.ts:403-413` |
| **Wire: delete a bend** | Yes | **Double-click** the handle | `CircuitCanvas.tsx:989-998` |
| **Wire: delete a wire** | Yes | **Double-click** the wire body. Single-click no longer deletes — that was changed because a slipped bend gesture destroyed the wire | `CircuitCanvas.tsx:776-784`, `989-998` |
| **Wire colour** | Auto only | Black if either end is a `gnd` pin, red if `power`, else cycles an 8-colour list. **No picker** — Tinkercad's is noted as absent | `CircuitCanvas.tsx:1716-1736`; `document.ts:109-118` |
| **Wire dedup / self-loop reject** | Yes | Identical pin pairs and self-loops are silently refused | `document.ts:377-387` |
| **Pan / zoom** | Yes | Drag background to pan; wheel to zoom, 0.3×–4×, anchored at the cursor. Zoom % shown bottom-left | `CircuitCanvas.tsx:1042-1049`, `407`, `1057-1059` |
| **Fit to content on open** | Yes | Layout effect fits the whole document on first paint, 0.45×–1.1× | `CircuitCanvas.tsx:506-510`, `427-441` |
| **Net highlight on hover** | Yes | Hovering a pin lights every wire on the same solver net | `CircuitCanvas.tsx:1276-1280`, `1245` |
| **Breadboard tie points hidden when small** | Yes | `subtle` pins render only above 0.55× zoom | `CircuitCanvas.tsx:1266` |
| **Starter circuits** | Yes, 16 | `LED, Exp 01, Pot, Starter 1…12, Blank` — loaded via `loadInto`, which is **undoable** | `CircuitEditor.tsx:2319-2334`; `examples.ts:659-676`; `document.ts:287-303` |
| **Fullscreen gate** | Yes | Editor is blocked behind a prompt until fullscreen; children stay mounted so the document/undo/autosave survive. Native Fullscreen API, with a CSS `fixed inset-0` fallback for iOS Safari. Simulation auto-pauses on leaving and resumes on return, only if it was running | `FullscreenGate.tsx:16-45`, `61-79`; `CircuitEditor.tsx:1707-1723` |
| **Code panel** | Yes, per track | Offered only when `detectBoard` finds **exactly one** board — no board and two boards both refuse | `CircuitEditor.tsx:1304-1327` |
| — AVR track | C++ / `sketch.ino`, compiled **server-side** (`app/api/compile`), diagnostics + flash bytes + warnings shown | `CircuitEditor.tsx:1384-1386`, `2181-2194`; `CodePanel.tsx:591-637` |
| — Pico track | MicroPython / `main.py`, no compile; Run reboots the interpreter and pastes the script; REPL phase shown (`booting… / sending script… / script running / REPL idle`); last traceback extracted | `CircuitEditor.tsx:1077-1082`, `1652-1679`; `CodePanel.tsx:152-159`, `662` |
| — Prebuilt firmware | 4 fixtures, **filtered by board** so a 328P image can never reach a Mega: Blink/DHT11/Pot (Uno), Traffic (Mega) | `CircuitEditor.tsx:77-97`, `1525-1535` |
| **Reset to starter (code)** | Yes | Two-step confirm; loads the editor only, Run still has to be pressed | `CircuitEditor.tsx:1684-1687`; `CodePanel.tsx:425-446` |
| **Reset to starter (circuit)** | **No** | There is no "reset the wiring" button. The nearest thing is re-loading a starter from the Starter-circuits row | — |
| **Panel toggles** | Yes | `Code` and `Components`, `aria-pressed`, persisted in `localStorage`. Below `md` they are mutually exclusive (three columns do not fit a phone) | `CircuitEditor.tsx:2021-2049`, `1238-1242`, `1330-1334` |
| **Panel width** | Yes | Code panel is drag-resizable 280–900 px, persisted | `CodePanel.tsx:687-689`, `984-1052` |
| **Autosave** | Yes | Local (IndexedDB) at 400 ms debounce, remote sync at 3 s. Circuit **and** program in one write so they cannot come back out of step. State shown as `saving… / saved / saved locally / saved locally (offline) / no changes` | `useAutosave.ts:43-45`, `165-172`; `CircuitEditor.tsx:1819-1838` |
| **Run / Stop** | Yes, one button | `Start Simulation` / `Stop` / `Run new code`. Stop is a genuine pause — SRAM, registers and transient state survive | `CircuitEditor.tsx:2070-2089`, `1690-1699` |
| **Reset MCU** | Yes | Rebuilds the engine | `CircuitEditor.tsx:2090-2092` |
| **Live readouts** | `speed ×real time`, `sim seconds`, `solves / cache hits`, `parts · wires · unknowns` | | `CircuitEditor.tsx:2096-2102`, `1814-1816` |
| **Pins driven high** | Yes | Chip list of every MCU pin currently driving high | `CircuitEditor.tsx:2337-2353` |
| **ADC readout** | Yes | Heading names the board's own range: `analogRead · 0–1023` (AVR) or `ADC · 0–4095` (Pico) | `CircuitEditor.tsx:2360-2374` |
| **Serial / REPL monitor** | Yes | Last 1500 chars, `h-28` scroll box, also mirrored inside the code panel | `CircuitEditor.tsx:2478-2488`; `engine.ts:1164` |
| **Checks panel** | Yes | Board problems, solver error, `limitations` (badged **not simulated**), `faults` (amber `caution` / red `destructive`), then connectivity problems. Falls back to a main-thread compile whenever nothing is running, so a stopped board still lists its to-dos | `CircuitEditor.tsx:2491-2570`, `1740-1745` |
| **Connectivity checks** | Yes | "No ground in the circuit", "X is not connected to anything", "X has a lead (pin N) wired to nothing", "D5 is driven but its wire reaches nothing else", and a **breadboard centre-channel crossing** hint naming both holes | `compile.ts:728-730`, `845-879` |
| **Multimeter / oscilloscope / function generator / power supply part** | **No** | Not in the palette. Voltage is only visible through a part's own device-state row | `parts.ts:1954-1989` |

---

# Device inventory

## 1. `arduino_uno` — Arduino Uno

- **Inspector props**: **none**. `makeUno()` declares no `props` (`parts.ts:583-599`).
- **Canvas**: drag, rotate (inspector), delete. No knob/slider/momentary.
- **Reported state**: not in `REPORTS_STATE`, so **no device-state row**. Reports
  through the global panels instead: pins-driven-high, `analogRead 0–1023` ADC,
  Serial.
- **Simulation**: `{kind:'mcu', board:'arduino_uno', logicVolts:5}`
  (`parts.ts:587`). avr8js ATmega328P running a real .hex. Every digital and
  analog pin is stamped as a permanently-present `NortonPort` so the matrix
  sparsity never changes (`compile.ts:662-694`). `5V` and `3.3V` become ideal
  `VoltageSource`s (`compile.ts:695-711`). No limitations pushed.
- **Safety**: two, and they are structurally different.
  - `NortonPort.safety` per I/O pin: >20 mA sourced = **caution**, >40 mA =
    **destructive** — ATmega328P datasheet §32 (`devices.ts:264-320`).
  - `ShortedPin`: a pin wired *directly* to GND has no node of its own, so the
    solver structurally cannot see it. The compiler records it and the engine
    reports it — a **supply** pin unconditionally, an **I/O** pin only while it
    is actually driving high (`compile.ts:40-66`, `654-711`;
    `engine.ts:1052-1084`).
  - `VoltageSource.safety`: >1 A from the rail = destructive short
    (`devices.ts:215-227`).
- **Pins**: **29**. `AREF, GND.1, D13…D0, IOREF, RESET, 3.3V, 5V, GND.2, GND.3,
  VIN, A0…A5`. All three GND pads bussed to one net (`parts.ts:589`). `A5.2` and
  `A4.2` (the SCL/SDA duplicates on the top header) are **deliberately omitted**
  because they are the same silicon as A4/A5 (`parts.ts:591-596`). `AREF`,
  `IOREF`, `RESET` render subtle.
- **Fidelity**: **high**. Real emulator, real firmware, datasheet pin ratings.
  The `logicVolts` field is data on the part specifically because "compile() used
  to hardcode 5, which overstated a shorted Pico pad by 52%" (`parts.ts:60-68`).

## 2. `arduino_mega` — Arduino Mega 2560

- **Inspector props**: **none** (`parts.ts:564-579`).
- **Canvas**: drag/rotate/delete only.
- **Reported state**: same as the Uno; no device-state row.
- **Simulation**: same avr8js track, 5 V logic, plus a hand-written ATmega2560
  peripheral map (`lib/simulator/avr/atmega2560.ts`), because "every interrupt
  vector avr8js ships is an ATmega328P's" (`parts.ts:28-33`).
- **Safety**: identical to the Uno.
- **Pins**: **83**. `AREF, GND.1, D13…D0, D14…D53, 5V.1, 5V.2, GND.4, GND.5,
  IOREF, RESET, 3.3V, 5V, GND.2, GND.3, VIN, A0…A15`. Five GND pads bussed; the
  three 5 V pads bussed. `SCL`/`SDA` omitted as duplicates of D21/D20
  (`parts.ts:542-578`).
- **Fidelity**: **high**, with an honest cost recorded in the comment: bussing
  the 5 V pads "costs one node and one branch row even in a circuit that never
  touches the rail … which is a real price" (`parts.ts:557-562`).

## 3. `raspberry_pi_pico` — Raspberry Pi Pico

- **Inspector props**: **none** (`parts.ts:686-726`).
- **Canvas**: drag/rotate/delete only.
- **Reported state**: no device-state row. Gets its own rail section instead:
  interpreter phase, **on-board LED (GP25)** on/off, and how many lines are
  loaded — GP25 has no header pad so it can never reach the solver or the canvas
  (`CircuitEditor.tsx:2381-2415`).
- **Simulation**: rp2040js + MicroPython, **3.3 V** logic (`parts.ts:714`). ADC
  is 12-bit on GP26–28.
- **Safety**: same `NortonPort` / `ShortedPin` / `VoltageSource` set. Because
  `logicVolts` is 3.3 here, a shorted pad reports 3.3 V rather than 5 V
  (`compile.ts:666-676`).
- **Pins**: **40**, in physical silkscreen order — left header top-to-bottom
  pin 1→20, right header **bottom-to-top** pin 21→40 (`parts.ts:686-694`). All
  seven GNDs plus AGND bussed. `GP23/24/25` absent because they are not brought
  out on a real Pico.
- **Fidelity**: **hand-drawn on purpose** — "@wokwi/elements ships no Pico
  element … and reusing the Uno's art would put a student's wire on a pin that
  does not exist" (`parts.ts:616-621`). `3.3V` and `5V` are named for the voltage
  rather than the silkscreen (`3V3(OUT)`, `VBUS`) because `compile()` keys rail
  stamping off exactly those ids (`parts.ts:655-662`).

## 4. `breadboard` — Breadboard

- **Inspector props**: **none** (`parts.ts:486-538`).
- **Canvas**: drag/rotate/delete. Tie points render only above 0.55× zoom.
- **Reported state**: none. Explicitly excluded from net "activeness" counting.
- **Simulation**: half-size, 30 columns. Every 5-hole bank and every power rail
  is a declared bus, so the netlist extractor treats the board as an ordinary
  part (`parts.ts:494-514`). Inert breadboard-only nets never reach the matrix —
  otherwise 420 tie points would be 420 unknowns against a ~15 budget
  (`compile.ts:235-262`).
- **Behaviour worth naming**: the **centre channel is real**. Rows a–e and f–j on
  the same column are separate nets, and `compile()` detects two dead leads
  straddling it and says so by hole name (`compile.ts:133-145`, `825-854`).
- **Safety**: none.
- **Pins**: **420** — 300 tie points (`a1…j30`) + 120 rail points
  (`tp1…30, tn1…30, bp1…30, bn1…30`), all `passive` and `subtle`. **64 buses**.
- **Fidelity**: geometrically faithful, generated rather than hand-written.

## 5. `resistor` — Resistor

- **Inspector props** (1):
  | key | label | rendered | unit | default | min/max | suggestions |
  |---|---|---|---|---|---|---|
  | `ohms` | Resistance | **number + unit dropdown** (`pΩ nΩ μΩ mΩ Ω kΩ MΩ GΩ`) | Ω | **220** | 0 … 1e12 | 0, 100, 220, 330, 470, 1 k, 2.2 k, 4.7 k, 10 k, 100 k (datalist) |

  Hint: *"0 Ω is a plain wire."* (`parts.ts:735-752`). The SI ladder is
  Tinkercad's own, verbatim (`parts.ts:314-330`). Typed values are validated in
  `parseValueUnit`, which **rejects** non-numeric and negative rather than
  reinterpreting, and **clamps** out-of-range with a visible note
  (`parts.ts:2100-2123`).
- **Canvas**: drag/rotate/delete only. No knob.
- **Reported state**: **Measurements only** — mA. No device-state row.
- **Simulation**: linear `Resistor`, `1/R` conductance, `R` clamped up to
  `MIN_RESISTANCE = 1 mΩ`; negative or non-finite **throws** rather than being
  clamped, and the solver surfaces it as `ok:false`
  (`devices.ts:113`, `127-141`).
- **Safety**: `I²R > rating` = **destructive**, rating **0.25 W** (a common
  through-hole part) — *"Resistor is dissipating X W — it is rated for 0.25 W and
  would burn out."* (`devices.ts:156-170`).
- **Pins**: **2** — `1`, `2` (harvested wokwi art).
- **Fidelity**: exact for a linear resistor. The 1 mΩ floor is documented as a
  *numerical* limit, not a cosmetic one: a 1e-12 Ω clamp annihilated any resistor
  above ~4.5 kΩ in double precision, measured as a 5V/10k divider returning
  2.048 V where theory says 2.500 V (`devices.ts:102-113`).

## 6. `led` — LED

- **Inspector props** (1):
  | key | label | rendered | default | choices |
  |---|---|---|---|---|
  | `color` | Colour | **`<select>` of strings** | `red` | `Red — 2.0 V`, `Orange — 2.0 V`, `Yellow — 2.1 V`, `Green — 3.2 V`, `Blue — 3.2 V`, `White — 3.2 V` |

  Hint: *"Colour sets the forward voltage, so it changes the current too."*
  (`parts.ts:888-904`). **There is no brightness prop and no size/type prop.**
- **Canvas**: drag/rotate/delete. The dome fill and the halo are driven from the
  solve: the harvested art's hard-coded `fill="red"` is rewritten to
  `var(--led-body, …)` and the canvas sets that per instance
  (`parts.ts:878-904`; `CircuitCanvas.tsx:1124-1132`, `1157-1166`). Brightness is
  a perceptual curve `min(1, (I/20 mA)^0.45)` (`engine.ts:878-885`).
- **Reported state**: **Measurements only** — mA. **No device-state row**
  (`led` is not in `REPORTS_STATE`, `CircuitEditor.tsx:1004-1015`).
- **Simulation**: Shockley diode + a 2 Ω bulk series resistor via an internal
  node (`devices.ts:670-681`; `compile.ts:621-648`). **Colour genuinely reaches
  the solver** — `compile.ts:641-645` passes `{is, n}` from `ledColour()`. The
  class of bug named in the brief (correct table in `parts.ts`, never passed on)
  **is fixed**; the comment records the measured consequence: 12.39 mA of red vs
  7.47 mA of blue through the same 220 Ω on a 5 V Uno, and 5.16 mA vs 0.90 mA on
  a Pico (`compile.ts:626-640`).
- **Safety**: `Diode.safety` — >20 mA (`rating`) = **caution** *"shortens its
  life"*, >30 mA (`absMaxCurrent`) = **destructive** *"this part is destroyed"*
  (`devices.ts:618-662`).
- **Pins**: **2** — `A` (anode), `C` (cathode).
- **Fidelity**: **datasheet Vf, shared slope.** `is` is derived from the Vf of
  Kingbright WP7113-family lamps, but `n` is **held at 1.8 for every colour**:
  *"re-fitting n per colour would need a second reference solve per colour that
  nobody has run. Holding n and moving `is` reproduces the datasheet Vf at 20 mA
  exactly, and the slope either side of it is then the same shape as red's —
  which is the honest limit of this model"* (`parts.ts:762-772`). Red keeps the
  literal `is: 1e-20` fitted against ngspice reference solves so nothing already
  built moves (`parts.ts:816-824`). A module-load guard shouts if a wokwi bump
  renames the dome attribute (`parts.ts:906-917`).

## 7. `push_button` — Push button

- **Inspector props** (1):
  | key | label | rendered | default |
  |---|---|---|---|
  | `pressed` | Pressed (latched) | **checkbox** (0/1 range) | 0 |

  Hint: *"Or press and hold the button itself on the canvas."* (`parts.ts:951-962`).
- **Canvas**: **momentary press-and-hold** on the cap — `r ≈ 14.9`, centred on
  the bounding box, geometry read off the art rather than eyeballed
  (`parts.ts:936-970`). Pointer-down writes 1, pointer-up writes 0; release also
  fires if the pointer leaves the canvas, so a button can never stick down
  (`CircuitCanvas.tsx:896-907`, `797-812`). `role="button"` with `aria-pressed`;
  **Space/Enter toggle** rather than hold, because "a keyboard has no *held*"
  (`CircuitCanvas.tsx:1623-1707`). wokwi's own `.button-active-circle` is
  re-wired to `--button-pressed` so the real pressed artwork lights
  (`parts.ts:919-990`).
- **Reported state**: **Measurements** (mA through the contacts) **and
  device-state**. `describeDevice`: headline `pressed` / `released`; detail
  `"contacts closed · N mV across them"` or `"contacts open · N V across them"`,
  or `"contacts wired to nothing"` when unwired (`CircuitEditor.tsx:969-984`).
  State keys: `pressed, connected, volts` (`analog-state.ts:244-254`).
- **Simulation**: a `Resistor` of **0.05 Ω closed / 1e12 Ω open** — never a
  removed device, so pressing never changes the matrix structure
  (`compile.ts:714-724`).
- **Safety**: inherits `Resistor.safety` (0.25 W). A closed button carrying
  enough current to exceed that will report as a burnt-out **resistor**, which is
  a slightly odd wording for a switch.
- **Pins**: **4** — `1a`, `1b`, `2a`, `2b`. `1a↔1b` and `2a↔2b` are bussed,
  "permanently bridged inside the switch body — a classic source of student
  confusion, and a real electrical fact" (`parts.ts:947-949`).
- **Fidelity**: **no bounce.** The contacts are ideal; there is no contact-bounce
  model anywhere, so a debounce exercise cannot fail here the way it does on a
  bench.

## 8. `potentiometer` — Potentiometer

- **Inspector props** (2):
  | key | label | rendered | unit | default | min/max/step |
  |---|---|---|---|---|---|
  | `position` | Knob | **range slider** with `%` readout | `%` | 50 | 0/100/1 |
  | `totalOhms` | Track resistance | **number + unit dropdown** | Ω | **10000** | 0.5 … 1e12; suggestions 1 k, 5 k, 10 k, 50 k, 100 k, 1 M |

  Hint on the track: *"The whole track, end to end. The knob splits it."*
  (`parts.ts:1006-1034`).
- **Canvas**: **`KnobControl`** — the only true rotary knob in the library.
  Centre (39.2, 31.7), grab radius 30, sweep **−150° … +150°** (a real
  single-turn pot's 300° travel with the detent at twelve o'clock), driving
  wokwi's own `--knob-angle` so the real tick turns rather than a second one
  being drawn over it (`parts.ts:1036-1058`). Absolute-angle tracking with a dead
  zone at six o'clock that **clamps to the nearer stop instead of wrapping**
  (`parts.ts:2145-2177`). `role="slider"` with full arrow / PageUp / Home / End
  keyboard contract (`CircuitCanvas.tsx:1360-1470`).
- **Reported state**: **device-state only — it is NOT in Measurements** (no
  `meters.set` in the pot branch, `compile.ts:300-324`). `describeDevice`:
  headline `"{position}% · {wiperVolts} V"`, detail `"{lower} Ω below the wiper ·
  {upper} Ω above · {track} track"`, plus `" · one end open (rheostat)"` when one
  end is unwired, or `" · wiper wired to nothing"`
  (`CircuitEditor.tsx:918-934`). State keys: `position, totalOhms, lowerOhms,
  upperOhms, connected, wiperVolts, endsWired, acrossVolts`
  (`analog-state.ts:186-207`).
- **Simulation**: two real `Resistor`s split by the wiper, each floored at
  `POT_MIN_LEG_OHMS = 0.5 Ω` (`parts.ts:426-453`; `compile.ts:300-324`). The
  divider is genuine — *"This is what makes analogRead() meaningful: the divider
  is real, so the ADC reads a genuine node voltage."* The arithmetic lives in
  `parts.ts` so the readout describes exactly what the solver stamped.
- **Safety**: each leg inherits `Resistor.safety` at 0.25 W.
- **Pins**: **3** — `1`, `2` (wiper), `3`, all typed `passive` (renamed from
  wokwi's GND/SIG/VCC so the part carries no implied polarity)
  (`parts.ts:1059-1062`).
- **Fidelity**: **linear taper only.** There is no log/audio-taper option and no
  wiper contact noise. The track resistance being editable is explicitly
  electrical, not cosmetic: it is "the source impedance the ADC sees, and an
  ATmega's sample-and-hold wants under 10 kΩ" (`parts.ts:1011-1022`).

## 9. `photoresistor` — Photoresistor (LDR)

- **Inspector props** (1):
  | key | label | rendered | unit | default | min/max/step |
  |---|---|---|---|---|---|
  | `light` | Light level | **range slider** with `%` readout | `%` | 60 | 0/100/1 |
- **Canvas**: **`SliderControl`** — a track and handle drawn on the part, at
  y = 5, x = 4→26, handle r = 3.6. A slider rather than a knob because "there is
  nothing on an LDR to turn" (`parts.ts:1095-1108`). Pointer position is
  projected onto the track (so a diagonal track would work and a drifting pointer
  does not jam the control), with one clamp at the end — the redundant second
  clamp was deleted after a mutation check found it changed nothing
  (`parts.ts:2202-2240`). Full `role="slider"` keyboard support
  (`CircuitCanvas.tsx:1474-1487`). The declared box grew by `LDR_HEADROOM = 18`
  so the control lives **inside** `def.width × def.height` — "a control nothing
  knows about is a control another part can be dropped on top of"
  (`parts.ts:1065-1079`).
- **Reported state**: **Measurements** (mA) **and device-state**.
  `describeDevice`: headline is the resistance formatted on the SI ladder
  (e.g. `4.7 kΩ`), detail `"{light}% light · {volts} V across it · {amps}"`, or
  `"…% light · not wired into anything"` (`CircuitEditor.tsx:936-950`). State
  keys: `light, ohms, connected, volts, amps` (`analog-state.ts:209-226`).
- **Simulation**: `variable_resistor`, **200 Ω … 200 kΩ**, interpolated
  **geometrically** in illumination, not linearly — a GL55-series cell's gamma is
  ~0.6/decade, and "a linear map makes the whole middle of the range behave
  nothing like a real cell" (`parts.ts:455-475`; `parts.ts:1091`;
  `compile.ts:325-336`).
- **Safety**: `Resistor.safety`, 0.25 W.
- **Pins**: **2** — `1` (A), `2` (B).
- **Fidelity**: **simplification with a named curve.** No response-time lag (a
  real LDR takes tens of ms to settle), no temperature coefficient, no light
  history/memory effect.

## 10. `diode` — Diode

- **Inspector props**: **ZERO.** `diode` declares no `props` array at all
  (`parts.ts:1175-1191`). Selecting it shows only the label, Rotate and Delete.
  There is **no way to change the diode type, the part number, or Is/n** from the
  UI; it is hard-wired to `DIODE_1N4148 = {is: 2.52e-9, n: 1.752}`
  (`devices.ts:525`; `compile.ts:614-620`).
- **Canvas**: drag/rotate/delete only.
- **Reported state**: **Measurements** (mA) **and device-state**.
  `describeDevice`: headline `"{volts} V forward|reverse|none"`, detail
  `"reverse biased — it blocks, which is either the point or the wrong way
  round"` or `"anode to cathode"`, or `"not in the circuit"`
  (`CircuitEditor.tsx:952-967`). State keys: `connected, volts, biased`
  (`analog-state.ts:228-242`). The word is deliberately about **direction**, not
  a threshold: *"A silicon junction is not 'on' at any particular threshold — it
  conducts exponentially"* (`analog-state.ts:236-239`).
- **Simulation**: full Shockley with SPICE `pnjlim` junction limiting. That
  limiting is load-bearing for **correctness**, not speed: the adversarial
  verifier found that removing it made Newton converge faster onto the wrong root
  — "3.2 V where the truth was 5.8 V" (`devices.ts:537-560`).
- **Safety**: `Diode.safety` with the **LED's** thresholds — 20 mA caution,
  30 mA destructive (`devices.ts:618-662`). A real 1N4148 is rated 200 mA
  continuous, so **the diode is over-protective by 6.7×** (see Known Gaps).
- **Pins**: **2** — `A` (Anode), `C` (Cathode).
- **Fidelity**: junction model exact; ratings wrong for the part it claims to be;
  no reverse breakdown, no Zener, no Schottky, no recovery time.

## 11. `buzzer` — Buzzer

- **Inspector props** (1):
  | key | label | rendered | default |
  |---|---|---|---|
  | `passive` | Passive (needs tone) | **checkbox** (0/1 range) | 0 (= active) |
- **Canvas**: drag/rotate/delete only. **No audio is synthesised anywhere**
  (`behavioural.ts:625`).
- **Reported state**: **Measurements** (mA) **and device-state**.
  `describeDevice`: when sounding, headline `"{hz} Hz"` — rounded to a whole
  number above 10 Hz, to 2 dp below, because *"a buzzer driven by digitalWrite in
  a 1 s blink is being driven at half a hertz, and rounding that to a whole
  number printed '0 Hz' over a part the model had just said was sounding"*
  — detail `"piezo element following the drive waveform"` or `"active buzzer —
  sounding at its own oscillator pitch"`. When silent, headline `silent`, detail
  `"steady {V} V across it — a piezo only sounds when that voltage changes
  (tone(), not digitalWrite())"` or `"{V} V across it — not enough to drive it"`
  (`CircuitEditor.tsx:683-705`). State keys: `sounding, hertz, passive, volts,
  driveHertz` (`behavioural.ts:689-696`).
- **Simulation**: a **real two-mode device**, not a resistor.
  - Active: a conductance of `ratedAmps/ratedVolts = 30 mA / 5 V = 167 Ω`, and it
    sounds at its own fixed 2300 Hz whenever |V| ≥ 4 V `minOperatingVolts`.
  - Passive: **1e-12 S** — an open, the same stamp a `Capacitor` uses at DC,
    because a piezo element is a ~10 nF capacitor (`devices.ts:685-782`).
  - `BuzzerMonitor` watches the solved terminal voltage with a
    0.3 Vcc / 0.6 Vcc deadband and measures the period between rising edges, so
    "the pitch reported is the pitch the student's own tone() call produced, not
    a number copied out of their sketch". A 100 ms silence timeout ages the
    reading out (`behavioural.ts:598-698`).
- **Limitations pushed**: one, only for a passive buzzer —
  > *"A passive buzzer is a piezo element — a capacitor — so no DC current flows
  > through it. The pitch it is being driven at is reported, but the current
  > reads zero because that is its true DC steady state."* (`compile.ts:363-369`)
- **Safety**: |V| > **7 V** (`maxVolts`) = **destructive** — *"X V across a
  buzzer rated for 5 V (absolute maximum 7 V). On real hardware this part is
  destroyed."* (`devices.ts:768-781`).
- **Pins**: **2** — `P` (+), `N` (−).
- **Fidelity**: **datasheet-derived** from a TMB12A05-class unit and a 12 mm
  piezo disc (`devices.ts:685-726`). Hand-drawn art on purpose, because the
  harvested wokwi buzzer "declares an 8×8 SVG but places its pins at (27,84) — it
  sizes itself with CSS outside the SVG" (`parts.ts:1123-1126`). **No sound
  output.**

## 12. `dc_motor` — DC motor

- **Inspector props** (1):
  | key | label | rendered | unit | default | min/max/step |
  |---|---|---|---|---|---|
  | `load` | Mechanical load | **range slider** with `%` readout | `%` | 0 | 0/100/**5** |
- **Canvas**: drag/rotate/delete only. **No animated rotor, no speed indicator on
  the artwork.**
- **Reported state**: **Measurements** (mA) **and device-state**.
  `describeDevice`: headline `"{rpm} rpm forward|reverse"`, or `stopped`, or
  `stalled`; detail `"{mA} mA · load {N}%"` plus `" · shaft not turning"` when
  stalled (`CircuitEditor.tsx:707-714`). State is computed in the **engine**, not
  by the device, so it can use the **time-averaged** current — a PWM motor sits
  at two DC operating points and a snapshot of either is a speed the shaft never
  runs at (`engine.ts:1089-1131`). Keys: `rpm, direction, amps, load, stalled`.
- **Simulation**: a real steady-state brushed-motor model from four datasheet
  numbers — `HOBBY_MOTOR_6V = {6 V, 6000 rpm, 70 mA no-load, 800 mA stall}`
  (`devices.ts:848-857`). `Ra = Vn/Is`, `Ke = (Vn − I0·Ra)/w0`,
  `G(L) = (I0 + L(Is−I0))/Vn`, `w = i(1/G − Ra)/Ke`. Three properties are called
  out as the reason this beats a fudge: a free-running motor is `Vn/I0 = 85.7 Ω`
  **not** `Ra = 7.5 Ω` (back-EMF, not copper, limits it — stamping Ra alone
  overstates current by an order of magnitude); speed is **linear** in current so
  PWM duty falls out free; and the element stays linear at every load so it
  cannot make Newton limit-cycle (`devices.ts:784-836`).
- **Limitations pushed**: one, unconditional —
  > *"The motor is solved at its steady state. Start-up inrush, rotor inertia and
  > the inductive spike when it is switched off all need transient simulation,
  > which the interactive engine does not run yet."* (`compile.ts:379-383`)
- **Safety**: two.
  - |V| > **9 V** (1.5 × 6 V nominal) = **destructive**, *"the winding insulation
    fails"*.
  - |I| > 0.4 A (half stall) **and** rpm < 600 (10 % of no-load) = **caution**,
    *"With no back-EMF to oppose it the winding heats fast"*
    (`devices.ts:930-967`).
- **Pins**: **2** — `1` (+), `2` (−).
- **Fidelity**: **honest limitations are in the source header**
  (`devices.ts:825-836`): the load is **proportional to applied voltage** (a fan
  or pump), so a **constant-torque load — a weight on a winch — is not
  modelled**; and it is steady state only. A constant-torque model "was written
  first and rejected" because Newton ping-pongs across its kink forever
  (`devices.ts:820-823`).

## 13. `dht11` — DHT11 sensor

- **Inspector props** (2):
  | key | label | rendered | unit | default | min/max/step |
  |---|---|---|---|---|---|
  | `temperature` | Temperature | **range slider** | `°C` | 24 | 0/50/1 |
  | `humidity` | Humidity | **range slider** | `%` | 45 | 20/90/1 |
- **Canvas**: drag/rotate/delete only.
- **Reported state**: device-state only (sensors are never in `meters`).
  `describeDevice`: headline `"{t} °C · {h}% RH"`, **no detail line**
  (`CircuitEditor.tsx:759-761`). Keys: `temperature, humidity`.
- **Simulation**: **full single-wire protocol on the CPU clock.** The model
  measures the host's start-low off the *solved net voltage* (VIL 1.5 V), then
  plays the datasheet sequence with `cpu.addClockEvent`: 80 µs low + 80 µs high
  ack, then 40 bits as 50 µs low + 27 µs (0) or 70 µs (1) high, five bytes with a
  computed checksum (`behavioural.ts:123-242`). **Open-drain only** — it never
  drives high, "Modelling it as a push-pull driver would fight the host instead of
  sharing the wire". A student whose start pulse is marginally short still gets an
  answer: the threshold is 15 ms against the datasheet's 18 ms, deliberately
  (`behavioural.ts:180-184`).
- **Limitations pushed**: **none**.
- **Safety**: **none** — `kind:'sensor'` creates no `Device` beyond a
  `NortonPort` (`compile.ts:564-584`). There is no supply-range check, no
  reverse-polarity check, and no over-voltage check on this part.
- **Pins**: **3** — `VCC` (power), `DATA` (digital), `GND` (**passive, not
  gnd**). Typing GND as `gnd` would silently ground the sensor for a student who
  never wired it, "turning 'you forgot the ground wire', the single commonest
  beginner mistake, into a circuit that works" (`parts.ts:1196-1203`).
- **Fidelity**: **protocol-exact, sensor-trivial.** Decimals are always 0 (which
  is what a real DHT11 sends). Unlike its neighbours it does **not** check its own
  supply rail — an unpowered DHT11 still answers. No 1 Hz sampling limit, no
  ±2 °C accuracy spread, no self-heating.

## 14. `capacitor` — Capacitor

- **Inspector props** (1):
  | key | label | rendered | unit | default | min/max | suggestions |
  |---|---|---|---|---|---|---|
  | `microfarads` | Capacitance | **number + unit dropdown** (`pF nF μF mF F`) | F | **1 µF** | 1e-9 … 1e6 µF | 1, 10, 47, 100, 220, 470 |

  Stored in **µF** (the `mul:1` entry), so typing `470` + `nF` must store `0.47`
  — "exactly the sort of factor-of-a-thousand error a fixed µF dropdown made
  impossible and a free field makes easy" (`parts.ts:332-347`, `1848-1858`).
  There is **no voltage rating, no polarity, no ESR** prop.
- **Canvas**: drag/rotate/delete only.
- **Reported state**: **Measurements** (mA) **and device-state**.
  `describeDevice`: headline `"{volts} V · charging|discharging|steady"`, detail
  `"{amps} into it · {size}"`, plus either `" · the current has stopped"` (when
  transient and settled) **or** `" · solved at its DC limit (an open), not
  integrated in time"` when the engine is not integrating — said out loud
  "because 'steady' over a capacitor has two very different causes"
  (`CircuitEditor.tsx:864-905`). Keys: `element, connected, transient, volts,
  amps, trend, value` (`analog-state.ts:132-184`). Current is formatted on a
  sliding prefix down to nA, because at 10τ a 1 kΩ/1 µF charge still passes
  227 nA and `0.000 mA` next to the word "charging" read as a contradiction
  (`CircuitEditor.tsx:651-668`).
- **Simulation**: **backward-Euler companion, genuinely integrated in time.**
  `Geq = C/h`, `Ieq = Geq·v_prev` (`devices.ts:332-422`). Both engines switch
  their run loop to transient stepping automatically when `Circuit.hasReactive`
  is set. State (`vPrev`) is **carried across recompiles**, so nudging the part
  two pixels does not dump its charge — "the same class of defect as the PIR
  whose hold timer was reset by the very prop change that started it"
  (`devices.ts:56-66`). A plain DC `solve()` still stamps it as a 1e12 Ω open.
- **Limitations pushed**: **none, and that is deliberate** — the old
  "charging and timing are not simulated" string was deleted because "it is no
  longer true, and leaving a stale warning up is its own kind of dishonesty"
  (`compile.ts:589-602`).
- **Safety**: **none.** `Capacitor` implements no `safety()` — there is no
  voltage rating and no way to blow one up.
- **Pins**: **2** — `1` (A), `2` (B).
- **Fidelity**: exact BE integration; **no polarity, no ESR/ESL, no leakage, no
  dielectric absorption, no voltage rating.** The 1 fF floor exists because a 0 F
  cap stamps `0/h` = a floating node = a singular matrix (`parts.ts:379-388`).

## 15. `inductor` — Inductor

- **Inspector props** (1):
  | key | label | rendered | unit | default | min/max | suggestions |
  |---|---|---|---|---|---|---|
  | `millihenries` | Inductance | **number + unit dropdown** (`nH μH mH H`) | H | **1 mH** | 1e-6 … 1e6 mH | 0.1, 1, 10, 100, 1000 |
- **Canvas**: drag/rotate/delete only.
- **Reported state**: **Measurements** and device-state. `describeDevice`:
  headline `"{amps} · rising|falling|steady"`, detail `"{volts} V across it ·
  {size}"` plus `" · settled — an inductor at DC is a wire"` or `" · solved at
  its DC limit (a wire), not integrated in time"` (`CircuitEditor.tsx:906-915`).
- **Simulation**: BE companion `Geq = h/L`, `Ieq = i_prev`
  (`devices.ts:424-513`). DC mode stamps a **0.01 Ω near-short**. The trend word
  is exact physics — `v = L·di/dt`, so it is the *voltage* that says whether the
  current is moving, not the current (`analog-state.ts:140-167`).
  `timeConstant()` is owned by the element because L/R is **reciprocal** in R and
  "an engine that guessed τ = R × value would size the timestep for an inductor
  by a factor of R² out" (`devices.ts:45-54`).
- **Limitations pushed**: none.
- **Safety**: **none.** No `safety()` — no current rating, no saturation.
- **Pins**: **2** — `1` (A), `2` (B).
- **Fidelity**: exact BE integration; **no winding resistance, no core
  saturation, no self-capacitance, no current rating.** The part exists because
  "the model already existed and the part did not" — `Inductor` and its compile
  branch had been shipping since transient landed, but nothing in `PALETTE` could
  produce one (`parts.ts:1868-1888`).

## 16. `hc_sr04` — HC-SR04 ultrasonic

- **Inspector props** (1):
  | key | label | rendered | unit | default | min/max/step |
  |---|---|---|---|---|---|
  | `distance` | Target distance | **range slider** | ` cm` | 50 | 1/420/1 |

  The range deliberately runs past the datasheet's 2–400 cm window so a student
  can drive it out of range (`parts.ts:1209-1222`).
- **Canvas**: drag/rotate/delete only. **No draggable "obstacle" on the canvas.**
- **Reported state**: device-state only. `describeDevice`:
  - unpowered → `no power` / *"VCC is not on a live rail — the module drives
    nothing"*
  - out of range → `"{cm} cm — out of range"` / *"outside the module's 2–400 cm
    window, so ECHO reports its 38 ms timeout"*
  - normal → `"{cm} cm"` / `"echo pulse {µs} µs"` (`CircuitEditor.tsx:716-729`).
  Keys: `distanceCm, echoMicros, inRange, powered` (`behavioural.ts:346-354`).
- **Simulation**: **both halves are real.** The TRIG pulse is *measured* off the
  solved net (threshold 2.5 V, minimum 8 µs against the datasheet's 10, same
  courtesy as the DHT11), and the ECHO is a **push-pull 5 V** output scheduled on
  the CPU clock, so `pulseIn()` measures a genuine pulse
  (`behavioural.ts:292-393`). Conversion is the datasheet's own `µs/58 = cm`
  rather than the physics figure, deliberately, "or a student sees a 1.4% error
  they cannot explain" (`behavioural.ts:257-266`). Idle ECHO is actively held
  **low**, not floated. Below `MIN_SUPPLY_VOLTS = 4.5 V` the module releases ECHO
  and drives nothing.
- **Limitations pushed**: **none**.
- **Safety**: **none** (`kind:'sensor'`).
- **Pins**: **4** — `VCC` (power), `TRIG` (digital), `ECHO` (digital), `GND`
  (**passive**) (`parts.ts:1224-1226`).
- **Fidelity**: **protocol-exact.** No beam angle, no target size/material, no
  temperature-dependent speed of sound, no multiple echoes, no minimum blanking
  distance beyond the 2 cm window. `BURST_MICROS: 460` is explicitly *not* a
  datasheet number: "the datasheet does not name the turnaround; ~460 µs is what
  the module measures on a scope" (`behavioural.ts:274-285`).

## 17. `pir_motion` — PIR motion sensor

- **Inspector props** (3):
  | key | label | rendered | unit | default | min/max/step |
  |---|---|---|---|---|---|
  | `motion` | Motion in front | **checkbox** (0/1) | — | 0 | 0/1/1 |
  | `hold` | Hold time (Tx) | **range slider** | ` s` | 5 | 1/30/1 |
  | `warmup` | Warm-up | **range slider** | ` s` | **0** | 0/60/5 |
- **Canvas**: drag/rotate/delete only.
- **Reported state**: device-state only. `describeDevice`:
  `no power` / `warming up` (+ `"{n} s left before it will trigger"`) / `motion`
  (+ *"output high · holds for {n} s after motion stops"*) / `no motion`
  (+ `"output low"`) (`CircuitEditor.tsx:731-749`). Keys: `motion, warming,
  warmupRemaining, holdSeconds, powered` (`behavioural.ts:491-497`).
- **Simulation**: HC-SR501, **retriggerable (H jumper, the factory position)**.
  OUT is **3.3 V push-pull even on a 5 V rail** — "a real trap the model keeps —
  it is above the ATmega's 3.0 V VIH, but only just" (`behavioural.ts:397-436`).
  The 2.5 s fixed block time Ti after OUT falls is modelled, "which is why a real
  PIR alarm cannot chatter". Because nothing the sketch does moves the motion
  slider, the device **self-ticks on the CPU clock every 1 ms simulated**
  (`behavioural.ts:414-421`). The hold window **survives a prop edit** — that was
  a real defect once, quoted in the UI comment (`CircuitEditor.tsx:741-745`).
- **Limitations pushed**: **none** — but the warm-up default is a documented
  deviation: *"Simulating that by default would mean a student stares at a dead
  circuit for a minute before anything can happen, so the `warmup` prop DEFAULTS
  TO 0 (disabled) … during warm-up this model holds OUT low, where a real module
  emits spurious highs."* (`behavioural.ts:432-437`).
- **Safety**: **none** (`kind:'sensor'`).
- **Pins**: **3** — `VCC` (power), `OUT` (digital), `GND` (**passive**).
- **Fidelity**: good behavioural model of the module's logic. **No detection
  zone, no distance, no sensitivity pot, no non-retriggerable (L) jumper
  option**, and no spurious warm-up output.

## 18. `flow_sensor` — YF-S201 flow sensor

- **Inspector props** (1):
  | key | label | rendered | unit | default | min/max/step |
  |---|---|---|---|---|---|
  | `flow` | Water flow | **range slider** | ` L/min` | 10 | 0/30/1 |

  0 is reachable on purpose — "'tap closed', which has to be reachable or the
  sensor could never be seen to stop pulsing" (`parts.ts:1263-1274`).
- **Canvas**: drag/rotate/delete only.
- **Reported state**: device-state. `describeDevice`: headline `no flow` or
  `"{L/min} L/min"`; detail `"{Hz} Hz · {n} pulses · {L} L total"` plus
  `" · outside the 1–30 L/min working range"` (`CircuitEditor.tsx:751-757`).
  Keys: `litresPerMinute, hertz, pulses, litres, inRange`
  (`behavioural.ts:581-590`).
- **Simulation**: `F = 7.5 × Q` — the sensor's whole transfer function — with a
  50 % duty pulse train generated on the CPU clock, so an interrupt-driven sketch
  counting FALLING edges counts **real edges**: "the pulse count and the
  frequency are the same object, not two numbers that could drift apart"
  (`behavioural.ts:518-595`). **Open-collector**: it only ever pulls DOWN, which
  is why the wiring needs a pull-up or `INPUT_PULLUP`. Self-clocked at 1 ms when
  idle so a slider change is noticed. Needs ≥4.5 V on VCC.
- **Limitations pushed**: **none**.
- **Safety**: **none** (`kind:'sensor'`).
- **Pins**: **3** — `VCC` (power), `SIG` (digital), `GND` (**passive**).
- **Fidelity**: exact against the datasheet transfer function. **No turbine
  inertia** (flow changes are instantaneous), no non-linearity at low flow, no
  pulse jitter. Hand-drawn — wokwi has no flow-sensor element (`parts.ts:1247-1250`).

## 19. `ds18b20` — DS18B20 temperature

- **Inspector props** (2):
  | key | label | rendered | unit | default | min/max/step or options |
  |---|---|---|---|---|---|
  | `temperature` | Probe temperature | **range slider** | `°C` | 25 | −55/125/1 |
  | `resolution` | Resolution | **`<select>` of numbers** | ` bit` | 12 | 9, 10, 11, 12 |

  The `select` renders each option as `` `${o} ${prop.unit}` `` and the unit
  already carries a leading space, so the labels read `9  bit` with a double
  space (`CircuitEditor.tsx:636-641`; `parts.ts:1362`) — cosmetic.
- **Canvas**: drag/rotate/delete only.
- **Reported state**: device-state. `describeDevice`:
  - `no power` / *"VDD is not on a 3.0–5.5 V rail — the sensor cannot answer"*
  - `bus held low` / *"nothing is pulling DQ up — a DS18B20 is open-drain and
    needs the 4.7 kΩ to 3.3 V"*
  - normal → `"{c} °C"` to **4 dp** / `"{n}-bit · ROM {hex}"` + `" · converting…"`
    (`CircuitEditor.tsx:763-781`). Keys: `celsius, raw, rawHex, resolution,
    converting, powered, busIdleHigh, rom, configFromProps`
    (`behavioural.ts:1397-1409`).
- **Simulation**: **the most complete protocol model in the library.**
  Reset + presence, READ ROM, MATCH ROM, SKIP ROM, SEARCH ROM, ALARM SEARCH,
  CONVERT T (with real tCONV and busy polling), READ/WRITE/COPY SCRATCHPAD,
  RECALL E2, READ POWER SUPPLY, over a 9-byte scratchpad with a **computed
  Dallas CRC-8** (`behavioural.ts:895-1411`). Multi-drop works "for the right
  reason": each device drives its own Norton port and the solver's node voltage
  **is** the wired-AND, so a SEARCH ROM collision is real. Deterministic per-part
  ROM code derived from the document id. The **85 °C power-on register** is
  seeded so a driver that reads without waiting meets the classic bug
  (`behavioural.ts:763-771`). The `resolution` slider owns the config register
  **only until the student's program writes its own** (`behavioural.ts:1355-1368`).
- **Limitations pushed**: **none through `compile()`** — but three are documented
  in the class header (`behavioural.ts:923-934`):
  > *"PARASITE POWER IS NOT MODELLED… wiring VDD to ground and stealing power
  > from the bus … reports as unpowered."*
  > *"The EEPROM is not persistent: COPY SCRATCHPAD takes its 10 ms and RECALL E2
  > returns immediately, but nothing survives a rebuild of the part."*
  > *"Self-heating, conversion noise and the ±0.5 °C accuracy spec are not
  > modelled; the sensor reports exactly the temperature the slider asks for,
  > quantised to the configured resolution."*
  **None of these three reach the Checks panel** — they are comments only.
- **Safety**: **none.** `kind:'sensor'` builds no `Device`, so there is no
  `safety()` at all (`compile.ts:564-584`). Confirmed still true.
- **Pins**: **3** — `GND` (**passive**), `DQ` (digital), `VDD` (power), in
  datasheet order 1-2-3 read off the flat face. *"Reversing GND and VDD is the
  classic way to cook one of these, and a part drawn the wrong way round would
  teach the mistake rather than catch it"* (`parts.ts:1316-1331`). The 4.7 kΩ
  pull-up is a **separate part on purpose**.
- **Fidelity**: **protocol-exact**, sensing trivial.

## 20. `l298n` — L298N motor driver

- **Inspector props**: **ZERO.** `makeL298N()` declares no `props`
  (`parts.ts:1463-1519`). No supply-voltage prop, no channel enable, no current
  limit. Everything is set by wiring.
- **Canvas**: drag/rotate/delete only. **No LEDs or indicators on the artwork.**
- **Reported state**: **NONE.** `h_bridge` is not in `REPORTS_STATE`
  (`CircuitEditor.tsx:1004-1015`), there is no behavioural monitor for it
  (`engine.ts:1185-1214` has no `h_bridge` case), and `compile()` never adds it
  to `meters` (`compile.ts:407-444`). The student can see its effect only through
  the motor it drives. **`HBridgeChannel.mode` (`coast/forward/reverse/brake`),
  `logicOk` and `supplyOk` are all computed and never surfaced**
  (`devices.ts:1329-1336`).
- **Simulation**: real switched-linear dual full bridge, both legs stamped
  independently as Thevenin sources in Norton form, so forward/reverse/brake/coast
  fall out of two legs rather than a four-way case analysis
  (`devices.ts:1301-1496`). Unwired logic inputs are handed the chip's own ground
  net rather than a fresh node — same answer, six unknowns saved
  (`compile.ts:410-421`). **The 2.5 V drop is the lesson and it is kept**:
  `VCEsat(H) 1.35 V + VCEsat(L) 1.2 V` at 1 A. Vss outside 4.5–7 V kills the
  logic; Vs below `VIH + 2.5 V = 4.8 V` kills the output stage.
- **Limitations pushed**: one —
  > *"The motor driver is solved at a DC operating point. Its ~2.5 V transistor
  > drop is modelled, but switching a motor off produces no inductive kick, so
  > the flyback diodes never conduct and the bridge is never seen doing the job
  > it is there for. That needs transient simulation, which the interactive
  > engine does not run yet."* (`compile.ts:439-444`)
- **Safety**: three thresholds (`devices.ts:1455-1495`):
  - `Vss > 7 V` = **destructive** — *"The motor supply goes on Vs, not on Vss —
    on real hardware this destroys the chip."*
  - `|I| > 2 A` = **caution** (continuous rating).
  - `|I| > 3 A` = **destructive** (absolute peak).
- **Pins**: **13** — `OUT1, OUT2, OUT3, OUT4, VS (+12V), GND (passive), VSS
  (+5V), ENA, IN1, IN2, IN3, IN4, ENB`. Named for the datasheet role rather than
  the silkscreen because "that is the distinction that matters and the silkscreen
  actively obscures it" (`parts.ts:1443-1461`).
- **Fidelity**: **one number is admitted as non-datasheet.** `onOhms = 0.15 Ω`
  per transistor is a judgement, because the datasheet characterises saturation
  at a single current and one point cannot separate an offset from a resistance;
  the consequence is bounded and checked — total drop runs 2.55 V (no load) to
  3.15 V (2 A) inside the datasheet's own 1.80–3.2 V window
  (`devices.ts:1276-1284`).

## 21. `uln2003` — ULN2003 Darlington array

- **Inspector props**: **ZERO** (`parts.ts:1402-1441`).
- **Canvas**: drag/rotate/delete only.
- **Reported state**: **NONE.** `darlington_array` is not in `REPORTS_STATE`,
  has no behavioural monitor, and is never added to `meters`
  (`compile.ts:384-406`). `DarlingtonSink.on`, `.current` and `.inputCurrent` are
  all computed and **never shown to the student** (`devices.ts:1078-1085`).
- **Simulation**: seven independent open-collector channels plus the on-die
  flyback diodes to COM. **"Or is not there at all" is the load-bearing half**:
  an off Darlington stamps *nothing* on the output — "Stamping a large resistance
  instead would quietly drain a motor coil's pull-up" (`devices.ts:1059-1072`).
  The input resistor and the sink both return to the chip's **own GND pin**, so
  an unwired ground gives a chip that does nothing. A channel whose input is
  unwired is never instantiated, so seven unused channels cost nothing.
  Hysteresis across the datasheet's own undefined band (VIL 1.4 V / VIH 2.4 V).
- **Limitations pushed**: **none.** The DC-inertness of the flyback diodes is
  documented in the source but **does not reach the Checks panel**
  (`devices.ts:1190-1203`).
- **Safety**: two thresholds (`devices.ts:1161-1187`):
  - `I > 350 mA` (`ratedAmps`, the highest characterised) = **caution** —
    *"It conducts, but hot — the package cannot carry this on every channel at
    once."*
  - `I > 500 mA` (`maxAmps`) = **destructive**.
- **Pins**: **16** — `IN1…IN7` down the left, `GND` (**passive**, pin 8), `COM`
  (power, pin 9), `OUT1…OUT7` up the right. Real DIP walk order, "which is why
  OUT1 sits opposite IN1 rather than beside it" (`parts.ts:1383-1399`).
- **Fidelity**: **every number is from TI SLRS027**, and the derivation is
  self-checked against a third datasheet point the fit did not use: R_on = 2 Ω,
  offset = 0.7 V, predicting 1.40 V at 350 mA against the datasheet's 1.3 V typ —
  "0.1 V high at 1.75× the highest fitted current" (`devices.ts:1022-1057`). The
  1.4 V floor is physical (two Vbe), not a datasheet line, and says so.

## 22. `stepper_28byj48` — 28BYJ-48 stepper

- **Inspector props**: **ZERO** (`parts.ts:1538-1580`). No speed, no
  microstepping, no load prop.
- **Canvas**: drag/rotate/delete only. **The shaft does not visually rotate** —
  the reported angle is text in the rail.
- **Reported state**: **Measurements** (total current out of COM) **and**
  device-state. `describeDevice`: headline `"{shaftDegrees}°"` or `coils off`;
  detail `"{n} half-steps · {r} rev · {rpm} rpm · coils {pattern}"` plus
  `" · N refused patterns"` when the sequence was wrong
  (`CircuitEditor.tsx:851-862`). Keys: `pattern, phaseIndex, halfSteps,
  fullSteps, degrees, shaftDegrees, revolutions, halfStepsPerRevolution, rpm,
  energisedPhases, holding, sequenceErrors` (`behavioural.ts:1520-1543`).
- **Simulation**: electrically four 50 Ω windings from the common tap
  (`devices.ts:1715-1797`). Position comes from `StepperMonitor` watching the
  four **solved** coil voltages with a 25 %-of-rated energised threshold
  (`behavioural.ts:1426-1544`). `StepTracker` is **deliberately strict**: a
  pattern off the 8-state ring (e.g. `0b1010`, two coils in opposition) or a jump
  of ≥3 positions **does not move the counter** and increments `sequenceErrors` —
  *"A real motor pulled through a three-position jump may or may not follow
  depending on speed and load, and a simulator that guessed would be reporting a
  position the bench would not reproduce"* (`devices.ts:1639-1705`). 4096
  half-steps/rev is **derived**, not hard-coded.
- **Limitations pushed**: one —
  > *"The stepper is solved at a DC operating point: the angle reported is the
  > one the coil sequence commands. Winding inductance is not modelled, so there
  > is no coil rise time, no torque falling away as the step rate climbs, and no
  > inductive kick when a phase switches off — a real 28BYJ-48 starts losing steps
  > long before this model would."* (`compile.ts:470-476`)
- **Safety**: `UnipolarStepper.safety` on the **worst** phase voltage
  (`devices.ts:1769-1796`):
  - `> 5 V` (rated) = **caution**, quoting the per-phase dissipation.
  - `> 7.5 V` (`maxVolts`) = **destructive** — *"the insulation fails."*
    `maxVolts` is flagged as a judgement call: *"the datasheet gives no absolute
    maximum"* (`devices.ts:1595-1597`).
- **Pins**: **5** — `COM (red)`, `A (orange)`, `B (yellow)`, `C (pink)`,
  `D (blue)`. Names carry the lead colours "because on a real motor that is all
  the student can see".
- **Fidelity**: three honest limitations in the source
  (`devices.ts:1580-1594`): the gear train is the datasheet's round **64:1** not
  the true **63.68395:1**, so "a student's `step(4096) = one turn` arithmetic
  works out exactly here and would be half a degree out on the bench"; windings
  are **DC resistance only** (the ~300 mH is what really limits step rate); and
  **torque, holding torque and losing steps under load are not modelled.**
  Hand-drawn because the harvested wokwi `stepper-motor` is a four-wire
  **bipolar** part with no common tap (`parts.ts:1521-1536`).

## 23. `relay_4ch` — 4-channel relay module

- **Inspector props** (1):
  | key | label | rendered | default |
  |---|---|---|---|
  | `activeLow` | Active-low trigger | **checkbox** (0/1) | **1** (active low, the common board) |

  (`parts.ts:1668-1680`). No coil-voltage prop, no per-channel override.
- **Canvas**: drag/rotate/delete only. The four channel LEDs on the artwork are
  **static** — they do not light when a channel energises (`parts.ts:1651-1659`).
- **Reported state**: device-state only (never in `meters`). `describeDevice`:
  - `no power` / *"VCC is not on a live rail — the coils cannot be energised"*
  - **`coils under-volted`** / *"{V} V is below the 3.75 V an SRD-05VDC coil is
    guaranteed to pull in at — the opto switches but the contact does not. Feed
    VCC from 5 V."*
  - normal → `all released` or `"{n} of 4 energised"` / `"{pattern} · {V} V
    supply · active-low|active-high · contacts NC NC NC NC · {mA} mA in the
    coils"` (`CircuitEditor.tsx:822-849`). Keys: `pattern, contacts, energised,
    channels, supplyVolts, coilAmps, powered, activeLow, underVolted`
    (`behavioural.ts:1621-1634`). `pattern` uses `-` for a channel the compiler
    never built, so "an unbuilt channel reads as absent rather than as permanently
    on".
- **Simulation**: per channel a **solved** PC817 opto LED + 1 kΩ, an SRD-05VDC
  coil with its flyback diode, and an SPDT contact stamped in **both** states
  (0.1 Ω / 1e12 Ω) so the sparsity pattern never changes when a relay clicks
  (`devices.ts:1929-2108`, `2130-2213`). The two trigger polarities are genuinely
  **different circuits**, not a sign flip (`devices.ts:2155-2169`). A channel is
  built only when something is topologically attached to *any* of its four pins —
  **including the contact terminals**, because "a de-energised relay has COM
  sitting on NC, so a load wired through COM/NC is POWERED with no input signal
  at all" (`compile.ts:477-538`). The monitor reads the **internal coil node**,
  not the IN pin, so it "cannot drift from RelayChannel, because it IS
  RelayChannel's answer" (`behavioural.ts:1548-1566`).
- **Limitations pushed**: one, only when at least one channel was built —
  > *"The relay is solved at a DC operating point: the contact is where the coil
  > current says it should be. Coil inductance is not modelled, so there is no
  > 5–10 ms pull-in delay, no contact bounce, and the flyback diode is never seen
  > absorbing the inductive kick it is there for — all of which need transient
  > simulation."* (`compile.ts:549-554`)
- **Safety**: three (`devices.ts:2066-2107`), plus the coil resistor's own:
  - `VCC > 5.5 V` = **destructive**, *"the coil cooks."*
  - opto LED `> 50 mA` = **destructive**, *"the isolator is destroyed."*
  - contact `> 10 A` = **destructive**, *"the contacts weld shut."*
  - The coil `Resistor`'s `rating` is **overridden** to `5.5²/70 = 0.43 W`
    because the stock 0.25 W default "would trip … and report a burnt-out part on
    a correctly built circuit" (`devices.ts:2178-2190`).
- **Pins**: **18** — `NO1/COM1/NC1 … NO4/COM4/NC4` on the screw blocks, then
  `VCC, IN1, IN2, IN3, IN4, GND` (**passive**) on the header. NO/COM/NC order is
  the board's own silkscreen, and getting it right "matters more here than on
  most parts" (`parts.ts:1582-1605`).
- **Fidelity**: **datasheet-derived with two numbers marked as judgement**
  (`devices.ts:1859-1878`): `optoOnAmps/optoOffAmps` (2.0 mA / 1.0 mA), because
  "no datasheet prints this, because it depends on a transistor the relay board
  chose" — but the value is *bounded* by the 3.9 mA the 1 kΩ actually delivers
  and by the 5 mA below which PC817 CTR is unspecified; and `driverOhms = 0.5 Ω`.
  `OPTO_LED` is a separate `DiodeParams` from `LED_RED` because a PC817's IR die
  drops 1.2 V not 1.88 V — "a 20 % error in the input current — i.e. in the exact
  number that decides whether the channel switches at all" (`devices.ts:1801-1821`).

## 24. `pulse_sensor` — Pulse sensor (SEN-11574)

- **Inspector props** (2):
  | key | label | rendered | unit | default | min/max/step |
  |---|---|---|---|---|---|
  | `bpm` | Heart rate | **range slider** | ` BPM` | 72 | 30/200/1 |
  | `amplitude` | Signal strength | **range slider** | `%` | 8 | 0/20/1 |
- **Canvas**: drag/rotate/delete only. **No waveform drawn on the canvas or
  anywhere in the UI** — there is no scope view.
- **Reported state**: device-state only. `describeDevice`:
  `no power` / *"VCC is not on a 3–5 V rail — the amplifier is dead"*, else
  headline `"{bpm} BPM"`, detail `"{V} V on the wire · {n} beats · **synthesised
  waveform, not a real PPG**"` — said out loud on every reading, "not buried in a
  docstring" (`CircuitEditor.tsx:783-796`). Keys: `powered, bpm, driveVolts,
  signalVolts, beats, synthesised` (`behavioural.ts:1814-1824`).
- **Simulation**: a **signal generator**, and it is labelled as one. A raised
  cosine (Hann) systolic bump over a Vs/2 baseline, 22 % of the beat interval,
  amplitude as a fraction of the **supply** so the same sensor behaves the same
  on 3.3 V and 5 V. Driven through a Norton port at 2 mV quantisation (below one
  LSB of a 10-bit converter on 3.3 V, and it bounds the memoisation key space)
  (`behavioural.ts:1638-1826`). Everything downstream is real: the wire is
  loaded, an ADC reads a genuine node voltage, and a peak detector must find its
  own peaks. Self-ticks every 2 ms simulated.
- **Limitations pushed**: **none through `compile()`**, but the class header is
  blunt:
  > *"THE WAVEFORM IS SYNTHESISED, NOT SIMULATED. There is no optical model here:
  > no LED, no tissue, no photodiode, no ambient-light rejection and no motion
  > artefact … It is a signal GENERATOR standing in for a transducer, and it is
  > labelled as one so nobody reads a heart rate out of this and believes a body
  > produced it."*
  > *"A real PPG also carries a dicrotic notch after the systolic peak — a second,
  > smaller bump — which this does not synthesise, so a naive detector will not
  > meet the double-counting problem it would meet on a bench."* (`behavioural.ts:1692-1710`)
  The `SYSTOLIC_FRACTION 0.22` being held constant as rate changes is also
  recorded as a simplification (`behavioural.ts:1668-1675`).
- **Safety**: **none** (`kind:'sensor'`).
- **Pins**: **3** — `VCC (red)`, `SIG (purple)` (**analog**), `GND (black)`
  (**passive**). Names carry the lead colours.
- **Fidelity**: **explicitly a stand-in.** The only device in the library whose
  own reported state carries a `synthesised: true` flag.

## 25. `mcp3008` — MCP3008 SPI ADC

- **Inspector props**: **ZERO** (`parts.ts:1768-1824`). No reference-voltage
  prop, no channel selector, no sample-rate prop — everything comes off the bus.
- **Canvas**: drag/rotate/delete only.
- **Reported state**: device-state only. `describeDevice`:
  - `no power` / *"VDD is not on a 2.7–5.5 V rail"*
  - **`no reference`** / *"VREF is not on a rail — every conversion reads 0
    without one"*
  - `idle` / *"VREF {V} V · nothing has clocked the bus yet"*
  - normal → `"CH{n} = {code}"` / `"{V} V of {vref} V VREF · single-ended ·
    {n} conversions"` (`CircuitEditor.tsx:798-819`). Keys: `powered, code, volts,
    channel, mode, vref, conversions` (`behavioural.ts:2116-2126`).
- **Simulation**: **the real bus, not a reading.** CS framing, START bit,
  SGL/DIFF + D2 D1 D0 config word, the sample instant, NULL bit, 10 data bits
  MSB-first, then the datasheet's LSB-first repeat. Mode 0,0 — DIN sampled on
  CLK rising, DOUT changes on falling. **DOUT is genuinely high-impedance until
  the null bit and again the moment CS rises, so two devices can share the bus**
  (`behavioural.ts:1907-2128`). Pseudo-differential pairing is implemented. The
  sample-and-hold closes at a specific clock, "which is what a real
  sample-and-hold does and is why a peak can be missed rather than smeared"
  (`behavioural.ts:2048-2064`). `mcp3008Code` **rounds, not truncates**, because
  equation 4-2 describes code *centres*: floor() would make a mid-rail input read
  511 instead of 512, "the one number every Pulse Sensor sketch is written
  around" (`behavioural.ts:1880-1905`).
- **Limitations pushed**: **none through `compile()`**; three in the class header
  (`behavioural.ts:1932-1941`):
  > *"There is no conversion-rate limit. A real MCP3008 manages 200 ksps at 5 V
  > and 75 ksps at 2.7 V, and clocking it faster than that returns garbage; this
  > model converts at whatever rate the master asks for."*
  > *"The 100 nA leakage, the input sample capacitor's 1 kΩ switch resistance and
  > therefore the source-impedance limit on the analog input are not modelled: the
  > converter reads the solved node voltage without loading it."*
  > *"Offset, gain and INL/DNL error are all zero."*
- **Safety**: **none** (`kind:'sensor'`).
- **Pins**: **16** — `CH0…CH7` (analog) down the left; `DGND` (passive, pin 9),
  `CS/SHDN, DIN, DOUT, CLK` (digital), `AGND` (passive), `VREF, VDD` (power) up
  the right. **AGND and DGND are kept separate**, as on the real part; tying them
  is left to the student, "the same choice every other part makes about ground"
  (`parts.ts:1754-1766`).
- **Fidelity**: **protocol-exact, analog front end idealised.**

---

# Known gaps we already know about

Verified against current source. Items the brief asked about are marked ✔ / ✘.

### ✘ "Buzzer and motor were once plain resistors" — **no longer true**
Both now have real device models: `Buzzer` with two electrically different modes
(`devices.ts:728-782`) and `DCMotor` with a four-datasheet-number steady-state
model (`devices.ts:859-968`). The vestigial `{kind:'load'; ohms; label}` variant
still exists in the union (`parts.ts:78`) and still has a live branch in
`compile()` (`compile.ts:337-344`), but **no part in `PART_LIBRARY` uses it** —
it is dead code that looks like a supported feature.

### ✔ Transient limitations on the H-bridge, stepper, relay and motor — **still true and still reported**
Four `limitations` strings reach the Checks panel and are badged **not
simulated**: motor (`compile.ts:379-383`), L298N (`439-444`), stepper
(`470-476`), relay (`549-554`), plus the passive buzzer (`363-369`). All say the
same underlying thing: the interactive engine solves these at a DC operating
point, so there is **no inductive kick and no flyback-diode conduction anywhere**
— even though the flyback diodes are genuinely stamped in both the ULN2003
(`devices.ts:1190-1203`) and the relay board (`devices.ts:2119-2124`) and sit
permanently reverse-biased.

### ✔ DS18B20 has no `safety()` — **still true, and it generalises to all seven sensors**
`kind:'sensor'` creates only a `NortonPort` per driven pin and no `Device`
(`compile.ts:564-584`). So **none** of `dht11, ds18b20, hc_sr04, pir_motion,
flow_sensor, pulse_sensor, mcp3008` can report a destructive fault. A student can
wire 12 V to a DHT11's VCC, or reverse a DS18B20's GND and VDD — the mistake the
part's own comment calls "the classic way to cook one of these"
(`parts.ts:1319-1322`) — and the Checks panel stays green. The models refuse to
*answer* out of their supply window, which is honest, but nothing says the part
is destroyed.

### ✔ The diode inspector has zero controls — **still true**
`diode` declares no `props` (`parts.ts:1175-1191`). It is permanently a 1N4148,
and — worse — it inherits `Diode.safety`'s **LED** ratings of 20 mA caution /
30 mA destructive (`devices.ts:618-627`), where a real 1N4148 is rated 200 mA
continuous. A correctly-built 1N4148 clamp circuit will therefore be reported as
a **destroyed part** at 1/6 of its real rating. The `l298n`, `uln2003`,
`stepper_28byj48` and `mcp3008` inspectors are likewise completely empty.

### ✔ `n` is held constant across LED colours — **still true**
`LED_N = 1.8` for all six (`parts.ts:772`, `831-838`). The comment states the
cost plainly: only the datasheet Vf at 20 mA is reproduced exactly; "the slope
either side of it is then the same shape as red's — which is the honest limit of
this model and is stated in the UI."

### The potentiometer never appears in Measurements
The pot branch stamps two `Resistor`s but calls no `meters.set`
(`compile.ts:300-324`), so the only part of the library whose whole purpose is
producing a voltage has no current row. Its device-state row does report wiper
voltage and both leg resistances.

### The two driver ICs report nothing at all
`l298n` and `uln2003` are absent from `REPORTS_STATE`
(`CircuitEditor.tsx:1004-1015`), have no behavioural monitor
(`engine.ts:1185-1214`), and are never in `meters`. `HBridgeChannel.mode`
(`coast/forward/reverse/brake`), `.logicOk`, `.supplyOk` and every
`DarlingtonSink.on` are computed on every solve and thrown away. A student cannot
see *why* their motor is not turning without inferring it from the motor's own
row.

### Sensor Norton ports inherit ATmega pin ratings
A behavioural sensor's driven pin is a `NortonPort` (`compile.ts:579`), whose
`safety()` is written for an MCU I/O pad — 20 mA / 40 mA, with the message
*"…mA through a pin rated for 40 mA. On real hardware this pin is destroyed."*
(`devices.ts:264-320`). Driving an HC-SR04's ECHO into a heavy load can therefore
produce a destructive fault worded as an MCU-pin failure, attributed to a device
id like `hcs_4.echo`.

### The relay board's channel LEDs are static artwork
Four `<circle fill="#7f1d1d">` indicators are drawn per channel and are never
driven from the solve (`parts.ts:1651-1659`), even though `RelayMonitor` knows
exactly which channels are energised.

### No editor primitives Tinkercad has
No **copy/paste/duplicate**, no **multi-select**, no **keyboard delete**, no
**undo keyboard shortcut**, no **wire colour picker**, no **part name/label
field**, no **rotation by keyboard**, and no **"reset the circuit to its
starter"** button (only the code has one). Confirmed by the exhaustive
`DocAction` union (`document.ts:194-237`) and the absence of any clipboard or
`Delete`-key handler in either simulator component.

### No instruments
There is no multimeter, oscilloscope, function generator or bench power supply in
the palette (`parts.ts:1954-1989`). Node voltages are visible **only** through a
part's own device-state row, so an arbitrary point in a circuit cannot be probed.

### Two-board documents cannot run
`detectBoard` returns null for both zero and two boards, deliberately, "because
two CPUs with two independent clocks cannot be co-simulated by one engine". The
code panel is withdrawn and the Checks panel says which case it is
(`CircuitEditor.tsx:1308-1327`).

### Cosmetic: `select` labels double-space their unit
`PropControl`'s numeric-`select` branch renders `` `${o} ${prop.unit}` ``
(`CircuitEditor.tsx:640`) and `ds18b20.resolution` declares `unit: ' bit'` with a
leading space (`parts.ts:1362`), giving `9  bit`. Only `ds18b20.resolution` uses
this branch today.

### Self-check that already exists and is worth keeping
`propDeclarationProblems()` (`parts.ts:2242-2407`) runs at module load and
`console.error`s any prop that cannot be rendered honestly — missing `default`, a
`select`/`choice` default outside its own options (which renders a **blank**
`<select>`), a `number` with no `mul: 1` unit or no bounds, or a knob/slider/
momentary pointing at a prop that does not exist or is the wrong shape. It is
clean for all 25 parts as of this reading. This is the guard that would catch the
declared-but-not-rendered class of bug the brief warns about; there is **no
equivalent guard for declared-but-not-reaching-the-solver**, which is the half
that actually bit twice.
