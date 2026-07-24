# Device controls audit — VLab simulator vs Tinkercad Circuits

Research and specification only. No implementation, no repo changes beyond this file.

**Date:** 2026-07-24
**Our side:** `lib/simulator/model/parts.ts` (`PALETTE`, `PART_LIBRARY[*].props`) and the
`SELECTED` inspector in `components/simulator/CircuitEditor.tsx` (`PropControl`, line 236).
**Their side:** the owner's design `https://www.tinkercad.com/things/hfX3NiARk0m/editel`,
inspected in a new tab created for this audit (now closed). The owner's design was not
modified: no component or wire was added, moved or deleted.

Every row is tagged **[observed]** (I saw it in the running app or read it in the source)
or **[inferred]** (reasoned, not seen). Read [inferred] as "worth verifying before you
build against it".

---

## 0. Method, and the honest limits of it

What I could observe on Tinkercad, I observed directly: I clicked each component present in
the owner's design and read its inspector out of the live DOM, and I opened and dissected the
Code panel.

**What I could not observe, and why.** Partway through the audit the tab went to the
background — the owner was working in their own tabs at `localhost:3000`. Chrome throttles
`requestAnimationFrame` in hidden tabs, and Tinkercad's editor boot, its loading curtain and
its drag-and-drop all depend on it. From that point screenshots timed out and drag-and-drop
from the component palette never dropped. **I therefore could not add any component to the
canvas**, so the inspectors for potentiometer, photoresistor, capacitor, DC motor,
pushbutton and micro:bit are **not observed**. I have not guessed at their field lists.
Section 7 states exactly what is missing.

I did not sign in anywhere; the browser session was already authenticated.

One thing I changed and then reverted: I switched the Code panel's EDIT MODE from `Blocks`
to `Blocks + Text` to see the text editor. That is a view mode, not a content change — the
block program stayed intact. After a page reload the mode read `Blocks` again, so the change
did not persist. **The owner's design is as they left it.**

---

## 1. Our parts, as actually declared and actually rendered

`PropControl` picks a control from the *shape* of the declared prop, not from the part:

| Declared shape | Rendered control |
|---|---|
| `type:'range'` with `min:0, max:1, step:1` | **checkbox** (`isToggle`, line 222) |
| `type:'range'` otherwise | **slider**, with a live value + unit readout |
| anything else (`'select'`, `'number'`) | **`<select>`**, options formatted `0 → "none (wire)"`, `>=1000 → "N k<unit>"`, else `"N <unit>"` |

Note `type:'number'` is declared in the `PartDefinition` union but **no part uses it, and
`PropControl` has no branch for it** — it would fall through to the `<select>` branch and
render an empty dropdown. There is no free-text numeric entry anywhere in our inspector.
**[observed, source]**

Full inventory of the 24 parts in `PART_LIBRARY`:

| Part | Props declared | Control | Range / options | Default |
|---|---|---|---|---|
| `arduino_uno` | — | none | | |
| `arduino_mega` | — | none | | |
| `raspberry_pi_pico` | — | none | | |
| `breadboard` | — | none | | |
| `resistor` | `ohms` | select | `0,100,220,330,470,1000,2200,4700,10000,100000` Ω | none declared; palette seeds `220` |
| `led` | — | **none** | | colour hardcoded `'red'` in `electrical` |
| `push_button` | `pressed` | checkbox | 0/1 | 0 |
| `potentiometer` | `position` | slider | 0–100 %, step 1 | 50 |
| `photoresistor` | `light` | slider | 0–100 %, step 1 | 60 |
| `diode` | — | none | | |
| `buzzer` | `passive` | checkbox | 0/1 | 0 |
| `dc_motor` | `load` | slider | 0–100 %, step 5 | 0 |
| `l298n` | — | none | | |
| `uln2003` | — | none | | |
| `stepper_28byj48` | — | none | | |
| `relay_4ch` | `activeLow` | checkbox | 0/1 | 1 |
| `dht11` | `temperature`, `humidity` | slider ×2 | 0–50 °C; 20–90 % | 24; 45 |
| `ds18b20` | `temperature`, `resolution` | slider, select | −55–125 °C; `9,10,11,12` bit | 25; 12 |
| `hc_sr04` | `distance` | slider | 1–420 cm, step 1 | 50 |
| `pir_motion` | `motion`, `hold`, `warmup` | checkbox, slider, slider | 0/1; 1–30 s; 0–60 s step 5 | 0; 5; 0 |
| `flow_sensor` | `flow` | slider | 0–30 L/min, step 1 | 10 |
| `pulse_sensor` | `bpm`, `amplitude` | slider ×2 | 30–200 BPM; 0–20 % | 72; 8 |
| `mcp3008` | — | none | | |
| `capacitor` | `microfarads` | select | `1,10,47,100,220,470` µF | none declared; compile falls back to 1 |

**11 of 24 parts have no inspector control at all.** Every value we do expose is either a
fixed dropdown or a bounded slider. **Nothing in our simulator accepts a typed number.**
**[observed, source]**

---

## 2. Tinkercad's inspector vocabulary

Tinkercad's client exposes its own enum of inspector control types, which is the cleanest
possible statement of what their inspectors can do. Read live from `Circuits.inspectorInputType`:

```
TEXT: 0,  READ_ONLY: 1,  VALUE_AND_UNIT: 2,  VALUE_UNIT_CHECK: 3,
VALUE_AND_FIXEDUNIT: 4,  CHECKBOX: 5,  SELECTBOX: 6,  BUTTON: 7
```

**[observed]**

Two consequences worth absorbing:

- **`VALUE_AND_UNIT` is the workhorse** — a free-text number paired with an SI-prefix unit
  dropdown. That is how a resistor, and by the same mechanism most passives, are edited.
- **There is no slider type in the inspector.** Tinkercad has no equivalent of our range
  control in the properties panel. Continuously-variable things (a pot's wiper, an LDR's
  illumination) are manipulated **on the canvas**, not in a panel. Our design put all of it
  in the panel and none on the canvas — that is the structural difference, and it matches
  the owner's earlier complaint that our pot knob is inert.

Their component picker offers **164 distinct components** across Basic / All / Starters
(Basic, Arduino, micro:bit) / Circuit Assemblies. **[observed]** Ours offers 24.

---

## 3. Device-by-device comparison

| Our part | Tinkercad equivalent | Their controls | Our controls | Gap |
|---|---|---|---|---|
| `resistor` | Resistor | **Name** (text) + **Resistance**: free-text numeric + unit `<select>` `pΩ nΩ μΩ mΩ Ω kΩ MΩ GΩ`. Instance read `1` + `kΩ`. **[observed]** | Fixed 10-entry dropdown, 0 Ω–100 kΩ | **Large.** Any value vs 10 values. Cannot enter 150 Ω, 1 kΩ, 4.7 kΩ is there but 3.3 kΩ is not. No unit selector. |
| `led` | LED | **Name** + **Color** `<select>`: Green, Yellow, Orange, Blue, Red, White. **[observed]** | **No props at all**; colour hardcoded `'red'` | **Large.** We cannot change LED colour at all; `electrical.color` is a library constant, not a per-instance prop. |
| `arduino_uno` / `arduino_mega` | Arduino Uno R3 | **Name only.** No electrical properties. Code lives entirely in the Code panel. **[observed]** | none | Parity on the *inspector*. The whole gap is the code panel — §4. |
| `raspberry_pi_pico` | *(no Pico in their palette; micro:bit and ATtiny are the non-Arduino boards)* **[observed]** | n/a | none | No comparison available. Our Pico is a differentiator. |
| `breadboard` | Breadboard Small / Breadboard / Breadboard Mini | **Name only.** **[observed]** | none | Parity. They ship three sizes, we ship one. |
| `potentiometer` | Potentiometer | **Not observed.** Their pot is expected to expose resistance via `VALUE_AND_UNIT` and to be turned by dragging the knob on canvas. **[inferred]** | `position` slider 0–100 % | **Confirmed gap in kind:** our knob is inert on canvas; theirs is the primary interaction. Total resistance is fixed at 10 kΩ in `electrical.totalOhms` and not editable. |
| `photoresistor` | Photoresistor | **Not observed.** Expected to be driven by an on-canvas slider/handle that appears during simulation. **[inferred]** | `light` slider 0–100 % | Panel vs canvas. Our min/max ohms are library constants, not editable. |
| `push_button` | Pushbutton | **Not observed.** **[inferred]** their pushbutton is pressed by clicking/holding it on canvas during simulation, and the inspector carries Name + colour. | `pressed` checkbox | **Interaction gap.** A checkbox is a poor model of a momentary button — it cannot express press-and-hold, and it is in the wrong place (panel, not the button). |
| `capacitor` | Capacitor / Polarized Capacitor | **Not observed.** Expected `VALUE_AND_UNIT` in farads (pF…F). **[inferred]** | 6-entry µF dropdown | Same shape as the resistor gap. They also ship a *polarized* variant we do not. |
| `dc_motor` | DC Motor / Hobby Gearmotor / Vibration Motor / DC Motor with encoder | **Not observed.** **[inferred]** | `load` slider 0–100 % | Unknown. Our "mechanical load" has no obvious Tinkercad analogue. |
| `diode` | Diode / Zener Diode / Photodiode | **Not observed.** **[inferred]** likely a part-number `SELECTBOX`. | none | We expose nothing; forward drop is a model constant. |
| `buzzer` | Piezo | **Not observed.** **[inferred]** | `passive` checkbox | Unknown. |
| `dht11` | *(no DHT in their palette)*; nearest is **Temperature Sensor [TMP36]** **[observed]** | Not observed | 2 sliders | We are ahead here. |
| `ds18b20` | *(none)* | — | slider + select | We are ahead. |
| `hc_sr04` | Ultrasonic Distance Sensor / Ultrasonic Distance Sensor (4-pin) **[observed]** | Not observed | `distance` slider | Both exist. Their adjustment mechanism unknown. |
| `pir_motion` | PIR Sensor **[observed]** | Not observed | 3 controls | Ours is richer in declared props; theirs may be canvas-driven. |
| `flow_sensor` | *(none)* | — | slider | We are ahead. |
| `pulse_sensor` | *(none)* | — | 2 sliders | We are ahead. |
| `mcp3008` | *(none as such)* | — | none | — |
| `l298n` | **H-bridge Motor Driver** **[observed]** | Not observed | none | Both exist. |
| `uln2003` | *(none)*; they ship **TIP120**, **Optocoupler**, transistors | — | none | — |
| `stepper_28byj48` | *(no stepper)*; they ship **Micro Servo** **[observed]** | Not observed | none | We are ahead on steppers; **we have no servo**, which is one of their headline parts. |
| `relay_4ch` | **Relay SPDT / Relay DPDT** **[observed]** | Not observed | `activeLow` checkbox | Both exist; theirs are discrete relays, ours is a module. |
| *(we have none)* | **Multimeter**, **Oscilloscope**, **Function Generator**, **Power Supply**, batteries (9 V, coin cell, 1.5 V), **NeoPixel** family, **LCD 16×2** (+I²C), **7-segment**, **Keypad 4×4**, logic-gate ICs, flip-flops, counters, op-amps, comparators, regulators, MOSFETs/BJTs, **Slideswitch**, **Light bulb**, **Solar Cell** **[observed]** | — | — | Large breadth gap, but mostly out of scope for an IoT lab. **The instruments (multimeter, oscilloscope) and the power sources are the notable absences** — we have no way to place a battery or measure a node. |

---

## 4. The code editor — how Tinkercad actually does it

This is the highest-value section: we have **no code editor at all** today.

### 4.1 Where it lives

- A **`Code`** button sits in the top toolbar, next to **`Start Simulation`** and `Send To`.
  **[observed]**
- Clicking it opens a **docked right-hand panel** that splits the window horizontally: the
  circuit canvas shrinks to the left, the code panel takes the right. It is **not** a modal
  and **not** a separate page — the circuit stays visible and editable while you code.
  **[observed]**
- **`Start Simulation` is shared.** One button in the top toolbar runs the circuit *and* the
  code. There is no separate "run code" control. **[observed]**

### 4.2 How code is bound to a board

The code panel's toolbar carries a **component selector dropdown reading `1 (Arduino Uno R3)`**
(DOM class `code_panel__toolbar__component`). **[observed]**

That label is the board's **`Name` property** — the Arduino's inspector contains exactly one
field, `Name`, whose value is `1`. So: **each MCU instance on the canvas owns its own
program, and the code panel targets one MCU at a time, selected by name.** A design with two
Arduinos would offer two entries. **[observed for the mechanism; the two-board case is
[inferred]]**

This is a clean answer to "how does the code get associated with the board", and it is
directly portable to us: the program is a property of the placed MCU part, not of the
document.

### 4.3 The three edit modes

An **`EDIT MODE`** dropdown offers exactly three options **[observed]**:

| Mode | What it is |
|---|---|
| **Blocks** | Blockly workspace only. The default. |
| **Blocks + Text** | Blockly on the left, generated C++ on the right, **read-only**. |
| **Text** | Text editor only. |

In **Blocks + Text** I read the editor instance directly:

```
CodeMirror, mode "text/x-c++src", lineNumbers: true, readOnly: true
```

**[observed]** — so the C++ view is a *transpilation target*, not an input, in that mode. It
showed the C++ generated from the owner's blocks:

```cpp
// C++ code
//
void setup()
{
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop()
{
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000); // Wait for 1000 millisecond(s)
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000); // Wait for 1000 millisecond(s)
}
```

**That `readOnly: true` is mode-specific.** `Text` is offered as an *edit* mode, so in `Text`
the same CodeMirror is editable. **[inferred — I deliberately did not switch to `Text`,
because that discards the owner's block program.]**

Tinkercad **compiles Arduino C++ server-side**; the browser does not host a compiler.
**[inferred — not verified in this audit. Do not treat as fact.]**

### 4.4 The blocks

Categories, colour-coded: **Output, Control, Input, Math, Notation, Variables**. **[observed]**

Blocks seen in the Output palette **[observed]**:
`set built-in LED to [HIGH]` · `set pin [0] to [HIGH]` · `set pin [3] to (0)` ·
`rotate servo on pin [0] to (0) degrees` · `play speaker on pin [0] with tone (…)` ·
`turn off speaker on pin [0]` · `print to serial monitor ("hello world") with …` ·
`set RGB LED in pins [3][6][5]…` · `configure LCD [1] type to [I2C (MCP2…)]`

The workspace uses two hat blocks — **`on start`** and **`forever`** — which map onto
`setup()` and `loop()`. **[observed]** Pin numbers inside blocks are dropdowns, not free
text. **[observed]**

The workspace has its own zoom in / zoom out / reset controls and a **trash can** for
deleting blocks. **[observed]** There is a **download button** in the panel toolbar.
**[observed]**

### 4.5 Serial Monitor

A **`Serial Monitor`** control sits at the **bottom-left of the code panel**, with a chevron
— a **collapsible drawer inside the code panel**, not a separate window. **[observed]** Its
contents and behaviour while running were **not observed**.

Tinkercad also ships a `serialGraph` GUI module (seen in `circuitsGui`), i.e. a serial
**plotter** alongside the monitor. **[observed that the module exists; its UI was not observed]**

### 4.6 What an equivalent needs in our app

Mapping the above onto what we have:

| Tinkercad element | Our current state |
|---|---|
| `Code` toggle opening a docked panel | **Nothing.** |
| Board selector binding code → MCU instance | **Nothing.** Program is not a part property. |
| Blocks / Blocks+Text / Text modes | **Nothing.** |
| Editable text editor | **Nothing.** Pico script is a read-only `<pre>` (`data-testid="pico-script"`, `CircuitEditor.tsx:1054`). |
| Shared `Start Simulation` | **We have this** — `data-testid="run-toggle"`, line 798. |
| Serial Monitor drawer | **We have a serial console already** (line ~1129). |

**The asymmetry that decides our priorities.** Our two tracks get their program in
fundamentally different ways, and `CircuitEditor.tsx:553-559` already says so:

- **AVR track (Uno/Mega):** `useState(FIRMWARE[0].url)` picks one of three **pre-compiled
  `.hex` fixtures** — `/sim/blink.hex`, `/sim/dht11.hex`, `/sim/pot.hex` (lines 25–29). There
  is **no avr-gcc in the browser**. Free-text Arduino C editing **cannot run today** without
  either a server-side compile service or a WASM toolchain.
- **Pico track:** MicroPython is **interpreted**. `pico/engine.ts` already drives the emulated
  USB REPL — Ctrl-C, Ctrl-E (paste mode), stream the script, Ctrl-D to execute (lines
  637–657). The plumbing is **already parameterised on the student's source**:
  - `usePicoSimulator(doc, script, enabled)` takes `script` as an argument;
  - it already sends a `setScript` message and **already reboots the interpreter when the
    script changes** (lines 157–172);
  - `CircuitEditor.tsx:609` is `const script = (experimentSlug && PICO_EXPERIMENTS[experimentSlug]?.script) || ''`
    — a **constant lookup**, and the only reason the script is not editable.

  **An editable Python editor is a UI change, not an engine change.** Replace that constant
  lookup with editor state, and replace the read-only `<pre>` at line 1054 with a real
  editor. The engine already handles everything else.

  **[observed, source]**

---

## 5. Prioritised gap list

Ordered by value, most valuable first. Sizes are rough: **S** ≈ ≤1 day, **M** ≈ 2–4 days,
**L** ≈ 1–2 weeks, **XL** ≈ a month or more.

### 1. Editable MicroPython editor for the Pico track — **M**
The single highest value-per-unit-effort item in this audit, because the engine work is
already done. Add a code panel (docked right, mirroring Tinkercad's placement), put a text
editor in it, feed it into the existing `script` prop, and let the existing reboot-on-change
path do the rest. Bind the source to the placed Pico part so it saves with the document.
Ship it with the serial console we already have as the "Serial Monitor". Gets us to genuine
"write code and run it" on one of our two tracks **without a compiler**.

### 2. Free-entry values with unit selectors — **S–M**
Adopt Tinkercad's `VALUE_AND_UNIT`. Add a `type:'value_unit'` prop kind with a numeric text
input plus an SI-prefix dropdown, and switch `resistor.ohms` and `capacitor.microfarads` to
it. This is the owner's named example and it is cheap. Keep the current dropdown as a
"common values" affordance if you like, but the typed field is the fix. Note `type:'number'`
is already declared in `PartDefinition` and unimplemented in `PropControl` — that is the
natural hook.

### 3. LED colour as a per-instance prop — **S**
We currently cannot change an LED's colour at all: it is `electrical: { kind:'led', color:'red' }`,
a library constant. Tinkercad offers six colours from a dropdown. Add a `color` prop, thread
it through to the SVG and to `ledBrightness` rendering. Small, visible, and it is the second
thing anyone tries after resistance.

### 4. On-canvas interaction for pot, LDR and pushbutton — **M**
This is a difference *in kind*, not in degree, and the owner has already flagged it. Tinkercad
has **no slider in its inspector at all**; the pot knob is dragged, the button is pressed.
Make the potentiometer knob draggable, make the pushbutton respond to press-and-hold on the
canvas (which also fixes the fact that a checkbox cannot express a momentary press), and give
the LDR a canvas handle. Keep the sliders as an accessible alternative — do not remove them.

### 5. Editable Arduino C++ — **XL, and blocked**
Free-text Arduino editing cannot run today: no avr-gcc in the browser, only three pre-built
`.hex` fixtures. Options, none cheap: (a) a server-side compile service, (b) a WASM avr-gcc,
(c) sidestep it with a blocks→AVR path. **Do not attempt this before item 1.** An honest
interim is to keep the `.hex` picker and *show* the corresponding sketch read-only next to it
— which is exactly Tinkercad's `Blocks + Text` shape and costs almost nothing.

### 6. Instruments and power sources — **L**
We have no battery, no power supply, no multimeter, no oscilloscope. Tinkercad has all four.
A multimeter over our existing DC solver is genuinely reachable (we already solve node
voltages); an oscilloscope needs the transient work. A plain battery part is **S** and would
let students build circuits with no MCU at all.

### 7. Blocks editor — **XL**
Tinkercad's default and the on-ramp for beginners. Very large, and it competes directly with
item 1 for the same panel. Recommend deferring until the text editor has shipped and been
used.

### 8. Servo — **M**
The most conspicuous single missing component: it is in Tinkercad's Basic palette, it is in
their block vocabulary (`rotate servo on pin [0] to (0) degrees`), and Wokwi art for it is
**already harvested** in `wokwi-art.generated.json` (the comment at `parts.ts:296` lists
`servo` among the available elements). Cheap art, real behavioural model.

### 9. Minor consistency fix — resistor default vs displayed value — **S**
`compile.ts:282` reads `part.props.ohms ?? el.defaultOhms` → **220 Ω**. `PropControl` shows
`props[key] ?? prop.default ?? prop.options[0] ?? 0` → and `resistor.ohms` declares **no
`default`**, so `options[0]` = **0**, rendered "none (wire)". The palette works around this by
explicitly seeding `props.ohms = defaultOhms` (`CircuitEditor.tsx:159`, with a comment
acknowledging the trap), so a palette-dropped resistor is fine. But **a resistor arriving from
a saved document, an authored starter or `loadInto` without an explicit `ohms` prop will
display "none (wire)" while simulating at 220 Ω.** Declaring `default: 220` on the prop closes
it. **[observed, source]**

---

## 6. Direct answers to the six questions asked

1. **Resistor** — **free-entry text input plus a unit `<select>`**, options
   `pΩ nΩ μΩ mΩ Ω kΩ MΩ GΩ`. Not a fixed dropdown. The instance in the owner's design read
   `1` + `kΩ`. **[observed]** The default for a *newly dragged* resistor was **not observed**
   (I could not add components — see §0); Tinkercad's documented default is 1 kΩ and the
   observed instance is consistent with that, but I did not verify it. **[inferred]**
2. **LED** — colour **is** selectable, from a fixed 6-entry dropdown: Green, Yellow, Orange,
   Blue, Red, White. Plus a `Name` field. Nothing else. **[observed]**
3. **Potentiometer / photoresistor / sensors** — **not observed** (§0). What I can state as
   fact is structural: Tinkercad's inspector enum contains **no slider type**, so these are
   not panel sliders; they are canvas interactions and/or `VALUE_AND_UNIT` fields. **[observed]**
4. **Board / code** — see §4 in full. Summary: `Code` button → **docked right-hand panel**
   (not a modal); **`EDIT MODE` = Blocks / Blocks + Text / Text**; code bound to a specific
   MCU via a **board selector dropdown keyed on the board's `Name`**; **CodeMirror**
   (`text/x-c++src`) for text, **read-only in Blocks + Text**; **Serial Monitor** as a
   collapsible drawer at the panel's bottom-left; **`Start Simulation` in the top toolbar is
   shared** between circuit and code. The board's own inspector has **only a `Name` field** —
   no electrical properties at all. **[observed]**
5. **On-canvas adjustment** — Tinkercad's inspector has no slider type, which is strong
   structural evidence that continuous values are canvas-driven. I could **not** directly
   observe a knob drag. **[inferred]** Our pot knob being inert is a real gap either way.
6. **Units, precision, validation** — units are handled by an **SI-prefix dropdown beside a
   free-text field**, so precision is the user's choice rather than a fixed step. The text
   inputs carry **no HTML `min`/`max`/`step`** (I read the attributes: all empty), so any
   validation is in JavaScript. **I did not test clamping or rejection of bad input**, because
   doing so would have meant typing into the owner's component. **[observed for the
   attributes; validation behaviour not observed]**

---

## 7. Everything I could not observe, stated plainly

- Inspector fields for **potentiometer, photoresistor, capacitor, DC motor, pushbutton,
  micro:bit**, and every other component not already present in the owner's design. Cause:
  the tab was backgrounded by the owner's own browsing, which throttled Tinkercad's
  rAF-driven loader and broke drag-and-drop from the palette. No component was ever added.
- Whether the **`Text` edit mode** makes the CodeMirror editable. Not tested on purpose —
  switching to `Text` discards the block program, and this is the owner's design.
- **Where Arduino C++ is compiled** (server vs client). Not verified.
- **Serial Monitor** contents, behaviour and the serial **plotter** UI while running.
- **On-canvas knob dragging** of a potentiometer during simulation.
- **Validation / clamping** of the resistance field — no bad input was typed.
- The **default resistance of a freshly-dragged resistor**.
- Anything requiring the simulation to actually run — I never pressed `Start Simulation`.
