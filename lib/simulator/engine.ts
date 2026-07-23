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
  AVRADC,
  adcConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  portBConfig,
  portCConfig,
  portDConfig,
  usart0Config,
} from 'avr8js'
import { compile, type CompileResult } from './model/compile'
import { DHT11, G_RELEASED, R_PULLDOWN, type BehaviouralDevice } from './behavioural'
import { MIN_RESISTANCE } from './devices'
import type { CircuitDoc, PlacedPart } from './model/document'
import type { SolveFault } from './types'

export const CLOCK_HZ = 16_000_000

/** AVR output impedance, and the pull-up value, from §2.6. */
const R_DRIVE = 25
const R_PULLUP = 20_000
const G_FLOAT = 1e-8
const VCC = 5
/** ATmega328P absolute maximum per I/O pin, from the datasheet. */
const PIN_MAX_CURRENT = 0.04

export type PinDrive = 'low' | 'high' | 'float' | 'pullup'

/**
 * Input thresholds, from SIMULATOR_ARCHITECTURE.md §2.6.
 *
 * VIL 0.3*Vcc, VIH 0.6*Vcc, WITH HYSTERESIS from day one. Without the deadband
 * a node sitting near mid-rail chatters across the threshold on every re-solve,
 * producing thousands of spurious pin-change interrupts a second and livelocking
 * the sketch — and it fails silently, as wrong interrupt counts rather than an
 * error.
 */
const VIL = 0.3 * 5
const VIH = 0.6 * 5

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
  /** Analog pin name → last value analogRead() returned (0..1023). */
  adc: Record<string, number>
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
  /** Honest statement of what the DC engine cannot do for this circuit (§2.3). */
  limitations: string[]
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

  /**
   * Time-weighted averaging of device currents.
   *
   * The solver reports the INSTANTANEOUS operating point, which is correct but
   * misleading for anything driven by PWM: analogWrite() makes a pin alternate
   * between two DC solutions, so a snapshot catches the LED either fully on or
   * fully off and never in between. An eye integrates, so the readout has to as
   * well. Each solution is weighted by how long it was actually held, which is
   * exact — §2.1's point that PWM composes from exact edges plus two operating
   * points, at no extra solve cost.
   *
   * `avg` holds one filtered value per metered part; `lastAvgCycle` is how far
   * the filter has been integrated. See advanceAverage() for why the window has
   * to close at snapshot time and not only on pin edges.
   */
  private avg = new Map<string, number>()
  private lastAvgCycle = 0
  private devices: BehaviouralDevice[] = []
  /** Behavioural drive state, part of the memoisation key. */
  private deviceDrives = new Map<string, 'low' | 'release'>()
  /** Last logic level presented to each MCU input pin, for hysteresis. */
  private inputLevels = new Map<string, boolean>()
  private doc: CircuitDoc
  /**
   * Display filter time constant, in CPU cycles — 25 ms of SIMULATED time.
   *
   * Long enough to swallow PWM: Timer1's 490 Hz gives a 2.04 ms period, and a
   * first-order filter reduces its ripple to about T/(4*tau) = 2% of full
   * scale. Short enough that anything a human could see is essentially
   * immediate: 99% settled in 115 ms, well inside the eye's flicker-fusion
   * window and only two 20 Hz snapshots.
   */
  private readonly avgTauCycles = CLOCK_HZ * 0.025
  private adc!: AVRADC
  /** Node voltages from the most recent solve, for the ADC to sample. */
  private voltages: Float64Array = new Float64Array(0)
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

    /**
     * The ADC reads REAL node voltages from the solved circuit.
     *
     * `onADCRead` is deliberately NOT overridden. avr8js's default reads
     * `channelValues` (in volts), applies the selected reference voltage, and
     * completes the conversion after `sampleCycles` via a clock event. Doing it
     * by hand meant re-implementing all three, and completing synchronously
     * would make every analogRead() instant rather than taking the ~104 us a
     * real ATmega328P takes. Feeding channelValues keeps that behaviour exact.
     */
    this.adc = new AVRADC(this.cpu, adcConfig)

    this.doc = doc
    this.compiled = compile(doc)
    this.rebuildWatchList()
    this.buildBehavioural()
    this.evaluate()
  }

  /**
   * Swap in an edited circuit. The firmware keeps running — a student rewiring
   * mid-run is a normal thing to do, and resetting the MCU would lose the
   * program state they are trying to observe.
   */
  setDocument(doc: CircuitDoc): void {
    this.doc = doc
    this.compiled = compile(doc)
    this.rebuildWatchList()
    this.buildBehavioural()
    this.topologyVersion++
    this.cache.clear()
    this.dirtyFlag[0] = 1
    this.evaluate()
  }

  /** Pins that are electrically connected. Unconnected pins are not in the key. */
  private wiredPins = new Set<string>()

  /** Wired pins grouped by AVR port, so a port write only checks its own pins. */
  private watched: Record<'B' | 'C' | 'D', Array<[string, number]>> = { B: [], C: [], D: [] }

  /**
   * Instantiate tier-2 parts. Each gets a live view of its own net voltage and
   * its own props, so moving the temperature slider changes what the next
   * reading reports without rebuilding anything.
   */
  private buildBehavioural(): void {
    this.devices = []
    this.deviceDrives.clear()
    for (const b of this.compiled.behavioural) {
      if (b.protocol !== 'dht11') continue
      this.devices.push(
        new DHT11(b.partId, {
          cpu: this.cpu,
          voltage: () => (b.net < this.voltages.length ? this.voltages[b.net] : 0),
          // The engine owns both the port and the cache key, so a device's
          // drive can never diverge from what the cache thinks it is.
          drive: (level) => {
            if (this.deviceDrives.get(b.partId) === level) return
            this.deviceDrives.set(b.partId, level)
            b.port.set(level === 'low' ? 1 / R_PULLDOWN : G_RELEASED, 0)
            this.dirtyFlag[0] = 1
          },
          props: () => this.partProps(b.partId),
        }),
      )
    }
  }

  /**
   * Push solved node voltages back into the emulator as digital input levels.
   *
   * This is the OTHER half of the PinBridge and it is easy to forget: avr8js
   * takes external input through setPin(), so without this the circuit drives
   * nothing back and digitalRead() never observes it. Every input-side
   * experiment — a pushbutton, a sensor sharing a wire — depends on it.
   */
  private driveInputs(): void {
    for (const name of this.wiredPins) {
      const entry = PIN_MAP[name]
      if (!entry) continue
      const drive = this.drives.get(name)
      // Only pins the sketch is not actively driving take an external level.
      if (drive !== 'float' && drive !== 'pullup') continue

      const netId = this.compiled.pinNets.get(name)
      if (netId === undefined) continue
      const v = netId < this.voltages.length ? this.voltages[netId] : 0

      const prev = this.inputLevels.get(name) ?? false
      const next = prev ? v > VIL : v > VIH
      if (next === prev && this.inputLevels.has(name)) continue
      this.inputLevels.set(name, next)

      const [port, bit] = entry
      const p = port === 'B' ? this.portB : port === 'C' ? this.portC : this.portD
      p.setPin(bit, next)
    }
  }

  private partProps(partId: string): Record<string, number | string> {
    const part: PlacedPart | undefined = this.doc.parts.find((p) => p.id === partId)
    return part ? part.props : {}
  }

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
    // Behavioural devices share the wire, so their drive is part of the
    // operating point. Omitting it made every DHT11 transition a cache HIT on
    // the previous solution — the sensor pulled its line low and the solver
    // went on reporting it high.
    for (const [id, level] of this.deviceDrives) k += '|' + id + level[0]
    return k
  }

  /**
   * Integrate the display filter forward to the current cycle.
   *
   * Called from TWO places, and both are load-bearing:
   *
   *   - evaluate(), BEFORE `latest` is replaced, so the outgoing operating point
   *     is weighted by exactly how long it was held;
   *   - snapshot(), so the window closes at the moment the snapshot is taken.
   *
   * That second call is the whole fix. The averaging used to be closed only on
   * a pin edge, which meant a snapshot published the average of the interval
   * BEFORE the last edge and nothing moved between edges at all. Blink's
   * symmetric 1 s hold turned that into a full 180° inversion — the LED was lit
   * exactly when D13 was low — and a circuit that stopped being driven froze at
   * its last value forever instead of decaying. The invariant now is that a
   * snapshot reflects state up to the moment it is taken.
   *
   * The signal is piecewise constant between calls, so exp(-dt/tau) integrates
   * the first-order filter EXACTLY at one exp() per call, whatever dt is. A
   * long hold (Blink's 16e6 cycles) collapses to the instantaneous value; a
   * short one (a PWM slice) barely moves it.
   */
  private advanceAverage(): void {
    const now = this.cpu.cycles
    const dt = now - this.lastAvgCycle
    this.lastAvgCycle = now
    const decay = dt > 0 ? Math.exp(-dt / this.avgTauCycles) : 1
    const cur = this.latest.currents
    // A part that no longer exists — deleted, or unwired by an edit — must not
    // keep reporting the current it was carrying when it left.
    for (const partId of this.avg.keys()) if (!(partId in cur)) this.avg.delete(partId)
    for (const partId of Object.keys(cur)) {
      const target = cur[partId]
      const prev = this.avg.get(partId)
      // A part seen for the first time starts AT its value rather than at zero,
      // so a freshly loaded circuit reads correctly before any time has passed.
      this.avg.set(partId, prev === undefined ? target : target + (prev - target) * decay)
    }
  }

  private evaluate(): void {
    this.advanceAverage()
    const key = this.stateKey()
    const hit = this.cache.get(key)
    if (hit) {
      this.cacheHits++
      this.latest = hit
      this.voltages = hit.voltages
      this.dirtyFlag[0] = 0
      this.driveInputs()
      for (let i = 0; i < this.devices.length; i++) this.devices[i].poll()
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

      this.voltages = res.voltages
      // Publish solved node voltages to the ADC. Unconnected analog pins read
      // 0 V: a real floating input picks up noise, but a deterministic 0 is the
      // honest choice for a teaching tool.
      for (let ch = 0; ch < 6; ch++) {
        const netId = this.compiled.analogNets.get('A' + ch)
        this.adc.channelValues[ch] =
          netId !== undefined && netId < res.voltages.length ? res.voltages[netId] : 0
      }

      const brightness: Record<string, number> = {}
      const currents: Record<string, number> = {}
      for (const [partId, dev] of this.compiled.meters) currents[partId] = dev.current
      for (const [partId, diode] of this.compiled.leds) {
        const i = Math.max(diode.current, 0)
        // Perceptual curve — a linear map makes a dim LED look completely off.
        brightness[partId] = Math.min(1, Math.pow(i / 0.02, 0.45))
      }
      this.latest = {
        brightness,
        currents,
        faults: res.faults,
        solveError,
        voltages: res.voltages,
      }
    } else {
      this.latest = EMPTY_SOLUTION
    }

    this.cache.set(key, this.latest)
    this.dirtyFlag[0] = 0
    this.driveInputs()
    for (let i = 0; i < this.devices.length; i++) this.devices[i].poll()
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

  /** Brightness from the time-averaged current, so PWM dimming is visible. */
  private averagedBrightness(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const partId of Object.keys(this.latest.brightness)) {
      const i = Math.max(this.avg.get(partId) ?? this.latest.currents[partId] ?? 0, 0)
      out[partId] = Math.min(1, Math.pow(i / 0.02, 0.45))
    }
    return out
  }

  private averagedCurrents(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const partId of Object.keys(this.latest.currents)) {
      out[partId] = this.avg.get(partId) ?? this.latest.currents[partId]
    }
    return out
  }

  /**
   * Everything wrong with the circuit right now.
   *
   * The solver's own faults, plus the ones it structurally cannot see: a pin
   * wired straight to GND has no net of its own, so there is no node voltage or
   * branch current to check. See ShortedPin in model/compile.ts.
   */
  private faults(): SolveFault[] {
    const shorts = this.compiled.shortedPins
    if (shorts.length === 0) return this.latest.faults
    const out: SolveFault[] = []
    for (const s of shorts) {
      if (s.role === 'supply') {
        out.push({
          kind: 'short_circuit',
          severity: 'destructive',
          deviceId: s.deviceId,
          // The engine models a plain wire as MIN_RESISTANCE, the same figure
          // the 0 Ω resistor case reports, so the two agree on what a short is.
          value: s.volts / MIN_RESISTANCE,
          message:
            `The ${s.volts} V supply pin is wired directly to GND — that is a short circuit. ` +
            `On real hardware this destroys the board or the supply.`,
        })
      } else if (this.drives.get(s.pinId) === 'high') {
        // Only while it is DRIVING. The same wire on an input pin is merely a
        // pin tied low, which is harmless, and claiming otherwise would be the
        // same class of dishonesty as missing the short in the first place.
        const amps = s.volts / R_DRIVE
        out.push({
          kind: 'short_circuit',
          severity: 'destructive',
          deviceId: s.deviceId,
          value: amps,
          message:
            `${s.pinId} is driving ${s.volts} V straight into GND — ` +
            `${(amps * 1000).toFixed(0)} mA through a pin rated for ${(PIN_MAX_CURRENT * 1000).toFixed(0)} mA. ` +
            `On real hardware this pin is destroyed.`,
        })
      }
    }
    return out.concat(this.latest.faults)
  }

  snapshot(): EngineSnapshot {
    // Close the averaging window HERE, so the reading reflects the recent past
    // up to this instant rather than up to the last pin edge.
    this.advanceAverage()
    const pins: Record<string, PinDrive> = {}
    for (const [name, d] of this.drives) pins[name] = d
    return {
      ledBrightness: this.averagedBrightness(),
      currents: this.averagedCurrents(),
      adc: adcCounts(this.adc),
      faults: this.faults(),
      problems: this.compiled.problems,
      serial: this.serial.slice(-1500),
      pins,
      simSeconds: this.cpu.cycles / CLOCK_HZ,
      solves: this.solves,
      cacheHits: this.cacheHits,
      pinEdges: this.pinEdges,
      unknowns: this.compiled.unknowns,
      solveError: this.latest.solveError,
      limitations: this.compiled.limitations,
    }
  }
}

interface CachedSolution {
  brightness: Record<string, number>
  currents: Record<string, number>
  faults: SolveFault[]
  solveError: string | null
  /**
   * Node voltages for this operating point.
   *
   * These MUST be cached alongside the currents. Behavioural devices read their
   * line voltage every poll, and a cache hit that restored the currents but left
   * `voltages` holding some earlier state fed the DHT11 a stale line — it never
   * saw the host release the wire, so it never answered.
   */
  voltages: Float64Array
}

const EMPTY_SOLUTION: CachedSolution = {
  brightness: {},
  currents: {},
  faults: [],
  solveError: null,
  voltages: new Float64Array(0),
}

/** What analogRead() would return right now, for display. */
function adcCounts(adc: AVRADC): Record<string, number> {
  const out: Record<string, number> = {}
  for (let ch = 0; ch < 6; ch++) {
    const v = Number(adc.channelValues[ch] ?? 0)
    out['A' + ch] = Math.max(0, Math.min(1023, Math.round((v / adc.avcc) * 1023)))
  }
  return out
}
