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

import { UNO_RENAME, wokwiGeometry } from './wokwi'

export const PITCH = 10

export type PinType = 'power' | 'gnd' | 'digital' | 'analog' | 'passive'

/**
 * Every MCU board the simulator can run.
 *
 * Two entries, and deliberately a closed union rather than a plugin registry:
 * the two tracks run different emulators (`avr8js` vs `rp2040js`) and different
 * toolchains (a precompiled .hex vs MicroPython typed into a REPL), so a third
 * board is a real piece of work and not a data row. See model/boards.ts for the
 * per-board profile the engine selection reads.
 */
export type BoardType = 'arduino_uno' | 'raspberry_pi_pico'

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
        protocol: 'dht11' | 'hc_sr04' | 'pir' | 'flow'
        drives: string[]
      }
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
    default?: number
  }>
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
  electrical: { kind: 'resistor', defaultOhms: 220 },
  props: [
    {
      key: 'ohms',
      label: 'Resistance',
      type: 'select',
      unit: 'Ω',
      options: [0, 100, 220, 330, 470, 1000, 2200, 4700, 10000, 100000],
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
    { key: 'microfarads', label: 'Capacitance', type: 'select', unit: 'uF',
      options: [1, 10, 47, 100, 220, 470] },
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
  hc_sr04: hcsr04,
  pir_motion: pirMotion,
  flow_sensor: flowSensor,
  capacitor,
}

/** Palette order. Breadboard and board first — students place those first too. */
export const PALETTE: string[] = [
  'arduino_uno',
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
  'dht11',
  'hc_sr04',
  'pir_motion',
  'flow_sensor',
  'capacitor',
]

export function getPart(type: string): PartDefinition {
  const def = PART_LIBRARY[type]
  if (!def) throw new Error(`Unknown part type: ${type}`)
  return def
}
