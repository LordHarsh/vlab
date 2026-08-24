/**
 * P0-1 — avr8js throughput on REAL compiled firmware.
 *
 * The blocking spike from docs/SIMULATOR_ARCHITECTURE.md §10. The original
 * architecture was budgeted on "163 Mcycle/s = 10.2x realtime", which the
 * adversarial verifier could not reproduce (§5.1). Every prior benchmark on
 * both sides used synthetic instruction loops; this one uses actual avr-gcc
 * output, because real firmware has a different instruction mix and far
 * heavier interrupt traffic.
 *
 * Fixtures are compiled by arduino-cli 1.5.1 / avr-gcc 7.3.0 / arduino:avr 1.8.8:
 *   blink.hex  —  Arduino Blink (delay() → Timer0 overflow interrupts)
 *   dht11.hex  —  VLab Experiment 01, with the real Adafruit DHT library
 *
 * KILL CRITERION: below ~0.5x realtime on a low-end laptop with rendering on
 * means stop and re-plan before any product code exists.
 *
 * Run: npx tsx lib/simulator/__spikes__/p0-1-avr8js-throughput.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CPU,
  avrInstruction,
  AVRTimer,
  AVRIOPort,
  AVRADC,
  AVRUSART,
  timer0Config,
  timer1Config,
  timer2Config,
  portBConfig,
  portCConfig,
  portDConfig,
  adcConfig,
  usart0Config,
} from 'avr8js'

const FLASH_WORDS = 0x8000 / 2 // ATmega328P: 32 KB flash
const CLOCK_HZ = 16_000_000

/** Minimal Intel HEX parser — enough for avr-gcc output (record types 00/01/04). */
function parseIntelHex(text: string): Uint16Array {
  const bytes = new Uint8Array(0x8000)
  let maxAddr = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith(':')) continue
    const len = parseInt(line.substring(1, 3), 16)
    const addr = parseInt(line.substring(3, 7), 16)
    const type = parseInt(line.substring(7, 9), 16)
    if (type === 1) break // EOF
    if (type !== 0) continue // ignore extended-address records; Uno fits in 64 KB
    for (let i = 0; i < len; i++) {
      const b = parseInt(line.substring(9 + i * 2, 11 + i * 2), 16)
      bytes[addr + i] = b
      if (addr + i > maxAddr) maxAddr = addr + i
    }
  }
  const words = new Uint16Array(FLASH_WORDS)
  for (let i = 0; i < FLASH_WORDS; i++) {
    words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
  }
  return words
}

type Config = 'cpu' | 'timers' | 'listener' | 'adc'

interface Rig {
  cpu: CPU
  run: (cycles: number) => void
  edges: number
  adcReads: number
}

function buildRig(program: Uint16Array, config: Config): Rig {
  const cpu = new CPU(program)
  const rig: Rig = { cpu, run: () => {}, edges: 0, adcReads: 0 }

  if (config !== 'cpu') {
    // Everything a real Arduino sketch touches: Timer0 drives millis()/delay(),
    // Timer1/2 back analogWrite(), USART backs Serial.
    new AVRTimer(cpu, timer0Config)
    new AVRTimer(cpu, timer1Config)
    new AVRTimer(cpu, timer2Config)
    const portB = new AVRIOPort(cpu, portBConfig)
    const portC = new AVRIOPort(cpu, portCConfig)
    const portD = new AVRIOPort(cpu, portDConfig)
    new AVRUSART(cpu, usart0Config, CLOCK_HZ)

    if (config === 'listener' || config === 'adc') {
      // This is the seam the analog solver hangs off: every pin change becomes
      // a re-solve trigger (memoised — see P0-2).
      portB.addListener(() => {
        rig.edges++
      })
      portD.addListener(() => {
        rig.edges++
      })
    }

    if (config === 'adc') {
      const adc = new AVRADC(cpu, adcConfig)
      // Demand-driven: the solver is asked for a node voltage only when the
      // sketch actually starts a conversion.
      adc.onADCRead = () => {
        rig.adcReads++
        // Stand-in for a DC solve; P0-2 measured the real cost at ~5 us,
        // and memoisation means most reads never reach the solver at all.
        const volts = 2.5
        adc.completeADCRead(Math.round((volts / 5) * 1023))
      }
      void portC
    }
  }

  rig.run = (cycles: number) => {
    const target = cpu.cycles + cycles
    while (cpu.cycles < target) {
      avrInstruction(cpu)
      cpu.tick()
    }
  }

  return rig
}

function bench(program: Uint16Array, config: Config, cycles: number) {
  const rig = buildRig(program, config)
  rig.run(1_000_000) // warm up JIT and get past Arduino's init()

  const start = performance.now()
  const c0 = rig.cpu.cycles
  rig.run(cycles)
  const elapsed = (performance.now() - start) / 1000
  const executed = rig.cpu.cycles - c0

  const mcps = executed / elapsed / 1e6
  return {
    mcps,
    xRealtime: (executed / elapsed) / CLOCK_HZ,
    edges: rig.edges,
    adcReads: rig.adcReads,
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const here = join(process.cwd(), 'lib/simulator/__spikes__/fixtures')
const sketches = [
  { name: 'blink.hex', label: 'Blink (delay/Timer0 ISR)' },
  { name: 'dht11.hex', label: 'Experiment 01 + Adafruit DHT' },
]

console.log('P0-1  avr8js throughput on real avr-gcc firmware')
console.log('='.repeat(78))
console.log(`\nHost: node ${process.version}  ${process.platform}/${process.arch}`)
console.log('Toolchain: arduino-cli 1.5.1 / avr-gcc 7.3.0 / arduino:avr 1.8.8')
console.log(`Target: ATmega328P @ ${CLOCK_HZ / 1e6} MHz\n`)

const CYCLES = 160_000_000 // 10 s of simulated time
const configs: Array<[Config, string]> = [
  ['cpu', 'CPU only'],
  ['timers', '+ timers + ports + USART'],
  ['listener', '+ port listener (solver seam)'],
  ['adc', '+ demand-driven ADC'],
]

const results: Record<string, number> = {}

for (const sk of sketches) {
  const hex = readFileSync(join(here, sk.name), 'utf8')
  const program = parseIntelHex(hex)

  console.log(`── ${sk.label}  (${sk.name})`)
  console.log('   configuration                    Mcycle/s   x realtime')
  console.log('   ' + '-'.repeat(58))

  for (const [cfg, label] of configs) {
    const r = bench(program, cfg, CYCLES)
    results[`${sk.name}:${cfg}`] = r.xRealtime
    console.log(
      `   ${label.padEnd(32)} ${r.mcps.toFixed(1).padStart(8)} ${r.xRealtime.toFixed(2).padStart(11)}x`,
    )
  }
  console.log()
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

const worst = Math.min(...Object.values(results))
const CELERON_PENALTY = 3.4 // measured ratio used throughout the architecture doc
const projected = worst / CELERON_PENALTY

console.log('='.repeat(78))
console.log(`Worst full-config case on this host : ${worst.toFixed(2)}x realtime`)
console.log(`Projected on Celeron N4020 (/${CELERON_PENALTY})  : ${projected.toFixed(2)}x realtime`)
console.log(`Architecture doc §5.1 predicted     : 0.7-1.1x on that class of machine`)
console.log()

if (projected >= 0.5) {
  console.log('VERDICT: PASS — above the 0.5x kill criterion.')
} else {
  console.log('VERDICT: FAIL — below the 0.5x kill criterion. STOP AND RE-PLAN.')
}
console.log()
console.log('NOTE: headless. Phase 0 still owes the same measurement in-browser')
console.log('      with the breadboard SVG and scope rendering live.')

process.exit(projected >= 0.5 ? 0 : 1)
