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

import { CPU, avrInstruction, AVRTimer, AVRIOPort, AVRUSART, AVRADC } from 'avr8js'
import { analogDeviceStates } from './analog-state'
import { SerialTextDecoder } from './serial-text'
import { chipForDoc, type AvrChip } from './avr/chip'
import { compile, type CompileResult } from './model/compile'
import {
  BuzzerMonitor,
  DHT11,
  DS18B20Sensor,
  FlowSensor,
  G_RELEASED,
  HCSR04,
  MCP3008Device,
  PIRSensor,
  PulseSensor,
  R_PULLDOWN,
  RelayMonitor,
  StepperMonitor,
  type BehaviouralContext,
  type BehaviouralDevice,
  type DeviceState,
  type DriveLevel,
} from './behavioural'
import {
  BUZZER_5V,
  MIN_RESISTANCE,
  RELAY_MODULE_4CH,
  STEPPER_28BYJ48,
  type NortonPort,
} from './devices'
import type { CircuitDoc, PlacedPart } from './model/document'
import type { NetId, SolveFault, SolveResult } from './types'

export const CLOCK_HZ = 16_000_000

// ─── Transient stepping (TRANSIENT_DESIGN.md §4) ─────────────────────────────

/**
 * Backward-Euler steps per time constant.
 *
 * BE's error on an RC charge is exactly computable, which is what lets this be
 * a derived number rather than a taste. The discrete solution is
 * v(k) = V·(1 − r^k) with r = 1/(1 + h/τ), so at t = τ (k = τ/h = n steps):
 *
 *   n =  10   →  v/V = 1 − 1.1^−10   = 0.6145  vs  1 − e^−1 = 0.6321   (−2.8 %)
 *   n =  50   →  v/V = 1 − 1.02^−50  = 0.6285  vs                      (−0.58 %)
 *   n = 100   →  v/V = 1 − 1.01^−100 = 0.6303  vs                      (−0.29 %)
 *
 * The error is first-order in h, so halving the step halves it and doubles the
 * cost. 50 buys sub-1 % timing — well under the tolerance of the electrolytic
 * capacitor a student would actually solder — for half the work of 100.
 */
const STEPS_PER_TAU = 50

/**
 * Floor on the timestep, in seconds of SIMULATED time. This is a COST ceiling
 * expressed as a step: 20 µs is at most 50 000 analog solves per simulated
 * second, measured at 5.9 µs (linear RC) to 8.8 µs (RC plus an LED) per step on
 * this machine, i.e. 0.30–0.44 s of wall clock per simulated second on top of
 * whatever the AVR itself costs.
 *
 * A circuit whose real τ is below 20 µs/50 = 400 ns therefore gets stepped with
 * h > τ. That is SAFE rather than merely tolerable, and it is the reason the
 * design chose backward Euler: BE is L-stable, so h ≫ τ does not ring or
 * diverge, it collapses to the DC steady state within a step or two — which is
 * the physically right answer for a time constant far finer than anything the
 * student can observe. A 1 µF cap straight across a driving pin (25 Ω, τ = 25 µs)
 * settles in a few steps instead of a few hundred; it still settles to the same
 * place. What is lost is resolution of the first microsecond, not correctness.
 */
const MIN_STEP_SECONDS = 20e-6

/**
 * Ceiling on the timestep, in seconds. A 100 kΩ × 470 µF pair has τ = 47 s, and
 * τ/50 would be nearly a second — one step per twenty snapshots, so the student
 * would watch a staircase rather than a curve. 5 ms is 200 steps per simulated
 * second (free) and four steps per 20 Hz snapshot interval.
 */
const MAX_STEP_SECONDS = 5e-3

/**
 * The step used when no simulated time has actually passed since the last one.
 *
 * This is not a fudge, it is a limit. Two analog updates in the same CPU cycle
 * (the first evaluate after construction, or a pin edge landing on the cycle a
 * scheduled step already took) must still re-solve, because the drive changed —
 * but a capacitor's charge cannot change in zero time. Geq = C/h with h → 0
 * clamps to MAX_CONDUCTANCE and pins the branch at v_prev, which IS the
 * zero-length-step answer. The fictitious 1 ns is bounded by one per evaluate
 * and can never accumulate: any real gap is at least one 62.5 ns cycle, which
 * is 62.5× larger, so the floor stops binding the moment time moves.
 */
const HOLD_STEP_SECONDS = 1e-9

/**
 * How often the timestep is re-derived, in seconds of simulated time.
 *
 * τ is not a constant of the circuit — it is R·C, and R is whatever the network
 * presents across the capacitor RIGHT NOW. An MCU pin swings between 25 Ω
 * driving and 100 MΩ floating, so the same 1 µF cap has a τ of 25 µs or 100 s
 * depending on one bit in a port register. Re-measuring every 200 µs costs at
 * most 5000 driving-point probes per simulated second at 1.36 µs each (~7 ms of
 * wall clock per simulated second, under 1 %), and bounds how long a stale step
 * size can persist to a fifth of a millisecond — which, again, only ever costs
 * resolution, because BE cannot be destabilised by too large a step.
 */
const RETUNE_SECONDS = 200e-6

/**
 * Hard cap on the memoisation cache, in entries.
 *
 * The key space used to be finite and small: a handful of pins, each in one of
 * four drive states. An ANALOG behavioural part breaks that — a pulse sensor
 * puts a different voltage on its wire every couple of milliseconds, so the key
 * space is now effectively continuous and an unbounded Map would grow for as
 * long as the tab is open. 4096 entries is far more than any digital circuit
 * ever produces (a 10-pin circuit has at most a few hundred reachable states),
 * so a digital experiment never reaches this and behaves exactly as before; an
 * analog one drops its history wholesale rather than leaking, and pays one
 * re-solve for each state it meets again. Clearing is always SAFE — a miss
 * costs a solve, never a wrong answer.
 */
const MAX_CACHE_ENTRIES = 4096

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

/**
 * Intel HEX → program words.
 *
 * RECORD TYPES 02 AND 04 ARE THE WHOLE REASON THIS IS NOT THREE LINES. The
 * `addr` field of a data record is sixteen bits, so a file that reaches past
 * 64 KB has to carry a segment or a linear-address record and let every data
 * record after it be relative to that base. avr-gcc emits type 04 for anything
 * over 64 KB, which is to say for most of an ATmega2560's 256 KB flash.
 *
 * Ignoring them — which this used to do, silently, along with every other
 * non-data record — does not produce a load error. It produces a program whose
 * upper banks are all overlaid on top of the first 64 KB, so the reset vector
 * is whatever the last bank happened to write there. That is §2.3's forbidden
 * failure: a plausible-looking machine executing the wrong bytes.
 *
 * `flashBytes` must match the chip. avr8js derives `pc22Bits` from the program
 * memory's byte length, and pc22Bits decides whether a return address is two
 * bytes or three — see AvrChip.flashBytes.
 */
export function parseIntelHex(text: string, flashBytes = 0x8000): Uint16Array {
  const bytes = new Uint8Array(flashBytes)
  /** Set by type 02/04 records; added to every subsequent data record's addr. */
  let base = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith(':')) continue
    const len = parseInt(line.substring(1, 3), 16)
    const addr = parseInt(line.substring(3, 7), 16)
    const type = parseInt(line.substring(7, 9), 16)
    const data = (i: number): number => parseInt(line.substring(9 + i * 2, 11 + i * 2), 16)

    if (type === 1) break // end of file
    if (type === 2) {
      // Extended SEGMENT address: the 16-bit value is shifted left by 4.
      base = ((data(0) << 8) | data(1)) << 4
      continue
    }
    if (type === 4) {
      // Extended LINEAR address: the 16-bit value is the upper half of a
      // 32-bit address, i.e. shifted left by 16.
      base = ((data(0) << 8) | data(1)) * 0x10000
      continue
    }
    if (type !== 0) continue // 03/05 are start-address records; nothing to load.
    const at = base + addr
    // A record past the end of flash is a hex built for a bigger part. Dropping
    // the bytes quietly would be the same silent-wrong-program failure as
    // ignoring the type 04 above, so it is refused out loud.
    if (at + len > flashBytes) {
      throw new Error(
        `firmware writes to 0x${(at + len - 1).toString(16)}, past the end of this ` +
          `board's ${flashBytes / 1024} KB of flash — it was built for a different chip`,
      )
    }
    for (let i = 0; i < len; i++) bytes[at + i] = data(i)
  }
  const words = new Uint16Array(flashBytes / 2)
  for (let i = 0; i < words.length; i++) words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
  return words
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
  /**
   * Timestep the transient loop is currently using, in seconds, or 0 when the
   * circuit is purely resistive and is being solved as a DC operating point.
   *
   * Optional because both worker hooks build an EMPTY snapshot literal and the
   * editor declares its own structural SharedSnapshot; a required field would
   * break three files owned by other work for a diagnostic.
   */
  transientStep?: number
  /** Backward-Euler steps taken so far. 0 on a purely resistive circuit. */
  transientSteps?: number
  /**
   * partId → whatever that part is doing that a node voltage cannot express:
   * the pitch a buzzer is sounding, the rpm and direction of a motor, whether a
   * PIR is still warming up. REPORTED state, derived from the solved circuit and
   * from simulated time — never a substitute for solving.
   */
  deviceStates: Record<string, DeviceState>
}

export class SimulationEngine {
  readonly cpu: CPU
  /**
   * Which AVR this is, and therefore every register address, interrupt vector
   * and pin mapping below. See lib/simulator/avr/chip.ts.
   */
  readonly chip: AvrChip
  /** Port letter → the live AVRIOPort. Three entries on an Uno, eleven on a Mega. */
  private ports = new Map<string, AVRIOPort>()

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
   * True while the compiled circuit contains a capacitor or an inductor.
   *
   * This is the switch between the two run loops, and it is also the switch that
   * DISABLES THE MEMOISATION CACHE. That is not an optimisation being given up
   * reluctantly, it is a correctness requirement: stateKey() describes the pin
   * drive vector and the behavioural drives, and a capacitor's voltage is state
   * that appears in NEITHER. A blinking pin returns to a key it has visited
   * before on every cycle, so a cache hit would restore the node voltages from
   * the first time that pin was high and freeze the charge curve flat — the
   * engine would report an RC circuit as a resistive divider, with ok:true, for
   * as long as the student watched it.
   *
   * Keying the cache correctly is not available either: the key would have to
   * carry every reactive element's stored state, which is continuous, so every
   * lookup would miss AND the map would grow without bound. The honest choice is
   * to not have a cache in this mode. It costs nothing in practice — the
   * transient loop re-solves on a schedule regardless, so there was never a
   * repeated solve for the cache to elide.
   */
  private transient = false
  /** Timestep in seconds, derived in tuneStep(). */
  private stepSeconds = 0
  /** The same step in CPU cycles, which is the unit the run loop compares in. */
  private stepCycles = 0
  /** cpu.cycles at the last analog update. The transient's notion of "now". */
  private lastStepCycles = 0
  /** cpu.cycles at which the next scheduled step falls due. */
  private nextStepCycles = 0
  /** cpu.cycles at which the timestep is next re-derived. */
  private retuneCycles = 0
  private transientSteps = 0

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
  /** Poll order, rebuilt from the compiler's order on every edit. */
  private devices: BehaviouralDevice[] = []
  /**
   * The live device per part id, with the wiring it was built against.
   *
   * Separate from `devices` because this is the map that decides SURVIVAL
   * across an edit; `devices` is just the iteration order. See buildBehavioural.
   */
  private live = new Map<string, { device: BehaviouralDevice; signature: string }>()
  /**
   * What each behavioural part is attached to in the CURRENT compile.
   *
   * Every device context reads its nets and ports THROUGH this map rather than
   * closing over a compile result. That indirection is the whole mechanism that
   * lets a surviving device be re-pointed at a fresh compile without being
   * rebuilt: compile() allocates a new Circuit, and therefore brand-new
   * NortonPorts, every single time, so a device still holding the old ones would
   * be stamping into a matrix nobody solves.
   */
  private bindings = new Map<string, CompileResult['behavioural'][number]>()
  /** Behavioural drive state, keyed "partId:signal". Part of the memo key. */
  private deviceDrives = new Map<string, DriveLevel>()
  /** The `volts` that went with each of those, so a re-point can re-stamp it. */
  private deviceVolts = new Map<string, number>()
  /** Latest reported state per behavioural part, for the snapshot. */
  private deviceStates: Record<string, DeviceState> = {}
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
  /**
   * UTF-8 decoder for the USART stream, one per engine.
   *
   * Not reset when `serial` is truncated below: that drops old TEXT the student
   * has already scrolled past, while the decoder's pending bytes are the START
   * of the next character. Resetting there would corrupt the very character the
   * truncation happened to land inside. The worker resets an MCU by rebuilding
   * the engine, which is where a genuinely discontinuous stream gets a fresh
   * decoder.
   */
  private readonly serialText = new SerialTextDecoder()
  serial = ''

  /**
   * @param chip Which AVR to build. Defaults to whatever board `doc` contains,
   *   which is what the worker wants; passed explicitly only by tests that
   *   construct an engine for a chip without drawing a board first.
   */
  constructor(program: Uint16Array, doc: CircuitDoc, chip: AvrChip = chipForDoc(doc)) {
    this.chip = chip
    this.cpu = new CPU(program, chip.cpuSramBytes)
    for (const timer of chip.timers) new AVRTimer(this.cpu, timer)
    for (const [letter, config] of Object.entries(chip.ports)) {
      this.ports.set(letter, new AVRIOPort(this.cpu, config))
    }
    /**
     * USART0 only, on every chip.
     *
     * A Mega has four, and `Serial1`…`Serial3` would therefore transmit into
     * nothing. That is deliberate rather than an oversight: those three are
     * separate physical ports on pins 14–19, and folding them into the editor's
     * single Serial pane would present bytes that never shared a wire as one
     * stream. Their register addresses are recorded in avr/atmega2560.ts so
     * that giving them their own panes later is wiring, not research.
     */
    const usart = new AVRUSART(this.cpu, chip.usart0, CLOCK_HZ)
    usart.onByteTransmit = (b) => {
      /**
       * ONE BYTE IS NOT ONE CHARACTER. This used to be
       * `String.fromCharCode(b)`, a Latin-1 decode, so a sketch printing an em
       * dash — three bytes of UTF-8, `e2 80 94` — arrived as three characters
       * of mojibake. The decoder is streaming and lives for the engine's
       * lifetime because the USART delivers exactly one byte per call, so
       * EVERY multi-byte character is split across writes. See serial-text.ts.
       */
      this.serial += this.serialText.byte(b)
      if (this.serial.length > 4000) this.serial = this.serial.slice(-4000)
    }

    for (const name of Object.keys(chip.pinMap)) this.drives.set(name, 'float')

    /**
     * Only WIRED pins are examined, and only on the port that changed.
     *
     * This listener fires on every port write, and Serial TX toggles D1 at 9600
     * baud, so it is genuinely hot. Scanning all 20 pins per event cost ~4x
     * throughput on the DHT11 sketch (0.63x realtime against 2.7x measured in
     * P0-1). A typical circuit wires one to three pins, so the watch list is
     * usually a single entry.
     */
    const makeListener = (port: string, p: AVRIOPort) => () => {
      const watch = this.watched.get(port) ?? EMPTY_WATCH
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
    for (const [letter, p] of this.ports) p.addListener(makeListener(letter, p))

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
    this.adc = new AVRADC(this.cpu, chip.adc)

    this.doc = doc
    this.compiled = compile(doc)
    this.rebuildWatchList()
    this.buildBehavioural()
    this.startTransient(null)
    this.evaluate()
  }

  /**
   * Swap in an edited circuit. The firmware keeps running — a student rewiring
   * mid-run is a normal thing to do, and resetting the MCU would lose the
   * program state they are trying to observe.
   *
   * The same argument applies to a half-charged capacitor, which is why the
   * reactive state is lifted out BEFORE the recompile and put back after. See
   * captureReactive().
   */
  setDocument(doc: CircuitDoc): void {
    const carried = this.captureReactive()
    this.doc = doc
    this.compiled = compile(doc)
    this.rebuildWatchList()
    this.buildBehavioural()
    this.topologyVersion++
    this.cache.clear()
    this.startTransient(carried)
    this.dirtyFlag[0] = 1
    this.evaluate()
  }

  /**
   * Stored charge and inductor current, keyed by part id and stamped with the
   * nets the element was bridging when it acquired them.
   *
   * The terminals are carried because they are what makes putting the state back
   * legitimate. compile() re-derives net ids from the document every time, so an
   * element still on nets [3, 0] after the edit is still across the same two
   * points of the same circuit and its charge is still the same charge. An
   * element the student re-wired is electrically somewhere else, and insisting
   * its old voltage is still valid would be inventing a number — those start
   * again from their initial condition, which is what physically happens when
   * you pull a lead out and put it somewhere else.
   */
  private captureReactive(): Map<string, { terminals: readonly [NetId, NetId]; state: number }> {
    const out = new Map<string, { terminals: readonly [NetId, NetId]; state: number }>()
    for (const [partId, device] of this.compiled.reactive) {
      out.set(partId, { terminals: device.terminals, state: device.state })
    }
    return out
  }

  /**
   * Put the analog side into (or out of) transient mode for the CURRENT compile.
   *
   * beginTransient() resets every reactive element to its t=0 condition, so the
   * carried state is restored immediately afterwards for the elements that
   * earned it. `lastStepCycles` is reset to the CPU's cycle counter rather than
   * to zero: the MCU keeps running across an edit, so the transient's clock has
   * to rejoin it where it is, not restart.
   */
  private startTransient(
    carried: Map<string, { terminals: readonly [NetId, NetId]; state: number }> | null,
  ): void {
    this.transient = this.compiled.circuit.hasReactive
    if (!this.transient) {
      this.stepSeconds = 0
      this.stepCycles = 0
      return
    }
    this.compiled.circuit.beginTransient()
    if (carried) {
      for (const [partId, device] of this.compiled.reactive) {
        const was = carried.get(partId)
        if (!was) continue
        if (was.terminals[0] !== device.terminals[0] || was.terminals[1] !== device.terminals[1]) {
          continue
        }
        device.state = was.state
      }
    }
    this.lastStepCycles = this.cpu.cycles
    this.retuneCycles = this.cpu.cycles
    this.tuneStep()
  }

  /**
   * Re-derive the timestep from the circuit's own smallest time constant.
   *
   * A null probe (no reactive element the probe could measure, or a matrix it
   * could not factor) falls back to the CEILING rather than the floor. Erring
   * large is the safe direction: too small a step only wastes wall clock, but it
   * wastes it without bound, and a pathological circuit that defeats the probe
   * would otherwise pin the engine at 50 000 solves a second forever.
   */
  private tuneStep(): void {
    const tau = this.compiled.circuit.smallestTimeConstant()
    const h =
      tau === null
        ? MAX_STEP_SECONDS
        : Math.min(Math.max(tau / STEPS_PER_TAU, MIN_STEP_SECONDS), MAX_STEP_SECONDS)
    this.stepSeconds = h
    this.stepCycles = Math.max(1, Math.round(h * CLOCK_HZ))
    this.nextStepCycles = this.lastStepCycles + this.stepCycles
  }

  /** Pins that are electrically connected. Unconnected pins are not in the key. */
  private wiredPins = new Set<string>()

  /**
   * Wired pins grouped by AVR port, so a port write only checks its own pins.
   *
   * A Map keyed by port letter rather than a fixed B/C/D record: a Mega has
   * eleven ports, and experiment 11 alone spans A, C and F.
   */
  private watched = new Map<string, Array<[string, number]>>()

  /** Stamp one behavioural drive onto its port. The one place that maths lives. */
  private stampDrive(port: NortonPort, level: DriveLevel, volts: number): void {
    port.set(
      level === 'release' ? G_RELEASED : 1 / R_PULLDOWN,
      level === 'high' ? volts / R_PULLDOWN : 0,
    )
  }

  /**
   * One device's view of the engine, addressed by PART ID rather than by a
   * captured compile result — see `bindings`.
   */
  private contextFor(partId: string): BehaviouralContext {
    return {
      cpu: this.cpu,
      voltage: (signal) => {
        const n = this.bindings.get(partId)?.nets[signal]
        return n !== undefined && n < this.voltages.length ? this.voltages[n] : 0
      },
      hasSignal: (signal) => this.bindings.get(partId)?.nets[signal] !== undefined,
      // The engine owns both the port and the cache key, so a device's drive
      // can never diverge from what the cache thinks it is.
      drive: (signal, level, volts = VCC) => {
        const port = this.bindings.get(partId)?.ports[signal]
        if (!port) return
        const key = `${partId}:${signal}`
        // The VOLTAGE is part of the state, not just the level — an analog part
        // re-drives 'high' at a new value every few milliseconds and this
        // early-out used to swallow every one of them after the first.
        if (this.deviceDrives.get(key) === level && this.deviceVolts.get(key) === volts) return
        this.deviceDrives.set(key, level)
        this.deviceVolts.set(key, volts)
        this.stampDrive(port, level, volts)
        this.dirtyFlag[0] = 1
      },
      props: () => this.partProps(partId),
      report: (state) => {
        this.deviceStates[partId] = state
      },
    }
  }

  /**
   * What a device is wired to, as a string, so two compiles can be compared.
   *
   * Nets AND driven signals, because both change what the device is: a sensor
   * moved to another pin is on a different net, and a sensor whose output lead
   * was pulled loses the port it drives through.
   */
  private static wiringSignature(b: CompileResult['behavioural'][number]): string {
    const nets = Object.entries(b.nets)
      .map(([signal, net]) => `${signal}=${net}`)
      .sort()
      .join(',')
    return `${b.protocol}|${nets}|${Object.keys(b.ports).sort().join('+')}`
  }

  /**
   * Instantiate tier-2 parts, and — the important half — DO NOT re-instantiate
   * the ones that have not actually changed.
   *
   * This used to throw every behavioural device away on any call, which is to
   * say on any document edit at all, including a mere prop change. That is not a
   * neutral act: these devices carry state that only means anything as a
   * continuous history. An HC-SR501 is the clearest case — its output stays high
   * until `hold` seconds after motion STOPS, and un-ticking the "motion in
   * front" checkbox is a prop change, so the very act of asking the module to
   * start its hold window destroyed the module and its window with it. The
   * output dropped instantly, which is the one thing the datasheet says it must
   * not do. A flow sensor's cumulative pulse count had the same problem: turning
   * the tap reset the meter.
   *
   * So a device SURVIVES an edit when it is still the same part, still the same
   * model, and still on the same nets driving the same signals. Anything else —
   * deleted, re-wired, replaced with a different part on the same id — is a
   * genuinely different device and is rebuilt, because at that point the
   * continuity being preserved would be a fiction.
   *
   * Two things make survival safe rather than merely cheap:
   *
   *   - `bindings` is re-pointed at the new compile before anything else runs,
   *     so a surviving device reads the CURRENT ports and nets;
   *   - the drives it had set are re-stamped onto those new ports. They come up
   *     released, and a device that only drives on its own scheduled edges (a
   *     DHT11 halfway through a 40-bit frame) would otherwise let its line float
   *     until the next one.
   *
   * Self-clocked devices that do NOT survive are disposed, exactly as before:
   * their callbacks are still on the CPU's event list, and an orphan would go on
   * driving a port belonging to a compile nobody solves any more.
   */
  private buildBehavioural(): void {
    const present = new Map(this.compiled.behavioural.map((b) => [b.partId, b]))

    // 1. Retire what is gone or has been rewired, and forget its state.
    for (const [partId, entry] of [...this.live]) {
      const b = present.get(partId)
      if (b && entry.signature === SimulationEngine.wiringSignature(b)) continue
      entry.device.dispose?.()
      this.live.delete(partId)
      this.forgetDevice(partId)
    }

    // 2. Re-point the survivors, build the newcomers.
    for (const [partId, b] of present) {
      this.bindings.set(partId, b)
      const entry = this.live.get(partId)
      if (entry) {
        for (const signal of Object.keys(b.ports)) {
          const key = `${partId}:${signal}`
          const level = this.deviceDrives.get(key)
          if (level === undefined) continue
          this.stampDrive(b.ports[signal], level, this.deviceVolts.get(key) ?? VCC)
        }
        continue
      }
      const device = makeBehavioural(b.protocol, partId, this.contextFor(partId))
      if (device) {
        this.live.set(partId, { device, signature: SimulationEngine.wiringSignature(b) })
      }
    }

    // 3. A part the compiler no longer reports is not inert, it is absent.
    for (const partId of [...this.bindings.keys()]) {
      if (!present.has(partId)) this.bindings.delete(partId)
    }

    // 4. Poll order follows the compiler's, so an edit cannot silently reorder
    //    which device gets to see the solved voltages first.
    this.devices = []
    for (const b of this.compiled.behavioural) {
      const entry = this.live.get(b.partId)
      if (entry) this.devices.push(entry.device)
    }
  }

  /** Drop every trace of one behavioural part: drives, volts, reported state. */
  private forgetDevice(partId: string): void {
    const prefix = partId + ':'
    for (const key of [...this.deviceDrives.keys()]) {
      if (key.startsWith(prefix)) {
        this.deviceDrives.delete(key)
        this.deviceVolts.delete(key)
      }
    }
    delete this.deviceStates[partId]
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
      const entry = this.chip.pinMap[name]
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
      this.ports.get(port)?.setPin(bit, next)
    }
  }

  private partProps(partId: string): Record<string, number | string> {
    const part: PlacedPart | undefined = this.doc.parts.find((p) => p.id === partId)
    return part ? part.props : {}
  }

  private rebuildWatchList(): void {
    this.wiredPins = new Set(this.compiled.mcuPorts.keys())
    this.watched = new Map()
    for (const name of this.wiredPins) {
      const entry = this.chip.pinMap[name]
      if (!entry) continue
      const list = this.watched.get(entry[0])
      if (list) list.push([name, entry[1]])
      else this.watched.set(entry[0], [[name, entry[1]]])
    }
  }

  private stateKey(): string {
    let k = `${this.topologyVersion}|`
    for (const name of this.wiredPins) k += name + this.drives.get(name)![0]
    // Behavioural devices share the wire, so their drive is part of the
    // operating point. Omitting it made every DHT11 transition a cache HIT on
    // the previous solution — the sensor pulled its line low and the solver
    // went on reporting it high.
    //
    // The DRIVEN VOLTAGE goes in too, for an analog part: a pulse sensor drives
    // 'high' at a different value every couple of milliseconds, and a key that
    // only carried the level would return the first of those solutions forever.
    for (const [id, level] of this.deviceDrives) {
      k += '|' + id + level[0]
      if (level === 'high') k += this.deviceVolts.get(id)
    }
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

  /** Stamp the MCU's pins onto their Norton ports from the current drive vector. */
  private stampPins(): void {
    for (const [name, port] of this.compiled.mcuPorts) {
      const { g, i } = nortonFor(this.drives.get(name) ?? 'float')
      port.set(g, i)
    }
  }

  /**
   * Turn a converged solution into the published operating point.
   *
   * Shared by the DC and the transient paths deliberately: the two differ in HOW
   * they reach a solution and in nothing else, and a readout that drifted
   * between them (an LED brightness curve applied on one path but not the other)
   * would be invisible until a student compared two circuits.
   */
  private publish(res: SolveResult): void {
    this.voltages = res.voltages
    // Publish solved node voltages to the ADC. Unconnected analog pins read
    // 0 V: a real floating input picks up noise, but a deterministic 0 is the
    // honest choice for a teaching tool.
    for (const [pin, ch] of this.chip.adcPins) {
      const netId = this.compiled.analogNets.get(pin)
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
      solveError: res.ok ? null : (res.error ?? 'circuit did not solve'),
      voltages: res.voltages,
    }
  }

  /** Let the circuit and the behavioural models see the new operating point. */
  private settle(): void {
    this.dirtyFlag[0] = 0
    this.driveInputs()
    for (let i = 0; i < this.devices.length; i++) this.devices[i].poll()
  }

  private evaluate(): void {
    this.advanceAverage()
    if (this.transient) {
      this.stepTransient()
      return
    }

    const key = this.stateKey()
    const hit = this.cache.get(key)
    if (hit) {
      this.cacheHits++
      this.latest = hit
      this.voltages = hit.voltages
      this.settle()
      return
    }

    this.stampPins()

    if (this.compiled.circuit.size > 0) {
      const res = this.compiled.circuit.solve()
      this.solves++
      this.publish(res)
    } else {
      this.latest = EMPTY_SOLUTION
    }

    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear()
    this.cache.set(key, this.latest)
    this.settle()
  }

  /**
   * Advance the analog side to the CPU's current cycle, by one backward-Euler
   * step of exactly the simulated time that has elapsed since the last one.
   *
   * THIS IS THE CLOCK SYNCHRONISATION, and it is a synchronisation by
   * construction rather than by agreement. The step handed to the solver is not
   * a nominal h — it is `(cpu.cycles − lastStepCycles) / CLOCK_HZ`, read off
   * avr8js's own counter. Analog time is therefore identically cpu.cycles/16e6
   * at every instant, and there is no second clock that could drift from it. A
   * `delay(1000)` is 16 000 000 cycles, so the integrated transient time across
   * it is 1.000000 s exactly, whatever the steps in between happened to be.
   *
   * It also makes pin edges EXACT rather than quantised. `nextStepCycles`
   * schedules the regular steps, but an edge calls in immediately and takes a
   * short partial step up to the instant it happened; the following step is a
   * full one from there. So the circuit sees a pin change at the cycle it
   * actually occurred, not rounded to the nearest 20 µs — which is the same
   * property §2.1 relies on for PWM, preserved.
   */
  private stepTransient(): void {
    const cycles = this.cpu.cycles
    const dt = Math.max((cycles - this.lastStepCycles) / CLOCK_HZ, HOLD_STEP_SECONDS)
    this.lastStepCycles = cycles
    this.nextStepCycles = cycles + this.stepCycles

    this.stampPins()

    if (this.compiled.circuit.size > 0) {
      const res = this.compiled.circuit.transientStep(dt)
      this.solves++
      this.transientSteps++
      this.publish(res)
    } else {
      this.latest = EMPTY_SOLUTION
    }

    // Re-derive h AFTER the step, so the probe linearises at the operating point
    // that was just converged rather than the one before it.
    if (cycles >= this.retuneCycles) {
      this.retuneCycles = cycles + Math.max(1, Math.round(RETUNE_SECONDS * CLOCK_HZ))
      this.tuneStep()
    }

    // No cache write. See the `transient` field for why a memo keyed on pin
    // state would freeze the charge curve.
    this.settle()
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

    if (!this.transient) {
      while (cpu.cycles < target) {
        avrInstruction(cpu)
        cpu.tick()
        // Event-driven: the analog side is only touched when a pin actually moves.
        if (flag[0] === 1) this.evaluate()
      }
      return
    }

    /**
     * Reactive circuit: the analog side is no longer purely event-driven,
     * because a capacitor charges whether or not a pin moved. It is visited on
     * a SCHEDULE as well as on an edge.
     *
     * `next` mirrors this.nextStepCycles in a local on purpose. The comment on
     * dirtyFlag records that reading instance properties inside this loop
     * measured ~3.5x slower than locals, and this loop body runs tens of
     * millions of times per simulated second. Only evaluate() ever moves the
     * schedule, so re-reading it right after each evaluate is exact.
     */
    let next = this.nextStepCycles
    while (cpu.cycles < target) {
      avrInstruction(cpu)
      cpu.tick()
      if (flag[0] === 1 || cpu.cycles >= next) {
        this.evaluate()
        next = this.nextStepCycles
      }
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

  /**
   * Reported device state at snapshot time.
   *
   * Motors are computed HERE rather than published by the device, because their
   * speed has to come from the TIME-AVERAGED current: a PWM-driven motor sits at
   * two DC operating points, and a snapshot of either one is a speed the shaft
   * never actually runs at. Speed is affine in current (see DCMotor.rpmFor), so
   * converting the exact time-weighted average is exactly the average speed.
   */
  private states(averaged: Record<string, number>): Record<string, DeviceState> {
    // Give devices whose reading AGES (a buzzer that stopped being driven) a
    // chance to notice — solves only happen on pin edges, and silence has none.
    for (let i = 0; i < this.devices.length; i++) this.devices[i].refresh?.()

    /**
     * The purely ANALOG parts, which have no behavioural model to report
     * through — a capacitor's voltage, a pot's wiper, an LDR's resistance. Read
     * out of the solve that has already happened; see analog-state.ts. Spread
     * FIRST so that a part which somehow had both would be reported by its own
     * model, which is the more specific answer.
     */
    const out: Record<string, DeviceState> = {
      ...analogDeviceStates({
        doc: this.doc,
        netOf: this.compiled.netOf,
        nets: this.compiled.nets,
        voltages: this.voltages,
        reactive: this.compiled.reactive,
        drivers: this.compiled.drivers,
        transient: this.transient,
      }),
      ...this.deviceStates,
    }
    for (const [partId, motor] of this.compiled.motors) {
      const amps = averaged[partId] ?? motor.current
      const rpm = motor.rpmFor(amps)
      out[partId] = {
        rpm: Math.abs(rpm),
        direction: rpm > 0 ? 'forward' : rpm < 0 ? 'reverse' : 'stopped',
        amps,
        load: motor.load,
        stalled: rpm === 0 && Math.abs(amps) > 0,
      }
    }
    return out
  }

  snapshot(): EngineSnapshot {
    /**
     * Close the TRANSIENT window here too, for exactly the reason the averaging
     * window is closed here.
     *
     * run() leaves the analog solution standing at `lastStepCycles`, which can
     * be up to one whole timestep behind `cpu.cycles` — the loop stops on the
     * time budget, not on a step boundary. Publishing that state alongside
     * `simSeconds: cpu.cycles / CLOCK_HZ` would date a voltage to an instant it
     * does not belong to: measured on a 1 kΩ/1 µF charge sampled every 20 µs,
     * it read 3.108 V against the 3.142 V the same integration actually holds
     * at t = τ, a 1 % lag that a student comparing to the theory would see and
     * we could not explain. Stepping to now makes the pair consistent by
     * construction, and costs one extra solve per snapshot (20 a second).
     */
    if (this.transient && this.cpu.cycles > this.lastStepCycles) this.evaluate()
    // Close the averaging window HERE, so the reading reflects the recent past
    // up to this instant rather than up to the last pin edge.
    this.advanceAverage()
    const pins: Record<string, PinDrive> = {}
    for (const [name, d] of this.drives) pins[name] = d
    const currents = this.averagedCurrents()
    return {
      ledBrightness: this.averagedBrightness(),
      currents,
      deviceStates: this.states(currents),
      adc: adcCounts(this.adc, this.chip.adcPins),
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
      transientStep: this.transient ? this.stepSeconds : 0,
      transientSteps: this.transientSteps,
    }
  }
}

/**
 * Protocol name → behavioural model. The compiler decides WHICH parts need one
 * and wires their nets; this decides what code runs. An unknown protocol returns
 * null rather than throwing: a document authored against a newer part library
 * should degrade to an inert part, not take the whole worker down.
 */
function makeBehavioural(
  protocol: string,
  partId: string,
  ctx: BehaviouralContext,
): BehaviouralDevice | null {
  switch (protocol) {
    case 'dht11':
      return new DHT11(partId, ctx)
    case 'ds18b20':
      return new DS18B20Sensor(partId, ctx)
    case 'hc_sr04':
      return new HCSR04(partId, ctx)
    case 'pir':
      return new PIRSensor(partId, ctx)
    case 'flow':
      return new FlowSensor(partId, ctx)
    case 'buzzer':
      return new BuzzerMonitor(partId, ctx, BUZZER_5V)
    case 'stepper':
      return new StepperMonitor(partId, ctx, STEPPER_28BYJ48)
    case 'pulse':
      return new PulseSensor(partId, ctx)
    case 'mcp3008':
      return new MCP3008Device(partId, ctx)
    case 'relay':
      return new RelayMonitor(partId, ctx, RELAY_MODULE_4CH)
    default:
      return null
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
function adcCounts(adc: AVRADC, pins: AvrChip['adcPins']): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [pin, ch] of pins) {
    const v = Number(adc.channelValues[ch] ?? 0)
    out[pin] = Math.max(0, Math.min(1023, Math.round((v / adc.avcc) * 1023)))
  }
  return out
}

/** Shared empty watch list, so a port with no wired pins allocates nothing. */
const EMPTY_WATCH: Array<[string, number]> = []
