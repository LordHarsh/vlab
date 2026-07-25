/**
 * SPIKE P2-2 — where does rp2040js's time actually go?
 *
 * P2-1 measured 0.50x realtime for MicroPython blink. That number is only
 * actionable if we know WHAT it is spending instructions on: a 1 Hz blink is
 * 99.9% time.sleep(), which on real silicon is a WFE and costs nothing. If the
 * emulated core genuinely idles, an idle-skip makes sleeps free and the ratio
 * is dominated by whatever little work remains. If it busy-waits — most likely
 * because the USB SOF interrupt fires at 1 kHz — the 0.50x is the real ceiling.
 *
 * Also measures the ceiling on raw emulator throughput with a hand-written
 * Thumb loop, so "MicroPython is slow" can be separated from "rp2040js is slow".
 *
 * Run:  npx tsx lib/simulator/__spikes__/p2-rp2040-throughput.ts <asset-dir>
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RP2040, USBCDC, type Logger } from 'rp2040js'

const SILENT: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
const CYCLE_NANOS = 1e9 / 125e6
const assetDir = process.argv[2]

/**
 * RP2040.clock is typed as the narrow IClock (nanos + createAlarm only); the
 * concrete SimulationClock it always holds is not re-exported from the package
 * index, so stepping by hand needs this shape.
 */
interface SteppableClock {
  readonly nanos: number
  readonly nanosToNextAlarm: number
  tick(deltaNanos: number): void
}

// ─── A. Raw emulator ceiling: a hand-written Thumb busy loop ─────────────────
//
// Two instructions, no peripherals, no interrupts. This is the fastest
// rp2040js can possibly go, and therefore the honest upper bound.
{
  const mcu = new RP2040()
  mcu.logger = SILENT
  // ADDS r0, #1  (0x3001) ; B .-4 (0xe7fd)  — an infinite two-instruction loop
  // placed in SRAM at 0x20000000.
  const prog = new Uint16Array([0x3001, 0xe7fd])
  new Uint8Array(mcu.sram.buffer).set(new Uint8Array(prog.buffer), 0)
  mcu.core.PC = 0x20000000
  mcu.core.SP = 0x20040000

  let instructions = 0
  const t0 = performance.now()
  const clock = mcu.clock as unknown as SteppableClock
  const target = clock.nanos + 2_000_000 * 1000 // 2 s simulated
  while (clock.nanos < target) {
    const cycles = mcu.core.executeInstruction()
    instructions++
    clock.tick(cycles * CYCLE_NANOS)
  }
  const wall = (performance.now() - t0) / 1000
  console.log(
    `A. raw thumb loop: ${(instructions / wall / 1e6).toFixed(1)} M instr/s, ` +
      `${(2 / wall).toFixed(2)}x realtime  (r0 = ${mcu.core.registers[0]})`,
  )
}

if (!assetDir) {
  console.log('\n(no asset dir given — skipping the MicroPython measurements)')
  process.exit(0)
}

// ─── B. MicroPython: what fraction of wall time is the sleep? ────────────────

const bootrom = readFileSync(join(assetDir, 'bootrom.bin'))
const firmware = readFileSync(join(assetDir, 'mp.bin'))

function bootMicroPython(): { mcu: RP2040; cdc: USBCDC; serial: () => string } {
  const mcu = new RP2040()
  mcu.logger = SILENT
  mcu.loadBootrom(
    new Uint32Array(bootrom.buffer.slice(bootrom.byteOffset, bootrom.byteOffset + bootrom.length)),
  )
  mcu.flash.set(firmware, 0)
  mcu.core.PC = 0x10000000
  const cdc = new USBCDC(mcu.usbCtrl)
  let s = ''
  cdc.onSerialData = (b) => {
    s += Buffer.from(b).toString('latin1')
  }
  cdc.onDeviceConnected = () => {
    for (const ch of '\r\n') cdc.sendSerialByte(ch.charCodeAt(0))
  }
  return { mcu, cdc, serial: () => s }
}

interface RunStats {
  instructions: number
  idleSkips: number
  idleNanos: number
  wall: number
}

function run(mcu: RP2040, micros: number): RunStats {
  const target = mcu.clock.nanos + micros * 1000
  const core = mcu.core
  const clock = mcu.clock as unknown as SteppableClock
  let instructions = 0
  let idleSkips = 0
  let idleNanos = 0
  const t0 = performance.now()
  while (clock.nanos < target) {
    if (core.waiting) {
      const next = clock.nanosToNextAlarm
      const skip = next > 0 ? Math.min(next, target - clock.nanos) : target - clock.nanos
      idleSkips++
      idleNanos += skip
      clock.tick(skip)
    } else {
      const cycles = core.executeInstruction()
      instructions++
      clock.tick(cycles * CYCLE_NANOS)
    }
  }
  return { instructions, idleSkips, idleNanos, wall: (performance.now() - t0) / 1000 }
}

function report(label: string, micros: number, s: RunStats): void {
  console.log(
    `${label}: ${(micros / 1e6).toFixed(2)} s sim / ${s.wall.toFixed(3)} s wall = ` +
      `${(micros / 1e6 / s.wall).toFixed(2)}x rt | ${(s.instructions / s.wall / 1e6).toFixed(1)} M instr/s | ` +
      `${s.instructions.toLocaleString()} instr | idle skips ${s.idleSkips.toLocaleString()} ` +
      `covering ${((s.idleNanos / (micros * 1000)) * 100).toFixed(1)}% of sim time`,
  )
}

const { mcu, cdc, serial } = bootMicroPython()
console.log('\nB. MicroPython')
report('   boot 3 s   ', 3_000_000, run(mcu, 3_000_000))
console.log(`   prompt: ${JSON.stringify(serial().slice(-8))}`)

function send(s: string): void {
  for (let i = 0; i < s.length; i++) cdc.sendSerialByte(s.charCodeAt(i))
}

// A pure sleep — no GPIO, no printing. If sleeps are free, this is fast.
send('\x05')
run(mcu, 200_000)
send(['import time', 'while True:', '    time.sleep(1)'].join('\r\n'))
run(mcu, 400_000)
send('\x04')
run(mcu, 200_000)
report('   sleep loop', 4_000_000, run(mcu, 4_000_000))

// ─── C. A tight GPIO toggle, no sleeping at all — the pin-edge stress case ───

const b = bootMicroPython()
run(b.mcu, 3_000_000)
let edges = 0
b.mcu.gpio[15].addListener(() => {
  edges++
})
b.cdc.sendSerialByte(5)
run(b.mcu, 200_000)
for (const ch of [
  'from machine import Pin',
  'p = Pin(15, Pin.OUT)',
  'while True:',
  '    p.value(1)',
  '    p.value(0)',
]
  .join('\r\n')
  .split('')) {
  b.cdc.sendSerialByte(ch.charCodeAt(0))
}
run(b.mcu, 400_000)
b.cdc.sendSerialByte(4)
run(b.mcu, 200_000)
const e0 = edges
const st = run(b.mcu, 2_000_000)
console.log('\nC. tight GPIO toggle (no sleep)')
report('   toggle 2 s', 2_000_000, st)
console.log(
  `   ${(edges - e0).toLocaleString()} pin edges in 2 s sim = ` +
    `${(((edges - e0) / 2 / 1000) | 0).toLocaleString()} k edges/s`,
)
