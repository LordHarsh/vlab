/**
 * Authored lab starters (model/examples.ts → EXPERIMENT_STARTERS).
 *
 * These seven documents are PRODUCTION CONTENT: migrations 020, 021 and 022
 * load them into `circuits` as role='starter', and they are the first thing a
 * student sees when they open the native editor for experiments 1, 2, 3, 4, 5,
 * 6 and 7. Nothing else in the test suite would notice if one of them were
 * quietly corrupted — compile() is happy to derive a netlist from a document
 * with a typo'd pin id, and the solver is happy to solve it.
 *
 * TWO BOARDS, ONE FILE. Experiments 5 and 7 are Raspberry Pi Pico circuits, and
 * almost everything below is therefore parameterised by board rather than
 * assuming an Uno: the supply pin ('3.3V' against '5V'), the rail voltage, the
 * pad's output impedance, and the value the DATABASE has to record
 * ('rp2040' against 'arduino_uno' — see BOARD_OF). The one thing a Pico starter
 * must never do is inherit 5 V arithmetic, so §2 and §5 assert the rail and the
 * resulting LED current explicitly.
 *
 * So this file pins down, exactly:
 *
 *   1. STRUCTURE   — part counts, part types, unique ids, and every wire
 *                    endpoint resolving to a pin that actually exists. A pin id
 *                    typo ("tp2" → "tp02") is silent everywhere else: compile()
 *                    skips the wire and the rail simply stops working. Plus the
 *                    BOARD each document selects, because that is what decides
 *                    which emulator runs it and which string the DB will accept.
 *   2. PRE-WIRING  — the supply plumbing really is plumbed. Board GND and both
 *                    negative rails are one net; the supply feed reaches both
 *                    positive rails, AT THE BOARD'S OWN VOLTAGE.
 *   3. PROBLEMS    — the EXACT set compile() reports. The starters are
 *                    deliberately unfinished, so "part is not connected"
 *                    notices are expected and are the student's to-do list.
 *                    Anything else — a crossed centre channel, a dangling MCU
 *                    pin, a missing ground — is a bug in the starter.
 *   4. SOLVABILITY — it compiles, it solves, no faults, no solver error.
 *   5. COMPLETABLE — wiring it up the way the lab sheet describes yields a
 *                    circuit with ZERO problems and LEDs that draw a sane
 *                    current. A starter that cannot be finished with the parts
 *                    it ships is worse than no starter at all.
 *   6. MIGRATION   — the graphs embedded in
 *                    supabase/migrations/020_native_experiments.sql,
 *                    021_native_experiments_2_4_6.sql and
 *                    022_native_experiments_5_7.sql are structurally identical
 *                    to the TypeScript ones, and each file records the board
 *                    value its own starters need. Two copies of the same
 *                    document is the whole risk here.
 *
 * Run: npx tsx lib/simulator/__tests__/starters.test.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOARDS, detectBoard } from '../model/boards'
import { compile } from '../model/compile'
import { partBounds, pinKeyOf, type CircuitDoc, type DocWire, type PlacedPart } from '../model/document'
import {
  EXPERIMENT_STARTERS,
  STARTER_DHT11_PICO,
  STARTER_LED_BUTTON_PICO,
  STARTER_LED_DHT11,
  STARTER_PIR_ALARM,
  STARTER_TRAFFIC_LIGHT,
  STARTER_ULTRASONIC_PIR,
  STARTER_WATER_FLOW,
} from '../model/examples'
import { getPart, type BoardType } from '../model/parts'

/** The AVR pin model, restated — see the same note in compile.test.ts. */
const R_DRIVE = 25
const G_FLOAT = 1e-8
const VCC = 5

/**
 * The RP2040's, restated the same way (lib/simulator/pico/engine.ts).
 *
 * The pad is a WEAKER driver than the AVR's — 50 Ω against 25 Ω — on top of a
 * lower rail, and the internal pull-down a `Pin.PULL_DOWN` input enables is
 * 55 kΩ. All three matter to the numbers §5 asserts for experiment 05.
 */
const PICO_R_DRIVE = 50
const PICO_R_PULL = 55_000
const PICO_VDD = 3.3

/**
 * What each starter's board means everywhere else in this file.
 *
 * `dbBoard` is the value `circuits.board` must carry, and it is NOT the part
 * type: migration 015's check constraint predates the Pico part and accepts
 * 'rp2040' only. Reading it off BOARDS rather than restating it here is
 * deliberate — pico.test.ts group J already checks BOARDS against the text of
 * migration 015, so this file inherits that check instead of copying a string
 * that could rot.
 */
const BOARD_OF: Record<
  string,
  { mcu: string; type: BoardType; supplyPin: string; gndPin: string; volts: number; rDrive: number }
> = {
  'led-dht11-arduino': { mcu: 'uno', type: 'arduino_uno', supplyPin: '5V', gndPin: 'GND.2', volts: VCC, rDrive: R_DRIVE },
  'ultrasonic-pir-arduino': { mcu: 'uno', type: 'arduino_uno', supplyPin: '5V', gndPin: 'GND.2', volts: VCC, rDrive: R_DRIVE },
  'traffic-light-arduino': { mcu: 'uno', type: 'arduino_uno', supplyPin: '5V', gndPin: 'GND.2', volts: VCC, rDrive: R_DRIVE },
  'water-flow-arduino': { mcu: 'uno', type: 'arduino_uno', supplyPin: '5V', gndPin: 'GND.2', volts: VCC, rDrive: R_DRIVE },
  'pir-alarm-arduino': { mcu: 'uno', type: 'arduino_uno', supplyPin: '5V', gndPin: 'GND.2', volts: VCC, rDrive: R_DRIVE },
  'led-button-rpi': { mcu: 'pico', type: 'raspberry_pi_pico', supplyPin: '3.3V', gndPin: 'GND.7', volts: PICO_VDD, rDrive: PICO_R_DRIVE },
  'dht11-rpi': { mcu: 'pico', type: 'raspberry_pi_pico', supplyPin: '3.3V', gndPin: 'GND.7', volts: PICO_VDD, rDrive: PICO_R_DRIVE },
}

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, a === e ? '' : `expected ${e}, got ${a}`)
}

function typeCounts(doc: CircuitDoc): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of doc.parts) out[p.type] = (out[p.type] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

function wire(id: string, from: [string, string], to: [string, string]): DocWire {
  return {
    id,
    from: { partId: from[0], pinId: from[1] },
    to: { partId: to[0], pinId: to[1] },
    color: '#2563eb',
  }
}

/**
 * Compile, drive the named pins, and solve — the same thing the engine does.
 *
 * `opts` is what makes this work for either board. Defaulting to the Uno keeps
 * every existing call site unchanged; a Pico circuit passes its own rail and pad
 * impedance, and `pullDown` is the one drive state the AVR has no equivalent of
 * (an RP2040 input with `Pin.PULL_DOWN` set).
 */
function solveDoc(
  doc: CircuitDoc,
  high: string[] = [],
  opts: { volts?: number; rDrive?: number; pullDown?: string[] } = {},
) {
  const volts = opts.volts ?? VCC
  const rDrive = opts.rDrive ?? R_DRIVE
  const c = compile(doc)
  for (const [name, port] of c.mcuPorts) {
    if (high.includes(name)) port.set(1 / rDrive, volts / rDrive)
    else if (opts.pullDown?.includes(name)) port.set(1 / PICO_R_PULL, 0)
    else port.set(G_FLOAT, 0)
  }
  return { c, res: c.circuit.solve() }
}

// ─── 1. Structure ─────────────────────────────────────────────────────────────

console.log('\n1. Structure')

eq('1.1 exactly seven experiments have authored starters', Object.keys(EXPERIMENT_STARTERS).sort(), [
  'dht11-rpi',
  'led-button-rpi',
  'led-dht11-arduino',
  'pir-alarm-arduino',
  'traffic-light-arduino',
  'ultrasonic-pir-arduino',
  'water-flow-arduino',
])

const EXPECTED: Record<
  string,
  {
    doc: CircuitDoc
    parts: number
    wires: number
    types: Record<string, number>
    /** Sorted resistor values — the lab sheet's bill of materials, in ohms. */
    ohms: number[]
    /**
     * Every part that carries authored props, and exactly what they are.
     *
     * These are not decoration. `passive: 0` is what makes experiment 6's
     * buzzer the ACTIVE one its bill of materials calls for — a passive piezo
     * is a capacitor and draws no DC current at all — and the PIR's
     * `warmup: 0` is what stops the starter looking dead for the first minute.
     * Drop one and the part silently falls back to a library default.
     */
    props: Record<string, Record<string, number>>
  }
> = {
  'led-dht11-arduino': {
    doc: STARTER_LED_DHT11,
    parts: 6,
    wires: 4,
    types: { arduino_uno: 1, breadboard: 1, dht11: 1, led: 1, resistor: 2 },
    ohms: [220, 10000],
    props: {
      dht: { temperature: 24, humidity: 45 },
      r10k: { ohms: 10000 },
      r220: { ohms: 220 },
    },
  },
  'ultrasonic-pir-arduino': {
    doc: STARTER_ULTRASONIC_PIR,
    parts: 6,
    wires: 4,
    types: { arduino_uno: 1, breadboard: 1, hc_sr04: 1, led: 1, pir_motion: 1, resistor: 1 },
    ohms: [220],
    props: {
      hcsr04: { distance: 50 },
      pir: { motion: 0, hold: 5, warmup: 0 },
      r220: { ohms: 220 },
    },
  },
  'traffic-light-arduino': {
    doc: STARTER_TRAFFIC_LIGHT,
    parts: 9,
    wires: 4,
    types: { arduino_uno: 1, breadboard: 1, led: 3, push_button: 1, resistor: 3 },
    ohms: [220, 220, 220],
    props: {
      r_red: { ohms: 220 },
      r_yellow: { ohms: 220 },
      r_green: { ohms: 220 },
      btn: { pressed: 0 },
    },
  },
  'water-flow-arduino': {
    doc: STARTER_WATER_FLOW,
    parts: 4,
    wires: 4,
    types: { arduino_uno: 1, breadboard: 1, flow_sensor: 1, resistor: 1 },
    ohms: [10000],
    props: {
      flow: { flow: 10 },
      r10k: { ohms: 10000 },
    },
  },
  'pir-alarm-arduino': {
    doc: STARTER_PIR_ALARM,
    parts: 8,
    wires: 4,
    types: { arduino_uno: 1, breadboard: 1, buzzer: 1, led: 2, pir_motion: 1, resistor: 2 },
    ohms: [220, 220],
    props: {
      pir: { motion: 0, hold: 5, warmup: 0 },
      buzzer: { passive: 0 },
      r_red: { ohms: 220 },
      r_green: { ohms: 220 },
    },
  },
  // ── Pico ──
  // 220 Ω and 10 kΩ are the lab sheet's own values and are still right on 3.3 V,
  // because the published content targets a Raspberry Pi SBC, which is also a
  // 3.3 V part. A 5 V starter's values would NOT have ported across.
  'led-button-rpi': {
    doc: STARTER_LED_BUTTON_PICO,
    parts: 6,
    wires: 4,
    types: { breadboard: 1, led: 1, push_button: 1, raspberry_pi_pico: 1, resistor: 2 },
    ohms: [220, 10000],
    props: {
      r220: { ohms: 220 },
      r10k: { ohms: 10000 },
      btn: { pressed: 0 },
    },
  },
  'dht11-rpi': {
    doc: STARTER_DHT11_PICO,
    parts: 4,
    wires: 4,
    types: { breadboard: 1, dht11: 1, raspberry_pi_pico: 1, resistor: 1 },
    ohms: [10000],
    props: {
      dht: { temperature: 24, humidity: 45 },
      r10k: { ohms: 10000 },
    },
  },
}

for (const [slug, exp] of Object.entries(EXPECTED)) {
  const doc = EXPERIMENT_STARTERS[slug]
  check(`1.2 ${slug}: EXPERIMENT_STARTERS points at the exported constant`, doc === exp.doc)
  eq(`1.3 ${slug}: part count`, doc.parts.length, exp.parts)
  eq(`1.4 ${slug}: wire count`, doc.wires.length, exp.wires)
  eq(`1.5 ${slug}: part types`, typeCounts(doc), exp.types)

  /**
   * Which BOARD the document selects, read exactly the way the editor reads it.
   *
   * Nothing else in this file would notice a starter shipped with the wrong MCU:
   * both boards compile, both solve, and the only visible difference is a rail
   * voltage. detectBoard() is what picks the emulator, so a starter that does
   * not resolve to exactly one board is a starter that cannot be run at all.
   */
  const board = BOARD_OF[slug]
  const detected = detectBoard(doc)
  eq(
    `1.14 ${slug}: detectBoard resolves it to one board`,
    detected.board?.type ?? `no board: ${detected.problem}`,
    board.type,
  )
  check(
    `1.15 ${slug}: the MCU is the part id the wires name`,
    doc.parts.some((p) => p.id === board.mcu && p.type === board.type),
    doc.parts.map((p) => `${p.id}:${p.type}`).join(','),
  )

  const ids = [...doc.parts.map((p) => p.id), ...doc.wires.map((w) => w.id)]
  eq(`1.6 ${slug}: ids are unique`, ids.length, new Set(ids).size)

  // Every endpoint must resolve. This is the check that catches a rail typo.
  const byId = new Map(doc.parts.map((p) => [p.id, p]))
  const bad: string[] = []
  for (const w of doc.wires) {
    for (const ref of [w.from, w.to]) {
      const part: PlacedPart | undefined = byId.get(ref.partId)
      if (!part) {
        bad.push(`${w.id}: no part "${ref.partId}"`)
        continue
      }
      if (!getPart(part.type).pins.some((p) => p.id === ref.pinId)) {
        bad.push(`${w.id}: ${part.type} has no pin "${ref.pinId}"`)
      }
    }
  }
  eq(`1.7 ${slug}: every wire endpoint resolves to a real pin`, bad, [])

  // Resistors must carry an explicit, CORRECT value. Without one the compiler
  // falls back to its 220 Ω default, which silently turns the DHT11's 10 kΩ
  // pull-up into a near-short across the supply.
  const resistors = doc.parts.filter((q) => q.type === 'resistor')
  for (const p of resistors) {
    check(
      `1.8 ${slug}: resistor "${p.id}" declares its ohms`,
      typeof p.props.ohms === 'number' && (p.props.ohms as number) > 0,
      JSON.stringify(p.props),
    )
  }
  eq(
    `1.9 ${slug}: resistor values match the bill of materials`,
    resistors.map((p) => Number(p.props.ohms)).sort((a, b) => a - b),
    exp.ohms,
  )

  // Authored props, exactly. A dropped `passive: 0` turns experiment 6's active
  // buzzer into a piezo that draws no DC current, and nothing else here would
  // notice — the circuit still solves, it just never makes a sound.
  const authored: Record<string, Record<string, number>> = {}
  for (const p of doc.parts) {
    if (Object.keys(p.props).length > 0) authored[p.id] = p.props as Record<string, number>
  }
  eq(`1.12 ${slug}: authored props are exactly the ones the lab sheet needs`, authored, exp.props)

  // …and every key must be one the part actually declares. A typo'd key is
  // accepted by the document type (props is Record<string, …>) and then ignored
  // by the compiler, so the part quietly runs on its library default.
  const strayProps: string[] = []
  for (const p of doc.parts) {
    const declared = new Set((getPart(p.type).props ?? []).map((d) => d.key))
    for (const key of Object.keys(p.props)) {
      if (!declared.has(key)) strayProps.push(`${p.id}.${key}`)
    }
  }
  eq(`1.13 ${slug}: no prop key the part library does not declare`, strayProps, [])

  // Layout sanity. A part dropped inside another is not an electrical fault, so
  // nothing else here would catch it — but a resistor buried in the ATmega328
  // is unfindable and unpickable, and that has happened before (see freeSpot()
  // in CircuitEditor). The canvas opens at translate(40 30) scale(1.1), so the
  // whole tray must also stay inside a modest first view.
  const boxes = doc.parts.map((p) => ({ id: p.id, x: p.x, y: p.y, ...partBounds(p) }))
  const overlaps: string[] = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        overlaps.push(`${a.id}/${b.id}`)
      }
    }
  }
  eq(`1.10 ${slug}: no two parts overlap on the canvas`, overlaps, [])
  const far = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > 900 || b.y + b.h > 620)
  eq(`1.11 ${slug}: every part is in the opening view`, far.map((b) => b.id), [])
}

// ─── 2. Pre-wiring: the supply plumbing ───────────────────────────────────────

console.log('\n2. Pre-wired supply rails')

for (const slug of Object.keys(EXPECTED)) {
  const doc = EXPERIMENT_STARTERS[slug]
  const board = BOARD_OF[slug]
  const { netOf } = compile(doc)
  const netAt = (partId: string, pinId: string) => netOf.get(pinKeyOf({ partId, pinId }))

  // Ground is net 0 by construction. Both blue rails must be on it — the top
  // one through the board's jumper, the bottom one through the tn29→bn29 bridge.
  eq(`2.1 ${slug}: board GND is net 0`, netAt(board.mcu, board.gndPin), 0)
  eq(`2.2 ${slug}: top negative rail is ground`, netAt('bb', 'tn2'), 0)
  eq(`2.3 ${slug}: bottom negative rail is ground (bridge works)`, netAt('bb', 'bn29'), 0)
  eq(`2.4 ${slug}: a hole far along the negative rail is ground`, netAt('bb', 'bn15'), 0)

  // The positive rail carries no COMPONENT but the board's supply pin, so
  // compile() correctly prunes it as inert — there is nothing to solve for.
  // Prove it is nonetheless wired by hanging a load on it and watching the rail
  // voltage appear.
  const probe: CircuitDoc = {
    parts: [...doc.parts, { id: 'probe', type: 'resistor', x: 0, y: 0, rotation: 0, props: { ohms: 1000 } }],
    // Bottom positive rail on one end, bottom negative on the other: this only
    // reads the rail if BOTH the board's feed and BOTH rail bridges are intact.
    wires: [...doc.wires, wire('probe_p', ['probe', '1'], ['bb', 'bp5']), wire('probe_n', ['probe', '2'], ['bb', 'bn5'])],
  }
  const { c, res } = solveDoc(probe, [], { volts: board.volts, rDrive: board.rDrive })
  const railNet = c.netOf.get(pinKeyOf({ partId: 'bb', pinId: 'bp5' }))
  check(`2.5 ${slug}: probe across the bottom rails solves`, res.ok, res.error ?? '')
  /**
   * THE RAIL VOLTAGE ITSELF, not just "some voltage". A Pico starter that had
   * been copied from an Uno one would plumb the '5V' pad — which on a Pico is
   * VBUS, raw USB power, not the logic rail — and every part hung on the rail
   * would then be fed 5 V by a 3.3 V board. It would solve perfectly.
   */
  check(
    `2.6 ${slug}: bottom positive rail sits at ${board.volts} V`,
    railNet !== undefined && Math.abs(res.voltages[railNet] - board.volts) < 1e-6,
    `net ${railNet} = ${railNet === undefined ? 'n/a' : res.voltages[railNet]}`,
  )
  check(
    `2.7 ${slug}: ${board.volts} mA through a 1 kΩ probe across the rails`,
    Math.abs(Math.abs(c.meters.get('probe')!.current) - board.volts / 1000) < 1e-6,
    String(c.meters.get('probe')!.current),
  )
}

// ─── 3. Problems: exactly the to-do list, nothing else ────────────────────────

console.log('\n3. Reported problems')

const EXPECTED_PROBLEMS: Record<string, string[]> = {
  'led-dht11-arduino': [
    'DHT11 sensor "dht" is not connected to anything.',
    'Resistor "r10k" is not connected to anything.',
    'Resistor "r220" is not connected to anything.',
    'LED "led" is not connected to anything.',
  ],
  // Both sensors appear, supply pins and all. They are unwired ON PURPOSE — the
  // behavioural models will not answer on an unpowered VCC, so forgetting the
  // sensor's own power is a mistake the student gets to make and diagnose.
  'ultrasonic-pir-arduino': [
    'HC-SR04 ultrasonic "hcsr04" is not connected to anything.',
    'PIR motion sensor "pir" is not connected to anything.',
    'Resistor "r220" is not connected to anything.',
    'LED "led" is not connected to anything.',
  ],
  // The push button is legitimately absent: an unwired button's two internal
  // buses each carry two of its own pins, so it never looks like a dead end.
  'traffic-light-arduino': [
    'Resistor "r_red" is not connected to anything.',
    'Resistor "r_yellow" is not connected to anything.',
    'Resistor "r_green" is not connected to anything.',
    'LED "led_red" is not connected to anything.',
    'LED "led_yellow" is not connected to anything.',
    'LED "led_green" is not connected to anything.',
  ],
  'water-flow-arduino': [
    'YF-S201 flow sensor "flow" is not connected to anything.',
    'Resistor "r10k" is not connected to anything.',
  ],
  'pir-alarm-arduino': [
    'PIR motion sensor "pir" is not connected to anything.',
    'Buzzer "buzzer" is not connected to anything.',
    'Resistor "r_red" is not connected to anything.',
    'Resistor "r_green" is not connected to anything.',
    'LED "led_red" is not connected to anything.',
    'LED "led_green" is not connected to anything.',
  ],
  // The push button is legitimately absent here for the same reason as
  // experiment 03's: its two internal buses each carry two of its own pins, so
  // an unwired button never looks like a dead end to the connectivity check.
  'led-button-rpi': [
    'Resistor "r220" is not connected to anything.',
    'Resistor "r10k" is not connected to anything.',
    'LED "led" is not connected to anything.',
  ],
  'dht11-rpi': [
    'DHT11 sensor "dht" is not connected to anything.',
    'Resistor "r10k" is not connected to anything.',
  ],
}

for (const [slug, expected] of Object.entries(EXPECTED_PROBLEMS)) {
  const r = compile(EXPERIMENT_STARTERS[slug])
  eq(`3.1 ${slug}: problems are exactly the unwired-part to-do list`, r.problems, expected)
  check(
    `3.2 ${slug}: no centre-channel mistakes in the authored wiring`,
    !r.problems.some((p) => p.includes('centre channel')),
  )
  check(`3.3 ${slug}: no dangling MCU pin`, !r.problems.some((p) => p.includes('dangling')))
  check(`3.4 ${slug}: ground exists`, !r.problems.some((p) => p.includes('No ground')))
  eq(`3.5 ${slug}: nothing is shorted to ground`, r.shortedPins, [])
  eq(`3.6 ${slug}: no unsimulatable parts`, r.limitations, [])
}

// ─── 4. It compiles and solves ────────────────────────────────────────────────

console.log('\n4. Compiles and solves')

const EXPECTED_SIZE: Record<string, { unknowns: number; activeNets: number }> = {
  // Every floating lead is its own node until the student joins them, so the
  // UNWIRED starter is the worst case: 9 component nets + ground, plus the
  // LED's internal series node.
  'led-dht11-arduino': { unknowns: 10, activeNets: 10 },
  // 11 component nets + ground, plus the LED's internal series node. Both
  // sensors contribute every pin they have (4 + 3), because an unwired sensor
  // pin still touches a discrete component and so is never pruned as inert.
  'ultrasonic-pir-arduino': { unknowns: 12, activeNets: 12 },
  // 14 component nets + ground, plus three LED internal nodes. Above the ~15
  // unknown budget only because nothing is joined yet; the finished circuit is
  // asserted below and comes in well under it.
  'traffic-light-arduino': { unknowns: 17, activeNets: 15 },
  // The smallest starter in the lab: one 3-pin sensor and one resistor.
  'water-flow-arduino': { unknowns: 5, activeNets: 6 },
  // 13 component nets + ground, plus two LED internal nodes. Exactly at the
  // ~15 budget in its worst (fully unwired) state; the finished alarm below is
  // 10.
  'pir-alarm-arduino': { unknowns: 15, activeNets: 14 },
  // 8 component nets + ground, plus the LED's internal series node. The button
  // contributes two nets (one per internal bus) even unwired, because its
  // contacts are modelled as a 1e12 Ω resistor rather than a removed device.
  'led-button-rpi': { unknowns: 9, activeNets: 9 },
  // The smallest Pico starter: one 3-pin sensor and one resistor. Identical in
  // size to experiment 04's, which is the same shape of circuit.
  'dht11-rpi': { unknowns: 5, activeNets: 6 },
}

for (const [slug, size] of Object.entries(EXPECTED_SIZE)) {
  const board = BOARD_OF[slug]
  const { c, res } = solveDoc(EXPERIMENT_STARTERS[slug], [], {
    volts: board.volts,
    rDrive: board.rDrive,
  })
  eq(`4.1 ${slug}: matrix unknowns`, c.unknowns, size.unknowns)
  eq(`4.2 ${slug}: active nets`, c.nets.filter((n) => n.active).length, size.activeNets)
  check(`4.3 ${slug}: solves`, res.ok, res.error ?? '')
  eq(`4.4 ${slug}: no faults`, res.faults, [])
  check(`4.5 ${slug}: no solver error`, res.error === undefined, String(res.error))
}

// ─── 5. Completable with the parts it ships ───────────────────────────────────
//
// The student's half of the work, done the way the lab sheet describes it and
// on the breadboard rather than pin-to-pin. If either of these stops reaching
// zero problems, the starter is missing a part or a rail.

console.log('\n5. Completable')

const COMPLETED_DHT: CircuitDoc = {
  parts: STARTER_LED_DHT11.parts,
  wires: [
    ...STARTER_LED_DHT11.wires,
    // DHT11: supply from the rails, DATA onto lower-bank column 10.
    wire('s1', ['dht', 'VCC'], ['bb', 'tp5']),
    wire('s2', ['dht', 'GND'], ['bb', 'tn5']),
    wire('s3', ['dht', 'DATA'], ['bb', 'a10']),
    wire('s4', ['uno', 'D2'], ['bb', 'b10']),
    // The datasheet's 10 k pull-up, from that same column up to +5 V.
    wire('s5', ['r10k', '1'], ['bb', 'c10']),
    wire('s6', ['r10k', '2'], ['bb', 'tp12']),
    // D13 → 220 Ω → LED → ground rail.
    wire('s7', ['uno', 'D13'], ['bb', 'a15']),
    wire('s8', ['r220', '1'], ['bb', 'b15']),
    wire('s9', ['r220', '2'], ['bb', 'b20']),
    wire('s10', ['led', 'A'], ['bb', 'c20']),
    wire('s11', ['led', 'C'], ['bb', 'c25']),
    wire('s12', ['bb', 'd25'], ['bb', 'bn25']),
  ],
}

const COMPLETED_TRAFFIC: CircuitDoc = {
  parts: STARTER_TRAFFIC_LIGHT.parts,
  wires: [
    ...STARTER_TRAFFIC_LIGHT.wires,
    // Red on D2, lower bank, columns 2 → 6 → 10.
    wire('t1', ['uno', 'D2'], ['bb', 'a2']),
    wire('t2', ['r_red', '1'], ['bb', 'b2']),
    wire('t3', ['r_red', '2'], ['bb', 'b6']),
    wire('t4', ['led_red', 'A'], ['bb', 'c6']),
    wire('t5', ['led_red', 'C'], ['bb', 'c10']),
    wire('t6', ['bb', 'd10'], ['bb', 'bn10']),
    // Yellow on D3, lower bank, columns 13 → 17 → 21.
    wire('t7', ['uno', 'D3'], ['bb', 'a13']),
    wire('t8', ['r_yellow', '1'], ['bb', 'b13']),
    wire('t9', ['r_yellow', '2'], ['bb', 'b17']),
    wire('t10', ['led_yellow', 'A'], ['bb', 'c17']),
    wire('t11', ['led_yellow', 'C'], ['bb', 'c21']),
    wire('t12', ['bb', 'd21'], ['bb', 'bn21']),
    // Green on D4, UPPER bank this time, columns 24 → 28 → 30.
    wire('t13', ['uno', 'D4'], ['bb', 'f24']),
    wire('t14', ['r_green', '1'], ['bb', 'g24']),
    wire('t15', ['r_green', '2'], ['bb', 'g28']),
    wire('t16', ['led_green', 'A'], ['bb', 'h28']),
    wire('t17', ['led_green', 'C'], ['bb', 'h30']),
    wire('t18', ['bb', 'i30'], ['bb', 'tn30']),
    // Pedestrian button: D5 to ground, read with INPUT_PULLUP.
    wire('t19', ['uno', 'D5'], ['bb', 'a26']),
    wire('t20', ['btn', '1a'], ['bb', 'b26']),
    wire('t21', ['btn', '2a'], ['bb', 'a30']),
    wire('t22', ['bb', 'b30'], ['bb', 'bn30']),
  ],
}

/** Experiment 02's Circuit section, wired: D9/D10 to the HC-SR04, D7 to the PIR. */
const COMPLETED_ULTRASONIC: CircuitDoc = {
  parts: STARTER_ULTRASONIC_PIR.parts,
  wires: [
    ...STARTER_ULTRASONIC_PIR.wires,
    // HC-SR04: supply from the rails, TRIG and ECHO onto lower-bank columns.
    wire('u1', ['hcsr04', 'VCC'], ['bb', 'tp5']),
    wire('u2', ['hcsr04', 'GND'], ['bb', 'tn5']),
    wire('u3', ['hcsr04', 'TRIG'], ['bb', 'a5']),
    wire('u4', ['uno', 'D9'], ['bb', 'b5']),
    wire('u5', ['hcsr04', 'ECHO'], ['bb', 'a8']),
    wire('u6', ['uno', 'D10'], ['bb', 'b8']),
    // PIR: supply from the rails, OUT to D7.
    wire('u7', ['pir', 'VCC'], ['bb', 'tp12']),
    wire('u8', ['pir', 'GND'], ['bb', 'tn12']),
    wire('u9', ['pir', 'OUT'], ['bb', 'a12']),
    wire('u10', ['uno', 'D7'], ['bb', 'b12']),
    // D13 → 220 Ω → LED → ground rail.
    wire('u11', ['uno', 'D13'], ['bb', 'a18']),
    wire('u12', ['r220', '1'], ['bb', 'b18']),
    wire('u13', ['r220', '2'], ['bb', 'b22']),
    wire('u14', ['led', 'A'], ['bb', 'c22']),
    wire('u15', ['led', 'C'], ['bb', 'c26']),
    wire('u16', ['bb', 'd26'], ['bb', 'bn26']),
  ],
}

/** Experiment 04's Circuit section, wired: SIG on D2 (INT0) with its pull-up. */
const COMPLETED_FLOW: CircuitDoc = {
  parts: STARTER_WATER_FLOW.parts,
  wires: [
    ...STARTER_WATER_FLOW.wires,
    wire('f1', ['flow', 'VCC'], ['bb', 'tp5']),
    wire('f2', ['flow', 'GND'], ['bb', 'tn5']),
    // SIG, D2 and the pull-up all meet on one lower-bank column.
    wire('f3', ['flow', 'SIG'], ['bb', 'a10']),
    wire('f4', ['uno', 'D2'], ['bb', 'b10']),
    wire('f5', ['r10k', '1'], ['bb', 'c10']),
    wire('f6', ['r10k', '2'], ['bb', 'tp14']),
  ],
}

/** Experiment 06's Circuit section, wired: PIR on D7, buzzer on D8, LEDs on D12/D11. */
const COMPLETED_PIR_ALARM: CircuitDoc = {
  parts: STARTER_PIR_ALARM.parts,
  wires: [
    ...STARTER_PIR_ALARM.wires,
    wire('a1', ['pir', 'VCC'], ['bb', 'tp5']),
    wire('a2', ['pir', 'GND'], ['bb', 'tn5']),
    wire('a3', ['pir', 'OUT'], ['bb', 'a5']),
    wire('a4', ['uno', 'D7'], ['bb', 'b5']),
    // Active buzzer straight off D8, exactly as the lab sheet draws it.
    wire('a5', ['uno', 'D8'], ['bb', 'a10']),
    wire('a6', ['buzzer', 'P'], ['bb', 'b10']),
    wire('a7', ['buzzer', 'N'], ['bb', 'a14']),
    wire('a8', ['bb', 'b14'], ['bb', 'bn14']),
    // Red alarm LED on D12, lower bank, columns 18 → 22 → 26.
    wire('a9', ['uno', 'D12'], ['bb', 'a18']),
    wire('a10', ['r_red', '1'], ['bb', 'b18']),
    wire('a11', ['r_red', '2'], ['bb', 'b22']),
    wire('a12', ['led_red', 'A'], ['bb', 'c22']),
    wire('a13', ['led_red', 'C'], ['bb', 'c26']),
    wire('a14', ['bb', 'd26'], ['bb', 'bn26']),
    // Green idle LED on D11, UPPER bank, columns 24 → 28 → 30.
    wire('a15', ['uno', 'D11'], ['bb', 'f24']),
    wire('a16', ['r_green', '1'], ['bb', 'g24']),
    wire('a17', ['r_green', '2'], ['bb', 'g28']),
    wire('a18', ['led_green', 'A'], ['bb', 'h28']),
    wire('a19', ['led_green', 'C'], ['bb', 'h30']),
    wire('a20', ['bb', 'i30'], ['bb', 'tn30']),
  ],
}

{
  const { c, res } = solveDoc(COMPLETED_DHT, ['D13'])
  eq('5.1 experiment 1 finished: no problems', c.problems, [])
  eq('5.2 experiment 1 finished: no shorts', c.shortedPins, [])
  check('5.3 experiment 1 finished: solves', res.ok, res.error ?? '')
  eq('5.4 experiment 1 finished: no faults', res.faults, [])
  const mA = Math.abs(c.leds.get('led')!.current) * 1000
  check('5.5 experiment 1 finished: LED on D13 draws 5–20 mA', mA > 5 && mA < 20, `${mA.toFixed(2)} mA`)
  check('5.6 experiment 1 finished: within the ~15 unknown budget', c.unknowns <= 15, String(c.unknowns))
  // The pull-up has to hold the idle DATA line at the rail, or the DHT11
  // behavioural model can never signal.
  const dataNet = c.netOf.get(pinKeyOf({ partId: 'dht', pinId: 'DATA' }))!
  check(
    '5.7 experiment 1 finished: the 10 kΩ holds DATA at ~5 V when idle',
    Math.abs(res.voltages[dataNet] - VCC) < 0.05,
    String(res.voltages[dataNet]),
  )
}

{
  // Green phase: D4 high, the other two low/floating.
  const { c, res } = solveDoc(COMPLETED_TRAFFIC, ['D4'])
  eq('5.8 experiment 3 finished: no problems', c.problems, [])
  eq('5.9 experiment 3 finished: no shorts', c.shortedPins, [])
  check('5.10 experiment 3 finished: solves', res.ok, res.error ?? '')
  eq('5.11 experiment 3 finished: no faults', res.faults, [])
  const green = Math.abs(c.leds.get('led_green')!.current) * 1000
  const red = Math.abs(c.leds.get('led_red')!.current) * 1000
  check('5.12 experiment 3 finished: the driven LED draws 5–20 mA', green > 5 && green < 20, `${green.toFixed(2)} mA`)
  check('5.13 experiment 3 finished: an undriven LED is dark', red < 0.01, `${red.toFixed(4)} mA`)
  check('5.14 experiment 3 finished: within the ~15 unknown budget', c.unknowns <= 15, String(c.unknowns))
}

{
  // Proximity alarm asserted: D13 high, both sensors powered from the rails.
  const { c, res } = solveDoc(COMPLETED_ULTRASONIC, ['D13'])
  eq('5.15 experiment 2 finished: no problems', c.problems, [])
  eq('5.16 experiment 2 finished: no shorts', c.shortedPins, [])
  check('5.17 experiment 2 finished: solves', res.ok, res.error ?? '')
  eq('5.18 experiment 2 finished: no faults', res.faults, [])
  const mA = Math.abs(c.leds.get('led')!.current) * 1000
  check('5.19 experiment 2 finished: LED on D13 draws 5–20 mA', mA > 5 && mA < 20, `${mA.toFixed(2)} mA`)
  check('5.20 experiment 2 finished: within the ~15 unknown budget', c.unknowns <= 15, String(c.unknowns))
  // Both behavioural sensors must SEE their supply. The models refuse to answer
  // on an unpowered VCC, so a sensor at 0 V is a silently dead experiment.
  for (const [id, pin] of [
    ['hcsr04', 'VCC'],
    ['pir', 'VCC'],
  ] as Array<[string, string]>) {
    const n = c.netOf.get(pinKeyOf({ partId: id, pinId: pin }))
    check(
      `5.21 experiment 2 finished: ${id} ${pin} sits at 5 V`,
      n !== undefined && Math.abs(res.voltages[n] - VCC) < 1e-6,
      `net ${n} = ${n === undefined ? 'n/a' : res.voltages[n]}`,
    )
  }
  // Both sensors must have reached the compiler as behavioural models with a
  // driven port; a sensor with no port is wired but mute.
  eq(
    '5.22 experiment 2 finished: both sensors are live behavioural models',
    c.behavioural
      .map((b) => `${b.partId}:${b.protocol}:${Object.keys(b.ports).sort().join('+')}`)
      .sort(),
    ['hcsr04:hc_sr04:ECHO', 'pir:pir:OUT'],
  )
}

{
  // Nothing is driven: this is the idle state, where the 10 kΩ pull-up alone
  // decides what D2 reads between pulses.
  const { c, res } = solveDoc(COMPLETED_FLOW)
  eq('5.23 experiment 4 finished: no problems', c.problems, [])
  eq('5.24 experiment 4 finished: no shorts', c.shortedPins, [])
  check('5.25 experiment 4 finished: solves', res.ok, res.error ?? '')
  eq('5.26 experiment 4 finished: no faults', res.faults, [])
  check('5.27 experiment 4 finished: within the ~15 unknown budget', c.unknowns <= 15, String(c.unknowns))
  const sigNet = c.netOf.get(pinKeyOf({ partId: 'flow', pinId: 'SIG' }))!
  check(
    '5.28 experiment 4 finished: the 10 kΩ holds SIG at ~5 V when idle',
    Math.abs(res.voltages[sigNet] - VCC) < 0.05,
    String(res.voltages[sigNet]),
  )
  // The sketch attaches its interrupt to digitalPinToInterrupt(2). SIG on any
  // other pin compiles and solves perfectly and counts nothing.
  eq(
    '5.29 experiment 4 finished: SIG really is on D2, the INT0 pin',
    c.pinNets.get('D2'),
    sigNet,
  )
}

{
  // Alarm asserted: motion has been seen, so D12 (red) and D8 (buzzer) are high
  // and D11 (green) is low — the state the sketch's loop() drives on detection.
  const { c, res } = solveDoc(COMPLETED_PIR_ALARM, ['D8', 'D12'])
  eq('5.30 experiment 6 finished: no problems', c.problems, [])
  eq('5.31 experiment 6 finished: no shorts', c.shortedPins, [])
  check('5.32 experiment 6 finished: solves', res.ok, res.error ?? '')
  check('5.33 experiment 6 finished: within the ~15 unknown budget', c.unknowns <= 15, String(c.unknowns))
  const redMa = Math.abs(c.leds.get('led_red')!.current) * 1000
  const greenMa = Math.abs(c.leds.get('led_green')!.current) * 1000
  check('5.34 experiment 6 finished: the red alarm LED draws 5–20 mA', redMa > 5 && redMa < 20, `${redMa.toFixed(2)} mA`)
  check('5.35 experiment 6 finished: the green LED is dark during the alarm', greenMa < 0.01, `${greenMa.toFixed(4)} mA`)

  // The buzzer must actually be able to sound: BUZZER_5V.minOperatingVolts is
  // 4 V, and a 167 Ω load fed through the AVR's 25 Ω driver lands at ~4.35 V.
  const pNet = c.netOf.get(pinKeyOf({ partId: 'buzzer', pinId: 'P' }))!
  const buzzV = res.voltages[pNet]
  check('5.36 experiment 6 finished: the buzzer sees more than its 4 V minimum', buzzV > 4, String(buzzV))
  const buzzMa = Math.abs(c.meters.get('buzzer')!.current) * 1000
  check('5.37 experiment 6 finished: the buzzer draws 20–30 mA', buzzMa > 20 && buzzMa < 30, `${buzzMa.toFixed(2)} mA`)

  /**
   * The ONE fault this finished circuit is expected to raise, and it is a true
   * statement about the lab sheet's own schematic rather than a defect in the
   * starter: an active buzzer hung straight off a digital pin pulls ~26 mA,
   * past the 20 mA an ATmega328 I/O pin is rated to source continuously. Real
   * builds put a transistor there. The simulator saying so out loud is the
   * point (§2.3), so this is pinned exactly — if it ever becomes an `error`,
   * or if a SECOND fault appears, the test must fail.
   */
  eq(
    '5.38 experiment 6 finished: exactly one fault, the D8 buzzer current caution',
    res.faults.map((f) => `${f.deviceId}:${f.kind}:${f.severity}`),
    ['uno.D8:over_current:caution'],
  )
}

{
  // Idle state: only the green LED is driven. No motion, no buzzer, no fault.
  const { c, res } = solveDoc(COMPLETED_PIR_ALARM, ['D11'])
  check('5.39 experiment 6 idle: solves', res.ok, res.error ?? '')
  eq('5.40 experiment 6 idle: no faults at all', res.faults, [])
  const greenMa = Math.abs(c.leds.get('led_green')!.current) * 1000
  const redMa = Math.abs(c.leds.get('led_red')!.current) * 1000
  check('5.41 experiment 6 idle: the green LED draws 5–20 mA', greenMa > 5 && greenMa < 20, `${greenMa.toFixed(2)} mA`)
  check('5.42 experiment 6 idle: the red LED is dark', redMa < 0.01, `${redMa.toFixed(4)} mA`)
  const buzzMa = Math.abs(c.meters.get('buzzer')!.current) * 1000
  check('5.43 experiment 6 idle: the buzzer is silent', buzzMa < 0.01, `${buzzMa.toFixed(4)} mA`)
}

/**
 * Experiment 05's Circuit section, wired: GP17 → 220 Ω → LED → GND, and the
 * push button sourcing 3V3 into GP27 through the 10 kΩ.
 *
 * `pressed` is a parameter because the whole point of the circuit is what the
 * pin reads in each of the two states, and the button's contacts are modelled
 * as a resistance rather than a removed device, so both states solve the same
 * matrix.
 */
function completedPicoButton(pressed: number): CircuitDoc {
  return {
    parts: STARTER_LED_BUTTON_PICO.parts.map((p) =>
      p.id === 'btn' ? { ...p, props: { pressed } } : p,
    ),
    wires: [
      ...STARTER_LED_BUTTON_PICO.wires,
      // GP17 → 220 Ω → LED → ground rail. Lower bank, columns 5 → 10 → 15.
      wire('k1', ['pico', 'GP17'], ['bb', 'a5']),
      wire('k2', ['r220', '1'], ['bb', 'b5']),
      wire('k3', ['r220', '2'], ['bb', 'b10']),
      wire('k4', ['led', 'A'], ['bb', 'c10']),
      wire('k5', ['led', 'C'], ['bb', 'c15']),
      wire('k6', ['bb', 'd15'], ['bb', 'bn15']),
      // The switch SOURCES the positive rail into GP27, through the 10 kΩ the
      // lab sheet's Circuit section puts there. GP27's own PULL_DOWN returns the
      // pin to 0 V when the contacts are open — that pair is what the code's
      // `Pin.PULL_DOWN` + `value() == 1` assumes, and wiring the switch to GND
      // instead would read LOW in both states.
      wire('k7', ['pico', 'GP27'], ['bb', 'a20']),
      wire('k8', ['btn', '1a'], ['bb', 'b20']),
      wire('k9', ['btn', '2a'], ['bb', 'a25']),
      wire('k10', ['r10k', '1'], ['bb', 'b25']),
      wire('k11', ['r10k', '2'], ['bb', 'tp25']),
    ],
  }
}

/** Experiment 07's Circuit section, wired: DATA on GP4 with its 10 kΩ pull-up. */
const COMPLETED_PICO_DHT: CircuitDoc = {
  parts: STARTER_DHT11_PICO.parts,
  wires: [
    ...STARTER_DHT11_PICO.wires,
    wire('h1', ['dht', 'VCC'], ['bb', 'tp5']),
    wire('h2', ['dht', 'GND'], ['bb', 'tn5']),
    // DATA, GP4 and the pull-up all meet on one lower-bank column.
    wire('h3', ['dht', 'DATA'], ['bb', 'a10']),
    wire('h4', ['pico', 'GP4'], ['bb', 'b10']),
    wire('h5', ['r10k', '1'], ['bb', 'c10']),
    wire('h6', ['r10k', '2'], ['bb', 'tp12']),
  ],
}

const PICO_OPTS = { volts: PICO_VDD, rDrive: PICO_R_DRIVE, pullDown: ['GP27'] }

{
  // LED latched on, button not pressed — the state the script sits in after one
  // press. GP27 is an input with its internal pull-down enabled throughout.
  const { c, res } = solveDoc(completedPicoButton(0), ['GP17'], PICO_OPTS)
  eq('5.44 experiment 5 finished: no problems', c.problems, [])
  eq('5.45 experiment 5 finished: no shorts', c.shortedPins, [])
  check('5.46 experiment 5 finished: solves', res.ok, res.error ?? '')
  eq('5.47 experiment 5 finished: no faults', res.faults, [])
  check('5.48 experiment 5 finished: within the ~15 unknown budget', c.unknowns <= 15, String(c.unknowns))

  /**
   * THE NUMBER THIS STARTER EXISTS TO GET RIGHT.
   *
   * The same LED and the same 220 Ω on a 3.3 V rail behind a 50 Ω pad, against
   * 5 V behind 25 Ω on the Uno. It is not a small difference and it is not a
   * scaling of 3.3/5 either — the LED's ~2 V forward drop eats a far larger
   * share of the smaller budget — so a starter that had quietly inherited the
   * Uno's rail would land at roughly twice this. The absolute figure is derived
   * independently, from the Shockley equation solved by bisection, in
   * __tests__/pico.test.ts group C; this band is the sanity check that the
   * STARTER (not the engine) is on the right rail.
   */
  const picoMa = Math.abs(c.leds.get('led')!.current) * 1000
  check('5.49 experiment 5 finished: the LED draws 4–7 mA on 3.3 V', picoMa > 4 && picoMa < 7, `${picoMa.toFixed(3)} mA`)
  const unoMa = Math.abs(solveDoc(COMPLETED_DHT, ['D13']).c.leds.get('led')!.current) * 1000
  check(
    '5.50 experiment 5 finished: and materially less than the same parts on 5 V',
    picoMa < 0.6 * unoMa,
    `${picoMa.toFixed(3)} mA vs ${unoMa.toFixed(3)} mA on the Uno`,
  )

  // Button open: only the internal pull-down is on GP27, so it must read a
  // clean logic LOW (RP2040 VIL is 0.8 V).
  const gp27 = c.netOf.get(pinKeyOf({ partId: 'pico', pinId: 'GP27' }))!
  check(
    '5.51 experiment 5 finished: button open holds GP27 below VIL (0.8 V)',
    res.voltages[gp27] < 0.8,
    `${res.voltages[gp27].toFixed(4)} V`,
  )
}

{
  // Button pressed. The 10 kΩ and the pad's 55 kΩ pull-down divide the rail, so
  // GP27 sees about 2.8 V — over the RP2040's 2.0 V VIH, but not by a mile, and
  // that margin is exactly what a bigger series resistor would eat.
  const { c, res } = solveDoc(completedPicoButton(1), ['GP17'], PICO_OPTS)
  const gp27 = c.netOf.get(pinKeyOf({ partId: 'pico', pinId: 'GP27' }))!
  const expected = (PICO_VDD * PICO_R_PULL) / (PICO_R_PULL + 10_000)
  check('5.52 experiment 5 pressed: solves', res.ok, res.error ?? '')
  check(
    '5.53 experiment 5 pressed: GP27 rises above VIH (2.0 V)',
    res.voltages[gp27] > 2.0,
    `${res.voltages[gp27].toFixed(4)} V`,
  )
  check(
    '5.54 experiment 5 pressed: and to the 10 kΩ / 55 kΩ divider value',
    Math.abs(res.voltages[gp27] - expected) < 0.01,
    `${res.voltages[gp27].toFixed(4)} V vs ${expected.toFixed(4)} V`,
  )
}

{
  // Idle: nothing driven. The LED must be dark — a starter whose LED glows with
  // the firmware doing nothing is a wiring mistake, not a lesson.
  const { c } = solveDoc(completedPicoButton(0), [], PICO_OPTS)
  const mA = Math.abs(c.leds.get('led')!.current) * 1000
  check('5.55 experiment 5 idle: the LED is dark', mA < 0.01, `${mA.toFixed(5)} mA`)
}

{
  const { c, res } = solveDoc(COMPLETED_PICO_DHT, [], { volts: PICO_VDD, rDrive: PICO_R_DRIVE })
  eq('5.56 experiment 7 finished: no problems', c.problems, [])
  eq('5.57 experiment 7 finished: no shorts', c.shortedPins, [])
  check('5.58 experiment 7 finished: solves', res.ok, res.error ?? '')
  eq('5.59 experiment 7 finished: no faults', res.faults, [])
  check('5.60 experiment 7 finished: within the ~15 unknown budget', c.unknowns <= 15, String(c.unknowns))

  // The sensor has to SEE its supply: the behavioural model refuses to answer on
  // an unpowered VCC, so a DHT11 at 0 V is a silently dead experiment.
  const vccNet = c.netOf.get(pinKeyOf({ partId: 'dht', pinId: 'VCC' }))!
  check(
    '5.61 experiment 7 finished: DHT11 VCC sits at 3.3 V',
    Math.abs(res.voltages[vccNet] - PICO_VDD) < 1e-6,
    String(res.voltages[vccNet]),
  )
  // …and the pull-up must hold the idle DATA line at the rail, or the open-drain
  // sensor has nothing to pull DOWN from and every read times out.
  const dataNet = c.netOf.get(pinKeyOf({ partId: 'dht', pinId: 'DATA' }))!
  check(
    '5.62 experiment 7 finished: the 10 kΩ holds DATA at ~3.3 V when idle',
    Math.abs(res.voltages[dataNet] - PICO_VDD) < 0.05,
    String(res.voltages[dataNet]),
  )
  // The script reads dht.DHT11(Pin(4)). DATA on any other GPIO compiles, solves
  // and reports nothing at all.
  eq('5.63 experiment 7 finished: DATA really is on GP4', c.pinNets.get('GP4'), dataNet)
  eq(
    '5.64 experiment 7 finished: the DHT11 is a live behavioural model',
    c.behavioural.map((b) => `${b.partId}:${b.protocol}:${Object.keys(b.ports).sort().join('+')}`),
    ['dht:dht11:DATA'],
  )
}

// ─── 6. The migration carries the same documents ──────────────────────────────

console.log('\n6. Migrations 020, 021 and 022 agree with the TypeScript')

{
  /**
   * Which migration is expected to carry which starters, and on which board.
   *
   * `board` is the string `circuits.board` must hold, and it is read off BOARDS
   * rather than typed out: migration 015's check constraint accepts
   * ('arduino_uno','arduino_nano','rp2040') and rejects 'raspberry_pi_pico',
   * which is what the part type is actually called. Writing the part type into
   * the SQL would fail at INSERT time in production and nowhere else.
   */
  const MIGRATIONS: Array<{ file: string; slugs: string[]; board: string }> = [
    {
      file: '020_native_experiments.sql',
      slugs: ['led-dht11-arduino', 'traffic-light-arduino'],
      board: BOARDS.arduino_uno.dbBoard,
    },
    {
      file: '021_native_experiments_2_4_6.sql',
      slugs: ['pir-alarm-arduino', 'ultrasonic-pir-arduino', 'water-flow-arduino'],
      board: BOARDS.arduino_uno.dbBoard,
    },
    {
      file: '022_native_experiments_5_7.sql',
      slugs: ['dht11-rpi', 'led-button-rpi'],
      board: BOARDS.raspberry_pi_pico.dbBoard,
    },
  ]

  const found = new Map<string, unknown>()

  for (const mig of MIGRATIONS) {
    const sqlPath = join(__dirname, '..', '..', '..', 'supabase', 'migrations', mig.file)
    let sql = ''
    try {
      sql = readFileSync(sqlPath, 'utf8')
    } catch {
      /* reported below */
    }
    check(`6.1 ${mig.file} exists`, sql.length > 0, sqlPath)

    // Each graph is dollar-quoted and preceded by "-- @starter <slug>".
    const mine: string[] = []
    const re = /--\s*@starter\s+(\S+)[\s\S]*?\$graph\$([\s\S]*?)\$graph\$/g
    let m: RegExpExecArray | null
    while ((m = re.exec(sql)) !== null) {
      mine.push(m[1])
      check(`6.2 ${m[1]}: appears in exactly one migration`, !found.has(m[1]), `also in another file`)
      try {
        found.set(m[1], JSON.parse(m[2]))
      } catch (e) {
        check(`6.2 ${m[1]}: embedded graph is valid JSON`, false, String(e))
      }
    }
    eq(`6.3 ${mig.file}: carries the starters it is supposed to`, mine.sort(), mig.slugs)

    /**
     * The value really inserted into circuits.board, read out of the SQL rather
     * than assumed. `'raspberry_pi_pico'` and a bare `'uno'` are both rejected
     * by migration 015's check constraint, and both are the obvious thing to
     * write — the first is the part type, the second is the silkscreen.
     */
    const inserted = [
      ...sql.matchAll(/values \(v_sim, 'starter', 1, '([^']+)'/g),
    ].map((m) => m[1])
    eq(
      `6.5 ${mig.file} inserts board='${mig.board}' for every starter it carries`,
      inserted,
      mig.slugs.map(() => mig.board),
    )
    check(
      `6.12 ${mig.file} never writes a board value the check constraint rejects`,
      !/'raspberry_pi_pico'\s*,\s*'free'/.test(sql) && !/1,\s*'uno'/.test(sql),
    )
    check(
      `6.6 ${mig.file} flips the simulations to 'native'`,
      /update simulations set type = 'native'/.test(sql),
    )
    check(
      `6.7 ${mig.file} looks the simulation up by slug, never a literal uuid`,
      /where slug = v_slug/.test(sql) &&
        !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql),
    )
    check(
      `6.8 ${mig.file} is re-runnable (upsert on the unique key)`,
      /on conflict \(simulation_id, role, version\) do update/.test(sql),
    )
    // At least one `do $mig$ … end $mig$` block per starter, all inside one
    // transaction. 022 carries extra blocks: it also corrects two published
    // procedure steps that contradict the circuit the student now runs.
    check(
      `6.9 ${mig.file}: at least one idempotent block per starter`,
      (sql.match(/do \$mig\$/g) ?? []).length >= mig.slugs.length,
      String((sql.match(/do \$mig\$/g) ?? []).length),
    )
    check(`6.10 ${mig.file} is transactional`, /^begin;$/m.test(sql) && /^commit;$/m.test(sql))
  }

  eq('6.11 the migrations together cover every authored starter', [...found.keys()].sort(), Object.keys(EXPERIMENT_STARTERS).sort())

  for (const [slug, doc] of Object.entries(EXPERIMENT_STARTERS)) {
    const sqlDoc = found.get(slug)
    // Round-trip the TS side through JSON so the comparison is of the stored
    // shape, which is what actually reaches the database. eq() compares
    // JSON.stringify output, so this pins KEY ORDER too — the SQL literal and
    // the TypeScript object literal have to be written the same way round.
    eq(
      `6.4 ${slug}: the migration's graph matches EXPERIMENT_STARTERS`,
      sqlDoc,
      JSON.parse(JSON.stringify({ parts: doc.parts, wires: doc.wires })),
    )
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60))
console.log(`${passed}/${passed + failed} passed`)
if (failed > 0) console.log(`${failed} FAILED`)
process.exit(failed > 0 ? 1 : 0)
