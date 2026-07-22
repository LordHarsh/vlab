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
    | { kind: 'mcu'; board: 'arduino_uno' }
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
    /** Talks a wire protocol; needs a behavioural model (§7.1 tier 2). */
    | { kind: 'sensor'; protocol: 'dht11' }
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
    electrical: { kind: 'mcu', board: 'arduino_uno' },
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
  electrical: { kind: 'load', ohms: 300, label: 'Buzzer' },
  // Hand-drawn on purpose. The harvested wokwi buzzer declares an 8x8 SVG but
  // places its pins at (27,84) — it sizes itself with CSS outside the SVG, so
  // the art and the pin coordinates do not share a coordinate system.
  width: 40,
  height: 40,
  pins: [
    { id: 'P', name: '+', x: 12, y: 40, type: 'passive' },
    { id: 'N', name: '-', x: 28, y: 40, type: 'passive' },
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
  electrical: { kind: 'load', ohms: 120, label: 'Motor' },
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
  electrical: { kind: 'sensor', protocol: 'dht11' },
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
  capacitor,
}

/** Palette order. Breadboard and board first — students place those first too. */
export const PALETTE: string[] = [
  'arduino_uno',
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
  'capacitor',
]

export function getPart(type: string): PartDefinition {
  const def = PART_LIBRARY[type]
  if (!def) throw new Error(`Unknown part type: ${type}`)
  return def
}
