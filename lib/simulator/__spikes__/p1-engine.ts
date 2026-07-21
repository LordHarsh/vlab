/**
 * Phase 1 — real firmware driving a student-built circuit, headless.
 * Run: npx tsx lib/simulator/__spikes__/p1-engine.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimulationEngine, parseIntelHex } from '../engine'
import { EXPERIMENT_01 } from '../model/examples'

const dir = join(process.cwd(), 'lib/simulator/__spikes__/fixtures')

for (const name of ['blink.hex', 'dht11.hex']) {
  const program = parseIntelHex(readFileSync(join(dir, name), 'utf8'))
  const eng = new SimulationEngine(program, EXPERIMENT_01)

  const t0 = performance.now()
  eng.run(3_000_000) // 3 s of simulated time
  const wall = (performance.now() - t0) / 1000
  const s = eng.snapshot()

  console.log(`\n${name}`)
  console.log(`  wall            : ${wall.toFixed(2)} s for 3 s simulated  (${(3 / wall).toFixed(2)}x)`)
  console.log(`  sim time        : ${s.simSeconds.toFixed(2)} s`)
  console.log(`  pin edges       : ${s.pinEdges}`)
  console.log(`  DC solves       : ${s.solves}   cache hits: ${s.cacheHits}`)
  console.log(`  LED current now : ${((s.currents['led1'] ?? 0) * 1000).toFixed(2)} mA`)
  console.log(`  unknowns        : ${s.unknowns}`)
  const serial = s.serial.replace(/\r?\n/g, ' | ').trim()
  console.log(`  serial          : ${serial ? serial.slice(0, 110) : '(none)'}`)
}
