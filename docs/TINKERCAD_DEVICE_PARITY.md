# What a student can DO with every component in Tinkercad Circuits

Observed catalogue, produced for a device-by-device diff against
`docs/OUR_DEVICE_CAPABILITIES.md` (same shape, same seven fields per device).

Date: 2026-07-25. Signed in as the design owner. Two sources, both first-hand:

1. **Shipped data** — the Circuits bundle and the component/device JSON it
   fetches, read out of the running editor. This is the schema *as shipped*:
   exact property names, units, defaults, prefixes and terminal lists.
2. **Hands-on** — components placed on a canvas, selected, inspected,
   simulated and manipulated.

Every line is tagged **[observed]** (I saw it happen or read it out of shipped
data) or **[inferred]** (deduced from a rule verified elsewhere). Where I could
not reach something it says so rather than guessing.

**Nothing was placed in or removed from the owner's design.** All hands-on work
was done in a new blank circuit created from the dashboard,
`Ingenious Inari-Uusam` / `ksY1aiNeJhN`. The owner's `Brave Inari-Kieran`
(`hfX3NiARk0m`) was verified afterwards to still hold its 5 component instances
(Uno, breadboard, LED, resistor + wires) **[observed]**.

---

## How this was obtained (so it can be redone)

**[observed]** The Circuits editor is a *different app* from the 3D editor. On
`/things/<id>/editel` the scripts are:

- `https://editor.tinkercad.com/assets_cc_3g62bj1/js/vendor-compiled.js`
- `https://editor.tinkercad.com/assets_cc_3g62bj1/js/circuits-compiled.js` — 3,272,501 bytes

The `assets_cc_*` path is the Circuits app; `assets_v2_*/js/appBundle.js` is the
3D editor. That is why the previous attempt could not find a Circuits bundle: it
is referenced only from the login-gated `editel` HTML.

The parts catalogue is **not** in the bundle. It is fetched as JSON:

| URL | Content |
|---|---|
| `…/js/components/collections/basic-components.json` | **[observed]** 179 entries — 26 Basic parts, header `Other Components`, 84 more parts, header `Starters`, 67 starters |
| `…/js/components/collections/all-components.json` | **[observed]** 189 entries — the same parts under 11 section headers |
| `…/js/packaged_devices/<footprintId>.json` | **[observed]** per-device record: `device.base`, `device.simulation_model`, `device.programmable`, `device.properties_attributes` (**the inspector schema**), and the terminal list |

All 110 non-starter components were fetched, **0 failures** **[observed]**.

### `all-components.json` section headers — the "All Components" taxonomy

**[observed]** `General, Input, Output, Power, Breadboards, Microcontrollers,
Instruments, Integrated Circuits, Power Control, Connectors, Logic`.

---

## The `inspectorInputType` question — settled

**[observed]** Read live from the running Circuits editor as
`window.Circuits.inspectorInputType`:

| Key | Value |
|---|---|
| `TEXT` | 0 |
| `READ_ONLY` | 1 |
| `VALUE_AND_UNIT` | 2 |
| `VALUE_UNIT_CHECK` | 3 |
| `VALUE_AND_FIXEDUNIT` | 4 |
| `CHECKBOX` | 5 |
| `SELECTBOX` | 6 |
| `BUTTON` | 7 |

**Eight members. There is no `slider`.** The 17-member enum containing `slider`
that an earlier pass found in `appBundle.js` belongs to the **3D design editor**
and is a genuinely different enum. The two are unrelated; the earlier caveat was
correct to doubt it.

The consequence is architectural and is the single biggest shape difference
between the two products: **Tinkercad has no slider in its inspector at all.**
Every continuous quantity a student varies during simulation — light level,
temperature, distance, knob position — is a control **drawn on the canvas
artwork**, not a widget in the property box.

### Control-type rendering matrix

**[observed]** on 20 parts placed by hand; the mapping from the shipped
`properties_attributes.unit` field to the rendered widget is exact and
mechanical:

| Shipped `unit` | Renders as | Verified on |
|---|---|---|
| `ohm`, `F`, `H`, `V`, `A` | **`VALUE_AND_UNIT`** — text box + 8-step SI prefix `<select>` | Resistor, Potentiometer, Capacitor, Inductor, Zener, Oscilloscope |
| `[["k","Label"],…]` (a JSON pair list) | **`SELECTBOX`** | LED, LED RGB, Servo, Multimeter, 1.5V Battery, 7-Seg, Function Generator |
| `hidden` | **not rendered** — the value is driven from the canvas or the simulator | Potentiometer `Position`, Slideswitch `Switch`, PIR/Ultrasonic/Gas `Target X/Y`, Oscilloscope `Volt per division`, Flex `flat resistance` |
| `code` | **`BUTTON`** — opens the Code panel | Arduino Uno, ATtiny, micro:bit |
| `(V)`, `(Hz)` | **`VALUE_AND_FIXEDUNIT`** — text box + fixed suffix, no prefix menu | Function Generator |
| absent | plain text/number box | Power Supply, Potato/Lemon Battery |

**[observed]** Every component, without exception, also gets a universal
**`Name`** text field as its first inspector row. It defaults to a sequence
number (`1`, `2`, …) and is what the Code panel's board-binding dropdown shows.

**[observed]** The SI prefix ladders are all 8 steps of the same shape:

- Ω — `pΩ nΩ μΩ mΩ Ω kΩ MΩ GΩ`
- F — `pF nF μF mF F kF MF GF`
- H — `pH nH uH mH H kH MH GH` (note: `uH`, not `μH` — inconsistent with the others)
- V — `pV nV μV mV V kV MV GV`
- s — `ps ns μs ms s ks Ms Gs`

Our resistor ladder is documented as "Tinkercad's own, verbatim". **That is
confirmed** — ours matches the Ω row exactly **[observed]**.

---

# Editor-level capabilities

| Capability | Exists? | Detail | Evidence |
|---|---|---|---|
| **Place part** | Yes | **Drag** a palette tile onto the canvas. Click-then-click does **not** place | [observed] |
| **Search palette** | Yes | Search box with a live **autocomplete suggestion dropdown** (e.g. `diode` → `diode / photodiode / zener diode`); results grouped under the same section headers | [observed] |
| **Components categories** | Yes, 5 | `Basic`, `All`, `Arduino`, `Micro:Bit`, `Circuit Assemblies` | [observed] |
| **Starters filter** | Yes | A second dropdown, `All` / `None` | [observed] |
| **Drag part** | Yes | Pointer drag on the artwork | [observed] |
| **Rotate** | Yes | Toolbar button, `title="Rotate"` | [observed] |
| **Mirror / flip** | Yes, **both axes** | `title="Mirror Horizontal"` and `title="Mirror Vertical"` | [observed] |
| **Copy / paste** | Yes | Dedicated toolbar buttons; `CopyPasteStateMachine` exists in the bundle | [observed] |
| **Delete** | Yes | Trash button **and** the `Delete` key | [observed] |
| **Multi-select** | Yes | **`Ctrl+A` selects all**, then `Delete` clears the canvas. Rubber-band select exists (`SelectingStateMachine`) | [observed] |
| **Undo / redo** | Yes | Toolbar buttons, `title="Undo"` / `"Redo"` | [observed] |
| **Zoom to fit** | Yes | Button, `title="Zoom To Fit"` | [observed] |
| **Right-click context menu** | **No** | Right-clicking a part **selects it and shows no menu** | [observed] |
| **Wire: draw** | Yes | **Click a terminal, then click the destination terminal.** A drag between terminals does **not** create a wire — it highlights them green and nothing else | [observed] |
| **Wire routing modes** | Yes, 4 | `45 degrees, Left/right first, up/down second`; `45 degrees, Up/down first…`; `Straight, Up/down first…`; `Straight, Left/right first…`. Each tooltip adds: *"you can right-click while tracing to switch instantly"* | [observed] |
| **Wire colour** | Yes, **a picker** | Colour swatch dropdown in the toolbar | [observed] |
| **Pin tooltips** | Yes | Hovering a terminal shows its name (`Terminal 1a`, `Power`, `Signal`, `GND`…) | [observed] |
| **Notes / annotation** | Yes | Toolbar note button + a notes-visibility toggle. Notes are **callout bubbles with leader lines anchored to a part**, and **collapse to an icon** | [observed] |
| **Starters** | Yes, 67 | Not templates — **complete pre-wired circuits including annotation callouts**. Dropping "Voltage Meter" produced Uno + HT16K33 7-seg backpack + bench PSU + 2 resistors + wires + 2 explanatory notes | [observed] |
| **View switcher** | Yes, 3 | `js-circuit_breadboard_button` (Lab/breadboard), `js-circuit_schematic_view_button` (**Schematic**), `js-circuit_bom_button` (**Bill of Materials**) | [observed] |
| **Send To** | Yes | `Picture of your design` (PNG), `Autodesk Fusion`, `Electrical design files → .BRD`, `Share over IM or email` + `Invite people` (real-time collaboration — `colab.tinkercad.com` is loaded on every editor page) | [observed] |
| **Start / Stop Simulation** | Yes, one button | Toggles to `Stop Simulation`; a `Simulator time: HH:MM:SS.mmm` readout replaces part of the toolbar | [observed] |
| **Editing during simulation** | **Blocked** | Copy/paste/delete/undo/redo are greyed out and **parts cannot be moved** while running | [observed] |
| **Selection during simulation** | Changed | Clicking a part's *control* operates it and does **not** move the inspector selection | [observed] |
| **Autosave** | Yes | Design persisted server-side; a reload restored everything | [observed] |

## Code editor

| Capability | Detail | Evidence |
|---|---|---|
| **Binding** | A dropdown naming the board **instance**: `1 (Arduino Uno R3)`. With no board it reads **`No programmable components in this circuit`** | [observed] |
| **Modes** | `Blocks` / `Blocks + Text` / `Text` | [observed] |
| **Blocks palette** | `Output, Control, Input, Math, Notation, Variables` | [observed] |
| **Default program** | `on start` + `forever { set built-in LED to HIGH; wait 1 secs; set built-in LED to LOW; wait 1 secs }` | [observed] |
| **Blocks → Text** | **One-way**, behind a confirm dialog: *"Any blocks you currently have will be lost. The code in the text editor will remain and become editable."* | [observed] |
| **Text mode** | C++ with line numbers and syntax highlighting; the blocks transpile to the standard `pinMode`/`digitalWrite`/`delay` Blink sketch | [observed] |
| **Text-mode tools** | Download, **`Include library`**, font-size control | [observed] |
| **Serial Monitor** | Collapsible panel at the foot of the code panel | [observed] |
| **Debugger** | Present: `Pause execution`, `Activate Breakpoints`, `Deactivate Breakpoints` | [observed] |
| **Serial plotter** | `circuitsGui.serialGraph` exists in the running app | [observed] — not exercised |
| **Languages** | C++ and Blocks only. **No MicroPython/Python anywhere** | [observed] |

## Simulation performance

**[observed]** With a Function Generator at 1 kHz driving an Oscilloscope,
simulator time advanced from `00:00:00.610` to `00:00:00.892` over ~18 s of wall
clock — roughly **0.016× real time**. Tinkercad does run a genuine transient
solve, but a kilohertz signal is far slower than real time.

---

# Device inventory

Columns: **Inspector fields** (shipped name → rendered control, default) ·
**Canvas / simulation interaction** · **Pins** · **Notes**.

Pin counts and terminal names are read from each part's shipped
`schematic_symbol_terminals_attributes` — **[observed]** for every row.
Inspector rows marked ✱ were additionally placed and inspected by hand.

## Basic set (26 tiles, the default palette)

| Component | Inspector fields | Canvas / simulation | Pins | Notes |
|---|---|---|---|---|
| **Resistor** ✱ | `Name` text · `Resistance` **value+unit**, default **1 kΩ**, ladder pΩ…GΩ | drag, rotate, mirror | 2 — `Terminal 1`, `Terminal 2` | `base=R`, `sim=resistor` |
| **LED** ✱ | `Name` · `Color` **selectbox** — Green, Yellow, Orange, Blue, **Red** (default), White | glows during sim | 2 — `Cathode`, `Anode` | `sim=led2` |
| **Pushbutton** ✱ | `Name` **only** | press-and-hold on the cap during sim | **4** — `Terminal 1a/1b/2a/2b` | Same 4-pin bussed geometry as ours |
| **Potentiometer** ✱ | `Name` · `Resistance` **value+unit**, default **250 kΩ** · `Position` **hidden** | **rotary knob on the artwork**; click/drag rotates it, position persists after the sim stops | 3 — `Terminal 1`, `Wiper`, `Terminal 2` | Knob is canvas-only — never an inspector slider |
| **Capacitor** ✱ | `Name` · `Capacitance` **value+unit**, default **100 nF**, ladder pF…**GF** | — | 2 | Ladder runs to gigafarads |
| **Slideswitch** ✱ | `Name` **only** · `Switch` **hidden** | slide the actuator on the artwork | 3 — `Terminal 1`, `Terminal 2`, `Common` | SPDT |
| **9V Battery** | `Name` only | — | 2 — `Negative`, `Positive` | |
| **Coin Cell 3V Battery** | `Name` only | — | 2 — `Positive`, `Negative` | |
| **1.5V Battery** ✱ | `Name` · `Count` **selectbox** 1–4 batteries · `Type` **selectbox** AA/AAA · `Built-in Switch` **selectbox** no/yes | the built-in switch is operable when enabled | 2 | One part covers four pack sizes |
| **Breadboard Small** | `Name` only | — | **420** | Identical tie-point count to ours |
| **micro:bit** | `Name` · `Color` **selectbox** Red/Yellow/Green/Blue · `Code` **button** · `Panel X/Y` hidden | 5×5 LED matrix, buttons A/B, accelerometer/compass via starters | 5 edge pads | Programmable |
| **Arduino Uno R3** ✱ | `Name` · `Code` **button** | runs real firmware; built-in LED animates | **32** | vs our 29 — Tinkercad exposes the SDA/SCL duplicates and a 3rd GND we deliberately omit |
| **Vibration Motor** | `Name` only | — | 2 | |
| **DC Motor** ✱ | `Name` **only** | **live `0 rpm` label rendered on the artwork** during sim | 2 | No load property at all |
| **Micro Servo** ✱ | `Name` · `Type` **selectbox** **Positional** / Continuous | horn sweeps during sim | 3 — `Ground`, `Power`, `Signal` | |
| **Hobby Gearmotor** | `Name` only | — | 2 | |
| **NPN Transistor (BJT)** | `Name` only | — | 3 — `Emitter`, `Base`, `Collector` | |
| **LED RGB** ✱ | `Name` · `Pinout` **selectbox** **RCBG** / RCGB / BRCG | tri-colour glow | 4 — `Red`, `Cathode`, `Blue`, `Green` | Pinout choice is a real teaching feature |
| **Diode** ✱ | `Name` **only** | — | 2 — `Cathode`, `Anode` | No part-number or Is/n choice — same as ours |
| **Photoresistor** ✱ | `Name` **only** | **on-canvas horizontal slider during simulation**, dark-dot ↔ sun icons at the ends | 2 | `sim=ldr_v2` |
| **Soil Moisture Sensor** | `Name` only | — | **6** (3 duplicated) | |
| **Ultrasonic Distance Sensor** ✱ | `Name` **only** · `Target X/Y` **hidden** | **draggable target object**; live readout **`44.7in / 113.4cm`** rendered above the part | 3 — `Ground`, `Power`, `Signal` | Parallax PING))), 3-pin |
| **PIR Sensor** ✱ | `Name` **only** · `Target X/Y` **hidden** | **draggable target + a rendered detection cone** that re-aims at the target and changes colour on detection | 3 — `Signal`, `Power`, `Ground` | |
| **Piezo** ✱ | `Name` **only** | sounds during sim | 2 — `Negative`, `Positive` | Tinkercad's only buzzer-class part |
| **Temperature Sensor [TMP36]** ✱ | `Name` **only** | **on-canvas slider with a live `25°C` badge**, cold/hot thermometer icons at the ends | 3 — `Power`, `Vout`, `GND` | |
| **Multimeter** ✱ | `Name` · `Mode` **selectbox** Amperage / **Voltage** (default) / Resistance | probes attach as two ordinary terminals; reads on its own display | 2 — `Negative`, `Positive` | One instrument, three modes |

## All Components (the further 84)

| Component | Inspector fields | Pins | Notes |
|---|---|---|---|
| **Polarized Capacitor** | `Voltage rating` **value+unit** 16 V · `Capacitance` 1 µF | 2 | We have **no** voltage rating on any capacitor |
| **Zener Diode** ✱ | `Zener Voltage` **value+unit**, default **5.10 V** | 2 | |
| **Inductor** ✱ | `Inductance` **value+unit**, default **10 µH** | 2 | |
| **Photodiode** | `Name` only | 2 | |
| **Ambient Light Sensor [Phototransistor]** | `Name` only | 2 | |
| **Flex Sensor** | `flat resistance` 30 kΩ **hidden** | 2 | Bend controlled on canvas |
| **Force Sensor** | `Name` only | 2 | |
| **IR sensor** | `Name` only | 3 — `Power`, `GND`, `Out` | |
| **Ultrasonic Distance Sensor (4-pin)** | `Target X/Y` hidden | 4 — `Power`, `Trigger`, `Echo`, `Ground` | Direct analogue of our `hc_sr04` |
| **Tilt Sensor** | `Name` only | 2 | `sim=sensor_tilt_sw200d` |
| **Gas Sensor** | `Target X/Y` hidden | **6** — `B2 H2 B1 A2 H1 A1` | Has a draggable gas-source target |
| **Keypad 4x4** | `Name` only | 8 | |
| **DIP Switch DPST** | `Switch` hidden | — | |
| **DIP Switch SPST ×4** | `Switch1…4` hidden | — | Four independent canvas switches |
| **DIP Switch SPST ×6** | `Switch1…6` hidden | — | |
| **Light bulb** | `Name` only | 2 | |
| **NeoPixel** + **Rings 12/16/24** + **Strips 4/6/8/10/12/16/20** | `Name` only | — | **11 addressable-LED parts.** We have none |
| **DC Motor with encoder** | `RPM` **selectbox**, 15 values `26, 32, 38, 44, 52, 116, 142, 195, 280, 350, 416, 520, 624, 730, 2737` | — | Gearbox ratios as a menu |
| **IR remote** | `Name` only | — | Emits IR codes to the IR sensor |
| **7 Segment Display** ✱ | `Common` **selectbox** **Anode** / Cathode | **10** — `G F Common A B E D Common C DP` | |
| **LCD 16 x 2** | `Name` only | **16** | Parallel HD44780 |
| **LCD 16 x 2 (I2C)** | `type` **selectbox** MCP23008/PCF8574 · `address` **selectbox** `32 (0x20)` … `39 (0x27)` | 4 | |
| **7-Segment Clock Display** | `color` **selectbox** Red/Yellow/Green/Blue | — | HT16K33 I²C backpack |
| **Solar Cell** | `peak voltage` 5 V · `peak current` 100 mA | 2 | |
| **Potato Battery** | `voltage` 0.67 V · `resistance` 5.65 kΩ | 2 | |
| **Lemon Battery** | `voltage` 0.52 V · `resistance` 5.9 kΩ | 2 | |
| **Breadboard** | `Name` only | **840** | Full-size |
| **Breadboard Mini** | `Name` only | — | |
| **micro:bit with Breakout** | `color` · `Code` · `Panel X/Y` | — | |
| **ATtiny** | `Code` **button** | 8 | Second programmable MCU |
| **Power Supply** ✱ | `Voltage` 5 · `Current` 5 (plain number boxes) | 2 | **Two rotary knobs (0–30 V, 0–5 A), an ON/OFF switch, and two live digital readouts.** Observed: `9.94 V` / `5.00 A`, then `10.0 V` / **`556 µA`** after turning the knob — the current **auto-ranges to µA** |
| **Function Generator** ✱ | `Function` **selectbox** **Square**/Sine/Triangle · `DC Offset` **2.5 V** fixed-unit · `Amplitude` **5 V** · `Frequency` **1000 Hz** | 2 | **Three knobs, three waveform buttons, ON/OFF switch, three live readouts** (`1.00 kHz`, `5.00 V`, `2.50 V`) |
| **Oscilloscope** ✱ | `Time Per Division` **value+unit**, default **100 ms**, ladder ps…Gs · `Volt per division` **hidden** (an on-canvas edge slider) | 2 | Graticule with axes labelled **Voltage** and **Time**. **Trace rendering was NOT observed** — see Unreachable |
| **Timer** / **Dual Timer** | `Name` only | 8 / 14 | 555-class (not named "555") |
| **741 Operational Amplifier** | `Name` only | **8** — `Offset 1, In-, In+, Power-, Offset 2, Out, Power+, Not Connected` | |
| **Quad comparator** / **Dual comparator** | `Name` only | 14 / 8 | |
| **Optocoupler** | `Name` only | — | |
| **PNP Transistor (BJT)** | `Name` only | 3 | |
| **Small Signal nMOS / pMOS** | `Name` only | 3 | |
| **nMOS / pMOS Transistor (MOSFET)** | `Name` only | 3 | |
| **TIP120** | `Name` only | 3 | Darlington |
| **Relay SPDT** | `Name` only | **6** | Bare relay, not a module board |
| **Relay DPDT** | `Name` only | **8** | |
| **5V Regulator [LM7805]** / **3.3V Regulator [LD1117V33]** | `Name` only | 3 | |
| **H-bridge Motor Driver** | `Name` only | **16** — `Enable 1 & 2, Input 1, Output 1, Ground ×2, Output 2, Input 2, Power 2, Enable 3 & 4, Input 3, Output 3, Ground ×2, Output 4, Input 4, Power 1` | L293-class DIP, not an L298N board |
| **8-Bit Shift Register** | `Name` only | **16** — `Output 2…8, Ground, Inverted Output 8, Shift Register Clear, Shift Register Clock, Output Register Clock, Output Enable, Input, Output 1, Power` | 74HC595 |
| **8 Pin Header**, **USB standard A** | `Name` only | 8 / 4 | Connectors |
| **Logic family** — Quad NAND / NOR / AND / OR / XOR, Hex Inverter, Inverting Schmitt Trigger, Quad NAND Schmitt Trigger, Triple 3-Input NAND/AND/NOR, Dual 4-Input NAND/AND | `Name` only | 14 each | **13 gate packages** |
| **Dual J-K Flip-Flop**, **Dual D Flip-Flop**, **4-Bit Latch**, **4-Bit Binary Counter**, **4-Bit Adder**, **Johnson Decade Counter**, **7-Segment Decoder**, **8-port I2C expander** | `Name` only | 14–16 | Sequential/combinational logic |

---

# Gap list against our palette

Our palette (25): `arduino_uno, arduino_mega, raspberry_pi_pico, breadboard,
resistor, led, push_button, potentiometer, photoresistor, diode, buzzer,
dc_motor, dht11, capacitor, inductor, hc_sr04, pir_motion, flow_sensor,
ds18b20, l298n, uln2003, stepper_28byj48, relay_4ch, pulse_sensor, mcp3008`.

## A. What Tinkercad has that we lack

**Instruments — we have none of these [observed]**

| Part | Why it matters |
|---|---|
| **Multimeter** | Voltage / Amperage / Resistance from one part, attached like any 2-terminal component. Our only voltage readout is a part's own device-state line |
| **Oscilloscope** | Time/div + volts/div, Voltage-vs-Time graticule |
| **Function Generator** | Square/sine/triangle, 1 Hz–1 MHz, amplitude and DC offset — a true AC source. We have no AC source of any kind |
| **Power Supply** | Bench PSU, 0–30 V / 0–5 A, live V and A readouts, ON/OFF |

**Power sources [observed]** — 9V battery, coin cell, AA/AAA pack (1–4 cells,
optional built-in switch), solar cell, potato battery, lemon battery. **We have
no battery part at all** — every circuit of ours must be powered from a board's
rail.

**Display / output [observed]** — 7-segment display (common anode *or*
cathode), 7-segment clock display, LCD 16×2 parallel, LCD 16×2 I²C (two expander
chips, eight addresses), RGB LED (three pinout orders), 11 NeoPixel variants,
light bulb, vibration motor, micro servo (positional **and** continuous), hobby
gearmotor, DC motor with a 15-ratio encoder.

**Sensors [observed]** — TMP36, soil moisture, gas (with a draggable source),
flex, force, tilt, IR receiver + IR remote, photodiode, phototransistor.

**Discrete / IC [observed]** — Zener diode, polarised capacitor **with a
voltage rating**, NPN, PNP, small-signal nMOS/pMOS, power nMOS/pMOS MOSFET,
TIP120, optocoupler, 741 op-amp, dual + quad comparator, 555-class timer and
dual timer, LM7805 and LD1117V33 regulators, H-bridge (L293-class), 74HC595,
**13 logic-gate packages**, JK and D flip-flops, 4-bit latch/counter/adder,
Johnson decade counter, 7-segment decoder, 8-port I²C expander, 8-pin header,
USB A.

**Boards [observed]** — micro:bit (+ breakout), ATtiny.

**Switchgear [observed]** — slideswitch (SPDT), DIP switch DPST, DIP SPST ×4,
DIP SPST ×6, keypad 4×4.

**Breadboards [observed]** — full-size 840-point and mini, alongside the
420-point small one we match exactly.

**Editor features we lack [observed]**

| Feature | Note |
|---|---|
| **Blocks programming** | Plus a Blocks+Text hybrid mode. We are text-only |
| **Schematic view** | A second rendering of the same circuit |
| **Bill of Materials view** | Parts list |
| **`.BRD` export** | Eagle board file — the breadboard design becomes a PCB |
| **PNG export** of the design | |
| **Real-time collaboration** | Share-link editing, "Invite people" |
| **Copy / paste** | We have none |
| **Multi-select + `Ctrl+A`** | Our `selected` is a single id |
| **Mirror / flip on both axes** | We have rotate only |
| **Zoom to fit button** | We fit only on first paint |
| **4 wire routing modes** | Switchable mid-trace by right-click |
| **Annotation notes** | Callout bubbles anchored to parts, collapsible |
| **Starters as complete annotated circuits** | Ours load geometry only |
| **Debugger** | Breakpoints + pause execution |
| **Part naming** | Every part has a user-editable `Name`; the code panel binds by it |
| **Pin hover tooltips** | |

**Interaction model we lack — the important one [observed]**

Tinkercad's sim-time controls live **on the canvas artwork**, not in the
inspector:

- Photoresistor → slider with dark/sun end icons
- TMP36 → slider with a live `25°C` badge and thermometer end icons
- Ultrasonic → **draggable target object**, live `44.7in / 113.4cm` readout
- PIR → **draggable target plus a rendered detection cone** that re-aims and
  changes colour on detection
- Gas sensor → draggable source target
- DC motor → live `0 rpm` label on the body
- Power supply / function generator → live digital readouts and rotary knobs

We have canvas controls for exactly three parts (button, pot knob, LDR slider);
everything else is an inspector slider. **Tinkercad has no inspector slider at
all**, and its draggable-target-with-cone idea has no analogue in our code.

## B. What we have that Tinkercad lacks

**Parts absent from Tinkercad's entire 110-component catalogue** — verified by
regex over the shipped `all-components.json` **[observed]**:

| Ours | Tinkercad |
|---|---|
| `arduino_mega` | **No Mega.** Only Uno R3, ATtiny, micro:bit |
| `raspberry_pi_pico` | **No Pico, and no Python of any kind** |
| `dht11` | **No DHT part** |
| `ds18b20` | **No 1-Wire part** |
| `flow_sensor` (YF-S201) | **No flow sensor** |
| `pulse_sensor` | **No pulse/heart sensor** |
| `mcp3008` | **No SPI ADC** |
| `stepper_28byj48` | **No stepper motor of any kind** — the catalogue contains none |
| `uln2003` | **No Darlington-array module** (TIP120 is a single transistor) |
| `l298n` | Only a **bare L293-class H-bridge DIP**, not an L298N breakout board |
| `relay_4ch` | Only **bare SPDT/DPDT relays**, not a 4-channel module board |
| `buzzer` with active/passive modes | Only `Piezo`, no active/passive distinction |

**Capabilities we have that Tinkercad does not appear to expose [observed for
ours; inferred-absent for Tinkercad, since I saw no such UI]**

- **A safety / fault model.** Our datasheet-derived `safety()` verdicts
  (caution / destructive, with the reason quoted) have no counterpart I could
  find. Tinkercad does burn out parts visually, but surfaces no per-part
  rating, threshold or explanation.
- **A Checks panel** listing `limitations` badged *not simulated*, solver
  errors, and connectivity problems ("No ground in the circuit", "X has a lead
  wired to nothing", the breadboard **centre-channel crossing** hint naming both
  holes).
- **Device-state prose** — `"reverse biased — it blocks, which is either the
  point or the wrong way round"`, `"contacts open · N V across them"`,
  `"solved at its DC limit (an open), not integrated in time"`. Tinkercad's
  readouts are numeric badges only.
- **A Measurements panel** giving per-part current in mA.
- **MicroPython** with REPL-phase reporting and traceback extraction.
- **Server-side compilation** surfacing diagnostics, flash bytes and warnings.
- **Prebuilt firmware fixtures filtered by board.**
- **Wire editing**: insert a waypoint by dragging the wire body, move a bend,
  double-click a bend to delete it, click-to-route with Escape to cancel.
- **Net highlight on pin hover.**
- **Explicit ADC-range labelling** (`analogRead · 0–1023` vs `ADC · 0–4095`).
- **Pins-driven-high** chip list.
- **Honest limitation strings** attached to specific parts.

## C. Where we are at parity

Breadboard tie-point count (420) **[observed, identical]**; the Ω SI ladder
**[observed, identical]**; resistor / LED / pushbutton / potentiometer /
capacitor / inductor / diode / photoresistor / DC motor / PIR / ultrasonic
(4-pin) / Arduino Uno all exist on both sides with comparable pinouts. Our Uno
has 29 pins to Tinkercad's 32 — the difference is the SCL/SDA duplicates and a
third GND pad, which we omit deliberately and document as such.

---

# Unreachable / not observed

Stated rather than guessed, per the brief:

1. **Oscilloscope trace rendering — NOT observed.** I placed a Function
   Generator and an Oscilloscope, wired them terminal-to-terminal (two green
   wires confirmed on screen), set Time/Div to 1 ms and ran the simulation. The
   generator showed live `1.00 kHz / 5.00 V / 2.50 V` and the square-wave button
   lit, but **the scope graticule stayed blank**. Two candidate causes, neither
   confirmed: one of the two wires appears to have been lost between runs
   (only one wire was visible in the final frame), and the transient solve was
   running at ~0.016× real time so a full sweep may simply not have completed.
   **I am not recording that Tinkercad's oscilloscope does or does not draw a
   trace.** Its inspector, pins, axis labels and hidden volts/div control *are*
   observed.
2. **Multimeter live reading — NOT observed.** Its `Mode` selectbox, pins and
   placement are observed; I did not get a wired measurement on screen.
3. **Serial Monitor output — NOT observed.** The panel exists and is
   collapsible; I did not run a sketch that printed to it.
4. **Debugger behaviour — NOT observed.** The three controls exist by title
   only.
5. **Schematic view and BOM view — NOT opened.** Their buttons are identified by
   their `js-` hooks; I did not switch to them.
6. **Keyboard shortcuts beyond `Ctrl+A` and `Delete` — NOT enumerated.**
   `addKeyBindings` is a generic dispatcher and `Circuits.KeyCode` is empty at
   runtime, so there is no shipped shortcut table to read. Only the two above
   were tested directly.
7. **Per-property min/max/validation — NOT exposed.** The shipped
   `properties_attributes` records carry `name`, `default`, `default_prefix`,
   `unit` and `default_show` and **no range fields**, and the rendered inputs are
   `type="text"` with no `min`/`max`/`step` attributes. Any clamping happens in
   code I did not trace. This is a real difference from our schema, which
   declares explicit ranges.
8. **`Circuit Assemblies`, `Arduino` and `Micro:Bit` palette categories — NOT
   enumerated.** Their collection JSONs return HTTP 403 under the names I
   probed; only `basic-components.json` and `all-components.json` are readable.
   The category names themselves are observed from the dropdown.
9. **Screenshots**: inspector and simulation states were captured throughout,
   but the browser's screenshot channel failed intermittently (the tab kept
   losing foreground; `resize_window` was the reliable way to bring it back).
   Late in the session screenshot capture broke entirely, which is why the final
   verification of the owner's design was done by counting component instances
   in the DOM rather than visually.

---

# Practical read

The two products have diverged in a specific way, and it is not mainly about
part count.

**Tinkercad is broader and more instrumented.** 110 components against our 25,
a full logic and analogue IC family, four bench instruments, batteries, and
export paths (`.BRD`, PNG) plus collaboration. A student can build and *measure*
a circuit that has no microcontroller in it at all — we effectively cannot,
because we have no battery, no AC source and no meter.

**We are deeper per part, and more honest about it.** Datasheet-derived safety
thresholds with reasons, a Checks panel that names what is *not* simulated,
prose device-state, per-part milliamps, two more MCU families including a
Python track, and protocol-exact models (DHT11, DS18B20, YF-S201) of parts
Tinkercad simply does not carry. Tinkercad tells a student a number; we tell
them why the number is that and what would destroy the part.

**The one structural idea worth stealing** is the canvas-resident sim-time
control — particularly the **draggable target with a rendered detection cone**
for the PIR and ultrasonic. It makes "what is the sensor pointed at" a physical,
spatial question instead of a number in a side panel, and it costs Tinkercad no
inspector real estate at all. It is also the reason their `inspectorInputType`
enum never needed a slider.
