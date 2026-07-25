/**
 * Phase 1 — analogRead() against a real solved node voltage.
 *
 * The circuit is a potentiometer across 5 V and GND with the wiper on A0, and
 * the firmware is a genuinely compiled sketch that calls analogRead(A0) and
 * prints the result. If the divider is real, turning the knob must move the
 * printed number the way a bench multimeter would.
 *
 * Run: npx tsx lib/simulator/__spikes__/p1-adc.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimulationEngine, parseIntelHex } from '../engine'
import type { CircuitDoc } from '../model/document'

function potCircuit(position: number): CircuitDoc {
  return {
    parts: [
      { id: 'uno', type: 'arduino_uno', x: 0, y: 0, rotation: 0, props: {} },
      { id: 'pot', type: 'potentiometer', x: 0, y: 200, rotation: 0, props: { position } },
    ],
    wires: [
      { id: 'w1', from: { partId: 'pot', pinId: '1' }, to: { partId: 'uno', pinId: 'GND.1' }, color: '#111' },
      { id: 'w2', from: { partId: 'pot', pinId: '3' }, to: { partId: 'uno', pinId: '5V' }, color: '#e04a4a' },
      { id: 'w3', from: { partId: 'pot', pinId: '2' }, to: { partId: 'uno', pinId: 'A0' }, color: '#eab308' },
    ],
  }
}

const program = parseIntelHex(
  readFileSync(join(process.cwd(), 'lib/simulator/__spikes__/fixtures/pot.hex'), 'utf8'),
)

console.log('P1  analogRead() against a solved potentiometer')
console.log('='.repeat(72))
console.log('\n  knob   expected V   expected counts   reported   serial')
console.log('  ' + '-'.repeat(66))

let pass = true

for (const position of [0, 25, 50, 75, 100]) {
  const eng = new SimulationEngine(program, potCircuit(position))
  eng.run(2_500_000) // let the sketch take a few readings
  const snap = eng.snapshot()

  // Wiper at `position` % from the GND end, so V = 5 * position/100.
  const expectedV = 5 * (position / 100)
  const expectedCounts = Math.round((expectedV / 5) * 1023)
  const reported = snap.adc['A0'] ?? -1

  // The sketch prints "A0=<n>" — parse the last complete line it emitted.
  const matches = [...snap.serial.matchAll(/A0=(\d+)/g)]
  const lastPrinted = matches.length ? Number(matches[matches.length - 1][1]) : -1

  const ok = Math.abs(reported - expectedCounts) <= 12 && lastPrinted >= 0
  if (!ok) pass = false

  console.log(
    `  ${String(position).padStart(4)}%  ${expectedV.toFixed(3).padStart(9)} V  ` +
      `${String(expectedCounts).padStart(15)}   ${String(reported).padStart(8)}   ` +
      `A0=${lastPrinted}  ${ok ? 'PASS' : 'FAIL'}`,
  )
}

// The sketch must also see the change: the value it PRINTS has to track the knob.
console.log('\n  Firmware-visible response (what the sketch actually printed)\n')
const low = new SimulationEngine(program, potCircuit(10))
low.run(2_500_000)
const high = new SimulationEngine(program, potCircuit(90))
high.run(2_500_000)
const lastOf = (s: string) => {
  const m = [...s.matchAll(/A0=(\d+)/g)]
  return m.length ? Number(m[m.length - 1][1]) : -1
}
const lo = lastOf(low.snapshot().serial)
const hi = lastOf(high.snapshot().serial)
console.log(`  knob 10%  → sketch printed A0=${lo}`)
console.log(`  knob 90%  → sketch printed A0=${hi}`)
const monotonic = hi > lo + 400
if (!monotonic) pass = false
console.log(`  ${monotonic ? 'PASS' : 'FAIL'}  the sketch sees the knob move`)

console.log('\n' + '='.repeat(72))
console.log(pass ? 'P1 ADC PASS' : 'P1 ADC FAIL')
process.exit(pass ? 0 : 1)
