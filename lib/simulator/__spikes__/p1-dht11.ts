/**
 * Phase 1 — DHT11, the first tier-2 behavioural part.
 *
 * This is the check that Experiment 01 can actually be COMPLETED. The firmware
 * is the real course sketch built against the real Adafruit DHT library, which
 * bit-bangs the single-wire protocol and verifies a checksum. Nothing here is
 * stubbed: if the timing or the framing is wrong, the library rejects the read
 * and prints "Sensor read failed!" exactly as it would on a bench.
 *
 * Run: npx tsx lib/simulator/__spikes__/p1-dht11.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimulationEngine, parseIntelHex } from '../engine'
import { EXPERIMENT_01_DHT } from '../model/examples'
import type { CircuitDoc } from '../model/document'

const program = parseIntelHex(
  readFileSync(join(process.cwd(), 'lib/simulator/__spikes__/fixtures/dht11.hex'), 'utf8'),
)

function withSensor(temperature: number, humidity: number): CircuitDoc {
  return {
    ...EXPERIMENT_01_DHT,
    parts: EXPERIMENT_01_DHT.parts.map((p) =>
      p.id === 'dht' ? { ...p, props: { temperature, humidity } } : p,
    ),
  }
}

console.log('P1  DHT11 — Experiment 01 end to end')
console.log('='.repeat(74))
console.log('\n  set T   set RH   what the sketch printed')
console.log('  ' + '-'.repeat(64))

let pass = true
const seen: Array<{ t: number; readT: number; readH: number }> = []

for (const [t, h] of [
  [22, 40],
  [28, 55],
  [35, 70],
] as const) {
  const eng = new SimulationEngine(program, withSensor(t, h))
  // The sketch waits 2 s between reads, and the DHT library needs a couple of
  // attempts before its first successful one.
  eng.run(7_000_000)
  const serial = eng.snapshot().serial

  const temps = [...serial.matchAll(/Temperature:\s*([\d.]+)/g)]
  const hums = [...serial.matchAll(/Humidity:\s*([\d.]+)/g)]
  const readT = temps.length ? Number(temps[temps.length - 1][1]) : NaN
  const readH = hums.length ? Number(hums[hums.length - 1][1]) : NaN
  const failed = /failed/i.test(serial)

  seen.push({ t, readT, readH })
  const last = serial.trim().split(/\r?\n/).slice(-2).join(' | ')
  console.log(`  ${String(t).padStart(4)}°C  ${String(h).padStart(5)}%   ${last.slice(0, 52)}`)

  const ok = !failed && Math.abs(readT - t) < 1 && Math.abs(readH - h) < 1
  if (!ok) pass = false
}

console.log('\n  Assertions\n')
function check(label: string, ok: boolean) {
  if (!ok) pass = false
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

check('the sketch read the sensor without a checksum failure', seen.every((s) => !Number.isNaN(s.readT)))
check('reported temperature matches what the sensor was set to', seen.every((s) => Math.abs(s.readT - s.t) < 1))
check('changing the slider changes what the firmware reads', seen[0].readT !== seen[2].readT)

// The sketch's own logic: digitalWrite(LED, t > 30 ? HIGH : LOW).
console.log('\n  The sketch\'s threshold logic (LED on above 30 °C)\n')
for (const [t, expectOn] of [
  [24, false],
  [35, true],
] as const) {
  const eng = new SimulationEngine(program, withSensor(t, 50))
  eng.run(7_000_000)
  const snap = eng.snapshot()
  const mA = (snap.currents['led1'] ?? 0) * 1000
  const on = mA > 5
  console.log(`  ${t}°C → LED ${mA.toFixed(2)} mA (${on ? 'ON' : 'off'}), expected ${expectOn ? 'ON' : 'off'}`)
  check(`LED is ${expectOn ? 'on' : 'off'} at ${t}°C`, on === expectOn)
}

console.log('\n' + '='.repeat(74))
console.log(pass ? 'P1 DHT11 PASS' : 'P1 DHT11 FAIL')
process.exit(pass ? 0 : 1)
