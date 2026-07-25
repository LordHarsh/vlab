/**
 * P0-5 — netlist extraction end-to-end.
 *
 * Builds the real Experiment-01 circuit (Uno → 220Ω → LED → GND) on an actual
 * breadboard, extracts nets by union-find, and checks that the derived netlist
 * matches a hand-written reference. Also feeds a deliberately broken variant
 * (floating leg) to confirm the editor can catch it before the solver runs.
 *
 * Run: npx tsx lib/simulator/__spikes__/p0-5-netlist.ts
 */

import {
  extractNetlist,
  breadboardDef,
  arduinoUnoDef,
  resistorDef,
  ledDef,
  pinKey,
  type PartInstance,
  type Wire,
} from '../netlist'

const parts: PartInstance[] = [
  { id: 'uno', def: arduinoUnoDef },
  { id: 'bb', def: breadboardDef() },
  { id: 'R1', def: resistorDef },
  { id: 'LED1', def: ledDef },
]

/**
 * D13 ── bb.a5 | R1 spans a5→a10 | LED1 spans a10→a15 | bb.a15 ── GND
 * Components plug into the breadboard; the board's strips do the connecting.
 */
const wires: Wire[] = [
  { id: 'w1', from: { partId: 'uno', pinId: 'D13' }, to: { partId: 'bb', pinId: 'a5' } },
  { id: 'w2', from: { partId: 'R1', pinId: '1' }, to: { partId: 'bb', pinId: 'b5' } },
  { id: 'w3', from: { partId: 'R1', pinId: '2' }, to: { partId: 'bb', pinId: 'b10' } },
  { id: 'w4', from: { partId: 'LED1', pinId: 'A' }, to: { partId: 'bb', pinId: 'c10' } },
  { id: 'w5', from: { partId: 'LED1', pinId: 'C' }, to: { partId: 'bb', pinId: 'c15' } },
  { id: 'w6', from: { partId: 'bb', pinId: 'd15' }, to: { partId: 'uno', pinId: 'GND.1' } },
]

console.log('P0-5  Netlist extraction spike')
console.log('='.repeat(72))

const nl = extractNetlist(parts, wires)

const netOf = (p: string, pin: string) => nl.nets.get(pinKey(p, pin))

console.log('\n1. Derived nets for the Experiment-01 circuit\n')
const probes: Array<[string, string, string]> = [
  ['uno', 'D13', 'MCU drive pin'],
  ['bb', 'a5', 'breadboard strip @ col 5'],
  ['R1', '1', 'resistor leg 1'],
  ['R1', '2', 'resistor leg 2'],
  ['LED1', 'A', 'LED anode'],
  ['LED1', 'C', 'LED cathode'],
  ['uno', 'GND.1', 'ground'],
]
for (const [p, pin, label] of probes) {
  console.log(`   net ${String(netOf(p, pin)).padStart(3)}  ${(p + '.' + pin).padEnd(12)} ${label}`)
}

// The assertions that matter: strips must merge the right pins, and only those.
const checks: Array<[string, boolean]> = [
  ['D13 and R1.1 share a net (via strip a5/b5)', netOf('uno', 'D13') === netOf('R1', '1')],
  ['R1.2 and LED1.A share a net (via strip col 10)', netOf('R1', '2') === netOf('LED1', 'A')],
  ['LED1.C is ground (net 0)', netOf('LED1', 'C') === 0],
  ['ground is net 0', netOf('uno', 'GND.1') === 0],
  ['all three Uno GND pins are one net', netOf('uno', 'GND.2') === 0 && netOf('uno', 'GND.3') === 0],
  ['drive net is NOT ground', netOf('uno', 'D13') !== 0],
  ['drive net differs from LED anode net', netOf('uno', 'D13') !== netOf('LED1', 'A')],
  ['column 5 and column 10 are separate nets', netOf('bb', 'a5') !== netOf('bb', 'a10')],
  ['bank A and bank B of a column are separate', netOf('bb', 'a5') !== netOf('bb', 'f5')],
  ['power rail is independent of strips', netOf('bb', 'tp1') !== netOf('bb', 'a1')],
  ['rail is continuous across columns', netOf('bb', 'tp1') === netOf('bb', 'tp30')],
  ['no dangling wires', nl.danglingWires.length === 0],
]

console.log('\n2. Assertions\n')
let pass = true
for (const [label, ok] of checks) {
  if (!ok) pass = false
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

// ─── Broken variant: the LED cathode never reaches ground ─────────────────────

console.log('\n3. Broken variant — student forgot the ground wire\n')
const brokenWires = wires.filter((w) => w.id !== 'w6')
const broken = extractNetlist(parts, brokenWires)
const cathodeNet = broken.nets.get(pinKey('LED1', 'C'))!
const cathodeMembers = broken.members.get(cathodeNet)!

// The cathode now sits on a breadboard strip with nothing else driving it.
// It is not literally a 1-pin net (the strip has 5 tie points), so the useful
// signal is "this net contains no source and no ground".
const touchesGround = cathodeNet === 0
console.log(`   LED cathode net        : ${cathodeNet} (${cathodeMembers.length} pins on it)`)
console.log(`   connected to ground?   : ${touchesGround ? 'yes' : 'NO — circuit is open'}`)
console.log(`   isolated 1-pin nets    : ${broken.floatingNets.length}`)
const brokenDetected = !touchesGround
console.log(`   ${brokenDetected ? 'PASS' : 'FAIL'}  open circuit is detectable before solving`)
if (!brokenDetected) pass = false

console.log('\n4. Scale\n')
console.log(`   parts            : ${parts.length}`)
console.log(`   pins             : ${parts.reduce((n, p) => n + p.def.pins.length, 0)}`)
console.log(`   wires            : ${wires.length}`)
console.log(`   distinct nets    : ${nl.netCount}`)

const t0 = performance.now()
const REPS = 1000
for (let i = 0; i < REPS; i++) extractNetlist(parts, wires)
const per = (performance.now() - t0) / REPS
console.log(`   extraction cost  : ${per.toFixed(3)} ms  (recomputed on every edit)`)

console.log('\n' + '='.repeat(72))
console.log(pass ? 'P0-5 PASS' : 'P0-5 FAIL')
process.exit(pass ? 0 : 1)
