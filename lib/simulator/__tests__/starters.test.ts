/**
 * Authored lab starters (model/examples.ts → EXPERIMENT_STARTERS).
 *
 * These two documents are PRODUCTION CONTENT: migration 020 loads them into
 * `circuits` as role='starter', and they are the first thing a student sees
 * when they open the native editor for experiment 1 or experiment 3. Nothing
 * else in the test suite would notice if one of them were quietly corrupted —
 * compile() is happy to derive a netlist from a document with a typo'd pin id,
 * and the solver is happy to solve it.
 *
 * So this file pins down, exactly:
 *
 *   1. STRUCTURE   — part counts, part types, unique ids, and every wire
 *                    endpoint resolving to a pin that actually exists. A pin id
 *                    typo ("tp2" → "tp02") is silent everywhere else: compile()
 *                    skips the wire and the rail simply stops working.
 *   2. PRE-WIRING  — the supply plumbing really is plumbed. Uno GND and both
 *                    negative rails are one net; the 5 V feed reaches both
 *                    positive rails.
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
 *                    supabase/migrations/020_native_experiments.sql are
 *                    structurally identical to the TypeScript ones. Two copies
 *                    of the same document is the whole risk here.
 *
 * Run: npx tsx lib/simulator/__tests__/starters.test.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from '../model/compile'
import { partBounds, pinKeyOf, type CircuitDoc, type DocWire, type PlacedPart } from '../model/document'
import { EXPERIMENT_STARTERS, STARTER_LED_DHT11, STARTER_TRAFFIC_LIGHT } from '../model/examples'
import { getPart } from '../model/parts'

/** The AVR pin model, restated — see the same note in compile.test.ts. */
const R_DRIVE = 25
const G_FLOAT = 1e-8
const VCC = 5

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

/** Compile, drive the named pins, and solve — the same thing the engine does. */
function solveDoc(doc: CircuitDoc, high: string[] = []) {
  const c = compile(doc)
  for (const [name, port] of c.mcuPorts) {
    if (high.includes(name)) port.set(1 / R_DRIVE, VCC / R_DRIVE)
    else port.set(G_FLOAT, 0)
  }
  return { c, res: c.circuit.solve() }
}

// ─── 1. Structure ─────────────────────────────────────────────────────────────

console.log('\n1. Structure')

eq('1.1 exactly two experiments have authored starters', Object.keys(EXPERIMENT_STARTERS).sort(), [
  'led-dht11-arduino',
  'traffic-light-arduino',
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
  }
> = {
  'led-dht11-arduino': {
    doc: STARTER_LED_DHT11,
    parts: 6,
    wires: 4,
    types: { arduino_uno: 1, breadboard: 1, dht11: 1, led: 1, resistor: 2 },
    ohms: [220, 10000],
  },
  'traffic-light-arduino': {
    doc: STARTER_TRAFFIC_LIGHT,
    parts: 9,
    wires: 4,
    types: { arduino_uno: 1, breadboard: 1, led: 3, push_button: 1, resistor: 3 },
    ohms: [220, 220, 220],
  },
}

for (const [slug, exp] of Object.entries(EXPECTED)) {
  const doc = EXPERIMENT_STARTERS[slug]
  check(`1.2 ${slug}: EXPERIMENT_STARTERS points at the exported constant`, doc === exp.doc)
  eq(`1.3 ${slug}: part count`, doc.parts.length, exp.parts)
  eq(`1.4 ${slug}: wire count`, doc.wires.length, exp.wires)
  eq(`1.5 ${slug}: part types`, typeCounts(doc), exp.types)

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
  const { netOf } = compile(doc)
  const netAt = (partId: string, pinId: string) => netOf.get(pinKeyOf({ partId, pinId }))

  // Ground is net 0 by construction. Both blue rails must be on it — the top
  // one through the Uno jumper, the bottom one through the tn29→bn29 bridge.
  eq(`2.1 ${slug}: Uno GND is net 0`, netAt('uno', 'GND.2'), 0)
  eq(`2.2 ${slug}: top negative rail is ground`, netAt('bb', 'tn2'), 0)
  eq(`2.3 ${slug}: bottom negative rail is ground (bridge works)`, netAt('bb', 'bn29'), 0)
  eq(`2.4 ${slug}: a hole far along the negative rail is ground`, netAt('bb', 'bn15'), 0)

  // The positive rail carries no COMPONENT but the Uno's 5 V pin, so compile()
  // correctly prunes it as inert — there is nothing to solve for. Prove it is
  // nonetheless wired by hanging a load on it and watching 5 V appear.
  const probe: CircuitDoc = {
    parts: [...doc.parts, { id: 'probe', type: 'resistor', x: 0, y: 0, rotation: 0, props: { ohms: 1000 } }],
    // Bottom positive rail on one end, bottom negative on the other: this only
    // reads 5 V if BOTH the Uno feed and BOTH rail bridges are intact.
    wires: [...doc.wires, wire('probe_p', ['probe', '1'], ['bb', 'bp5']), wire('probe_n', ['probe', '2'], ['bb', 'bn5'])],
  }
  const { c, res } = solveDoc(probe)
  const railNet = c.netOf.get(pinKeyOf({ partId: 'bb', pinId: 'bp5' }))
  check(`2.5 ${slug}: probe across the bottom rails solves`, res.ok, res.error ?? '')
  check(
    `2.6 ${slug}: bottom positive rail sits at 5 V`,
    railNet !== undefined && Math.abs(res.voltages[railNet] - VCC) < 1e-6,
    `net ${railNet} = ${railNet === undefined ? 'n/a' : res.voltages[railNet]}`,
  )
  check(
    `2.7 ${slug}: 5 mA through a 1 kΩ probe across the rails`,
    Math.abs(Math.abs(c.meters.get('probe')!.current) - VCC / 1000) < 1e-6,
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
  // 14 component nets + ground, plus three LED internal nodes. Above the ~15
  // unknown budget only because nothing is joined yet; the finished circuit is
  // asserted below and comes in well under it.
  'traffic-light-arduino': { unknowns: 17, activeNets: 15 },
}

for (const [slug, size] of Object.entries(EXPECTED_SIZE)) {
  const { c, res } = solveDoc(EXPERIMENT_STARTERS[slug])
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

// ─── 6. The migration carries the same documents ──────────────────────────────

console.log('\n6. Migration 020 agrees with the TypeScript')

{
  const sqlPath = join(__dirname, '..', '..', '..', 'supabase', 'migrations', '020_native_experiments.sql')
  let sql = ''
  try {
    sql = readFileSync(sqlPath, 'utf8')
  } catch {
    /* reported below */
  }
  check('6.1 migration 020 exists', sql.length > 0, sqlPath)

  // Each graph is dollar-quoted and preceded by "-- @starter <slug>".
  const found = new Map<string, unknown>()
  const re = /--\s*@starter\s+(\S+)[\s\S]*?\$graph\$([\s\S]*?)\$graph\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    try {
      found.set(m[1], JSON.parse(m[2]))
    } catch (e) {
      check(`6.2 ${m[1]}: embedded graph is valid JSON`, false, String(e))
    }
  }

  eq('6.3 migration carries one graph per authored starter', [...found.keys()].sort(), [
    'led-dht11-arduino',
    'traffic-light-arduino',
  ])

  for (const [slug, doc] of Object.entries(EXPERIMENT_STARTERS)) {
    const sqlDoc = found.get(slug)
    // Round-trip the TS side through JSON so the comparison is of the stored
    // shape, which is what actually reaches the database.
    eq(
      `6.4 ${slug}: the migration's graph matches EXPERIMENT_STARTERS`,
      sqlDoc,
      JSON.parse(JSON.stringify({ parts: doc.parts, wires: doc.wires })),
    )
  }

  check(
    "6.5 migration uses board='arduino_uno' (the check constraint rejects 'uno')",
    sql.includes("'arduino_uno'") && !/board\s*,?[^\n]*'uno'/.test(sql),
  )
  check("6.6 migration flips the simulations to 'native'", /update simulations set type = 'native'/.test(sql))
  check('6.7 migration looks the simulation up by slug, never a literal uuid', {
    ok: /where slug = v_slug/.test(sql) && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql),
  }.ok)
  check('6.8 migration is re-runnable (upsert on the unique key)', /on conflict \(simulation_id, role, version\) do update/.test(sql))
}

// ─── Report ───────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60))
console.log(`${passed}/${passed + failed} passed`)
if (failed > 0) console.log(`${failed} FAILED`)
process.exit(failed > 0 ? 1 : 0)
