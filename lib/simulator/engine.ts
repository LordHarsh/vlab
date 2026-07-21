/**
 * The simulation engine: real compiled firmware driving a student-built circuit.
 *
 * This is where the two halves meet. `avr8js` owns the clock and executes the
 * actual .hex; `compile()` turns the student's document into a solvable circuit;
 * and the PinBridge (SIMULATOR_ARCHITECTURE.md §2.6) couples them — MCU pin
 * writes become Norton stamps, and the analog solution is memoised on the
 * pin-state vector so a blinking pin only ever costs two DC solves (§2.4).
 *
 * Superseded the demo-specific ArduinoSimulation, which hardcoded one circuit.
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
import { compile, type CompileResult } from './model/compile'
import type { CircuitDoc } from './model/document'
import type { SolveFault } from './types'

export const CLOCK_HZ = 16_000_000

/** AVR output impedance, and the pull-up value, from §2.6. */
const R_DRIVE = 25
const R_PULLUP = 20_000
const G_FLOAT = 1e-8
const VCC = 5

export type PinDrive = 'low' | 'high' | 'float' | 'pullup'

function nortonFor(drive: PinDrive): { g: number; i: number } {
  switch (drive) {
    case 'low':
      return { g: 1 / R_DRIVE, i: 0 }
    case 'high':
      return { g: 1 / R_DRIVE, i: VCC / R_DRIVE }
    case 'pullup':
      return { g: 1 / R_PULLUP, i: VCC / R_PULLUP }
    case 'float':
      return { g: G_FLOAT, i: 0 }
  }
}

/** Intel HEX → program words. */
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

/** Arduino Uno silkscreen name → (port, bit). */
const PIN_MAP: Record<string, ['B' | 'C' | 'D', number]> = {
  D0: ['D', 0], D1: ['D', 1], D2: ['D', 2], D3: ['D', 3],
  D4: ['D', 4], D5: ['D', 5], D6: ['D', 6], D7: ['D', 7],
  D8: ['B', 0], D9: ['B', 1], D10: ['B', 2], D11: ['B', 3],
  D12: ['B', 4], D13: ['B', 5],
  A0: ['C', 0], A1: ['C', 1], A2: ['C', 2],
  A3: ['C', 3], A4: ['C', 4], A5: ['C', 5],
}

export interface EngineSnapshot {
  /** partId → 0..1 for rendering. */
  ledBrightness: Record<string, number>
  /** partId → amps. */
  currents: Record<string, number>
  faults: SolveFault[]
  problems: string[]
  serial: string
  /** Arduino pin name → drive state. */
  pins: Record<string, PinDrive>
  simSeconds: number
  solves: number
  cacheHits: number
  pinEdges: number
  unknowns: number
  solveError: string | null
}

export class SimulationEngine {
  readonly cpu: CPU
  private portB: AVRIOPort
  private portC: AVRIOPort
  private portD: AVRIOPort

  private compiled: CompileResult
  private drives = new Map<string, PinDrive>()
  /** Uint8 so the hot run() loop reads an array element, not a property. */
  private dirtyFlag = new Uint8Array([1])

  /** pin-state key → { brightness, currents, faults }. §2.4 */
  private cache = new Map<string, CachedSolution>()
  private solves = 0
  private cacheHits = 0
  private pinEdges = 0
  private topologyVersion = 0

  private latest: CachedSolution = EMPTY_SOLUTION
  serial = ''

  constructor(program: Uint16Array, doc: CircuitDoc) {
    this.cpu = new CPU(program)
    new AVRTimer(this.cpu, timer0Config)
    new AVRTimer(this.cpu, timer1Config)
    new AVRTimer(this.cpu, timer2Config)
    this.portB = new AVRIOPort(this.cpu, portBConfig)
    this.portC = new AVRIOPort(this.cpu, portCConfig)
    this.portD = new AVRIOPort(this.cpu, portDConfig)
    const usart = new AVRUSART(this.cpu, usart0Config, CLOCK_HZ)
    usart.onByteTransmit = (b) => {
      this.serial += String.fromCharCode(b)
      if (this.serial.length > 4000) this.serial = this.serial.slice(-4000)
    }

    for (const name of Object.keys(PIN_MAP)) this.drives.set(name, 'float')

    /**
     * Only WIRED pins are examined, and only on the port that changed.
     *
     * This listener fires on every port write, and Serial TX toggles D1 at 9600
     * baud, so it is genuinely hot. Scanning all 20 pins per event cost ~4x
     * throughput on the DHT11 sketch (0.63x realtime against 2.7x measured in
     * P0-1). A typical circuit wires one to three pins, so the watch list is
     * usually a single entry.
     */
    const makeListener = (port: 'B' | 'C' | 'D', p: AVRIOPort) => () => {
      const watch = this.watched[port]
      let changed = false
      for (let i = 0; i < watch.length; i++) {
        const [name, bit] = watch[i]
        const state = p.pinState(bit)
        // avr8js PinState: 0 Low, 1 High, 2 Input, 3 InputPullUp
        const drive: PinDrive =
          state === 1 ? 'high' : state === 0 ? 'low' : state === 3 ? 'pullup' : 'float'
        if (this.drives.get(name) !== drive) {
          this.drives.set(name, drive)
          changed = true
        }
      }
      if (changed) {
        this.pinEdges++
        this.dirtyFlag[0] = 1
      }
    }
    this.portB.addListener(makeListener('B', this.portB))
    this.portC.addListener(makeListener('C', this.portC))
    this.portD.addListener(makeListener('D', this.portD))

    this.compiled = compile(doc)
    this.rebuildWatchList()
    this.evaluate()
  }

  /**
   * Swap in an edited circuit. The firmware keeps running — a student rewiring
   * mid-run is a normal thing to do, and resetting the MCU would lose the
   * program state they are trying to observe.
   */
  setDocument(doc: CircuitDoc): void {
    this.compiled = compile(doc)
    this.rebuildWatchList()
    this.topologyVersion++
    this.cache.clear()
    this.dirtyFlag[0] = 1
    this.evaluate()
  }

  /** Pins that are electrically connected. Unconnected pins are not in the key. */
  private wiredPins = new Set<string>()

  /** Wired pins grouped by AVR port, so a port write only checks its own pins. */
  private watched: Record<'B' | 'C' | 'D', Array<[string, number]>> = { B: [], C: [], D: [] }

  private rebuildWatchList(): void {
    this.wiredPins = new Set(this.compiled.mcuPorts.keys())
    this.watched = { B: [], C: [], D: [] }
    for (const name of this.wiredPins) {
      const entry = PIN_MAP[name]
      if (entry) this.watched[entry[0]].push([name, entry[1]])
    }
  }

  private stateKey(): string {
    let k = `${this.topologyVersion}|`
    for (const name of this.wiredPins) k += name + this.drives.get(name)![0]
    return k
  }

  private evaluate(): void {
    const key = this.stateKey()
    const hit = this.cache.get(key)
    if (hit) {
      this.cacheHits++
      this.latest = hit
      this.dirtyFlag[0] = 0
      return
    }

    for (const [name, port] of this.compiled.mcuPorts) {
      const { g, i } = nortonFor(this.drives.get(name) ?? 'float')
      port.set(g, i)
    }

    let solveError: string | null = null
    if (this.compiled.circuit.size > 0) {
      const res = this.compiled.circuit.solve()
      if (!res.ok) solveError = res.error ?? 'circuit did not solve'
      this.solves++

      const brightness: Record<string, number> = {}
      const currents: Record<string, number> = {}
      for (const [partId, diode] of this.compiled.leds) {
        const i = Math.max(diode.current, 0)
        currents[partId] = diode.current
        // Perceptual curve — a linear map makes a dim LED look completely off.
        brightness[partId] = Math.min(1, Math.pow(i / 0.02, 0.45))
      }
      this.latest = { brightness, currents, faults: res.faults, solveError }
    } else {
      this.latest = EMPTY_SOLUTION
    }

    this.cache.set(key, this.latest)
    this.dirtyFlag[0] = 0
  }

  /**
   * Advance simulated time by `micros`.
   *
   * The loop body runs tens of millions of times per second, so `cpu` is hoisted
   * into a local and the dirty flag is read from a one-element array rather than
   * an instance property — going through `this` on every instruction measured
   * about 3.5x slower than the equivalent loop in spike P0-1.
   */
  run(micros: number): void {
    const cpu = this.cpu
    const flag = this.dirtyFlag
    const target = cpu.cycles + Math.round((micros * CLOCK_HZ) / 1e6)
    while (cpu.cycles < target) {
      avrInstruction(cpu)
      cpu.tick()
      // Event-driven: the analog side is only touched when a pin actually moves.
      if (flag[0] === 1) this.evaluate()
    }
  }

  snapshot(): EngineSnapshot {
    const pins: Record<string, PinDrive> = {}
    for (const [name, d] of this.drives) pins[name] = d
    return {
      ledBrightness: this.latest.brightness,
      currents: this.latest.currents,
      faults: this.latest.faults,
      problems: this.compiled.problems,
      serial: this.serial.slice(-1500),
      pins,
      simSeconds: this.cpu.cycles / CLOCK_HZ,
      solves: this.solves,
      cacheHits: this.cacheHits,
      pinEdges: this.pinEdges,
      unknowns: this.compiled.unknowns,
      solveError: this.latest.solveError,
    }
  }
}

interface CachedSolution {
  brightness: Record<string, number>
  currents: Record<string, number>
  faults: SolveFault[]
  solveError: string | null
}

const EMPTY_SOLUTION: CachedSolution = {
  brightness: {},
  currents: {},
  faults: [],
  solveError: null,
}
