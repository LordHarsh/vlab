/**
 * Phase 1 — PWM dimming must be visible, not binary.
 *
 * analogWrite() alternates a pin between two DC operating points. Reporting the
 * instantaneous solve makes an LED read either fully on or fully off; a real eye
 * integrates. This checks that the reported current tracks the duty cycle the
 * firmware actually requested.
 *
 * The sketch is real: it reads A0 and writes analogWrite(D9, raw/4).
 *
 * Run: npx tsx lib/simulator/__spikes__/p1-pwm.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimulationEngine, parseIntelHex } from '../engine'
import { POT_ADC } from '../model/examples'
import type { CircuitDoc } from '../model/document'

const program = parseIntelHex(
  readFileSync(join(process.cwd(), 'lib/simulator/__spikes__/fixtures/pot.hex'), 'utf8'),
)

function withKnob(position: number): CircuitDoc {
  return {
    ...POT_ADC,
    parts: POT_ADC.parts.map((p) => (p.id === 'pot' ? { ...p, props: { position } } : p)),
  }
}

console.log('P1  PWM dimming via analogWrite')
console.log('='.repeat(70))
console.log('\n  knob   A0    duty    mean LED current   full-on equivalent')
console.log('  ' + '-'.repeat(60))

const results: Array<{ knob: number; mA: number }> = []

for (const knob of [10, 30, 50, 75, 100]) {
  const eng = new SimulationEngine(program, withKnob(knob))
  // Let the sketch take a reading and settle into a stable duty cycle.
  eng.run(3_000_000)
  const snap = eng.snapshot()
  const a0 = snap.adc['A0'] ?? 0
  const duty = Math.min(255, Math.round(a0 / 4)) / 255
  const mA = (snap.currents['led1'] ?? 0) * 1000
  results.push({ knob, mA })
  console.log(
    `  ${String(knob).padStart(4)}%  ${String(a0).padStart(4)}  ${(duty * 100).toFixed(0).padStart(5)}%  ` +
      `${mA.toFixed(2).padStart(14)} mA  ${(duty * 12.39).toFixed(2).padStart(10)} mA`,
  )
}

console.log('\n  Assertions\n')
let pass = true
function check(label: string, ok: boolean) {
  if (!ok) pass = false
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

// The whole point: brightness must be graded, not binary.
const distinct = new Set(results.map((r) => r.mA.toFixed(1))).size
check('reported current takes more than two values', distinct > 2)
check('current rises with the knob', results[4].mA > results[0].mA)
check('low knob is dim, not off', results[0].mA > 0.05 && results[0].mA < 4)
check('full knob is near full brightness', results[4].mA > 10)

console.log('\n' + '='.repeat(70))
console.log(pass ? 'P1 PWM PASS' : 'P1 PWM FAIL')
process.exit(pass ? 0 : 1)
