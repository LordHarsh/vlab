/**
 * SPIKE P2-1 — can rp2040js boot MicroPython and give us observable GPIO?
 *
 * Answers the four Phase-1 questions with measurements rather than opinion:
 *
 *   1. does rp2040js run headless with no Node-only APIs in the hot path?
 *   2. what does it take to LOAD MicroPython, and how big is the payload?
 *   3. can we see and drive GPIO the way avr8js's port.addListener/setPin work?
 *   4. is it fast enough for the memoised-DC-solve trick the AVR engine uses?
 *
 * Run:  npx tsx lib/simulator/__spikes__/p2-rp2040-micropython.ts <dir-with-bootrom.bin+mp.bin>
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RP2040, USBCDC, GPIOPinState, type Logger } from 'rp2040js'

/**
 * The default ConsoleLogger formats and prints a Date on every debug() call and
 * MicroPython's USB stack is chatty enough to dominate the profile. A no-op
 * logger is what a production build would ship, so it is what we benchmark.
 */
const SILENT: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const FLASH_START = 0x10000000

const assetDir = process.argv[2]
if (!assetDir) {
  console.error('usage: tsx p2-rp2040-micropython.ts <asset-dir>')
  process.exit(1)
}

// ─── 1. Load the two binary blobs ────────────────────────────────────────────

const bootromBytes = readFileSync(join(assetDir, 'bootrom.bin'))
const firmwareBytes = readFileSync(join(assetDir, 'mp.bin'))

console.log(`bootrom.bin  ${bootromBytes.length} bytes`)
console.log(`mp.bin       ${firmwareBytes.length} bytes`)

const mcu = new RP2040()
mcu.logger = SILENT
mcu.loadBootrom(
  new Uint32Array(
    bootromBytes.buffer.slice(
      bootromBytes.byteOffset,
      bootromBytes.byteOffset + bootromBytes.length,
    ),
  ),
)
mcu.flash.set(firmwareBytes, 0) // image starts exactly at FLASH_START
mcu.core.PC = FLASH_START // the bootrom's stage-2 entry, as the demo does
void FLASH_START

// ─── 2. Serial over emulated USB CDC ─────────────────────────────────────────

const cdc = new USBCDC(mcu.usbCtrl)
let serial = ''
cdc.onSerialData = (buf) => {
  serial += Buffer.from(buf).toString('latin1')
}
let connected = false
cdc.onDeviceConnected = () => {
  connected = true
  for (const ch of '\r\n') cdc.sendSerialByte(ch.charCodeAt(0))
}

// ─── 3. GPIO observability ───────────────────────────────────────────────────

const WATCH = 15
let edges = 0
const edgeAt: number[] = []
mcu.gpio[WATCH].addListener((state) => {
  edges++
  if (edgeAt.length < 40) edgeAt.push(clock.micros)
  void state
})

// ─── 4. Stepping loop, mirroring SimulationEngine.run(micros) ────────────────

const CYCLE_NANOS = 1e9 / 125e6
let instructions = 0

/**
 * rp2040js types RP2040.clock as the narrow IClock interface, which exposes
 * only `nanos` and `createAlarm`. Stepping the emulator by hand needs the
 * concrete SimulationClock underneath — which is what RP2040 always constructs
 * — and that class is not re-exported from the package index.
 */
interface SteppableClock {
  readonly nanos: number
  readonly micros: number
  readonly nanosToNextAlarm: number
  tick(deltaNanos: number): void
}
const clock = mcu.clock as unknown as SteppableClock

function run(micros: number): void {
  const target = clock.nanos + micros * 1000
  const core = mcu.core
  while (clock.nanos < target) {
    if (core.waiting) {
      const skip = clock.nanosToNextAlarm
      clock.tick(skip > 0 ? Math.min(skip, target - clock.nanos) : target - clock.nanos)
    } else {
      const cycles = core.executeInstruction()
      instructions++
      clock.tick(cycles * CYCLE_NANOS)
    }
  }
}

function bench(label: string, micros: number): number {
  const i0 = instructions
  const t0 = performance.now()
  run(micros)
  const wall = (performance.now() - t0) / 1000
  const ips = (instructions - i0) / wall
  console.log(
    `${label}: ${(micros / 1e6).toFixed(2)} s sim in ${wall.toFixed(3)} s wall ` +
      `= ${(micros / 1e6 / wall).toFixed(2)}x realtime, ${(ips / 1e6).toFixed(1)} M instr/s`,
  )
  return micros / 1e6 / wall
}

// Boot.
console.log('\n--- boot ---')
const bootRatio = bench('boot 3 s', 3_000_000)
console.log(`usb connected: ${connected}`)
console.log(`serial so far (${serial.length} B):\n${JSON.stringify(serial.slice(0, 400))}`)

// ─── 5. Feed a student script over the REPL, in paste mode ───────────────────

const SCRIPT = [
  'from machine import Pin',
  'import time',
  'led = Pin(15, Pin.OUT)',
  'while True:',
  '    led.value(1)',
  '    time.sleep(0.5)',
  '    led.value(0)',
  '    time.sleep(0.5)',
].join('\r\n')

function send(s: string): void {
  for (let i = 0; i < s.length; i++) cdc.sendSerialByte(s.charCodeAt(i))
}

console.log('\n--- paste mode ---')
send('\x05') // Ctrl-E: enter paste mode
run(200_000)
send(SCRIPT)
run(400_000)
send('\x04') // Ctrl-D: execute
console.log(`serial tail: ${JSON.stringify(serial.slice(-200))}`)

const edgesBefore = edges
const micros0 = clock.micros
console.log('\n--- running the blink ---')
const runRatio = bench('blink 4 s', 4_000_000)
const elapsed = (clock.micros - micros0) / 1e6

console.log(`\nGPIO${WATCH} edges in ${elapsed.toFixed(2)} s sim: ${edges - edgesBefore}`)
console.log(`pin state now: ${GPIOPinState[mcu.gpio[WATCH].value]}`)
console.log(`outputEnable=${mcu.gpio[WATCH].outputEnable} outputValue=${mcu.gpio[WATCH].outputValue}`)
if (edgeAt.length > 2) {
  const gaps = edgeAt.slice(1).map((t, i) => (t - edgeAt[i]) / 1000)
  console.log(`edge gaps (ms): ${gaps.map((g) => g.toFixed(1)).join(', ')}`)
}
console.log(`\nserial tail: ${JSON.stringify(serial.slice(-300))}`)
console.log(`\nspeed: boot ${bootRatio.toFixed(2)}x, run ${runRatio.toFixed(2)}x realtime`)
