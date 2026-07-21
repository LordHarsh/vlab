/**
 * Phase 1 — document → netlist → circuit compilation.
 *
 * Builds Experiment 01 out of the editor's own document model (Uno + breadboard
 * + resistor + LED, wired the way a student would) and checks that the compiled
 * circuit both solves and stays inside the unknown budget.
 *
 * Run: npx tsx lib/simulator/__spikes__/p1-compile.ts
 */

import { compile } from '../model/compile'
import { newId, resetIds, type CircuitDoc, type PlacedPart, type DocWire } from '../model/document'

resetIds()

function part(type: string, x: number, y: number, props: Record<string, number | string> = {}): PlacedPart {
  return { id: newId(type.slice(0, 3) + '_'), type, x, y, rotation: 0, props }
}

function wire(fromPart: string, fromPin: string, toPart: string, toPin: string): DocWire {
  return {
    id: newId('w'),
    from: { partId: fromPart, pinId: fromPin },
    to: { partId: toPart, pinId: toPin },
    color: '#111827',
  }
}

const uno = part('arduino_uno', 0, 0)
const bb = part('breadboard', 0, 200)
const r1 = part('resistor', 100, 400, { ohms: 220 })
const led1 = part('led', 200, 400)

const doc: CircuitDoc = {
  parts: [uno, bb, r1, led1],
  wires: [
    // D13 → breadboard column 5
    wire(uno.id, 'D13', bb.id, 'a5'),
    // resistor bridges column 5 → column 10
    wire(r1.id, '1', bb.id, 'b5'),
    wire(r1.id, '2', bb.id, 'b10'),
    // LED bridges column 10 → column 15
    wire(led1.id, 'A', bb.id, 'c10'),
    wire(led1.id, 'C', bb.id, 'c15'),
    // column 15 → GND
    wire(bb.id, 'd15', uno.id, 'GND.1'),
  ],
}

console.log('P1  Document → circuit compilation')
console.log('='.repeat(72))

const res = compile(doc)

console.log('\n1. Compilation\n')
console.log(`   parts              : ${doc.parts.length}`)
console.log(`   wires              : ${doc.wires.length}`)
console.log(`   derived nets       : ${res.nets.length}`)
console.log(`   ACTIVE nets        : ${res.nets.filter((n) => n.active).length}`)
console.log(`   matrix unknowns    : ${res.unknowns}`)
console.log(`   MCU ports stamped  : ${res.mcuPorts.size}`)
console.log(`   LEDs               : ${res.leds.size}`)
console.log(`   problems           : ${res.problems.length ? res.problems.join('; ') : 'none'}`)

let pass = true
function check(label: string, ok: boolean) {
  if (!ok) pass = false
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

console.log('\n2. Assertions\n')
// A breadboard alone has ~450 pins. Without pruning, every empty tie point
// would take a matrix row and blow the ~15-unknown budget 30x over.
check('unknowns stay within the architecture budget (<= 15)', res.unknowns <= 15)
check('no problems reported for a correctly built circuit', res.problems.length === 0)
check('D13 was stamped as an MCU port', res.mcuPorts.has('D13'))
check('the LED compiled', res.leds.size === 1)
check('breadboard-only nets were pruned', res.nets.some((n) => !n.active))

console.log('\n3. Solve with D13 driven HIGH\n')
const d13 = res.mcuPorts.get('D13')!
d13.set(1 / 25, 5 / 25)
const solved = res.circuit.solve()
const led = [...res.leds.values()][0]
const mA = led.current * 1000
console.log(`   solved             : ${solved.ok}  (${solved.iterations} iterations)`)
console.log(`   LED current        : ${mA.toFixed(2)} mA`)
check('solve converged', solved.ok)
// Driving through the pin's own 25 ohm output impedance, not an ideal source.
check('LED current is physically plausible (10-16 mA)', mA > 10 && mA < 16)

console.log('\n4. Solve with D13 driven LOW\n')
d13.set(1 / 25, 0)
res.circuit.resetState()
res.circuit.solve()
const offMA = led.current * 1000
console.log(`   LED current        : ${offMA.toFixed(4)} mA`)
check('LED is off when the pin is low', Math.abs(offMA) < 0.01)

console.log('\n5. Broken circuit — student forgot the ground wire\n')
const broken: CircuitDoc = { ...doc, wires: doc.wires.filter((w) => w.to.pinId !== 'GND.1') }
const brokenRes = compile(broken)
const brokenD13 = brokenRes.mcuPorts.get('D13')!
brokenD13.set(1 / 25, 5 / 25)
const brokenSolve = brokenRes.circuit.solve()
const brokenLed = [...brokenRes.leds.values()][0]
console.log(`   solved             : ${brokenSolve.ok}`)
console.log(`   LED current        : ${(brokenLed.current * 1000).toFixed(6)} mA`)
// gmin keeps the matrix non-singular, so this must not crash — it must simply
// carry no current, which is what an open circuit does in reality.
check('open circuit does not crash the solver', brokenSolve.ok)
check('open circuit carries no meaningful current', Math.abs(brokenLed.current) < 1e-6)

console.log('\n6. Resistor value changes the outcome (the fidelity thesis)\n')
for (const ohms of [220, 1000, 10000]) {
  const variant: CircuitDoc = {
    ...doc,
    parts: doc.parts.map((p) => (p.id === r1.id ? { ...p, props: { ohms } } : p)),
  }
  const v = compile(variant)
  v.mcuPorts.get('D13')!.set(1 / 25, 5 / 25)
  v.circuit.solve()
  const cur = [...v.leds.values()][0].current * 1000
  console.log(`   ${String(ohms).padStart(6)} Ω → ${cur.toFixed(3).padStart(8)} mA`)
}

console.log('\n' + '='.repeat(72))
console.log(pass ? 'P1 COMPILE PASS' : 'P1 COMPILE FAIL')
process.exit(pass ? 0 : 1)
