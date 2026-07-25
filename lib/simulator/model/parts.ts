/**
 * Part library.
 *
 * Parts are DATA, not code: geometry, pin positions and SVG markup are all
 * declarative. That is what makes SIMULATOR_ARCHITECTURE.md §7.1's promise
 * ("new analog parts are a JSON file") reachable later without a refactor —
 * this registry is already the shape such a loader would produce.
 *
 * Coordinates use 10 units per 0.1 inch, the breadboard pitch. Everything snaps
 * to that grid.
 */

import { MEGA_RENAME, UNO_RENAME, wokwiGeometry } from './wokwi'

export const PITCH = 10

export type PinType = 'power' | 'gnd' | 'digital' | 'analog' | 'passive'

/**
 * Every MCU board the simulator can run.
 *
 * A closed union rather than a plugin registry, deliberately: the TRACKS run
 * different emulators (`avr8js` vs `rp2040js`) and different toolchains (a
 * precompiled .hex vs MicroPython typed into a REPL), so adding a track is a
 * real piece of work and not a data row. See model/boards.ts for the per-board
 * profile the engine selection reads.
 *
 * The Mega is the case that shows where the line actually falls. It shares the
 * Uno's track — same emulator, same instruction decoder, same PinBridge — so it
 * needed no new worker and no new firmware pipeline; what it needed was an
 * ATmega2560 peripheral map, because every interrupt vector avr8js ships is an
 * ATmega328P's. That map is data (lib/simulator/avr/atmega2560.ts), which is
 * why this union grew by one entry instead of the engine growing a plugin API.
 */
export type BoardType = 'arduino_uno' | 'arduino_mega' | 'raspberry_pi_pico'

export interface PinGeometry {
  id: string
  name: string
  x: number
  y: number
  type: PinType
  /** Hidden pins (breadboard tie points) render only on hover. */
  subtle?: boolean
}

export interface PartDefinition {
  type: string
  label: string
  /** Bounding box in grid units. */
  width: number
  height: number
  pins: PinGeometry[]
  /** Pin ids that are internally connected (breadboard strips, ganged pins). */
  buses?: string[][]
  /** Inner SVG markup, drawn in part-local coordinates. */
  svg: string
  /** Electrical role, consumed by the netlist → circuit compiler. */
  electrical:
    /**
     * A microcontroller board.
     *
     * `logicVolts` is the I/O rail — what a pin driving HIGH actually puts on
     * the wire — and it is DATA on the board rather than a constant in the
     * compiler because the two boards do not share it: an Uno drives 5 V, a
     * Pico drives 3.3 V and is not 5 V tolerant. compile() used to hardcode 5,
     * which overstated a shorted Pico pad by 52%.
     */
    | { kind: 'mcu'; board: BoardType; logicVolts: number }
    | { kind: 'breadboard' }
    | { kind: 'resistor'; defaultOhms: number }
    | { kind: 'led'; color: string }
    | { kind: 'button' }
    | { kind: 'potentiometer'; totalOhms: number }
    /** A resistance the student varies with a slider — LDR, thermistor. */
    | { kind: 'variable_resistor'; minOhms: number; maxOhms: number }
    /**
     * NOTE: there is no `load` kind any more.
     *
     * `{kind:'load'; ohms; label}` used to sit here — "modelled by its coil/
     * driver resistance; activity is reported, not solved" — and was how the
     * buzzer and the motor were first stamped. Both have had real device models
     * for a long time (Buzzer has two electrically different modes, DCMotor is
     * built from four datasheet numbers), and by the time this was removed NO
     * part in PART_LIBRARY used the variant at all, while compile() still
     * carried a live branch for it. Dead code shaped like a supported feature is
     * worse than no feature: the next part that wanted "just a resistance" would
     * have reached for it and got a model that reports nothing.
     */
    | { kind: 'diode' }
    /**
     * Electro-acoustic transducer. Two very different parts share the name: an
     * ACTIVE buzzer is a resistive load with its own oscillator, a PASSIVE one is
     * a piezo element (a capacitor) that only sounds when the drive changes. The
     * `passive` prop picks which, and the model differs electrically.
     */
    | { kind: 'buzzer' }
    /**
     * Brushed DC motor. Solved at its electrical/mechanical steady state from
     * four datasheet numbers — see MotorParams in devices.ts.
     */
    | { kind: 'motor' }
    /**
     * Talks a wire protocol or drives its own output; needs a behavioural model
     * (§7.1 tier 2). `drives` names the pins the part itself can drive, which is
     * what tells the compiler where to put a Norton port.
     */
    | {
        kind: 'sensor'
        protocol: 'dht11' | 'hc_sr04' | 'pir' | 'flow' | 'ds18b20' | 'pulse' | 'mcp3008'
        drives: string[]
      }
    /**
     * A bank of opto-isolated relay channels. Each one is an opto-coupler LED
     * behind a series resistor, a coil with its flyback diode, and an SPDT
     * contact — see RelayModuleParams in devices.ts, and note that these boards
     * are ACTIVE LOW, which the `activeLow` prop can change because high-trigger
     * variants exist.
     */
    | { kind: 'relay_module'; channels: number }
    /**
     * A bank of open-collector Darlington sinks (a ULN2003). Each channel is a
     * logic input and an output that either pulls DOWN or is not there at all —
     * see DarlingtonSink in devices.ts for why "not there at all" is the
     * load-bearing half of open-collector.
     */
    | { kind: 'darlington_array' }
    /**
     * A dual full-bridge motor driver (an L298N). Two transistors are in series
     * with the load at all times, so the bridge eats ~2.5 V of the supply; that
     * drop IS the lesson and the model keeps it (HBridgeParams in devices.ts).
     */
    | { kind: 'h_bridge' }
    /**
     * A unipolar stepper: four windings from a common tap. Electrically that is
     * all it is — the shaft position is a property of the energisation SEQUENCE
     * in time, which a DC operating point cannot hold, so it is reported by the
     * behavioural StepperMonitor exactly as a buzzer's pitch is.
     */
    | { kind: 'stepper' }
    /**
     * Capacitor or inductor. The interactive engine is DC-only, so these are
     * solved at their DC limit — a cap is open, an inductor is a wire. That is
     * the correct steady state, but charge and discharge need transient
     * simulation, which does not exist yet. The compiler says so out loud
     * rather than letting the part sit there doing nothing (§2.3).
     */
    | { kind: 'reactive'; element: 'capacitor' | 'inductor' }
    | { kind: 'passive' }
  /** Editable properties surfaced in the inspector. */
  props?: PropSpec[]
  /**
   * A control the student operates on the ARTWORK rather than in the panel.
   *
   * Tinkercad's inspector has no slider in it at all — its control vocabulary is
   * TEXT / READ_ONLY / VALUE_AND_UNIT / VALUE_UNIT_CHECK / VALUE_AND_FIXEDUNIT /
   * CHECKBOX / SELECTBOX / BUTTON — because a continuously variable physical
   * thing is turned where it lives (DEVICE_CONTROLS_AUDIT.md §2). A knob that
   * cannot be turned reads as broken, and one QA tester reported exactly that.
   *
   * The panel control is NOT replaced by this. A pointer drag is unavailable to
   * a keyboard user and awkward on a phone, so the declared `range` prop keeps
   * its slider and the two drive the same document value.
   */
  knob?: KnobControl
  /**
   * A linear control on the artwork, for a value that has no shaft to turn.
   *
   * A photoresistor is the case that forced this. Its value is an illumination,
   * and there is nothing on the part to rotate — but "adjust it where it lives"
   * is the whole point of §2's finding, so the affordance is a track and a
   * handle rather than a knob. Same contract as `knob`: the declared `range`
   * prop keeps its panel slider, and the two write the same document value.
   */
  slider?: SliderControl
  /**
   * A control that is only in its "on" state WHILE it is held.
   *
   * A push button is a momentary switch and a checkbox cannot express one: it
   * has no press and no release, only a state that stays where it was put.
   * DEVICE_CONTROLS_AUDIT.md §3 called that out as an interaction gap rather
   * than a missing field, and it is — a student debouncing a button, or reading
   * one inside a loop, needs to press and let go.
   *
   * The panel checkbox stays, and stays useful: press-and-hold is unavailable
   * to anyone who cannot hold a pointer down, and a latched state is the only
   * way to leave a button pressed while looking at something else.
   */
  momentary?: MomentaryControl
}

/**
 * One editable property of a placed part.
 *
 * Four shapes, and the inspector picks its control from the shape rather than
 * from the part — a part that ships tomorrow gets a working inspector for free:
 *
 *   `range`   slider (or a checkbox when min/max/step are 0/1/1)
 *   `select`  <select> over a fixed list of numbers
 *   `number`  free numeric entry + an SI unit dropdown — Tinkercad's
 *             VALUE_AND_UNIT, the control a resistor actually wants
 *   `choice`  <select> over a fixed list of STRINGS (an LED's colour)
 */
export type PropSpec = {
  key: string
  label: string
  type: 'number' | 'select' | 'range' | 'choice'
  /** `select` only: the numbers offered. */
  options?: number[]
  /** `choice` only: the strings offered, with the label each one shows. */
  choices?: ReadonlyArray<{ value: string; label: string }>
  /**
   * `number` only: the SI unit dropdown beside the field.
   *
   * `mul` is what the TYPED figure is multiplied by to get the STORED value, so
   * the stored unit is whichever entry has `mul: 1`. That indirection is the
   * whole point: `capacitor.microfarads` is stored in µF because compile.ts
   * reads it in µF, and a student who types `470` and picks `nF` must end up
   * with 0.47 in the document rather than 470.
   */
  units?: ReadonlyArray<{ label: string; mul: number }>
  /** Unit suffix shown beside a `range` readout, and the base symbol elsewhere. */
  unit?: string
  min?: number
  max?: number
  step?: number
  /** One line under the control. Where an affordance needs saying out loud. */
  hint?: string
  /**
   * The value the part has when the document carries none for this key.
   *
   * NOT decoration, and not optional in practice — see
   * propDeclarationProblems() at the foot of this file. It has to equal whatever
   * the ENGINE falls back to for the same missing prop, because the inspector
   * reads this and the simulation reads that: `resistor.ohms` declared no
   * default for months, so the inspector fell through to `options[0]` — 0 Ω,
   * "none (wire)" — over a resistor compile.ts was solving at 220 Ω. The panel
   * and the physics disagreed and nothing said so.
   */
  default?: number | string
}

/**
 * A rotary control drawn on a part's artwork.
 *
 * Angles are degrees clockwise from twelve o'clock, which is how the harvested
 * potentiometer art is drawn (`#rotating` is a tick at x=10,y=2 above a
 * transform-origin of 10,8 — i.e. pointing straight up at 0°).
 */
export interface KnobControl {
  /** The `range` prop this drives. Must be declared in `props`. */
  key: string
  /** Grab target, in part-local units. */
  cx: number
  cy: number
  r: number
  /** Angle at the prop's `min`, degrees clockwise from twelve o'clock. */
  fromDeg: number
  /** Angle at the prop's `max`. */
  toDeg: number
  /**
   * CSS custom property the artwork's own rotation reads, if it has one.
   *
   * The wokwi potentiometer ships `transform: rotate(var(--knob-angle, 0deg))`
   * on its indicator, so setting this one variable on the instance's group
   * turns the real tick rather than drawing a second one over it.
   */
  angleVar?: string
}

/**
 * A straight-line control drawn on a part's artwork.
 *
 * The track runs from (x1, y1) at the prop's `min` to (x2, y2) at its `max`, in
 * part-local units, so the direction of travel is a property of the declaration
 * rather than a convention the canvas has to remember. The photoresistor's runs
 * left-to-right above the cell; a part that wanted a vertical one would only
 * have to say so.
 */
export interface SliderControl {
  /** The `range` prop this drives. Must be declared in `props`. */
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** Handle radius, in part-local units. Also the grab target. */
  r: number
}

/**
 * A press-and-hold control drawn on a part's artwork.
 *
 * Writes `1` on pointer-down and `0` on pointer-up. There is no "value" beyond
 * that, which is exactly what makes a momentary switch different from a toggle.
 */
export interface MomentaryControl {
  /** The 0/1 `range` prop this drives. Must be declared in `props`. */
  key: string
  cx: number
  cy: number
  r: number
  /**
   * CSS custom property the artwork's own pressed styling reads, if it has one.
   *
   * The harvested pushbutton ships a `.button-active-circle` that a real
   * `button:active` would reveal. There is no `<button>` here — the markup is
   * injected — so the rule is rewritten to read a variable and the canvas sets
   * it, which turns wokwi's own pressed artwork on instead of drawing a second
   * indicator over it.
   */
  pressedVar?: string
}

/**
 * The resistance a resistor has when its document carries no `ohms`.
 *
 * ONE constant feeding BOTH readers — `electrical.defaultOhms`, which compile.ts
 * resolves at `part.props.ohms ?? el.defaultOhms`, and the prop's `default`,
 * which the inspector shows. They cannot drift apart because there is only one
 * of them.
 */
export const RESISTOR_DEFAULT_OHMS = 220

/**
 * The SI ladder Tinkercad offers beside a resistance field, verbatim:
 * `pΩ nΩ μΩ mΩ Ω kΩ MΩ GΩ` (DEVICE_CONTROLS_AUDIT.md §6.1, observed).
 *
 * `mul` is relative to the STORED unit, and `ohms` is stored in ohms, so `Ω`
 * is the entry with `mul: 1`.
 */
export const OHM_UNITS: ReadonlyArray<{ label: string; mul: number }> = [
  { label: 'pΩ', mul: 1e-12 },
  { label: 'nΩ', mul: 1e-9 },
  { label: 'μΩ', mul: 1e-6 },
  { label: 'mΩ', mul: 1e-3 },
  { label: 'Ω', mul: 1 },
  { label: 'kΩ', mul: 1e3 },
  { label: 'MΩ', mul: 1e6 },
  { label: 'GΩ', mul: 1e9 },
]

/**
 * The same ladder for capacitance — but note what `mul: 1` is on.
 *
 * compile.ts reads `Number(part.props.microfarads ?? 1)` and hands the result to
 * `new Capacitor(..., microfarads * 1e-6)`, so the DOCUMENT stores microfarads
 * and µF is the unit with `mul: 1`. Typing `470` and picking `nF` therefore has
 * to store 0.47, not 470 — which is exactly the sort of factor-of-a-thousand
 * error a fixed µF dropdown made impossible and a free field makes easy.
 */
export const FARAD_UNITS: ReadonlyArray<{ label: string; mul: number }> = [
  { label: 'pF', mul: 1e-6 },
  { label: 'nF', mul: 1e-3 },
  { label: 'μF', mul: 1 },
  { label: 'mF', mul: 1e3 },
  { label: 'F', mul: 1e6 },
]

/**
 * The same ladder for inductance, and again note what `mul: 1` sits on.
 *
 * compile.ts reads `Number(part.props.millihenries ?? 1)` and hands the result
 * to `new Inductor(..., millihenries * 1e-3)`, so the DOCUMENT stores
 * millihenries and mH is the unit with `mul: 1`. A 100 µH choke — the commonest
 * value in a buck converter or an RF filter — therefore stores 0.1.
 */
export const HENRY_UNITS: ReadonlyArray<{ label: string; mul: number }> = [
  { label: 'nH', mul: 1e-6 },
  { label: 'μH', mul: 1e-3 },
  { label: 'mH', mul: 1 },
  { label: 'H', mul: 1e3 },
]

/**
 * Ceiling on a typed resistance, ohms.
 *
 * Not a physical limit — it is the top of the offered ladder (999 GΩ is under
 * 1e12) and a guard against a paste of nonsense reaching the solver. The FLOOR
 * is 0, which is a legitimate value: `Resistor.stamp` clamps 0 Ω up to
 * MIN_RESISTANCE and the part behaves as the piece of wire it is drawn as.
 * Negative and non-finite are what `Resistor.stamp` THROWS on, so the field
 * rejects them before a student can reach that.
 */
export const RESISTOR_MAX_OHMS = 1e12

/** Ceiling on a typed capacitance, microfarads — 1 farad, the top of the ladder. */
export const CAPACITOR_MAX_UF = 1e6

/**
 * Floor on a typed capacitance, microfarads — 1 femtofarad.
 *
 * Zero is excluded on purpose, and it is the one place capacitance and
 * resistance differ: a 0 Ω resistor is a wire, but a 0 F capacitor is not a
 * component at all. `Capacitor.geq()` would stamp `0/h = 0 S` in transient — a
 * floating node, i.e. a singular matrix — where a 1 fF cap is merely a very
 * good open.
 */
export const CAPACITOR_MIN_UF = 1e-9

/**
 * The inductance an inductor has when its document carries no `millihenries`.
 *
 * 1 mH because that is compile.ts's own fallback
 * (`Number(part.props.millihenries ?? 1)`), and the prop's `default` has to be
 * the same number or the panel and the physics disagree — the resistor's trap,
 * one part along.
 */
export const INDUCTOR_DEFAULT_MH = 1

/** Ceiling on a typed inductance, millihenries — 1000 H, the top of the ladder. */
export const INDUCTOR_MAX_MH = 1e6

/**
 * Floor on a typed inductance, millihenries — 1 nH, the bottom of the ladder.
 *
 * Zero is excluded for the mirror of the capacitor's reason. `Inductor.geq()`
 * stamps `h/L`, so a 0 H inductor is a division by zero — an infinite
 * conductance, i.e. a short with no branch equation — where a 1 nH inductor is
 * merely a very good wire.
 */
export const INDUCTOR_MIN_MH = 1e-6

/**
 * Track resistance of the potentiometer a starter kit ships.
 *
 * 10 kΩ linear, the value on a Bourns 3386P-1-103 trimmer and on the ALPS RK09
 * panel pot that every "Arduino starter kit" contains — `103` is 10 × 10³ Ω.
 *
 * ONE constant feeding BOTH readers, exactly as RESISTOR_DEFAULT_OHMS does:
 * `electrical.totalOhms`, which compile.ts resolves at
 * `part.props.totalOhms ?? el.totalOhms`, and the prop's `default`, which the
 * inspector shows.
 */
export const POT_DEFAULT_OHMS = 10000

/**
 * The smallest resistance either leg of a pot may present, ohms.
 *
 * Never exactly zero: a 0 Ω leg would be a dead short from the wiper to a rail,
 * and the wiper of a real pot always has some track resistance either side of
 * it — the contact resistance alone is of this order.
 */
export const POT_MIN_LEG_OHMS = 0.5

/**
 * The two halves of a pot's track at a given wiper position, ohms.
 *
 * `lower` is pin 1 → wiper, `upper` is wiper → pin 3, so at 0 % the wiper sits
 * on pin 1. Shared by compile.ts, which stamps them, and by the device readout,
 * which reports them: two copies of this arithmetic would be two chances for
 * the panel to describe a divider the solver is not solving.
 */
export function potentiometerLegs(
  totalOhms: number,
  position: number,
): { lower: number; upper: number } {
  const pos = Math.min(100, Math.max(0, Number.isFinite(position) ? position : 50)) / 100
  const total = Number.isFinite(totalOhms) && totalOhms > 0 ? totalOhms : POT_DEFAULT_OHMS
  return {
    lower: Math.max(total * pos, POT_MIN_LEG_OHMS),
    upper: Math.max(total * (1 - pos), POT_MIN_LEG_OHMS),
  }
}

/**
 * The resistance a light-dependent resistor presents at a given light level.
 *
 * GEOMETRIC, not linear, in the illumination: an LDR's resistance falls roughly
 * as a power law in lux (the datasheet "gamma" of a GL55-series cell is ~0.6
 * per decade), so a linear interpolation between the light and dark figures
 * makes the whole middle of the range behave nothing like a real cell — it
 * would sit near the dark value for the first 90 % of the slider and then
 * collapse.
 *
 * Shared by compile.ts and the device readout for the same reason
 * potentiometerLegs() is.
 */
export function variableResistorOhms(
  minOhms: number,
  maxOhms: number,
  light: number,
): number {
  const t = Math.min(100, Math.max(0, Number.isFinite(light) ? light : 60)) / 100
  return minOhms * Math.pow(maxOhms / minOhms, 1 - t)
}

// ─── Breadboard ───────────────────────────────────────────────────────────────

const BB_COLS = 30

/**
 * Half-size breadboard. Generated rather than hand-written: 30 columns of two
 * 5-hole banks plus four power rails, with each strip declared as a bus so the
 * netlist extractor treats the board as an ordinary part (§3).
 */
function makeBreadboard(): PartDefinition {
  const pins: PinGeometry[] = []
  const buses: string[][] = []
  const rowY: Record<string, number> = {
    j: 30, i: 40, h: 50, g: 60, f: 70,
    e: 90, d: 100, c: 110, b: 120, a: 130,
  }

  for (let c = 1; c <= BB_COLS; c++) {
    const x = 15 + (c - 1) * PITCH
    for (const [row, y] of Object.entries(rowY)) {
      pins.push({ id: `${row}${c}`, name: `${row.toUpperCase()}${c}`, x, y, type: 'passive', subtle: true })
    }
    buses.push(['a', 'b', 'c', 'd', 'e'].map((r) => `${r}${c}`))
    buses.push(['f', 'g', 'h', 'i', 'j'].map((r) => `${r}${c}`))
  }

  // Power rails run the length of the board, offset half a pitch like the real thing.
  const rails: Array<[string, number]> = [['tp', 5], ['tn', 15], ['bp', 150], ['bn', 160]]
  for (const [rail, y] of rails) {
    const strip: string[] = []
    for (let c = 1; c <= BB_COLS; c++) {
      const x = 20 + (c - 1) * PITCH
      const id = `${rail}${c}`
      pins.push({ id, name: id.toUpperCase(), x, y, type: 'passive', subtle: true })
      strip.push(id)
    }
    buses.push(strip)
  }

  const holes = pins
    .map((p) => `<rect x="${p.x - 2}" y="${p.y - 2}" width="4" height="4" rx="1" fill="#c9c9c9"/>`)
    .join('')

  return {
    type: 'breadboard',
    label: 'Breadboard',
    width: 15 + BB_COLS * PITCH + 10,
    height: 170,
    pins,
    buses,
    electrical: { kind: 'breadboard' },
    svg: `
      <rect x="0" y="0" width="${15 + BB_COLS * PITCH + 10}" height="170" rx="4" fill="#f4f2ef" stroke="#d6d2cc"/>
      <line x1="0" y1="10" x2="${15 + BB_COLS * PITCH + 10}" y2="10" stroke="#e04a4a" stroke-width="0.8"/>
      <line x1="0" y1="20" x2="${15 + BB_COLS * PITCH + 10}" y2="20" stroke="#3b6fd4" stroke-width="0.8"/>
      <line x1="0" y1="145" x2="${15 + BB_COLS * PITCH + 10}" y2="145" stroke="#e04a4a" stroke-width="0.8"/>
      <line x1="0" y1="155" x2="${15 + BB_COLS * PITCH + 10}" y2="155" stroke="#3b6fd4" stroke-width="0.8"/>
      <rect x="0" y="76" width="${15 + BB_COLS * PITCH + 10}" height="8" fill="#e8e5e0"/>
      ${holes}
    `,
  }
}

// ─── Arduino Mega 2560 ────────────────────────────────────────────────────────

/**
 * Arduino Mega 2560 Rev3.
 *
 * Same track as the Uno — avr8js running a compiled .hex — and the same 5 V
 * logic rail, so nothing downstream of `logicVolts` moves. What moves is inside
 * the chip: 54 digital pins across eleven ports instead of 20 across three, 16
 * ADC channels instead of 6, and a completely different interrupt vector table.
 * See lib/simulator/avr/atmega2560.ts.
 *
 * PINS OMITTED, and why: SCL and SDA on the top header are the same silicon as
 * D21 and D20, exactly as the Uno's A5.2/A4.2 duplicate A5/A4. Exposing them
 * would let a student wire to "another pin" that is electrically identical, and
 * would give that wire a net the sketch's digitalWrite(21, …) also drives.
 *
 * PINS BUSSED: every GND pad is one piece of copper, and so are the three 5 V
 * pads — `5V` on the bottom power header plus `5V.1`/`5V.2` at the top of the
 * right-hand double row. Bussing the 5 V pads costs one node and one branch row
 * even in a circuit that never touches the rail (compile() treats a net with two
 * or more component pins as live), which is a real price; the alternative is a
 * student wiring to 5V.1 and getting no supply at all, from a hole that is
 * bolted to the same trace on the board in front of them.
 */
function makeMega(): PartDefinition {
  return {
    type: 'arduino_mega',
    label: 'Arduino Mega 2560',
    electrical: { kind: 'mcu', board: 'arduino_mega', logicVolts: 5 },
    buses: [
      ['GND.1', 'GND.2', 'GND.3', 'GND.4', 'GND.5'],
      ['5V', '5V.1', '5V.2'],
    ],
    ...wokwiGeometry('arduino-mega', {
      rename: MEGA_RENAME,
      omit: ['SCL', 'SDA'],
      subtle: ['AREF', 'IOREF', 'RESET', 'VIN'],
    }),
  }
}

// ─── Arduino Uno ──────────────────────────────────────────────────────────────

function makeUno(): PartDefinition {
  return {
    type: 'arduino_uno',
    label: 'Arduino Uno',
    electrical: { kind: 'mcu', board: 'arduino_uno', logicVolts: 5 },
    // All GND pins are the same net on the real board.
    buses: [['GND.1', 'GND.2', 'GND.3']],
    ...wokwiGeometry('arduino-uno', {
      rename: UNO_RENAME,
      // A5.2/A4.2 are the SCL/SDA duplicates on the top header. They are the
      // same silicon pins as A4/A5, so exposing them as separate ids would let
      // a student wire to "a different pin" that is electrically identical.
      omit: ['A5.2', 'A4.2'],
      subtle: ['AREF', 'IOREF', 'RESET'],
    }),
  }
}

// ─── Raspberry Pi Pico ────────────────────────────────────────────────────────

/**
 * The single most important difference from the Uno is the rail: a Pico's GPIO
 * run at 3.3 V and are NOT 5 V tolerant. Every downstream number moves — an LED
 * through 220 Ω draws about 5.2 mA here against 12.4 mA on an Uno, because the
 * LED's ~2 V forward drop eats a far larger share of a 3.3 V budget. That is
 * why `logicVolts` is on the part and not a constant in compile().
 *
 * The header is the physical 40-pin layout in silkscreen order, so a student
 * counting pins on a photo of a real Pico finds the same thing here. GP23/GP24/
 * GP25 exist on the die but are NOT brought out to a Pico's header, so they are
 * absent — GP25 is the on-board LED, which pico/engine.ts reports separately
 * rather than pretending it is wireable.
 *
 * HAND-DRAWN ON PURPOSE. @wokwi/elements ships no Pico element (the harvested
 * set in wokwi-art.generated.json is resistor, led, pushbutton, potentiometer,
 * buzzer, photoresistor, ntc, hc-sr04, pir, dht22, servo, 7segment, rgb-led,
 * slide-switch, stepper-motor, led-bar-graph, tilt-switch, arduino-uno), and
 * reusing the Uno's art would put a student's wire on a pin that does not
 * exist.
 */
const PICO_W = 90
const PICO_H = 220
const PICO_LEFT_X = 10
const PICO_RIGHT_X = 80
const PICO_TOP_Y = 15

type PicoHeaderEntry = [id: string, name: string, type: PinType]

/** Physical header positions 1 → 20, top to bottom on the left edge. */
const PICO_LEFT_HEADER: PicoHeaderEntry[] = [
  ['GP0', 'GP0', 'digital'],
  ['GP1', 'GP1', 'digital'],
  ['GND.1', 'GND', 'gnd'],
  ['GP2', 'GP2', 'digital'],
  ['GP3', 'GP3', 'digital'],
  ['GP4', 'GP4', 'digital'],
  ['GP5', 'GP5', 'digital'],
  ['GND.2', 'GND', 'gnd'],
  ['GP6', 'GP6', 'digital'],
  ['GP7', 'GP7', 'digital'],
  ['GP8', 'GP8', 'digital'],
  ['GP9', 'GP9', 'digital'],
  ['GND.3', 'GND', 'gnd'],
  ['GP10', 'GP10', 'digital'],
  ['GP11', 'GP11', 'digital'],
  ['GP12', 'GP12', 'digital'],
  ['GP13', 'GP13', 'digital'],
  ['GND.4', 'GND', 'gnd'],
  ['GP14', 'GP14', 'digital'],
  ['GP15', 'GP15', 'digital'],
]

/**
 * Physical header positions 21 → 40, i.e. BOTTOM to TOP on the right edge —
 * the direction a real Pico is numbered.
 *
 * `3.3V` and `5V` are deliberately named for the VOLTAGE and not the silkscreen
 * (`3V3(OUT)` and `VBUS`), because compile() keys its rail stamping off exactly
 * those two pin ids. The human-facing `name` keeps the real label.
 */
const PICO_RIGHT_HEADER: PicoHeaderEntry[] = [
  ['GP16', 'GP16', 'digital'],
  ['GP17', 'GP17', 'digital'],
  ['GND.5', 'GND', 'gnd'],
  ['GP18', 'GP18', 'digital'],
  ['GP19', 'GP19', 'digital'],
  ['GP20', 'GP20', 'digital'],
  ['GP21', 'GP21', 'digital'],
  ['GND.6', 'GND', 'gnd'],
  ['GP22', 'GP22', 'digital'],
  ['RUN', 'RUN', 'passive'],
  ['GP26', 'GP26/A0', 'analog'],
  ['GP27', 'GP27/A1', 'analog'],
  ['AGND', 'AGND', 'gnd'],
  ['GP28', 'GP28/A2', 'analog'],
  ['ADC_VREF', 'ADC_VREF', 'passive'],
  ['3.3V', '3V3(OUT)', 'power'],
  ['3V3_EN', '3V3_EN', 'passive'],
  ['GND.7', 'GND', 'gnd'],
  ['VSYS', 'VSYS', 'passive'],
  ['5V', 'VBUS', 'power'],
]

function makePico(): PartDefinition {
  const pins: PinGeometry[] = []
  PICO_LEFT_HEADER.forEach(([id, name, type], i) => {
    pins.push({ id, name, x: PICO_LEFT_X, y: PICO_TOP_Y + i * PITCH, type })
  })
  // Pin 21 sits at the BOTTOM right and the numbering walks upward to pin 40.
  PICO_RIGHT_HEADER.forEach(([id, name, type], i) => {
    pins.push({ id, name, x: PICO_RIGHT_X, y: PICO_TOP_Y + (19 - i) * PITCH, type })
  })

  const holes = pins
    .map(
      (p) =>
        `<rect x="${p.x - 3.5}" y="${p.y - 3.5}" width="7" height="7" rx="1.2" ` +
        `fill="#c9a227" stroke="#8a6d14" stroke-width="0.5"/>` +
        `<circle cx="${p.x}" cy="${p.y}" r="2" fill="#2b2b2b"/>`,
    )
    .join('')

  return {
    type: 'raspberry_pi_pico',
    label: 'Raspberry Pi Pico',
    width: PICO_W,
    height: PICO_H,
    pins,
    // Every GND pad is the same copper on the real board, AGND included — it is
    // joined to GND through a 0 Ω link, not isolated.
    buses: [['GND.1', 'GND.2', 'GND.3', 'GND.4', 'GND.5', 'GND.6', 'GND.7', 'AGND']],
    electrical: { kind: 'mcu', board: 'raspberry_pi_pico', logicVolts: 3.3 },
    svg: `
      <rect x="0" y="0" width="${PICO_W}" height="${PICO_H}" rx="8" fill="#0f5132" stroke="#0a3d26"/>
      <rect x="22" y="6" width="46" height="26" rx="2" fill="#1b1b1b"/>
      <text x="45" y="23" font-size="9" text-anchor="middle" fill="#d8d8d8" font-family="monospace">USB</text>
      <rect x="30" y="96" width="30" height="30" rx="3" fill="#1b1b1b" stroke="#000"/>
      <text x="45" y="108" font-size="7" text-anchor="middle" fill="#9ad" font-family="monospace">RP2</text>
      <text x="45" y="118" font-size="7" text-anchor="middle" fill="#9ad" font-family="monospace">040</text>
      <text x="45" y="200" font-size="7" text-anchor="middle" fill="#cfe8d8" font-family="monospace">Pico 3V3</text>
      ${holes}
    `,
  }
}

// ─── Discretes ────────────────────────────────────────────────────────────────

const resistor: PartDefinition = {
  type: 'resistor',
  label: 'Resistor',
  electrical: { kind: 'resistor', defaultOhms: RESISTOR_DEFAULT_OHMS },
  props: [
    {
      key: 'ohms',
      label: 'Resistance',
      // Free entry, not a ten-entry <select>. The old list could not express
      // 150 Ω or 3.3 kΩ — two of the most common values in a starter kit — and
      // a student who needs one of those has no way to say so.
      type: 'number',
      unit: 'Ω',
      units: OHM_UNITS,
      min: 0,
      max: RESISTOR_MAX_OHMS,
      // Kept, and now offered as SUGGESTIONS rather than as the whole vocabulary.
      // 0 Ω is in the list because it is the only way the "none (wire)"
      // affordance stays discoverable once the control is a text box.
      options: [0, 100, 220, 330, 470, 1000, 2200, 4700, 10000, 100000],
      hint: '0 Ω is a plain wire.',
      default: RESISTOR_DEFAULT_OHMS,
    },
  ],
  ...wokwiGeometry('resistor'),
}

// ─── LED colours ──────────────────────────────────────────────────────────────

/** Thermal voltage at 300 K, the same figure devices.ts solves with. */
const VT_300K = 0.025852

/**
 * Emission coefficient shared by every LED colour.
 *
 * One value across the set on purpose: `LED_RED`'s n = 1.8 was fitted against
 * ngspice reference numbers (devices.ts), and re-fitting n per colour would need
 * a second reference solve per colour that nobody has run. Holding n and moving
 * `is` reproduces the datasheet Vf at 20 mA exactly, and the slope either side
 * of it is then the same shape as red's — which is the honest limit of this
 * model and is stated in the UI.
 */
const LED_N = 1.8

/**
 * Shockley saturation current that puts `vfAt20mA` volts across the junction at
 * a forward current of 20 mA.
 *
 *   Vf = n·VT·ln(If/Is)  =>  Is = If·exp(−Vf/(n·VT))
 *
 * Derived rather than fitted, exactly as OPTO_LED is in devices.ts, so the
 * constants below cannot drift away from the datasheet figures beside them.
 */
export function ledSaturationCurrent(vfAt20mA: number): number {
  return 0.02 * Math.exp(-vfAt20mA / (LED_N * VT_300K))
}

export interface LedColour {
  value: string
  label: string
  /** The unlit epoxy dome. */
  body: string
  /** Emitted light as r,g,b — the lit dome and the glow around it. */
  emit: readonly [number, number, number]
  /** Typical forward voltage at IF = 20 mA, volts. Datasheet figure. */
  vfVolts: number
  /** Saturation current, amps. See ledSaturationCurrent(). */
  is: number
  /** Emission coefficient. */
  n: number
}

/**
 * The six colours Tinkercad's LED inspector offers, with REAL forward voltages.
 *
 * Vf is typical at IF = 20 mA for 5 mm T-1¾ lamps of the Kingbright WP7113
 * family, which is the part every Arduino starter kit actually ships:
 *
 *   red     WP7113ID    AlGaInP   2.0 V     amber/orange WP7113SEC AlGaInP 2.0 V
 *   yellow  WP7113YD    GaAsP/GaP 2.1 V     green        WP7113PGC InGaN   3.2 V
 *   blue    WP7113QBC   InGaN     3.2 V     white        WP7113QWC InGaN   3.2 V
 *
 * THIS IS NOT COSMETIC. A blue LED needs 3.2 V of the supply where a red one
 * needs 2.0, so the same 220 Ω on the same 5 V rail passes ~13.8 mA of red and
 * ~7.5 mA of blue — and on a Pico's 3.3 V rail a blue LED barely lights at all,
 * which is a real bench result students hit and misdiagnose as a broken part.
 * Shipping colour as appearance-only would have taught the opposite.
 *
 * RED IS THE HISTORIC CONSTANT, deliberately. `LED_RED` in devices.ts is
 * { is: 1e-20, n: 1.8 }, fitted to the ngspice reference solves in
 * SIMULATOR_ARCHITECTURE.md §5.5 (220 Ω → 13.76 mA against an ideal source).
 * ledSaturationCurrent(1.96) gives 1.0198e-20 — the same number to 2 %, which
 * is n·VT·ln(1.0198) = 0.91 mV of forward voltage — so red keeps the LITERAL
 * and every existing solver, engine and starter number stays exactly put.
 * parts.test.ts asserts that agreement rather than trusting this comment.
 *
 * Measured through the compiler, Uno D13 (25 Ω pad) → 220 Ω → LED → GND:
 * red 12.39 mA, orange 12.24, yellow 11.84, green/blue/white 7.47. On a Pico's
 * 3.3 V rail through the same 220 Ω: red 5.16 mA against blue's 0.90 mA — the
 * blue one is visibly dim, which is a real bench result students hit.
 */
export const LED_COLOURS: ReadonlyArray<LedColour> = [
  { value: 'red', label: 'Red', body: '#d0342c', emit: [255, 70, 50], vfVolts: 1.96, is: 1e-20, n: LED_N },
  { value: 'orange', label: 'Orange', body: '#d97722', emit: [255, 140, 45], vfVolts: 2.0, is: ledSaturationCurrent(2.0), n: LED_N },
  { value: 'yellow', label: 'Yellow', body: '#d6b31f', emit: [255, 205, 60], vfVolts: 2.1, is: ledSaturationCurrent(2.1), n: LED_N },
  { value: 'green', label: 'Green', body: '#2f9e44', emit: [70, 230, 90], vfVolts: 3.2, is: ledSaturationCurrent(3.2), n: LED_N },
  { value: 'blue', label: 'Blue', body: '#2f6fd0', emit: [70, 140, 255], vfVolts: 3.2, is: ledSaturationCurrent(3.2), n: LED_N },
  { value: 'white', label: 'White', body: '#d8d8d8', emit: [255, 250, 235], vfVolts: 3.2, is: ledSaturationCurrent(3.2), n: LED_N },
]

export const LED_DEFAULT_COLOUR = 'red'

/** The declared colour, or red for a document that carries none. */
export function ledColour(value: unknown): LedColour {
  return LED_COLOURS.find((c) => c.value === value) ?? LED_COLOURS[0]
}

/** "#d0342c" → [208, 52, 44]. Returns black for anything unparseable. */
function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * The dome's fill at a given brightness: the unlit epoxy, lerped toward the
 * emitted colour.
 *
 * Here rather than in the canvas so the colours can be asserted without a DOM,
 * and so the ONE place that decides what a lit LED looks like is beside the
 * table that says what colour it is.
 */
export function ledBodyFill(colour: LedColour, brightness: number): string {
  const t = Math.min(1, Math.max(0, Number.isFinite(brightness) ? brightness : 0))
  const [r0, g0, b0] = hexRgb(colour.body)
  const [r1, g1, b1] = colour.emit
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(r0, r1)},${mix(g0, g1)},${mix(b0, b1)})`
}

/** The halo around a lit LED. Transparent at rest, so an unlit LED has none. */
export function ledGlowFill(colour: LedColour, brightness: number): string {
  const t = Math.min(1, Math.max(0, Number.isFinite(brightness) ? brightness : 0))
  const [r, g, b] = colour.emit
  return `rgba(${r},${g},${b},${t * 0.32})`
}

/**
 * The LED, with its dome colour driven by a per-instance CSS variable.
 *
 * The harvested art hardcodes `fill="red"` on the dome. Rewriting that one
 * attribute to `var(--led-body, …)` is what lets one piece of artwork serve six
 * colours: the canvas sets the variable on each instance's group, and anything
 * that renders the raw definition (the palette tile) falls back to red.
 */
const ledArt = wokwiGeometry('led')
const LED_DOME_FILL = 'opacity=".65" fill="red"'
const led: PartDefinition = {
  type: 'led',
  label: 'LED',
  electrical: { kind: 'led', color: 'red' },
  props: [
    {
      key: 'color',
      label: 'Colour',
      type: 'choice',
      choices: LED_COLOURS.map((c) => ({ value: c.value, label: `${c.label} — ${c.vfVolts.toFixed(1)} V` })),
      hint: 'Colour sets the forward voltage, so it changes the current too.',
      default: LED_DEFAULT_COLOUR,
    },
  ],
  ...ledArt,
  svg: ledArt.svg.replace(LED_DOME_FILL, `opacity=".65" fill="var(--led-body, ${LED_COLOURS[0].body})"`),
}

/**
 * Loud rather than silent: if a future @wokwi/elements bump renames that
 * attribute, the LED silently stops responding to its colour prop and nothing
 * else in the suite would notice.
 */
if (!ledArt.svg.includes(LED_DOME_FILL)) {
  console.error(
    '[parts] the harvested LED art no longer carries `' +
      LED_DOME_FILL +
      '`, so the colour prop cannot reach the dome. Re-check wokwi-art.generated.json.',
  )
}

/**
 * The push button, with its pressed artwork driven by a per-instance variable.
 *
 * The harvested art already draws a pressed cap — `.button-active-circle`, a
 * second gradient at `opacity: 0` that wokwi's own `button:active` rule reveals.
 * There is no `<button>` here (the markup is injected as raw SVG), so that one
 * declaration is rewritten to read a custom property and the canvas sets it.
 * Same move as the LED's dome fill, and for the same reason: one piece of shared
 * artwork, per-instance state.
 */
const buttonArt = wokwiGeometry('pushbutton', {
  rename: { '1.l': '1a', '1.r': '1b', '2.l': '2a', '2.r': '2b' },
})
const BUTTON_ACTIVE_RULE = '.wk-pushbutton .button-active-circle{opacity: 0;}'

/**
 * The cap's radius in part-local units.
 *
 * Read off the art rather than eyeballed. The element is 70.087 × 47.244 over a
 * `-3 0 18 12` viewBox with `xMidYMid meet`, so one viewBox unit is width/18 =
 * 3.894 of ours; the cap is a circle of r 3.822 at viewBox (6, 6), which lands
 * it at exactly the bounding box's centre with a radius of 14.88.
 */
const BUTTON_CAP_R = (buttonArt.width * 3.822) / 18

const pushButton: PartDefinition = {
  type: 'push_button',
  label: 'Push button',
  // The two pins on each side are permanently bridged inside the switch body —
  // a classic source of student confusion, and a real electrical fact.
  buses: [['1a', '1b'], ['2a', '2b']],
  electrical: { kind: 'button' },
  props: [
    {
      key: 'pressed',
      label: 'Pressed (latched)',
      type: 'range',
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: 'Or press and hold the button itself on the canvas.',
    },
  ],
  /** Hold the cap to close the contacts; let go and they open. */
  momentary: {
    key: 'pressed',
    cx: buttonArt.width / 2,
    cy: buttonArt.height / 2,
    r: BUTTON_CAP_R,
    pressedVar: '--button-pressed',
  },
  ...buttonArt,
  svg: buttonArt.svg.replace(
    BUTTON_ACTIVE_RULE,
    '.wk-pushbutton .button-active-circle{opacity: var(--button-pressed, 0);}',
  ),
}

/**
 * Loud rather than silent, exactly as the LED's dome guard is: a future
 * @wokwi/elements bump that reformats that rule leaves the button looking
 * un-pressed while the contacts really are closed, and nothing else in the
 * suite would notice.
 */
if (!buttonArt.svg.includes(BUTTON_ACTIVE_RULE)) {
  console.error(
    '[parts] the harvested pushbutton art no longer carries `' +
      BUTTON_ACTIVE_RULE +
      '`, so a press cannot reach the cap. Re-check wokwi-art.generated.json.',
  )
}


// ─── Analog input parts ───────────────────────────────────────────────────────

/**
 * Potentiometer. Track between pins 1 and 3, wiper on 2.
 *
 * This is the part that makes analogRead() mean something: the wiper really
 * divides the track, so the ADC reads a genuine node voltage rather than a
 * number we invented.
 */
const potentiometer: PartDefinition = {
  type: 'potentiometer',
  label: 'Potentiometer',
  electrical: { kind: 'potentiometer', totalOhms: POT_DEFAULT_OHMS },
  props: [
    { key: 'position', label: 'Knob', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
    {
      key: 'totalOhms',
      label: 'Track resistance',
      /**
       * FREE ENTRY, and it is electrical rather than cosmetic.
       *
       * The track is a permanent load across whatever it is wired between: a
       * 1 kΩ pot on a 5 V rail draws 5 mA all the time, a 100 kΩ pot draws
       * 50 µA. It is also the source impedance the ADC sees, and an ATmega's
       * sample-and-hold wants under 10 kΩ to charge inside one conversion —
       * which is precisely why 10 kΩ is the value in the kit.
       *
       * The suggestions are the standard panel-pot decades (1 k, 5 k, 10 k,
       * 50 k, 100 k, 1 M); the field takes anything in between.
       */
      type: 'number',
      unit: 'Ω',
      units: OHM_UNITS,
      // A pot with a 0 Ω track is a wire from pin 1 to pin 3, which is a short
      // across whatever it is wired between rather than a component. The floor
      // is the same figure the legs are clamped to.
      min: POT_MIN_LEG_OHMS,
      max: RESISTOR_MAX_OHMS,
      options: [1000, 5000, 10000, 50000, 100000, 1000000],
      hint: 'The whole track, end to end. The knob splits it.',
      default: POT_DEFAULT_OHMS,
    },
  ],
  /**
   * The knob turns. It is the reason this part exists.
   *
   * Geometry is read off the harvested art rather than eyeballed. The 20 mm
   * viewBox maps to 78.74 units (20 × 100/25.4), so one viewBox unit is 3.937
   * of ours; the shaft ellipse sits at (9.95, 8.06) with rx 6.60, which lands
   * the centre at (39.2, 31.7) with a 26.0-unit radius. The grab target is a
   * touch wider than the shaft — 30 units — because the whole cap is what a
   * finger reaches for, and it still stops well short of the pin row at y ≈ 71.
   *
   * ±150° is the sweep of a real single-turn pot: 300° of travel with a stop at
   * each end and the flat centre detent at twelve o'clock, which is exactly
   * where 50 % lands.
   */
  knob: {
    key: 'position',
    cx: 39.2,
    cy: 31.7,
    r: 30,
    fromDeg: -150,
    toDeg: 150,
    angleVar: '--knob-angle',
  },
  ...wokwiGeometry('potentiometer', {
    rename: { GND: '1', SIG: '2', VCC: '3' },
    types: { '1': 'passive', '2': 'passive', '3': 'passive' },
  }),
}

/**
 * The light slider lives INSIDE the declared box, and the box grew to hold it.
 *
 * The first version put the track at y = −13, above the part. It worked, but it
 * put a control outside `def.width × def.height` — which is the box `freeSpot`
 * uses for collision, the box the selection outline is drawn from, and the box
 * the palette tile letterboxes into. A control nothing knows about is a control
 * another part can be dropped on top of.
 *
 * So the cell and its leads moved DOWN by this much and the height grew by the
 * same, leaving the top 18 units for the track. Pin IDS are unchanged, so every
 * wire in every saved document still lands on the same pin; only where that pin
 * is drawn moves, and no authored starter contains a photoresistor.
 */
const LDR_HEADROOM = 18

const photoresistor: PartDefinition = {
  type: 'photoresistor',
  label: 'Photoresistor',
  width: 30,
  height: 40 + LDR_HEADROOM,
  pins: [
    { id: '1', name: 'A', x: 8, y: 40 + LDR_HEADROOM, type: 'passive' },
    { id: '2', name: 'B', x: 22, y: 40 + LDR_HEADROOM, type: 'passive' },
  ],
  // Bright light drops an LDR to a few hundred ohms; darkness is hundreds of k.
  electrical: { kind: 'variable_resistor', minOhms: 200, maxOhms: 200000 },
  props: [
    { key: 'light', label: 'Light level', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 60 },
  ],
  /**
   * The light is adjusted ON THE PART, above the cell where the light falls.
   *
   * A slider rather than a knob because there is nothing on an LDR to turn —
   * see SliderControl. The track sits at y = 5, inside the box, clear of the
   * dome (a circle at (15, 18 + 18) with r 13, so its crown is at y = 23) by
   * more than the handle's radius. 0 % is at the left and 100 % at the right,
   * the same direction the panel slider travels.
   *
   * The ends are inset by the HANDLE'S RADIUS rather than sitting on the box
   * edge: the handle is centred on the track, so a track that ran 2..28 would
   * put half the handle outside a 30-wide part at each end.
   */
  slider: { key: 'light', x1: 4, y1: 5, x2: 26, y2: 5, r: 3.6 },
  svg: `
    <g transform="translate(0 ${LDR_HEADROOM})">
      <line x1="8" y1="40" x2="8" y2="28" stroke="#9a9a9a" stroke-width="2"/>
      <line x1="22" y1="40" x2="22" y2="28" stroke="#9a9a9a" stroke-width="2"/>
      <circle cx="15" cy="18" r="13" fill="#e8d9a0" stroke="#8a7a45"/>
      <path d="M6 18 q4 -6 9 0 q4 6 9 0" fill="none" stroke="#7a4a2a" stroke-width="2"/>
    </g>
  `,
}

const buzzer: PartDefinition = {
  type: 'buzzer',
  label: 'Buzzer',
  electrical: { kind: 'buzzer' },
  // Hand-drawn on purpose. The harvested wokwi buzzer declares an 8x8 SVG but
  // places its pins at (27,84) — it sizes itself with CSS outside the SVG, so
  // the art and the pin coordinates do not share a coordinate system.
  width: 40,
  height: 40,
  pins: [
    { id: 'P', name: '+', x: 12, y: 40, type: 'passive' },
    { id: 'N', name: '-', x: 28, y: 40, type: 'passive' },
  ],
  props: [
    // 0/1 rather than a text dropdown, matching the push button's `pressed`.
    { key: 'passive', label: 'Passive (needs tone)', type: 'range', min: 0, max: 1, step: 1, default: 0 },
  ],
  svg: `
    <circle cx="20" cy="20" r="18" fill="#1a1a1a" stroke="#000"/>
    <circle cx="20" cy="20" r="4" fill="#3a3a3a"/>
    <line x1="12" y1="40" x2="12" y2="36" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="28" y1="40" x2="28" y2="36" stroke="#9a9a9a" stroke-width="2"/>
  `,
}

const dcMotor: PartDefinition = {
  type: 'dc_motor',
  label: 'DC motor',
  width: 50,
  height: 40,
  pins: [
    { id: '1', name: '+', x: 15, y: 40, type: 'passive' },
    { id: '2', name: '-', x: 35, y: 40, type: 'passive' },
  ],
  electrical: { kind: 'motor' },
  props: [
    {
      key: 'load',
      label: 'Mechanical load',
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      unit: '%',
      default: 0,
    },
  ],
  svg: `
    <rect x="4" y="4" width="42" height="30" rx="6" fill="#9aa3ad" stroke="#6d757e"/>
    <circle cx="25" cy="19" r="9" fill="#6d757e"/>
    <text x="25" y="23" font-size="10" text-anchor="middle" fill="#e8e8e8" font-family="monospace">M</text>
    <line x1="15" y1="40" x2="15" y2="34" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="35" y1="40" x2="35" y2="34" stroke="#9a9a9a" stroke-width="2"/>
  `,
}

const diode: PartDefinition = {
  type: 'diode',
  label: 'Diode',
  width: 50,
  height: 20,
  pins: [
    { id: 'A', name: 'Anode', x: 0, y: 10, type: 'passive' },
    { id: 'C', name: 'Cathode', x: 50, y: 10, type: 'passive' },
  ],
  electrical: { kind: 'diode' },
  svg: `
    <line x1="0" y1="10" x2="15" y2="10" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="35" y1="10" x2="50" y2="10" stroke="#9a9a9a" stroke-width="2"/>
    <rect x="15" y="3" width="20" height="14" rx="2" fill="#1f1f1f"/>
    <rect x="31" y="3" width="3" height="14" fill="#d8d8d8"/>
  `,
}


// ─── Behavioural sensors (tier 2) ─────────────────────────────────────────────

/**
 * Every one of these declares GND as `passive`, not `gnd`, exactly as the DHT11
 * does. compile() collapses every `gnd` pin in the document onto net 0 whether
 * or not a wire reaches it, so typing the pin as `gnd` would silently ground the
 * sensor for a student who never connected it — turning "you forgot the ground
 * wire", the single commonest beginner mistake, into a circuit that works.
 */
const GND_IS_A_REAL_WIRE = { GND: 'passive' } as const

const hcsr04: PartDefinition = {
  type: 'hc_sr04',
  label: 'HC-SR04 ultrasonic',
  electrical: { kind: 'sensor', protocol: 'hc_sr04', drives: ['ECHO'] },
  props: [
    {
      key: 'distance',
      label: 'Target distance',
      type: 'range',
      // The datasheet's own 2–400 cm ranging window. Outside it the module
      // reports no echo, which the behavioural model implements as its 38 ms
      // timeout pulse rather than by refusing to move the slider.
      min: 1,
      max: 420,
      step: 1,
      unit: ' cm',
      default: 50,
    },
  ],
  ...wokwiGeometry('hc-sr04', {
    types: { ...GND_IS_A_REAL_WIRE, TRIG: 'digital', ECHO: 'digital' },
  }),
}

const pirMotion: PartDefinition = {
  type: 'pir_motion',
  label: 'PIR motion sensor',
  electrical: { kind: 'sensor', protocol: 'pir', drives: ['OUT'] },
  props: [
    { key: 'motion', label: 'Motion in front', type: 'range', min: 0, max: 1, step: 1, default: 0 },
    // Tx on a real HC-SR501 goes to 200 s; nobody sits through that, and the
    // teaching point is made anywhere in this range.
    { key: 'hold', label: 'Hold time (Tx)', type: 'range', min: 1, max: 30, step: 1, unit: ' s', default: 5 },
    // Defaults to 0. See PIRSensor in behavioural.ts for why the real 30-60 s
    // induction lockout is off unless the student asks for it.
    { key: 'warmup', label: 'Warm-up', type: 'range', min: 0, max: 60, step: 5, unit: ' s', default: 0 },
  ],
  ...wokwiGeometry('pir-motion-sensor', {
    types: { ...GND_IS_A_REAL_WIRE, OUT: 'digital' },
  }),
}

/**
 * YF-S201 water flow sensor. Hand-drawn: wokwi has no flow-sensor element, so
 * there is no harvested art to use.
 */
const flowSensor: PartDefinition = {
  type: 'flow_sensor',
  label: 'YF-S201 flow sensor',
  width: 60,
  height: 50,
  pins: [
    { id: 'VCC', name: 'VCC', x: 18, y: 50, type: 'power' },
    { id: 'SIG', name: 'SIG', x: 30, y: 50, type: 'digital' },
    { id: 'GND', name: 'GND', x: 42, y: 50, type: 'passive' },
  ],
  electrical: { kind: 'sensor', protocol: 'flow', drives: ['SIG'] },
  props: [
    {
      key: 'flow',
      label: 'Water flow',
      type: 'range',
      // Datasheet working range is 1–30 L/min; 0 is "tap closed", which has to
      // be reachable or the sensor could never be seen to stop pulsing.
      min: 0,
      max: 30,
      step: 1,
      unit: ' L/min',
      default: 10,
    },
  ],
  svg: `
    <rect x="4" y="10" width="52" height="28" rx="6" fill="#3a3f45" stroke="#22262b"/>
    <rect x="0" y="18" width="8" height="12" rx="2" fill="#7d848c"/>
    <rect x="52" y="18" width="8" height="12" rx="2" fill="#7d848c"/>
    <circle cx="30" cy="24" r="9" fill="#22262b"/>
    <path d="M30 17 l0 14 M23 24 l14 0" stroke="#7d848c" stroke-width="2"/>
    <line x1="18" y1="50" x2="18" y2="38" stroke="#e04a4a" stroke-width="2"/>
    <line x1="30" y1="50" x2="30" y2="38" stroke="#eab308" stroke-width="2"/>
    <line x1="42" y1="50" x2="42" y2="38" stroke="#111827" stroke-width="2"/>
  `,
}

const dht11: PartDefinition = {
  type: 'dht11',
  label: 'DHT11 sensor',
  width: 40,
  height: 55,
  pins: [
    { id: 'VCC', name: 'VCC', x: 8, y: 55, type: 'power' },
    { id: 'DATA', name: 'DATA', x: 20, y: 55, type: 'digital' },
    { id: 'GND', name: 'GND', x: 32, y: 55, type: 'passive' },
  ],
  electrical: { kind: 'sensor', protocol: 'dht11', drives: ['DATA'] },
  props: [
    { key: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 50, step: 1, unit: '°C', default: 24 },
    { key: 'humidity', label: 'Humidity', type: 'range', min: 20, max: 90, step: 1, unit: '%', default: 45 },
  ],
  svg: `
    <rect x="2" y="2" width="36" height="42" rx="3" fill="#3b7fd4" stroke="#2a5c9c"/>
    <circle cx="11" cy="13" r="3" fill="#1e3f6b"/><circle cx="20" cy="13" r="3" fill="#1e3f6b"/>
    <circle cx="29" cy="13" r="3" fill="#1e3f6b"/><circle cx="11" cy="23" r="3" fill="#1e3f6b"/>
    <circle cx="20" cy="23" r="3" fill="#1e3f6b"/><circle cx="29" cy="23" r="3" fill="#1e3f6b"/>
    <circle cx="11" cy="33" r="3" fill="#1e3f6b"/><circle cx="20" cy="33" r="3" fill="#1e3f6b"/>
    <circle cx="29" cy="33" r="3" fill="#1e3f6b"/>
    <line x1="8" y1="55" x2="8" y2="44" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="20" y1="55" x2="20" y2="44" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="32" y1="55" x2="32" y2="44" stroke="#9a9a9a" stroke-width="2"/>
  `,
}

/**
 * DS18B20 1-Wire digital thermometer, in the TO-92 package the kits ship.
 *
 * PINOUT, and it is the one thing worth getting right here: looking at the FLAT
 * face with the leads pointing down, the order is GND, DQ, VDD (datasheet pin
 * 1, 2, 3). Reversing GND and VDD is the classic way to cook one of these, and
 * a part drawn the wrong way round would teach the mistake rather than catch it.
 *
 * GND is `passive`, not `gnd` — see GND_IS_A_REAL_WIRE. This part cares more
 * than most: a DS18B20 with no ground has no return path for the open-drain
 * pull-down, so it cannot answer, and "you forgot the ground wire" has to stay a
 * real mistake with a real symptom.
 *
 * The 4.7 kΩ pull-up the experiment calls for is a SEPARATE part, deliberately.
 * It is external on real hardware, the bus does not work without it, and the
 * behavioural model reports `busIdleHigh: false` when it is missing.
 */
const ds18b20: PartDefinition = {
  type: 'ds18b20',
  label: 'DS18B20 temperature',
  width: 36,
  height: 50,
  pins: [
    { id: 'GND', name: 'GND', x: 8, y: 50, type: 'passive' },
    { id: 'DQ', name: 'DQ', x: 18, y: 50, type: 'digital' },
    { id: 'VDD', name: 'VDD', x: 28, y: 50, type: 'power' },
  ],
  electrical: { kind: 'sensor', protocol: 'ds18b20', drives: ['DQ'] },
  props: [
    {
      key: 'temperature',
      label: 'Probe temperature',
      type: 'range',
      // The datasheet's own −55…+125 °C measurement range. Values outside it
      // are clamped by ds18b20Raw() rather than refused, but the slider should
      // not offer a reading the part cannot represent.
      min: -55,
      max: 125,
      step: 1,
      unit: '°C',
      default: 25,
    },
    {
      key: 'resolution',
      label: 'Resolution',
      type: 'select',
      unit: ' bit',
      // 9/10/11/12 bits, the four settings of the configuration register. The
      // slider owns this only until the student's program writes its own
      // register — see applyResolutionProp() in behavioural.ts.
      options: [9, 10, 11, 12],
      default: 12,
    },
  ],
  svg: `
    <path d="M4 30 A14 14 0 0 1 32 30 L32 40 L4 40 Z" fill="#1f1f1f" stroke="#000"/>
    <rect x="4" y="16" width="28" height="20" fill="#1f1f1f" stroke="#000"/>
    <line x1="4" y1="34" x2="32" y2="34" stroke="#3a3a3a" stroke-width="1"/>
    <text x="18" y="30" font-size="7" text-anchor="middle" fill="#c9c9c9" font-family="monospace">DS18</text>
    <line x1="8" y1="50" x2="8" y2="40" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="18" y1="50" x2="18" y2="40" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="28" y1="50" x2="28" y2="40" stroke="#9a9a9a" stroke-width="2"/>
  `,
}

// ─── Motor driver stages and the motor they drive ─────────────────────────────

/**
 * ULN2003A, as the 16-pin DIP.
 *
 * PIN NUMBERING IS THE REAL PART'S, walked the way a DIP is walked: pin 1 at
 * the top left, down the left side to pin 8, then across to pin 9 at the bottom
 * right and back UP to pin 16. So the inputs 1B…7B are the left column, E
 * (ground) is pin 8, COM is pin 9, and the outputs 7C…1C run bottom to top on
 * the right — which is why OUT1 sits opposite IN1 rather than beside it.
 *
 * Ids are IN1…IN7 / OUT1…OUT7 / COM / GND rather than the datasheet's 1B/1C/E,
 * because IN1…IN4 is what the ULN2003 stepper BOARD silkscreens and what the
 * experiment's own circuit table names.
 *
 * GND is `passive`. The chip's sinks and its input resistors all return to THIS
 * pin, not to net 0 (see DarlingtonSink), so an unwired ground gives a chip that
 * does nothing — exactly what happens on a bench.
 */
const ULN2003_CHANNELS = 7

function makeULN2003(): PartDefinition {
  const pins: PinGeometry[] = []
  const leftX = 10
  const rightX = 80
  const topY = 15

  for (let k = 1; k <= ULN2003_CHANNELS; k++) {
    pins.push({ id: `IN${k}`, name: `IN${k}`, x: leftX, y: topY + (k - 1) * PITCH, type: 'digital' })
  }
  // Pin 8 (E) closes the left column; pin 9 (COM) opens the right one opposite it.
  pins.push({ id: 'GND', name: 'GND', x: leftX, y: topY + 7 * PITCH, type: 'passive' })
  pins.push({ id: 'COM', name: 'COM', x: rightX, y: topY + 7 * PITCH, type: 'power' })
  for (let k = 1; k <= ULN2003_CHANNELS; k++) {
    pins.push({ id: `OUT${k}`, name: `OUT${k}`, x: rightX, y: topY + (k - 1) * PITCH, type: 'passive' })
  }

  const pads = pins
    .map(
      (p) =>
        `<rect x="${p.x - 3}" y="${p.y - 3}" width="6" height="6" rx="1" ` +
        `fill="#c9c9c9" stroke="#8a8a8a" stroke-width="0.5"/>`,
    )
    .join('')

  return {
    type: 'uln2003',
    label: 'ULN2003 Darlington array',
    width: 90,
    height: 100,
    pins,
    electrical: { kind: 'darlington_array' },
    svg: `
      <rect x="16" y="6" width="58" height="88" rx="3" fill="#1f1f1f" stroke="#000"/>
      <circle cx="24" cy="16" r="3" fill="#3a3a3a"/>
      <text x="45" y="46" font-size="8" text-anchor="middle" fill="#c9c9c9" font-family="monospace">ULN</text>
      <text x="45" y="58" font-size="8" text-anchor="middle" fill="#c9c9c9" font-family="monospace">2003</text>
      ${pads}
    `,
  }
}

/**
 * L298N dual full-bridge, drawn as the RED BREAKOUT MODULE rather than as the
 * bare Multiwatt15, because that is the object the experiment's bill of
 * materials lists and the object a student has in front of them.
 *
 * Pin ids follow the module's silkscreen — OUT1…OUT4, ENA, IN1…IN4, ENB, and
 * the three-way power terminal +12V / GND / +5V. The two supply pins are named
 * VS and VSS for their datasheet roles instead, because that is the distinction
 * that matters and the silkscreen actively obscures it:
 *
 *   VS  (the "+12V" screw) is the MOTOR supply, 2.5 V above a logic high at the
 *       very least, and it is what the output stage draws from.
 *   VSS (the "+5V" screw) is the LOGIC supply and is rated 4.5–7 V. Putting the
 *       motor rail here destroys the chip, which HBridgeChannel.safety() says
 *       out loud.
 *
 * GND is `passive`, as everywhere else, and it is genuinely load-bearing on this
 * part: an L298N shares its ground with the MCU or neither of them agrees what a
 * logic high is. A student who omits that wire gets a bridge that never enables.
 */
function makeL298N(): PartDefinition {
  const W = 160
  const H = 110
  const pins: PinGeometry[] = [
    // Motor terminals, one screw block per channel.
    { id: 'OUT1', name: 'OUT1', x: 20, y: 10, type: 'passive' },
    { id: 'OUT2', name: 'OUT2', x: 40, y: 10, type: 'passive' },
    { id: 'OUT3', name: 'OUT3', x: 120, y: 10, type: 'passive' },
    { id: 'OUT4', name: 'OUT4', x: 140, y: 10, type: 'passive' },
    // Power terminal.
    { id: 'VS', name: '+12V (VS)', x: 10, y: 40, type: 'power' },
    { id: 'GND', name: 'GND', x: 10, y: 60, type: 'passive' },
    { id: 'VSS', name: '+5V (VSS)', x: 10, y: 80, type: 'power' },
    // Logic header.
    { id: 'ENA', name: 'ENA', x: 40, y: 100, type: 'digital' },
    { id: 'IN1', name: 'IN1', x: 50, y: 100, type: 'digital' },
    { id: 'IN2', name: 'IN2', x: 60, y: 100, type: 'digital' },
    { id: 'IN3', name: 'IN3', x: 70, y: 100, type: 'digital' },
    { id: 'IN4', name: 'IN4', x: 80, y: 100, type: 'digital' },
    { id: 'ENB', name: 'ENB', x: 90, y: 100, type: 'digital' },
  ]

  const terminals = pins
    .filter((p) => p.id.startsWith('OUT') || p.id === 'VS' || p.id === 'GND' || p.id === 'VSS')
    .map(
      (p) =>
        `<rect x="${p.x - 6}" y="${p.y - 6}" width="12" height="12" rx="2" ` +
        `fill="#2b6cb0" stroke="#1a4a80"/><circle cx="${p.x}" cy="${p.y}" r="3" fill="#d8d8d8"/>`,
    )
    .join('')
  const header = pins
    .filter((p) => p.type === 'digital')
    .map(
      (p) =>
        `<rect x="${p.x - 3}" y="${p.y - 4}" width="6" height="8" rx="1" ` +
        `fill="#c9a227" stroke="#8a6d14" stroke-width="0.5"/>`,
    )
    .join('')

  return {
    type: 'l298n',
    label: 'L298N motor driver',
    width: W,
    height: H,
    pins,
    electrical: { kind: 'h_bridge' },
    svg: `
      <rect x="0" y="0" width="${W}" height="${H}" rx="4" fill="#b03a2e" stroke="#7d2820"/>
      <rect x="58" y="26" width="44" height="44" rx="3" fill="#3a3f45" stroke="#22262b"/>
      <text x="80" y="44" font-size="9" text-anchor="middle" fill="#e8e8e8" font-family="monospace">L298</text>
      <text x="80" y="56" font-size="9" text-anchor="middle" fill="#e8e8e8" font-family="monospace">N</text>
      <rect x="108" y="34" width="18" height="28" rx="2" fill="#8a8f96"/>
      ${terminals}
      ${header}
    `,
  }
}

/**
 * 28BYJ-48 unipolar stepper, five wires.
 *
 * HAND-DRAWN, AND THE HARVESTED ART IS NOT A SUBSTITUTE. wokwi-art.generated.json
 * does carry a `stepper-motor`, but its pins are A-/A+/B+/B- — a four-wire
 * BIPOLAR motor with no common tap. A 28BYJ-48 has five wires because its two
 * windings are centre-tapped and both taps are joined to the red lead; that
 * common tap is the entire reason it can be driven by seven open-collector sinks
 * instead of by two H-bridges. Reusing the bipolar art would put a student's
 * wire on a pin the real part does not have, and would hide the one structural
 * fact this experiment is about.
 *
 * Ids are COM / A / B / C / D. A…D are the four phase leads in HALF_STEP_SEQUENCE
 * order (bit 3 is A), so wiring IN1→A, IN2→B, IN3→C, IN4→D through a ULN2003
 * reproduces the ring the datasheet prints. The human-facing names carry the
 * lead COLOURS, because on a real motor that is all the student can see.
 */
function makeStepper28BYJ48(): PartDefinition {
  const W = 90
  const H = 100
  const pins: PinGeometry[] = [
    { id: 'COM', name: 'COM (red)', x: 25, y: 100, type: 'power' },
    { id: 'A', name: 'A (orange)', x: 35, y: 100, type: 'passive' },
    { id: 'B', name: 'B (yellow)', x: 45, y: 100, type: 'passive' },
    { id: 'C', name: 'C (pink)', x: 55, y: 100, type: 'passive' },
    { id: 'D', name: 'D (blue)', x: 65, y: 100, type: 'passive' },
  ]
  const leadColour: Record<string, string> = {
    COM: '#e04a4a',
    A: '#e07b2e',
    B: '#eab308',
    C: '#e29ec0',
    D: '#3b6fd4',
  }
  const leads = pins
    .map(
      (p) =>
        `<line x1="${p.x}" y1="100" x2="${p.x}" y2="84" stroke="${leadColour[p.id]}" stroke-width="2"/>`,
    )
    .join('')

  return {
    type: 'stepper_28byj48',
    label: '28BYJ-48 stepper',
    width: W,
    height: H,
    pins,
    electrical: { kind: 'stepper' },
    svg: `
      <circle cx="45" cy="42" r="34" fill="#c8ccd1" stroke="#8f959c"/>
      <circle cx="45" cy="42" r="26" fill="#aeb4bb" stroke="#8f959c"/>
      <rect x="30" y="18" width="30" height="10" rx="2" fill="#8f959c"/>
      <circle cx="45" cy="42" r="7" fill="#6d757e"/>
      <circle cx="45" cy="42" r="3" fill="#e8e8e8"/>
      <rect x="18" y="72" width="54" height="14" rx="2" fill="#e8e2d0" stroke="#b8b09a"/>
      <text x="45" y="83" font-size="7" text-anchor="middle" fill="#5a5346" font-family="monospace">28BYJ-48</text>
      ${leads}
    `,
  }
}

/**
 * The common 4-channel opto-isolated relay board.
 *
 * HAND-DRAWN. wokwi-art.generated.json carries no relay of any kind (its parts
 * are resistor, led, pushbutton, potentiometer, buzzer, photoresistor, ntc,
 * hc-sr04, pir, dht22, servo, 7segment, rgb-led, slide-switch, stepper-motor,
 * led-bar-graph, tilt-switch and arduino-uno), so there is nothing to reuse.
 *
 * PINOUT is the board's own. The six-way logic header carries VCC, IN1…IN4 and
 * GND; each channel's screw terminal carries NO, COM and NC in that order, which
 * is the order silkscreened on the block. Getting NO and NC the right way round
 * matters more here than on most parts: a load on NC is powered when the relay
 * is IDLE, and a student who wires the "off" terminal gets an appliance that is
 * on until the program turns it off.
 *
 * GND is `passive`, not `gnd` — see GND_IS_A_REAL_WIRE. The opto LEDs' return,
 * the coil driver's emitter and the module's whole supply reference are this
 * pin, so an unwired ground gives a board that does nothing, which is what a
 * bench does.
 *
 * VCC is where the coil's power comes from and it is 5 V. On a Pico that means
 * the VBUS pad, not the 3.3 V logic rail — and the model will not pull the
 * armature in below the relay's 3.75 V pick-up voltage, so wiring it to 3V3
 * produces a board that clicks its opto and never its contact.
 */
const RELAY_CHANNELS = 4

function makeRelayModule(): PartDefinition {
  const W = 220
  const H = 120
  const pins: PinGeometry[] = []

  // Screw terminals along the top: NO / COM / NC per channel.
  for (let k = 1; k <= RELAY_CHANNELS; k++) {
    const x0 = 20 + (k - 1) * 50
    pins.push({ id: `NO${k}`, name: `NO${k}`, x: x0, y: 15, type: 'passive' })
    pins.push({ id: `COM${k}`, name: `COM${k}`, x: x0 + 15, y: 15, type: 'passive' })
    pins.push({ id: `NC${k}`, name: `NC${k}`, x: x0 + 30, y: 15, type: 'passive' })
  }

  // Six-way logic header along the bottom.
  const header: Array<[string, string, PinType]> = [
    ['VCC', 'VCC', 'power'],
    ['IN1', 'IN1', 'digital'],
    ['IN2', 'IN2', 'digital'],
    ['IN3', 'IN3', 'digital'],
    ['IN4', 'IN4', 'digital'],
    ['GND', 'GND', 'passive'],
  ]
  header.forEach(([id, name, type], i) => {
    pins.push({ id, name, x: 60 + i * PITCH, y: H - 10, type })
  })

  const terminals = pins
    .filter((p) => p.y === 15)
    .map(
      (p) =>
        `<rect x="${p.x - 6}" y="${p.y - 7}" width="12" height="14" rx="2" ` +
        `fill="#1f4d8f" stroke="#12305c"/><circle cx="${p.x}" cy="${p.y}" r="3" fill="#d8d8d8"/>`,
    )
    .join('')
  const headerPads = pins
    .filter((p) => p.y === H - 10)
    .map(
      (p) =>
        `<rect x="${p.x - 3}" y="${p.y - 4}" width="6" height="8" rx="1" ` +
        `fill="#c9a227" stroke="#8a6d14" stroke-width="0.5"/>`,
    )
    .join('')
  // The four relay cans, and the four channel LEDs beside them.
  const cans = [0, 1, 2, 3]
    .map(
      (k) =>
        `<rect x="${22 + k * 50}" y="${34}" width="40" height="34" rx="2" fill="#1f4d8f" stroke="#12305c"/>` +
        `<text x="${42 + k * 50}" y="${55}" font-size="7" text-anchor="middle" fill="#dbe7f7" font-family="monospace">SRD</text>` +
        `<circle cx="${42 + k * 50}" cy="${80}" r="4" fill="#7f1d1d" stroke="#4a1010"/>`,
    )
    .join('')

  return {
    type: 'relay_4ch',
    label: '4-channel relay module',
    width: W,
    height: H,
    pins,
    electrical: { kind: 'relay_module', channels: RELAY_CHANNELS },
    props: [
      // 0/1 rather than a text dropdown, matching the buzzer's `passive` and the
      // push button's `pressed`. 1 (active low) is the common board.
      {
        key: 'activeLow',
        label: 'Active-low trigger',
        type: 'range',
        min: 0,
        max: 1,
        step: 1,
        default: 1,
      },
    ],
    svg: `
      <rect x="0" y="0" width="${W}" height="${H}" rx="4" fill="#1d4ed8" stroke="#14357f"/>
      <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="3" fill="#1e40af" stroke="none"/>
      ${cans}
      <text x="${W / 2}" y="${H - 22}" font-size="7" text-anchor="middle" fill="#cbd5e1" font-family="monospace">4-CH RELAY (opto)</text>
      ${terminals}
      ${headerPads}
    `,
  }
}

/**
 * SEN-11574 pulse sensor — the small round PPG board with three flying leads.
 *
 * HAND-DRAWN; there is no wokwi element for it.
 *
 * The three leads are colour-coded on the real part and the names carry the
 * colours, because that is all a student can see: red is VCC (3–5 V), purple is
 * the analog signal, black is ground. The signal is genuinely ANALOG — it rests
 * at half the supply and the pulse rides on it — which is why the published
 * circuit needs an MCP3008 in front of a Raspberry Pi at all.
 */
const pulseSensor: PartDefinition = {
  type: 'pulse_sensor',
  label: 'Pulse sensor (SEN-11574)',
  width: 40,
  height: 52,
  pins: [
    { id: 'VCC', name: 'VCC (red)', x: 10, y: 52, type: 'power' },
    { id: 'SIG', name: 'S (purple)', x: 20, y: 52, type: 'analog' },
    { id: 'GND', name: 'GND (black)', x: 30, y: 52, type: 'passive' },
  ],
  electrical: { kind: 'sensor', protocol: 'pulse', drives: ['SIG'] },
  props: [
    {
      key: 'bpm',
      label: 'Heart rate',
      type: 'range',
      // The band the experiment's own thresholds sit inside (60–100 normal),
      // with bradycardia and tachycardia both reachable so the alert logic can
      // be exercised.
      min: 30,
      max: 200,
      step: 1,
      unit: ' BPM',
      default: 72,
    },
    {
      key: 'amplitude',
      label: 'Signal strength',
      type: 'range',
      // Percent of the supply. A poorly placed finger really does drop the
      // swing to a couple of percent, at which point a fixed threshold stops
      // detecting beats — which is a lesson, not a bug.
      min: 0,
      max: 20,
      step: 1,
      unit: '%',
      default: 8,
    },
  ],
  svg: `
    <circle cx="20" cy="20" r="18" fill="#1b1b1b" stroke="#000"/>
    <circle cx="20" cy="20" r="12" fill="#0f172a"/>
    <circle cx="15" cy="20" r="4" fill="#166534"/>
    <rect x="23" y="16" width="6" height="8" rx="1" fill="#334155"/>
    <path d="M6 30 l4 0 l2 -6 l3 12 l3 -8 l2 2 l4 0" fill="none" stroke="#e879f9" stroke-width="1.2"/>
    <line x1="10" y1="52" x2="10" y2="38" stroke="#e04a4a" stroke-width="2"/>
    <line x1="20" y1="52" x2="20" y2="38" stroke="#a855f7" stroke-width="2"/>
    <line x1="30" y1="52" x2="30" y2="38" stroke="#111827" stroke-width="2"/>
  `,
}

/**
 * MCP3008, as the 16-pin PDIP.
 *
 * HAND-DRAWN, and the pin NUMBERING is the real part's, walked the way a DIP is
 * walked: pin 1 at the top left, down the left side to pin 8, then across to
 * pin 9 at the bottom right and back UP to pin 16. So CH0…CH7 are the left
 * column, DGND is pin 9 at the bottom right, and CS/DIN/DOUT/CLK/AGND/VREF/VDD
 * run bottom to top on the right — which is why VDD sits opposite CH0.
 *
 * The two grounds are separate pins on the real part and are kept separate
 * here: AGND (pin 14) is the reference the conversion is measured against and
 * DGND (pin 9) is the logic return. A real board ties them together; leaving
 * that to the student is the same choice every other part makes about ground.
 */
function makeMCP3008(): PartDefinition {
  const W = 100
  const H = 100
  const leftX = 10
  const rightX = 90
  const topY = 15
  const pins: PinGeometry[] = []

  for (let k = 0; k < 8; k++) {
    pins.push({ id: `CH${k}`, name: `CH${k}`, x: leftX, y: topY + k * PITCH, type: 'analog' })
  }
  // Pins 9 → 16, bottom to top on the right edge.
  const right: Array<[string, string, PinType]> = [
    ['DGND', 'DGND', 'passive'],
    ['CS', 'CS/SHDN', 'digital'],
    ['DIN', 'DIN', 'digital'],
    ['DOUT', 'DOUT', 'digital'],
    ['CLK', 'CLK', 'digital'],
    ['AGND', 'AGND', 'passive'],
    ['VREF', 'VREF', 'power'],
    ['VDD', 'VDD', 'power'],
  ]
  right.forEach(([id, name, type], i) => {
    pins.push({ id, name, x: rightX, y: topY + (7 - i) * PITCH, type })
  })

  const pads = pins
    .map(
      (p) =>
        `<rect x="${p.x - 3}" y="${p.y - 3}" width="6" height="6" rx="1" ` +
        `fill="#c9c9c9" stroke="#8a8a8a" stroke-width="0.5"/>`,
    )
    .join('')

  return {
    type: 'mcp3008',
    label: 'MCP3008 SPI ADC',
    width: W,
    height: H,
    pins,
    electrical: {
      kind: 'sensor',
      protocol: 'mcp3008',
      // DOUT is the only pin the part ever drives, and it is high-impedance
      // whenever CS is high — which is what lets it share a MISO line.
      drives: ['DOUT'],
    },
    svg: `
      <rect x="18" y="6" width="64" height="88" rx="3" fill="#1f1f1f" stroke="#000"/>
      <path d="M42 6 a8 8 0 0 0 16 0" fill="#111"/>
      <circle cx="27" cy="17" r="3" fill="#3a3a3a"/>
      <text x="50" y="46" font-size="8" text-anchor="middle" fill="#c9c9c9" font-family="monospace">MCP</text>
      <text x="50" y="58" font-size="8" text-anchor="middle" fill="#c9c9c9" font-family="monospace">3008</text>
      ${pads}
    `,
  }
}

// ─── Reactive parts — present, but honest about what they do ──────────────────

const capacitor: PartDefinition = {
  type: 'capacitor',
  label: 'Capacitor',
  width: 40,
  height: 30,
  pins: [
    { id: '1', name: 'A', x: 0, y: 15, type: 'passive' },
    { id: '2', name: 'B', x: 40, y: 15, type: 'passive' },
  ],
  electrical: { kind: 'reactive', element: 'capacitor' },
  props: [
    // 1 µF because that is what compile.ts falls back to for a capacitor with
    // no `microfarads` (`Number(part.props.microfarads ?? 1)`). Same trap as the
    // resistor's, one line earlier in the same file — the inspector used to show
    // options[0], which happens to be 1 here, so it was right by accident.
    // Declared now so it is right on purpose.
    //
    // Free entry with a pF…F ladder, because the six-entry µF list could not
    // express a 100 nF decoupling cap — the single most common capacitor on any
    // board — without asking a student to type it as 0.1 µF.
    {
      key: 'microfarads',
      label: 'Capacitance',
      type: 'number',
      unit: 'F',
      units: FARAD_UNITS,
      min: CAPACITOR_MIN_UF,
      max: CAPACITOR_MAX_UF,
      options: [1, 10, 47, 100, 220, 470],
      default: 1,
    },
  ],
  svg: `
    <line x1="0" y1="15" x2="16" y2="15" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="24" y1="15" x2="40" y2="15" stroke="#9a9a9a" stroke-width="2"/>
    <rect x="15" y="4" width="3" height="22" fill="#d8d8d8"/>
    <rect x="22" y="4" width="3" height="22" fill="#d8d8d8"/>
  `,
}

/**
 * Axial inductor — an RF choke, the shape a kit ships.
 *
 * THE MODEL ALREADY EXISTED AND THE PART DID NOT. `Inductor` is in devices.ts,
 * compile.ts has stamped `{ kind: 'reactive', element: 'inductor' }` since
 * transient landed, and `Circuit.smallestTimeConstant()` sizes a timestep from
 * L/R — but nothing in `PALETTE` could produce one, so no student could place
 * an inductor and none of that ran outside a test. This is the missing row.
 *
 * HAND-DRAWN: wokwi-art.generated.json carries no inductor.
 *
 * The suggested values are the E-series decades a through-hole choke kit
 * contains — 100 µH, 1 mH, 10 mH, 100 mH — plus 1 H for a relay-coil-sized
 * winding. The default is 1 mH, which is compile.ts's own fallback.
 *
 * WORTH KNOWING about the numbers this part produces: an inductor's DC steady
 * state is a 0.01 Ω short (Inductor.geq() in DC mode), so on its own it does
 * very little. It earns its place in a TRANSIENT — the current through it rises
 * with time constant L/R, and with a 10 mH choke in series with 100 Ω that is
 * 100 µs, which the engine's step sizing resolves without being told.
 */
const inductor: PartDefinition = {
  type: 'inductor',
  label: 'Inductor',
  width: 40,
  height: 30,
  pins: [
    { id: '1', name: 'A', x: 0, y: 15, type: 'passive' },
    { id: '2', name: 'B', x: 40, y: 15, type: 'passive' },
  ],
  electrical: { kind: 'reactive', element: 'inductor' },
  props: [
    {
      key: 'millihenries',
      label: 'Inductance',
      type: 'number',
      unit: 'H',
      units: HENRY_UNITS,
      min: INDUCTOR_MIN_MH,
      max: INDUCTOR_MAX_MH,
      options: [0.1, 1, 10, 100, 1000],
      default: INDUCTOR_DEFAULT_MH,
    },
  ],
  svg: `
    <line x1="0" y1="15" x2="8" y2="15" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="32" y1="15" x2="40" y2="15" stroke="#9a9a9a" stroke-width="2"/>
    <rect x="8" y="7" width="24" height="16" rx="7" fill="#3f3a34" stroke="#25211c"/>
    <path d="M11 15 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0"
          fill="none" stroke="#c9a227" stroke-width="1.6"/>
    <rect x="11" y="9" width="2.5" height="12" fill="#8a5a2a"/>
    <rect x="26.5" y="9" width="2.5" height="12" fill="#8a5a2a"/>
  `,
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const PART_LIBRARY: Record<string, PartDefinition> = {
  arduino_uno: makeUno(),
  arduino_mega: makeMega(),
  raspberry_pi_pico: makePico(),
  breadboard: makeBreadboard(),
  resistor,
  led,
  push_button: pushButton,
  potentiometer,
  photoresistor,
  buzzer,
  dc_motor: dcMotor,
  diode,
  dht11,
  ds18b20,
  hc_sr04: hcsr04,
  pir_motion: pirMotion,
  flow_sensor: flowSensor,
  l298n: makeL298N(),
  uln2003: makeULN2003(),
  stepper_28byj48: makeStepper28BYJ48(),
  relay_4ch: makeRelayModule(),
  pulse_sensor: pulseSensor,
  mcp3008: makeMCP3008(),
  capacitor,
  inductor,
}

/** Palette order. Breadboard and board first — students place those first too. */
export const PALETTE: string[] = [
  'arduino_uno',
  'arduino_mega',
  'raspberry_pi_pico',
  'breadboard',
  'resistor',
  'led',
  'push_button',
  'potentiometer',
  'photoresistor',
  'diode',
  'buzzer',
  'dc_motor',
  // The two driver stages sit next to the motor they drive, and the stepper next
  // to the array that sinks its coils — a student reaching for one reaches for
  // the other in the same breath.
  'l298n',
  'uln2003',
  'stepper_28byj48',
  // A relay board is the other way a small board switches something bigger, so
  // it sits with the driver stages rather than with the sensors.
  'relay_4ch',
  'dht11',
  'ds18b20',
  'hc_sr04',
  'pir_motion',
  'flow_sensor',
  // The pulse sensor is analog-out, so it travels with the converter that a
  // board without an ADC needs in order to read it.
  'pulse_sensor',
  'mcp3008',
  // The two reactive elements together: they are the pair the transient engine
  // exists for, and a student reaching for one is learning the same lesson.
  'capacitor',
  'inductor',
]

export function getPart(type: string): PartDefinition {
  const def = PART_LIBRARY[type]
  if (!def) throw new Error(`Unknown part type: ${type}`)
  return def
}

// ─── Free numeric entry, with a unit ──────────────────────────────────────────
//
// Tinkercad's VALUE_AND_UNIT is a free-text number beside an SI-prefix dropdown
// (DEVICE_CONTROLS_AUDIT.md §2, §6.1). All of the arithmetic and all of the
// validation live here rather than in the React control, so both can be
// asserted without mounting anything — and so the SAME rules apply wherever a
// value is typed.

/** A typed figure and the unit it was typed in. */
export interface ValueAndUnit {
  text: string
  unitIndex: number
}

/**
 * Split a stored value into the figure and unit a student would recognise.
 *
 * Picks the largest unit that still leaves the figure at 1 or above, which is
 * how anyone writes a resistance out loud: 4700 Ω is "4.7 k", not "4700" and
 * not "0.0047 M". Zero has no meaningful prefix, so it stays on the base unit.
 */
export function splitValueUnit(
  value: number,
  units: ReadonlyArray<{ label: string; mul: number }>,
): ValueAndUnit {
  const base = Math.max(0, units.findIndex((u) => u.mul === 1))
  if (!Number.isFinite(value) || value === 0) return { text: String(value || 0), unitIndex: base }

  const mag = Math.abs(value)

  /**
   * The largest unit that still leaves the figure at 1 or above.
   *
   * `best` starts UNSET rather than at the base unit, and that is the whole
   * correctness of this function. Seeding it at the base and only ever moving
   * upward meant nothing below the stored unit could be reached: 0.47 µF
   * displayed as "0.47 µF" instead of "470 nF", and a 100 pF capacitor — stored
   * as 0.0001 µF — read as "0.0001 µF", which is exactly the unreadable figure
   * the unit dropdown exists to abolish.
   */
  let best = -1
  for (let i = 0; i < units.length; i++) {
    if (mag / units[i].mul >= 1 && (best < 0 || units[i].mul > units[best].mul)) best = i
  }

  // Smaller than the smallest unit on the ladder: there is nothing left to step
  // down to, so show it on that smallest unit rather than on the base.
  if (best < 0) {
    best = 0
    for (let i = 1; i < units.length; i++) if (units[i].mul < units[best].mul) best = i
  }

  return { text: trimFigure(value / units[best].mul), unitIndex: best }
}

/**
 * A figure a human would have typed.
 *
 * `toPrecision` rather than `toFixed`, because the error being avoided is
 * floating-point litter: 0.47 µF stored and re-split through 1e-6 comes back as
 * 0.46999999999999997, which in a text box a student is about to edit reads as
 * a bug in the editor. Six significant figures is past anything they will type
 * and short of where the litter starts.
 */
function trimFigure(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(6)))
}

/**
 * Strip binary floating-point litter from a scaled value.
 *
 * `470 * 1e-3` is 0.47000000000000003, not 0.47. Without this that is the number
 * written into the DOCUMENT — it is autosaved, it round-trips through JSON into
 * the database, and it comes back into the text field as a seventeen-digit
 * figure the student did not type and cannot correct. Twelve significant figures
 * is far past any component tolerance (a 1 % resistor has three) and comfortably
 * short of where the litter begins.
 */
function cleanFloat(n: number): number {
  if (!Number.isFinite(n) || n === 0) return n
  return Number(n.toPrecision(12))
}

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: string }

/**
 * Validate and scale a typed figure into a stored value.
 *
 * REJECTS rather than reinterprets, and that is not a style choice.
 * `Resistor.stamp` THROWS on a negative or non-finite resistance — deliberately,
 * because clamping a negative resistance silently turns it into a short and
 * returns a plausible 0 V — and `Circuit.solve()` surfaces the throw as a dead
 * simulation with a stack trace in it. The inspector is the last place that can
 * stop a student reaching that, so it does.
 *
 * Out-of-RANGE is different from invalid and is treated differently: 5 GΩ typed
 * into a field that tops out at 1 TΩ is a real value, so it is clamped and the
 * clamp is reported, rather than the entry being thrown away.
 */
export function parseValueUnit(text: string, prop: PropSpec, unitIndex: number): ParseResult {
  const units = prop.units ?? [{ label: prop.unit ?? '', mul: 1 }]
  const unit = units[unitIndex] ?? units[0]
  const trimmed = text.trim()

  if (trimmed === '') return { ok: false, reason: 'Enter a number.' }
  // Number('') is 0 and Number(' 12 ') is 12, so the emptiness check above has
  // to come first. Number('1e5') is 100000, which is a legitimate way to type it.
  const figure = Number(trimmed)
  if (!Number.isFinite(figure)) return { ok: false, reason: `"${trimmed}" is not a number.` }

  const value = cleanFloat(figure * unit.mul)
  if (!Number.isFinite(value)) return { ok: false, reason: 'That value is too large.' }

  const min = prop.min ?? -Infinity
  const max = prop.max ?? Infinity
  if (value < min) {
    return min === 0 && value < 0
      ? { ok: false, reason: `${prop.label} cannot be negative.` }
      : { ok: true, value: min }
  }
  if (value > max) return { ok: true, value: max }
  return { ok: true, value }
}

/** How a stored value reads in a sentence — "4.7 kΩ", "100 nF", "0 Ω". */
export function formatValueUnit(
  value: number,
  units: ReadonlyArray<{ label: string; mul: number }>,
): string {
  const { text, unitIndex } = splitValueUnit(value, units)
  return `${text} ${units[unitIndex]?.label ?? ''}`.trim()
}

// ─── Knob geometry ────────────────────────────────────────────────────────────

/** Degrees clockwise from twelve o'clock for a prop value. */
export function knobAngleFor(knob: KnobControl, prop: PropSpec, value: number): number {
  const min = prop.min ?? 0
  const max = prop.max ?? 100
  const span = max - min || 1
  const t = Math.min(1, Math.max(0, (value - min) / span))
  return knob.fromDeg + t * (knob.toDeg - knob.fromDeg)
}

/**
 * The prop value a pointer at (dx, dy) from the knob centre asks for.
 *
 * `atan2(dx, -dy)` rather than the usual `atan2(dy, dx)`: the artwork measures
 * from twelve o'clock going clockwise, and SVG's y axis points down.
 *
 * The dead zone at the bottom is what a real pot's end stops are. Without it,
 * dragging past either stop wraps to the far end — the knob jumps from 0 % to
 * 100 % as the pointer crosses six o'clock, which is worse than not moving at
 * all. Anything outside the sweep is CLAMPED to the nearer stop instead, chosen
 * by which end of the sweep the angle is closer to.
 */
export function knobValueFor(
  knob: KnobControl,
  prop: PropSpec,
  dx: number,
  dy: number,
): number {
  const min = prop.min ?? 0
  const max = prop.max ?? 100
  const step = prop.step ?? 1

  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI // −180…180, 0 = up
  const lo = Math.min(knob.fromDeg, knob.toDeg)
  const hi = Math.max(knob.fromDeg, knob.toDeg)
  const clampedDeg =
    deg < lo || deg > hi ? (Math.abs(angleGap(deg, lo)) <= Math.abs(angleGap(deg, hi)) ? lo : hi) : deg

  const t = (clampedDeg - knob.fromDeg) / (knob.toDeg - knob.fromDeg || 1)
  const raw = min + t * (max - min)
  const snapped = step > 0 ? Math.round(raw / step) * step : raw
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))))
}

/** Shortest signed separation between two angles, degrees. */
function angleGap(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180
}

// ─── Slider geometry ──────────────────────────────────────────────────────────

/** Where a slider's handle sits for a prop value, in part-local units. */
export function sliderPointFor(
  slider: SliderControl,
  prop: PropSpec,
  value: number,
): { x: number; y: number } {
  const min = prop.min ?? 0
  const max = prop.max ?? 100
  const span = max - min || 1
  const t = Math.min(1, Math.max(0, (value - min) / span))
  return {
    x: slider.x1 + t * (slider.x2 - slider.x1),
    y: slider.y1 + t * (slider.y2 - slider.y1),
  }
}

/**
 * The prop value a pointer at part-local (px, py) asks for.
 *
 * PROJECTED onto the track rather than measured along one axis, so a diagonal
 * track works and, more usefully, so a pointer that drifts off the line keeps
 * driving the control instead of sticking — a slider that only responded to
 * perfectly horizontal movement would read as one that jams.
 *
 * ONE CLAMP, at the end, and deliberately only one. The obvious shape is to
 * clamp the projection to the segment AND clamp the result to the prop's range,
 * but the second subsumes the first exactly — `min + t·(max − min)` is monotone
 * in t — so the first is dead code that looks like a safety net. A mutation
 * check found it: deleting it changed no behaviour and failed no test, which is
 * the definition of a line that should not be there.
 */
export function sliderValueFor(
  slider: SliderControl,
  prop: PropSpec,
  px: number,
  py: number,
): number {
  const min = prop.min ?? 0
  const max = prop.max ?? 100
  const step = prop.step ?? 1
  const dx = slider.x2 - slider.x1
  const dy = slider.y2 - slider.y1
  const len2 = dx * dx + dy * dy
  // A zero-length track has no direction to project onto. propDeclarationProblems
  // rejects one, so this is a guard against division by zero, not a behaviour.
  const t = len2 > 0 ? ((px - slider.x1) * dx + (py - slider.y1) * dy) / len2 : 0
  const snapped = step > 0 ? Math.round((min + t * (max - min)) / step) * step : min + t * (max - min)
  /**
   * THE END STOPS. Dragging past either end must HOLD at that end — the same
   * job the knob's dead zone does, and needed for the same reason: a control
   * that wrapped from 100 % to 0 % as the pointer ran off the track is worse
   * than one that does not move at all.
   */
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))))
}

// ─── Declaration self-check ───────────────────────────────────────────────────

/**
 * Every declared prop that cannot be rendered honestly, as human-readable lines.
 *
 * The failures it catches, all of which have actually happened or are one typo
 * away from happening:
 *
 *  1. NO `default`. The inspector then has nothing to show for a part whose
 *     document carries no value for the key — an authored starter, a restored
 *     attempt, a `loadInto`. It used to fall through to `options[0]`, which for
 *     a resistor is 0 Ω, "none (wire)", while compile.ts solved the same part at
 *     220 Ω. A panel that disagrees with the physics is worse than no panel.
 *  2. A `select` whose `default` is not one of its `options`. A <select> handed
 *     a value with no matching <option> renders BLANK — so the control would
 *     show nothing at all while the simulation used the declared value.
 *  3. A `choice` whose `default` is not one of its `choices` — the same blank
 *     <select>, one type along.
 *  4. A `number` with no `units`, no `mul: 1` entry, or no bounds. The stored
 *     unit IS the entry with `mul: 1`; without one, every typed figure is scaled
 *     by whatever the first row happens to be and the document silently holds a
 *     value a thousand times off. Without bounds the field would pass a negative
 *     resistance straight to `Resistor.stamp`, which throws.
 *  5. A declared `knob` naming a prop that does not exist, or one whose type
 *     cannot be dragged — the canvas would then render a control that moves
 *     nothing.
 *
 * Exported so it can be asserted in a test, and also run once at module load
 * below, because a part declared wrongly should not have to wait for someone to
 * write a test before it says so.
 */
export function propDeclarationProblems(): string[] {
  const out: string[] = []
  for (const [type, def] of Object.entries(PART_LIBRARY)) {
    for (const prop of def.props ?? []) {
      if (prop.default === undefined) {
        out.push(
          `${type}.${prop.key} declares no \`default\`, so the inspector cannot show ` +
            `what the engine will use for a part that carries no value for it.`,
        )
        continue
      }

      const wantsString = prop.type === 'choice'
      if (wantsString !== (typeof prop.default === 'string')) {
        out.push(
          `${type}.${prop.key} is a \`${prop.type}\` prop with a ` +
            `${typeof prop.default} default (${String(prop.default)}) — a \`choice\` stores ` +
            `strings and everything else stores numbers.`,
        )
        continue
      }

      if (prop.type === 'select' && !(prop.options ?? []).includes(prop.default as number)) {
        out.push(
          `${type}.${prop.key} has default ${prop.default}, which is not in its options ` +
            `[${(prop.options ?? []).join(', ')}] — the <select> would render blank.`,
        )
      }

      if (prop.type === 'choice') {
        const values = (prop.choices ?? []).map((c) => c.value)
        if (values.length === 0) {
          out.push(`${type}.${prop.key} is a \`choice\` prop with no \`choices\` to choose from.`)
        } else if (!values.includes(prop.default as string)) {
          out.push(
            `${type}.${prop.key} has default "${prop.default}", which is not in its choices ` +
              `[${values.join(', ')}] — the <select> would render blank.`,
          )
        }
      }

      if (prop.type === 'number') {
        const units = prop.units ?? []
        if (units.length === 0) {
          out.push(`${type}.${prop.key} is a \`number\` prop with no \`units\`, so it has no unit dropdown.`)
        } else if (!units.some((u) => u.mul === 1)) {
          out.push(
            `${type}.${prop.key} declares no unit with \`mul: 1\`, so nothing states which ` +
              `unit the DOCUMENT holds — every typed figure would be scaled by the wrong factor.`,
          )
        }
        if (prop.min === undefined || prop.max === undefined) {
          out.push(
            `${type}.${prop.key} is a \`number\` prop without both \`min\` and \`max\`, so a ` +
              `typed value has nothing to be clamped against.`,
          )
        } else if (!(prop.min < prop.max)) {
          out.push(`${type}.${prop.key} has min ${prop.min} >= max ${prop.max}.`)
        } else if ((prop.default as number) < prop.min || (prop.default as number) > prop.max) {
          out.push(
            `${type}.${prop.key} has default ${prop.default}, outside its own ` +
              `[${prop.min}, ${prop.max}] range.`,
          )
        }
      }
    }

    const knob = def.knob
    if (knob) {
      const target = (def.props ?? []).find((p) => p.key === knob.key)
      if (!target) {
        out.push(`${type} declares a knob on "${knob.key}", which is not one of its props.`)
      } else if (target.type !== 'range') {
        out.push(
          `${type}'s knob drives "${knob.key}", a \`${target.type}\` prop — a knob sweeps a ` +
            `\`range\`, and the panel control has to be the same value.`,
        )
      }
      if (knob.fromDeg === knob.toDeg) {
        out.push(`${type}'s knob has a zero-degree sweep, so it can never change its value.`)
      }
    }

    const slider = def.slider
    if (slider) {
      const target = (def.props ?? []).find((p) => p.key === slider.key)
      if (!target) {
        out.push(`${type} declares a slider on "${slider.key}", which is not one of its props.`)
      } else if (target.type !== 'range') {
        out.push(
          `${type}'s slider drives "${slider.key}", a \`${target.type}\` prop — a slider sweeps ` +
            `a \`range\`, and the panel control has to be the same value.`,
        )
      }
      if (slider.x1 === slider.x2 && slider.y1 === slider.y2) {
        out.push(`${type}'s slider has a zero-length track, so it can never change its value.`)
      }
    }

    /**
     * A momentary control has one more thing to check than the other two: its
     * prop must be the 0/1 shape, because pressing writes 1 and releasing
     * writes 0 and nothing else is meaningful. A momentary on a 0–100 range
     * would jump a pot's wiper to 1 % on every click.
     */
    const momentary = def.momentary
    if (momentary) {
      const target = (def.props ?? []).find((p) => p.key === momentary.key)
      if (!target) {
        out.push(
          `${type} declares a momentary control on "${momentary.key}", which is not one of its props.`,
        )
      } else if (target.type !== 'range' || target.min !== 0 || target.max !== 1) {
        out.push(
          `${type}'s momentary control drives "${momentary.key}", which is not a 0/1 \`range\` — ` +
            `a press writes 1 and a release writes 0, so anything else would be a jump to 1.`,
        )
      }
      if (!(momentary.r > 0)) {
        out.push(`${type}'s momentary control has no radius, so there is nothing to press.`)
      }
    }
  }
  return out
}

/**
 * Non-throwing on purpose. This is a wiring bug in a part declaration, not a
 * reason to take a student's editor down mid-lab — but it is loud, named and
 * unmissable in the console the moment the module loads.
 */
const PROP_PROBLEMS = propDeclarationProblems()
if (PROP_PROBLEMS.length > 0) {
  console.error('[parts] prop declaration problems:\n  ' + PROP_PROBLEMS.join('\n  '))
}
