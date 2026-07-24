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
    /** Modelled by its coil/driver resistance; activity is reported, not solved. */
    | { kind: 'load'; ohms: number; label: string }
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
  props?: Array<{
    key: string
    label: string
    type: 'number' | 'select' | 'range'
    options?: number[]
    unit?: string
    min?: number
    max?: number
    step?: number
    /**
     * The value the part has when the document carries none for this key.
     *
     * NOT decoration, and not optional in practice — see checkPropDefaults() at
     * the foot of this file. It has to equal whatever the ENGINE falls back to
     * for the same missing prop, because the inspector reads this and the
     * simulation reads that: `resistor.ohms` declared no default for months, so
     * the inspector fell through to `options[0]` — 0 Ω, "none (wire)" — over a
     * resistor compile.ts was solving at 220 Ω. The panel and the physics
     * disagreed and nothing said so.
     */
    default?: number
  }>
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
      type: 'select',
      unit: 'Ω',
      options: [0, 100, 220, 330, 470, 1000, 2200, 4700, 10000, 100000],
      default: RESISTOR_DEFAULT_OHMS,
    },
  ],
  ...wokwiGeometry('resistor'),
}

const led: PartDefinition = {
  type: 'led',
  label: 'LED',
  electrical: { kind: 'led', color: 'red' },
  ...wokwiGeometry('led'),
}

const pushButton: PartDefinition = {
  type: 'push_button',
  label: 'Push button',
  // The two pins on each side are permanently bridged inside the switch body —
  // a classic source of student confusion, and a real electrical fact.
  buses: [['1a', '1b'], ['2a', '2b']],
  electrical: { kind: 'button' },
  props: [{ key: 'pressed', label: 'Pressed', type: 'range', min: 0, max: 1, step: 1, default: 0 }],
  ...wokwiGeometry('pushbutton', {
    rename: { '1.l': '1a', '1.r': '1b', '2.l': '2a', '2.r': '2b' },
  }),
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
  electrical: { kind: 'potentiometer', totalOhms: 10000 },
  props: [
    { key: 'position', label: 'Knob', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  ],
  ...wokwiGeometry('potentiometer', {
    rename: { GND: '1', SIG: '2', VCC: '3' },
    types: { '1': 'passive', '2': 'passive', '3': 'passive' },
  }),
}

const photoresistor: PartDefinition = {
  type: 'photoresistor',
  label: 'Photoresistor',
  width: 30,
  height: 40,
  pins: [
    { id: '1', name: 'A', x: 8, y: 40, type: 'passive' },
    { id: '2', name: 'B', x: 22, y: 40, type: 'passive' },
  ],
  // Bright light drops an LDR to a few hundred ohms; darkness is hundreds of k.
  electrical: { kind: 'variable_resistor', minOhms: 200, maxOhms: 200000 },
  props: [
    { key: 'light', label: 'Light level', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 60 },
  ],
  svg: `
    <line x1="8" y1="40" x2="8" y2="28" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="22" y1="40" x2="22" y2="28" stroke="#9a9a9a" stroke-width="2"/>
    <circle cx="15" cy="18" r="13" fill="#e8d9a0" stroke="#8a7a45"/>
    <path d="M6 18 q4 -6 9 0 q4 6 9 0" fill="none" stroke="#7a4a2a" stroke-width="2"/>
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
    { key: 'microfarads', label: 'Capacitance', type: 'select', unit: 'uF',
      options: [1, 10, 47, 100, 220, 470], default: 1 },
  ],
  svg: `
    <line x1="0" y1="15" x2="16" y2="15" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="24" y1="15" x2="40" y2="15" stroke="#9a9a9a" stroke-width="2"/>
    <rect x="15" y="4" width="3" height="22" fill="#d8d8d8"/>
    <rect x="22" y="4" width="3" height="22" fill="#d8d8d8"/>
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
  'capacitor',
]

export function getPart(type: string): PartDefinition {
  const def = PART_LIBRARY[type]
  if (!def) throw new Error(`Unknown part type: ${type}`)
  return def
}

// ─── Declaration self-check ───────────────────────────────────────────────────

/**
 * Every declared prop that cannot be rendered honestly, as human-readable lines.
 *
 * Two failures, both of which have actually happened:
 *
 *  1. NO `default`. The inspector then has nothing to show for a part whose
 *     document carries no value for the key — an authored starter, a restored
 *     attempt, a `loadInto`. It used to fall through to `options[0]`, which for
 *     a resistor is 0 Ω, "none (wire)", while compile.ts solved the same part at
 *     220 Ω. A panel that disagrees with the physics is worse than no panel.
 *  2. A `select` whose `default` is not one of its `options`. A <select> handed
 *     a value with no matching <option> renders BLANK — so the control would
 *     show nothing at all while the simulation used the declared value.
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
      if (prop.type === 'select' && !(prop.options ?? []).includes(prop.default)) {
        out.push(
          `${type}.${prop.key} has default ${prop.default}, which is not in its options ` +
            `[${(prop.options ?? []).join(', ')}] — the <select> would render blank.`,
        )
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
