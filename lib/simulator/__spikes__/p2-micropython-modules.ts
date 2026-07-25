/**
 * SPIKE P2-3 — which modules does the SHIPPED MicroPython actually have?
 *
 * Phase 3 asks what each of the six Raspberry Pi experiments would have to
 * change. That question is only answerable with evidence: whether `ds18b20-rpi`
 * is a small rewrite or an impossibility turns entirely on whether onewire/
 * ds18x20 are frozen into the RPI_PICO build, and guessing is not good enough.
 * So ask the interpreter.
 *
 * Run:  npx tsx lib/simulator/__spikes__/p2-micropython-modules.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { PicoSimulationEngine } from '../pico/engine'
import { loadPicoFirmware } from '../pico/firmware'

const dir = path.join(process.cwd(), 'public', 'pico')
const firmware = loadPicoFirmware(
  fs.readFileSync(path.join(dir, 'bootrom.bin')),
  fs.readFileSync(path.join(dir, 'micropython.bin')),
)

const CANDIDATES = [
  // What the six experiments actually need.
  'machine', // GPIO, PWM, ADC, SPI — the RPi.GPIO replacement
  'time',
  'dht', // DHT11/DHT22 — replaces Adafruit_DHT
  'onewire', // 1-Wire bus — replaces the Pi's /sys/bus/w1 kernel driver
  'ds18x20', // DS18B20 decoding on top of onewire
  'network', // WiFi — the Flask/ThingSpeak question
  'socket',
  'urequests',
  'requests',
  'os',
  'json',
  'math',
  'rp2',
  'micropython',
  '_thread',
]

const script = [
  'import sys',
  `mods = ${JSON.stringify(CANDIDATES)}`,
  'for m in mods:',
  '    try:',
  '        __import__(m)',
  '        print("HAVE", m)',
  '    except Exception as e:',
  '        print("MISS", m, type(e).__name__)',
  'print("MPVER", sys.version)',
  'print("PLATFORM", sys.platform)',
  'print("IMPLEMENTATION", sys.implementation)',
  'print("DONE")',
].join('\n')

const eng = new PicoSimulationEngine(firmware, { parts: [], wires: [] }, { script })

const t0 = Date.now()
for (let i = 0; i < 30 && !eng.serial.includes('DONE'); i++) eng.run(500_000)
const wall = (Date.now() - t0) / 1000

console.log(`(${eng.snapshot().simSeconds.toFixed(2)} s simulated in ${wall.toFixed(1)} s wall)\n`)
for (const line of eng.serial.split(/\r?\n/)) {
  if (/^(HAVE|MISS|MPVER|PLATFORM|IMPLEMENTATION)/.test(line)) console.log(line)
}
if (!eng.serial.includes('DONE')) {
  console.log('\n*** did not reach DONE — raw tail ***')
  console.log(JSON.stringify(eng.serial.slice(-600)))
}
