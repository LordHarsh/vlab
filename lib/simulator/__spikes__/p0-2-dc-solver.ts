/**
 * P0-2 — DC solver correctness + memoisation cost.
 *
 * Blocking spike from docs/SIMULATOR_ARCHITECTURE.md §10. Two questions:
 *
 *   1. Does the solver reproduce ngspice's numbers for the LED+resistor sweep?
 *      Reference (§5.5): 220Ω → 13.76 mA, 1kΩ → 3.12 mA, 10kΩ → 0.32 mA,
 *      none → 1419 mA / 7.1 W (destroyed).
 *
 *   2. Does memoisation on pin state collapse PWM to two solves?
 *      This is the load-bearing claim of the entire architecture (§2.4). If it
 *      fails, the design changes.
 *
 * Run: node lib/simulator/__spikes__/p0-2-dc-solver.ts
 */

import { Circuit } from '../solver'
import { Resistor, VoltageSource, NortonPort, createLED, type Diode } from '../devices'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** 5 V ── R ── LED ── GND. Pass rSeries = 0 for the "no resistor" case. */
function ledCircuit(rSeries: number): { circuit: Circuit; led: Diode } {
  const c = new Circuit()
  const vcc = c.allocNet()
  const anode = rSeries > 0 ? c.allocNet() : vcc
  const internal = c.allocNet()

  c.add(new VoltageSource('V1', vcc, 0, 5))
  if (rSeries > 0) c.add(new Resistor('R1', vcc, anode, rSeries))

  const { devices, diode } = createLED('LED1', anode, 0, internal)
  // createLED wires diode anode→internal and Rs internal→cathode; cathode is 0.
  c.add(...devices)
  return { circuit: c, led: diode }
}

/** A resistor ladder with `rungs` internal nodes, for scaling measurements. */
function ladder(rungs: number): Circuit {
  const c = new Circuit()
  const vcc = c.allocNet()
  c.add(new VoltageSource('V1', vcc, 0, 5))
  let prev = vcc
  for (let i = 0; i < rungs; i++) {
    const node = c.allocNet()
    c.add(new Resistor(`Rs${i}`, prev, node, 1000))
    c.add(new Resistor(`Rp${i}`, node, 0, 10000))
    prev = node
  }
  return c
}

// ─── 1. Correctness against the ngspice reference ─────────────────────────────

const REFERENCE = [
  { r: 220, mA: 13.76, label: 'bright' },
  { r: 1000, mA: 3.12, label: 'dim' },
  { r: 10000, mA: 0.32, label: 'barely lit' },
  { r: 0, mA: 1419, label: 'DESTROYED' },
]

console.log('P0-2  DC solver spike')
console.log('='.repeat(72))
console.log('\n1. LED + resistor sweep vs ngspice reference (docs/SIMULATOR_ARCHITECTURE.md §5.5)\n')
console.log('   R        expected     measured     err      iters  status')
console.log('   ' + '-'.repeat(62))

let allPass = true
for (const ref of REFERENCE) {
  const { circuit, led } = ledCircuit(ref.r)
  const res = circuit.solve()
  const mA = led.current * 1000
  const errPct = Math.abs(mA - ref.mA) / ref.mA * 100
  const pass = res.ok && errPct < 5
  if (!pass) allPass = false
  const rLabel = ref.r === 0 ? 'none' : ref.r >= 1000 ? `${ref.r / 1000}k` : `${ref.r}`
  console.log(
    `   ${rLabel.padEnd(8)} ${ref.mA.toFixed(2).padStart(9)} mA ${mA.toFixed(2).padStart(9)} mA` +
      ` ${errPct.toFixed(1).padStart(6)}%  ${String(res.iterations).padStart(4)}   ` +
      `${pass ? 'PASS' : 'FAIL'}  ${ref.label}`,
  )
}

// The pedagogy check that actually matters: does resistor choice change outcome?
{
  const bright = ledCircuit(220)
  bright.circuit.solve()
  const dim = ledCircuit(10000)
  dim.circuit.solve()
  const none = ledCircuit(0)
  none.circuit.solve()
  const ratio = bright.led.current / dim.led.current
  const power = none.led.current * 5
  console.log(`\n   Pedagogy: 220Ω is ${ratio.toFixed(0)}x brighter than 10kΩ.`)
  console.log(`   No resistor dissipates ${power.toFixed(1)} W — LED destroyed (rated ~0.06 W).`)
}

// ─── 2. Memoisation under PWM — the load-bearing claim ────────────────────────

console.log('\n2. Memoisation under PWM (§2.4)\n')

/** Cache keyed on the pin-state vector, exactly as the architecture specifies. */
class MemoisedPins {
  private cache = new Map<string, Float64Array>()
  solves = 0
  hits = 0

  constructor(
    private circuit: Circuit,
    private ports: NortonPort[],
  ) {}

  /** states[i] = true for HIGH, false for LOW. */
  evaluate(states: boolean[]): Float64Array {
    const key = states.map((s) => (s ? '1' : '0')).join('')
    const hit = this.cache.get(key)
    if (hit) {
      this.hits++
      return hit
    }
    for (let i = 0; i < this.ports.length; i++) {
      // Output HIGH: 5 V behind 25 Ω. Output LOW: 0 V behind 25 Ω. (§2.6)
      this.ports[i].set(1 / 25, states[i] ? 5 / 25 : 0)
    }
    const res = this.circuit.solve()
    this.solves++
    this.cache.set(key, res.voltages)
    return res.voltages
  }
}

{
  // One MCU pin driving an LED through a resistor.
  const c = new Circuit()
  const pin = c.allocNet()
  const internal = c.allocNet()
  const port = new NortonPort('D9', 0, pin, 1 / 25, 0)
  c.add(port)
  const anode = c.allocNet()
  c.add(new Resistor('R1', pin, anode, 220))
  const { devices } = createLED('LED1', anode, 0, internal)
  c.add(...devices)

  const memo = new MemoisedPins(c, [port])

  // 490 Hz PWM for 1 second of simulated time = 980 edges.
  const EDGES = 980
  const t0 = performance.now()
  for (let i = 0; i < EDGES; i++) memo.evaluate([i % 2 === 0])
  const dt = performance.now() - t0

  console.log(`   ${EDGES} PWM edges (490 Hz, 1 s simulated)`)
  console.log(`   actual solves : ${memo.solves}`)
  console.log(`   cache hits    : ${memo.hits}`)
  console.log(`   wall time     : ${dt.toFixed(2)} ms`)
  console.log(
    `   VERDICT       : ${memo.solves === 2 ? 'CONFIRMED — PWM collapses to 2 solves' : 'FAILED — ' + memo.solves + ' solves'}`,
  )
  if (memo.solves !== 2) allPass = false

  // Regression guard: a Norton-driven pin must produce the same current as an
  // ideal source through the same resistance. The polarity of the Norton
  // current stamp was once reversed, which the solve-count test above cannot
  // see — it converged fine and simply drove the node to −5 V.
  const vHigh = memo.evaluate([true])
  const vLow = memo.evaluate([false])
  const pinHigh = vHigh[1]
  const pinLow = vLow[1]
  const polarityOk = pinHigh > 4 && Math.abs(pinLow) < 0.1
  console.log(
    `\n   Norton polarity: pin HIGH = ${pinHigh.toFixed(3)} V, LOW = ${pinLow.toFixed(3)} V` +
      `  ${polarityOk ? 'PASS' : 'FAIL'}`,
  )
  if (!polarityOk) allPass = false
}

// ─── 3. Per-solve cost vs circuit size ────────────────────────────────────────

console.log('\n3. Solve cost vs unknowns (nonlinear, cold each time)\n')
console.log('   unknowns   per-solve    solves/sec')
console.log('   ' + '-'.repeat(38))

for (const rungs of [5, 9, 14, 19, 39]) {
  const c = ladder(rungs)
  const n = c.size
  const ITER = 2000
  const t0 = performance.now()
  for (let i = 0; i < ITER; i++) {
    c.resetState()
    c.solve()
  }
  const per = (performance.now() - t0) / ITER
  console.log(
    `   ${String(n).padStart(6)}   ${per.toFixed(4).padStart(8)} ms  ${Math.round(1000 / per).toString().padStart(9)}`,
  )
}

console.log('\n' + '='.repeat(72))
console.log(allPass ? 'P0-2 PASS' : 'P0-2 FAIL')
process.exit(allPass ? 0 : 1)
