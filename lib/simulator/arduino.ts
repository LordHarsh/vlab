/**
 * The PinBridge: couples a cycle-accurate AVR emulator to the DC analog solver.
 *
 * This is the seam SIMULATOR_ARCHITECTURE.md §2.6 calls non-negotiable. Every
 * MCU pin is permanently Norton-stamped so the matrix sparsity pattern never
 * changes between pin states, and DC solutions are memoised on the pin-state
 * vector — which is what collapses a PWM waveform to two solves (§2.4,
 * confirmed by spike P0-2).
 */

import {
  CPU,
  avrInstruction,
  AVRTimer,
  AVRIOPort,
  AVRUSART,
  timer0Config,
  timer1Config,
  timer2Config,
  portBConfig,
  portCConfig,
  portDConfig,
  usart0Config,
} from 'avr8js'
import { Circuit } from './solver'
import { NortonPort, Resistor, createLED, type Diode } from './devices'
import type { NetId } from './types'

export const CLOCK_HZ = 16_000_000

/** Pin drive models from §2.6. An AVR output is ~25 Ω; a pull-up is 20 kΩ. */
const R_DRIVE = 25
const R_PULLUP = 20_000
const G_FLOAT = 1e-8
const VCC = 5

export type PinMode = 'output_low' | 'output_high' | 'input' | 'input_pullup'

function nortonFor(mode: PinMode): { g: number; i: number } {
  switch (mode) {
    case 'output_low':
      return { g: 1 / R_DRIVE, i: 0 }
    case 'output_high':
      return { g: 1 / R_DRIVE, i: VCC / R_DRIVE }
    case 'input_pullup':
      return { g: 1 / R_PULLUP, i: VCC / R_PULLUP }
    case 'input':
      return { g: G_FLOAT, i: 0 }
  }
}

/** Intel HEX → program words. Handles the record types avr-gcc emits. */
export function parseIntelHex(text: string, flashBytes = 0x8000): Uint16Array {
  const bytes = new Uint8Array(flashBytes)
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith(':')) continue
    const len = parseInt(line.substring(1, 3), 16)
    const addr = parseInt(line.substring(3, 7), 16)
    const type = parseInt(line.substring(7, 9), 16)
    if (type === 1) break
    if (type !== 0) continue
    for (let i = 0; i < len; i++) {
      bytes[addr + i] = parseInt(line.substring(9 + i * 2, 11 + i * 2), 16)
    }
  }
  const words = new Uint16Array(flashBytes / 2)
  for (let i = 0; i < words.length; i++) words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
  return words
}

export interface SimStats {
  /** Simulated microseconds elapsed. */
  simMicros: number
  /** How fast we ran relative to a real 16 MHz part. */
  speedRatio: number
  /** DC solves actually performed (cache misses). */
  solves: number
  /** Cache hits — the memoisation payoff. */
  cacheHits: number
  pinEdges: number
}

export interface LedReading {
  id: string
  /** Amps through the LED. */
  current: number
  /** 0..1, perceptual-ish, for rendering. */
  brightness: number
  /** True when the part is past its rating and would be destroyed. */
  overCurrent: boolean
}

/**
 * Demo/reference topology: D13 ── Rseries ── LED ── GND.
 *
 * This is VLab Experiment 01's output stage, and it is the circuit the whole
 * fidelity argument rests on: change Rseries and the current must change the
 * way it does on a real bench.
 */
export class ArduinoSimulation {
  readonly cpu: CPU
  private portB: AVRIOPort
  private portD: AVRIOPort
  private usart: AVRUSART

  private circuit = new Circuit()
  private d13Port: NortonPort
  private seriesResistor: Resistor
  private led: Diode
  private ledNetAnode: NetId

  /** Cache: pin-state key → solved voltages. §2.4 */
  private cache = new Map<string, Float64Array>()
  private solves = 0
  private cacheHits = 0
  private pinEdges = 0

  private d13State: PinMode = 'output_low'
  private lastVoltages: Float64Array = new Float64Array(0)

  /** Serial output from the sketch, as the USART emits it. */
  serial = ''

  /** LED current rating; above this the part is destroyed. */
  private readonly ledRating = 0.03

  constructor(program: Uint16Array, seriesOhms = 220) {
    this.cpu = new CPU(program)
    new AVRTimer(this.cpu, timer0Config)
    new AVRTimer(this.cpu, timer1Config)
    new AVRTimer(this.cpu, timer2Config)
    this.portB = new AVRIOPort(this.cpu, portBConfig)
    new AVRIOPort(this.cpu, portCConfig)
    this.portD = new AVRIOPort(this.cpu, portDConfig)
    this.usart = new AVRUSART(this.cpu, usart0Config, CLOCK_HZ)

    this.usart.onByteTransmit = (byte) => {
      this.serial += String.fromCharCode(byte)
      if (this.serial.length > 4000) this.serial = this.serial.slice(-4000)
    }

    // ── Build the analog side ──
    const pinNet = this.circuit.allocNet()
    const anode = this.circuit.allocNet()
    const internal = this.circuit.allocNet()
    this.ledNetAnode = anode

    this.d13Port = new NortonPort('D13', 0, pinNet, 1 / R_DRIVE, 0)
    this.seriesResistor = new Resistor('Rs', pinNet, anode, seriesOhms)
    const { devices, diode } = createLED('LED1', anode, 0, internal)
    this.led = diode
    this.circuit.add(this.d13Port, this.seriesResistor, ...devices)

    // D13 is PORTB bit 5 on an Uno.
    this.portB.addListener(() => {
      const state = this.portB.pinState(5)
      const mode: PinMode =
        state === 1 ? 'output_high' : state === 0 ? 'output_low' : 'input'
      if (mode !== this.d13State) {
        this.d13State = mode
        this.pinEdges++
      }
    })

    this.evaluate()
  }

  /**
   * Changing a component value is a topology-preserving edit, so it only has to
   * invalidate the cache — the matrix structure is untouched.
   */
  setSeriesResistance(ohms: number): void {
    this.seriesResistor = new Resistor('Rs', 0, 0, ohms)
    // Rebuild is cheap and avoids mutable-state bugs; ~40 unknowns worst case.
    this.rebuild(ohms)
  }

  private seriesOhms = 220

  private rebuild(ohms: number): void {
    this.seriesOhms = ohms
    this.circuit = new Circuit()
    const pinNet = this.circuit.allocNet()
    const anode = this.circuit.allocNet()
    const internal = this.circuit.allocNet()
    this.ledNetAnode = anode
    this.d13Port = new NortonPort('D13', 0, pinNet, 1 / R_DRIVE, 0)
    // A "no resistor" build still needs the wire's own tiny resistance, or the
    // student gets a mathematically ideal short instead of a burnt LED.
    this.seriesResistor = new Resistor('Rs', pinNet, anode, Math.max(ohms, 1e-3))
    const { devices, diode } = createLED('LED1', anode, 0, internal)
    this.led = diode
    this.circuit.add(this.d13Port, this.seriesResistor, ...devices)
    this.cache.clear()
    this.evaluate()
  }

  /** Solve for the current pin state, using the memo cache. */
  private evaluate(): void {
    const key = `${this.d13State}|${this.seriesOhms}`
    const hit = this.cache.get(key)
    if (hit) {
      this.cacheHits++
      this.lastVoltages = hit
      // The cached solve also fixes the LED current for this state.
      this.cachedCurrent.set(key, this.cachedCurrent.get(key) ?? 0)
      this.ledCurrentNow = this.cachedCurrent.get(key) ?? 0
      return
    }
    const { g, i } = nortonFor(this.d13State)
    this.d13Port.set(g, i)
    const res = this.circuit.solve()
    this.solves++
    this.lastVoltages = res.voltages
    this.ledCurrentNow = this.led.current
    this.cache.set(key, res.voltages)
    this.cachedCurrent.set(key, this.led.current)
  }

  private cachedCurrent = new Map<string, number>()
  private ledCurrentNow = 0

  /** Advance the simulation by `micros` of simulated time. */
  run(micros: number): SimStats {
    const cycles = Math.round((micros * CLOCK_HZ) / 1e6)
    const target = this.cpu.cycles + cycles
    const wall0 = performance.now()

    let lastState = this.d13State
    while (this.cpu.cycles < target) {
      avrInstruction(this.cpu)
      this.cpu.tick()
      // Re-solve only when the pin actually moved. This is the event-driven
      // core of the architecture — there is no per-timestep work.
      if (this.d13State !== lastState) {
        lastState = this.d13State
        this.evaluate()
      }
    }

    const wall = (performance.now() - wall0) / 1000
    return {
      simMicros: micros,
      speedRatio: wall > 0 ? micros / 1e6 / wall : Infinity,
      solves: this.solves,
      cacheHits: this.cacheHits,
      pinEdges: this.pinEdges,
    }
  }

  get led1(): LedReading {
    const current = this.ledCurrentNow
    return {
      id: 'LED1',
      current,
      // Perceptual curve: human brightness response is roughly a power law, so
      // a linear current map makes dim LEDs look completely off.
      brightness: Math.min(1, Math.pow(Math.max(current, 0) / 0.02, 0.45)),
      overCurrent: current > this.ledRating,
    }
  }

  get d13(): PinMode {
    return this.d13State
  }

  get anodeVoltage(): number {
    return this.lastVoltages[this.ledNetAnode] ?? 0
  }

  get stats(): SimStats {
    return {
      simMicros: (this.cpu.cycles / CLOCK_HZ) * 1e6,
      speedRatio: 0,
      solves: this.solves,
      cacheHits: this.cacheHits,
      pinEdges: this.pinEdges,
    }
  }
}
