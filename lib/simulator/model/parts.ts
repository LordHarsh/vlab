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
  const pins: PinGeometry[] = []
  // Digital header along the top, analog + power along the bottom.
  const digital = ['D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0']
  digital.forEach((id, i) => {
    pins.push({ id, name: id, x: 30 + i * PITCH, y: 5, type: 'digital' })
  })
  const bottom: Array<[string, PinType]> = [
    ['GND.1', 'gnd'], ['GND.2', 'gnd'], ['5V', 'power'], ['3V3', 'power'], ['VIN', 'power'],
    ['A0', 'analog'], ['A1', 'analog'], ['A2', 'analog'], ['A3', 'analog'], ['A4', 'analog'], ['A5', 'analog'],
  ]
  bottom.forEach(([id, type], i) => {
    pins.push({ id, name: id, x: 30 + i * PITCH, y: 95, type })
  })

  const labels = pins
    .map(
      (p) =>
        `<text x="${p.x}" y="${p.y < 50 ? p.y + 12 : p.y - 6}" font-size="5" text-anchor="middle" fill="#dff3f0" font-family="monospace">${p.name.replace('.1', '').replace('.2', '')}</text>`,
    )
    .join('')

  return {
    type: 'arduino_uno',
    label: 'Arduino Uno',
    width: 190,
    height: 100,
    pins,
    // All GND pins are the same net on the real board.
    buses: [['GND.1', 'GND.2']],
    electrical: { kind: 'mcu', board: 'arduino_uno' },
    svg: `
      <rect x="0" y="0" width="190" height="100" rx="6" fill="#16a3a3" stroke="#0f7d7d"/>
      <rect x="24" y="0" width="146" height="10" fill="#0d5f5f"/>
      <rect x="24" y="90" width="116" height="10" fill="#0d5f5f"/>
      <rect x="60" y="35" width="70" height="30" rx="2" fill="#1b1b1b"/>
      <text x="95" y="54" font-size="11" text-anchor="middle" fill="#ffffff" font-family="monospace">UNO</text>
      ${labels}
    `,
  }
}

// ─── Discretes ────────────────────────────────────────────────────────────────

const resistor: PartDefinition = {
  type: 'resistor',
  label: 'Resistor',
  width: 60,
  height: 20,
  pins: [
    { id: '1', name: 'A', x: 0, y: 10, type: 'passive' },
    { id: '2', name: 'B', x: 60, y: 10, type: 'passive' },
  ],
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
  svg: `
    <line x1="0" y1="10" x2="16" y2="10" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="44" y1="10" x2="60" y2="10" stroke="#9a9a9a" stroke-width="2"/>
    <rect x="16" y="3" width="28" height="14" rx="3" fill="#d9b382" stroke="#a8875c"/>
    <rect x="21" y="3" width="3" height="14" fill="#7b3f00"/>
    <rect x="26" y="3" width="3" height="14" fill="#111"/>
    <rect x="31" y="3" width="3" height="14" fill="#b5442e"/>
    <rect x="37" y="3" width="2" height="14" fill="#d4af37"/>
  `,
}

const led: PartDefinition = {
  type: 'led',
  label: 'LED',
  width: 30,
  height: 40,
  pins: [
    { id: 'A', name: 'Anode (+)', x: 10, y: 40, type: 'passive' },
    { id: 'C', name: 'Cathode (−)', x: 20, y: 40, type: 'passive' },
  ],
  electrical: { kind: 'led', color: 'red' },
  svg: `
    <line x1="10" y1="40" x2="10" y2="26" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="20" y1="40" x2="20" y2="30" stroke="#9a9a9a" stroke-width="2"/>
    <path d="M4 26 A11 11 0 0 1 26 26 L26 30 L4 30 Z" fill="var(--led-fill, #b03030)" stroke="#7d2020"/>
    <circle cx="15" cy="20" r="11" fill="var(--led-fill, #b03030)" stroke="#7d2020"/>
  `,
}

const pushButton: PartDefinition = {
  type: 'push_button',
  label: 'Push button',
  width: 40,
  height: 40,
  pins: [
    { id: '1a', name: '1a', x: 5, y: 5, type: 'passive' },
    { id: '1b', name: '1b', x: 5, y: 35, type: 'passive' },
    { id: '2a', name: '2a', x: 35, y: 5, type: 'passive' },
    { id: '2b', name: '2b', x: 35, y: 35, type: 'passive' },
  ],
  // The two pins on each side are permanently bridged inside the switch body —
  // a classic source of student confusion, and a real electrical fact.
  buses: [['1a', '1b'], ['2a', '2b']],
  electrical: { kind: 'button' },
  props: [{ key: 'pressed', label: 'Pressed', type: 'range', min: 0, max: 1, step: 1, default: 0 }],
  svg: `
    <rect x="2" y="2" width="36" height="36" rx="3" fill="#2b2b2b" stroke="#111"/>
    <circle cx="20" cy="20" r="10" fill="#d8d8d8" stroke="#9a9a9a"/>
  `,
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
  width: 50,
  height: 50,
  pins: [
    { id: '1', name: 'Left', x: 5, y: 50, type: 'passive' },
    { id: '2', name: 'Wiper', x: 25, y: 50, type: 'passive' },
    { id: '3', name: 'Right', x: 45, y: 50, type: 'passive' },
  ],
  electrical: { kind: 'potentiometer', totalOhms: 10000 },
  props: [
    { key: 'position', label: 'Knob', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  ],
  svg: `
    <circle cx="25" cy="25" r="20" fill="#2b2b2b" stroke="#111"/>
    <circle cx="25" cy="25" r="14" fill="#4a4a4a"/>
    <line x1="25" y1="25" x2="25" y2="12" stroke="#e8e8e8" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="5" y1="50" x2="5" y2="43" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="25" y1="50" x2="25" y2="45" stroke="#9a9a9a" stroke-width="2"/>
    <line x1="45" y1="50" x2="45" y2="43" stroke="#9a9a9a" stroke-width="2"/>
  `,
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
  width: 40,
  height: 40,
  pins: [
    { id: 'P', name: '+', x: 12, y: 40, type: 'passive' },
    { id: 'N', name: '-', x: 28, y: 40, type: 'passive' },
  ],
  electrical: { kind: 'load', ohms: 300, label: 'Buzzer' },
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
]

export function getPart(type: string): PartDefinition {
  const def = PART_LIBRARY[type]
  if (!def) throw new Error(`Unknown part type: ${type}`)
  return def
}
