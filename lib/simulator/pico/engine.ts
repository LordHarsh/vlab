/**
 * The Pico simulation engine: real MicroPython firmware driving a student-built
 * circuit.
 *
 * Deliberately parallel to ../engine.ts — same PinBridge idea, same memoised
 * DC solve, same time-weighted display filter — so that the two boards stay
 * comparable and a fix to one is obviously portable to the other. What is NOT
 * shared is every electrical constant, because a Pico is a 3.3 V part and an
 * Uno is a 5 V part, and quietly inheriting 5 V numbers would make every
 * resistor value we teach wrong by more than a factor of two.
 *
 * The other structural difference is where the student's program enters. On the
 * Uno, avr-gcc has already turned the sketch into a .hex before the engine ever
 * runs. Here there is no compile step: one prebuilt MicroPython image is loaded
 * for everybody, and the student's .py is typed into the emulated REPL over
 * emulated USB, exactly as if they had opened Thonny. See feedScript().
 */

import { Simulator, USBCDC, GPIOPinState, type Logger, type RP2040 } from 'rp2040js'
import type { CPU } from 'avr8js'
import { compile, type CompileResult } from '../model/compile'
import type { CircuitDoc, PlacedPart } from '../model/document'
import type { SolveFault } from '../types'
import {
  BuzzerMonitor,
  DHT11,
  FlowSensor,
  G_RELEASED,
  HCSR04,
  PIRSensor,
  R_PULLDOWN,
  type BehaviouralContext,
  type BehaviouralDevice,
  type DeviceState,
  type DriveLevel,
} from '../behavioural'
import { BUZZER_5V, MIN_RESISTANCE } from '../devices'
import { PICO_ADC_PINS, PICO_ONBOARD_LED_GPIO, adcChannelOf, gpioIndexOf } from './board'
import { PicoBehaviouralClock } from './clock-shim'
import type { PicoFirmware } from './firmware'

/** RP2040 system clock as the Pico's stage-2 bootloader configures it. */
export const PICO_CLOCK_HZ = 125_000_000
const CYCLE_NANOS = 1e9 / PICO_CLOCK_HZ

// ─── Electrical model, all from the RP2040 datasheet §5.5.3 ──────────────────

/** IOVDD on a Pico. The single most consequential difference from the Uno. */
export const PICO_VDD = 3.3

/**
 * GPIO output impedance, in ohms.
 *
 * RP2040 pads have a configurable drive strength (2/4/8/12 mA) and reset to
 * 4 mA. At that setting the datasheet guarantees only VOH ≥ IOVDD − 0.4 V at
 * 4 mA, i.e. a 100 Ω WORST case; the measured typical pad impedance is nearer
 * 50 Ω. We model the typical, because a student comparing against a real board
 * on the bench sees the typical, and record the spread as a limitation rather
 * than hiding it. It is twice the Uno's 25 Ω, which alone costs an LED about
 * 0.5 mA on a 3.3 V rail.
 */
const R_DRIVE = 50

/**
 * Internal pull-up / pull-down, in ohms. Datasheet gives 50–80 kΩ; 55 kΩ is the
 * typical. Note this is nearly 3x weaker than the ATmega's ~20 kΩ, which
 * matters for button circuits: the same external pull-down that safely beats an
 * AVR pull-up will beat a Pico's far more easily.
 */
const R_PULL = 55_000

/** An input pad that is neither driven nor pulled: 100 MΩ, as in ../engine.ts. */
const G_FLOAT = 1e-8

/**
 * Input thresholds, in volts, from the RP2040 DC characteristics at
 * IOVDD = 3.3 V: VIL max 0.8 V, VIH min 2.0 V.
 *
 * The 1.2 V gap between them IS the hysteresis, and it is doing the same
 * load-bearing job as the AVR engine's deadband: without it a node parked near
 * mid-rail chatters across the threshold on every re-solve and floods the
 * firmware with spurious edges. Here the numbers happen to be real — RP2040
 * pads have a Schmitt trigger enabled at reset — so we get it honestly rather
 * than by fiat.
 */
const VIL = 0.8
const VIH = 2.0

/**
 * Per-pin current ratings, in amps.
 *
 * 12 mA is the highest drive strength an RP2040 pad can be configured for and
 * therefore the most it can source while still meeting its VOH spec; beyond
 * that the pad is simply out of specification. Unlike the ATmega there is no
 * published per-pin absolute maximum, so `maxCurrent` here is a judgement call
 * marked at 16 mA rather than a datasheet number, and it is set on each port so
 * the AVR's 20/40 mA thresholds cannot leak in.
 */
const PIN_RATED_CURRENT = 0.012
const PIN_MAX_CURRENT = 0.016

/** ADC: 12 bits against a 3.3 V reference, versus the AVR's 10 bits. */
export const PICO_ADC_MAX = 4095

const SILENT_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

/**
 * A Pico pad can pull DOWN as well as up, which an ATmega cannot. Modelling it
 * as 'float' would make an internally-pulled-down input read as a dangling
 * wire, so it gets its own state rather than being folded into the AVR's four.
 */
export type PicoPinDrive = 'low' | 'high' | 'float' | 'pullup' | 'pulldown'

function nortonFor(drive: PicoPinDrive): { g: number; i: number } {
  switch (drive) {
    case 'low':
      return { g: 1 / R_DRIVE, i: 0 }
    case 'high':
      return { g: 1 / R_DRIVE, i: PICO_VDD / R_DRIVE }
    case 'pullup':
      return { g: 1 / R_PULL, i: PICO_VDD / R_PULL }
    case 'pulldown':
      // A pull-DOWN is the same conductance to ground with no injected current:
      // it is a resistor to 0 V, which is exactly what 'low' would be if the
      // driver were 1000x weaker.
      return { g: 1 / R_PULL, i: 0 }
    case 'float':
      return { g: G_FLOAT, i: 0 }
  }
}

function driveOf(state: GPIOPinState): PicoPinDrive {
  switch (state) {
    case GPIOPinState.Low:
      return 'low'
    case GPIOPinState.High:
      return 'high'
    case GPIOPinState.InputPullUp:
      return 'pullup'
    case GPIOPinState.InputPullDown:
      return 'pulldown'
    // Bus-keeper is a weak latch that holds whatever the line last was. We do
    // not model the latch, so it degrades to a plain high-impedance input; the
    // engine says so in limitations() rather than inventing a value.
    case GPIOPinState.InputBusKeeper:
    case GPIOPinState.Input:
    default:
      return 'float'
  }
}

export interface PicoSnapshot {
  /** partId → 0..1 for rendering. */
  ledBrightness: Record<string, number>
  /** partId → amps. */
  currents: Record<string, number>
  /** GP26/GP27/GP28 → the 12-bit count machine.ADC.read_u16()>>4 would return. */
  adc: Record<string, number>
  faults: SolveFault[]
  problems: string[]
  /** Everything MicroPython has printed to the REPL. */
  serial: string
  /** Pico pin id (GP0…GP28) → drive state. */
  pins: Record<string, PicoPinDrive>
  /** GP25 has no header pad; this is the on-board LED it drives. */
  onboardLed: boolean
  simSeconds: number
  solves: number
  cacheHits: number
  pinEdges: number
  unknowns: number
  solveError: string | null
  limitations: string[]
  /** Where the REPL hand-off has got to. See feedScript(). */
  repl: ReplPhase
  /**
   * partId → whatever that part is doing that a node voltage cannot express:
   * the reading a DHT11 is sending, the rpm of a motor. REPORTED state, derived
   * from the solved circuit and from simulated time — never a substitute for
   * solving. Same field, same meaning as the AVR engine's.
   */
  deviceStates: Record<string, DeviceState>
}

/**
 * Life cycle of getting the student's .py into a running interpreter.
 *
 *   booting  — firmware is coming up; no prompt has appeared yet.
 *   pasting  — we have seen '>>>' and are streaming the script in paste mode.
 *   running  — Ctrl-D sent; the script owns the interpreter.
 *   idle     — no script was supplied; the REPL is just sitting there.
 */
export type ReplPhase = 'booting' | 'pasting' | 'running' | 'idle'

interface CachedSolution {
  brightness: Record<string, number>
  currents: Record<string, number>
  faults: SolveFault[]
  solveError: string | null
  voltages: Float64Array
}

const EMPTY_SOLUTION: CachedSolution = {
  brightness: {},
  currents: {},
  faults: [],
  solveError: null,
  voltages: new Float64Array(0),
}

export interface PicoEngineOptions {
  /** The student's MicroPython source. Omit to land at a bare REPL. */
  script?: string
}

export class PicoSimulationEngine {
  readonly mcu: RP2040
  private readonly sim: Simulator
  private readonly cdc: USBCDC

  private compiled: CompileResult
  private drives = new Map<string, PicoPinDrive>()
  private dirtyFlag = new Uint8Array([1])

  private cache = new Map<string, CachedSolution>()
  private solves = 0
  private cacheHits = 0
  private pinEdges = 0
  private topologyVersion = 0
  private latest: CachedSolution = EMPTY_SOLUTION

  private avg = new Map<string, number>()
  private lastAvgNanos = 0
  /**
   * Display filter time constant, in NANOSECONDS of simulated time.
   *
   * 25 ms, the same window ../engine.ts uses and for the same reason: long
   * enough to integrate PWM into a steady brightness, short enough (99%
   * settled in 115 ms) that a human reads it as instant. Expressed in nanos
   * here because the RP2040 clock is a nanosecond counter rather than a cycle
   * counter — using cycles would have silently made the filter 7.8x too fast,
   * since a Pico cycle is 1/125 MHz and not 1/16 MHz.
   */
  private readonly avgTauNanos = 25e6

  /**
   * Behavioural parts (a DHT11 and friends), running the SAME models the AVR
   * engine runs, on an RP2040 clock. See ./clock-shim.ts for why that is a
   * translation rather than a fork.
   */
  private readonly clockShim: PicoBehaviouralClock
  private devices: BehaviouralDevice[] = []
  /** Behavioural drive state, keyed "partId:signal". Part of the memo key. */
  private deviceDrives = new Map<string, DriveLevel>()
  private deviceStates: Record<string, DeviceState> = {}

  private inputLevels = new Map<string, boolean>()
  private wiredPins = new Set<string>()
  /** Wired header GPIOs as [pinId, gpioIndex], so the hot path skips the regex. */
  private watched: Array<[string, number]> = []
  private unsubscribe: Array<() => void> = []
  private voltages: Float64Array = new Float64Array(0)
  private doc: CircuitDoc

  private replPhase: ReplPhase
  private script: string | null
  /** Set by the serial callback the moment a prompt appears. See pumpRepl(). */
  private promptSeen = false
  /** Bytes still to be pushed into the CDC FIFO. See pumpScript(). */
  private pending: number[] = []
  /**
   * Next simulated nanosecond at which the REPL feeder may run.
   *
   * The feeder must NOT run per instruction. At ~64 M emulated instructions per
   * simulated second, a per-instruction check costs more than the emulation it
   * is checking on. 1 ms of simulated time is far finer than the USB frame rate
   * the bytes leave on anyway, so gating on it is free in behaviour and turns a
   * 64-million-call-per-second loop into a 1000-call-per-second one.
   */
  private nextReplCheckNanos = 0
  private onboardLedOn = false

  serial = ''

  constructor(firmware: PicoFirmware, doc: CircuitDoc, options: PicoEngineOptions = {}) {
    this.sim = new Simulator()
    this.mcu = this.sim.rp2040
    this.mcu.logger = SILENT_LOGGER

    this.mcu.loadBootrom(firmware.bootrom)
    this.mcu.flash.set(firmware.flash, firmware.flashBase - 0x10000000)
    // Entry point is the start of XIP flash: the bootrom's stage-2 handoff.
    this.mcu.core.PC = firmware.flashBase

    this.cdc = attachSerial(this.mcu, (text) => {
      this.serial += text
      if (this.serial.length > 8000) this.serial = this.serial.slice(-8000)
      // Only the tail can contain a prompt we have not already acted on, and
      // scanning it here — once per USB packet — keeps the substring search out
      // of the per-instruction loop entirely. See pumpRepl().
      if (this.replPhase === 'booting' && text.includes('>>>')) this.promptSeen = true
    })

    this.script = options.script ?? null
    this.replPhase = this.script ? 'booting' : 'idle'

    /**
     * GP25 is not on the header, so it is not in `watched` and cannot reach the
     * solver. It is still the pin every "hello world" blinks, so it is tracked
     * here purely so the snapshot can report it — a student whose first script
     * blinks the built-in LED must see SOMETHING happen even with an empty
     * breadboard.
     */
    this.mcu.gpio[PICO_ONBOARD_LED_GPIO].addListener((state) => {
      this.onboardLedOn = state === GPIOPinState.High
    })

    this.clockShim = new PicoBehaviouralClock(this.mcu.clock)

    this.doc = doc
    this.compiled = compile(doc)
    this.rebuildWatchList()
    this.buildBehavioural()
    this.evaluate()
  }

  /** Swap in an edited circuit without resetting the interpreter. */
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

  private partProps(partId: string): Record<string, number | string> {
    const part: PlacedPart | undefined = this.doc.parts.find((p) => p.id === partId)
    return part ? part.props : {}
  }

  /**
   * Instantiate tier-2 parts, exactly as ../engine.ts does.
   *
   * The one Pico-specific line is the default `volts` for a device driving its
   * line HIGH: PICO_VDD rather than the AVR's 5. A device that names its own
   * output level (an HC-SR501 drives 3.3 V whatever the board) still wins, as
   * it should — that is a datasheet property of the part, not of the rail.
   */
  private buildBehavioural(): void {
    // Self-clocked devices hold live alarms on the RP2040 clock. Rebuilding
    // without cancelling them leaves an orphan still driving a Norton port that
    // belongs to the previous compile.
    for (const d of this.devices) d.dispose?.()
    this.clockShim.cancelAll()
    this.devices = []
    this.deviceDrives.clear()
    this.deviceStates = {}

    for (const b of this.compiled.behavioural) {
      const ctx: BehaviouralContext = {
        /**
         * The one unavoidable cast on this path.
         *
         * BehaviouralContext types this as avr8js's CPU class, which has
         * private fields and therefore cannot be satisfied structurally. What
         * makes it safe is that the models touch exactly three members of it,
         * PicoBehaviouralClock implements all three against the real avr8js
         * signatures, and pico.test.ts fails if a device ever reaches for a
         * fourth. See ./clock-shim.ts.
         */
        cpu: this.clockShim as unknown as CPU,
        voltage: (signal) => {
          const n = b.nets[signal]
          return n !== undefined && n < this.voltages.length ? this.voltages[n] : 0
        },
        drive: (signal, level, volts = PICO_VDD) => {
          const port = b.ports[signal]
          if (!port) return
          const key = `${b.partId}:${signal}`
          if (this.deviceDrives.get(key) === level) return
          this.deviceDrives.set(key, level)
          port.set(
            level === 'release' ? G_RELEASED : 1 / R_PULLDOWN,
            level === 'high' ? volts / R_PULLDOWN : 0,
          )
          this.dirtyFlag[0] = 1
        },
        props: () => this.partProps(b.partId),
        report: (state) => {
          this.deviceStates[b.partId] = state
        },
      }

      const device = makeBehavioural(b.protocol, b.partId, ctx)
      if (device) this.devices.push(device)
    }
  }

  /**
   * Subscribe to exactly the GPIOs the circuit uses.
   *
   * rp2040js dispatches per-pin rather than per-port, so unlike the AVR side
   * there is no cost at all to pins we do not watch — but there IS a cost to
   * leaking subscriptions across a rewire, since a stale listener would keep
   * writing into `drives` for a pin that no longer has a Norton port. Every
   * listener is therefore torn down and rebuilt together.
   */
  private rebuildWatchList(): void {
    for (const off of this.unsubscribe) off()
    this.unsubscribe = []
    this.watched = []
    this.wiredPins = new Set(this.compiled.mcuPorts.keys())
    this.drives = new Map()

    for (const pinId of this.wiredPins) {
      const gp = gpioIndexOf(pinId)
      if (gp === null) continue
      this.watched.push([pinId, gp])
      const pin = this.mcu.gpio[gp]
      // Seed from the pad's CURRENT state, not from 'float'. A rewire happens
      // mid-run, so the firmware may already be driving this pin; starting at
      // 'float' would publish one frame of a dark LED that is actually lit.
      this.drives.set(pinId, driveOf(pin.value))
      this.unsubscribe.push(
        pin.addListener((state) => {
          const drive = driveOf(state)
          if (this.drives.get(pinId) === drive) return
          this.drives.set(pinId, drive)
          this.pinEdges++
          this.dirtyFlag[0] = 1
        }),
      )
    }

    // Per-pin ratings, so the AVR's 20/40 mA thresholds can never be inherited.
    for (const port of this.compiled.mcuPorts.values()) {
      port.ratedCurrent = PIN_RATED_CURRENT
      port.maxCurrent = PIN_MAX_CURRENT
    }
  }

  private stateKey(): string {
    let k = `${this.topologyVersion}|`
    for (const [pinId] of this.watched) k += pinId + (this.drives.get(pinId) ?? 'float')[0]
    // A behavioural device shares the wire, so its drive is part of the
    // operating point. Omitting it makes every DHT11 transition a cache HIT on
    // the previous solution — the sensor pulls its line low and the solver goes
    // on reporting it high, which is exactly the bug the AVR engine hit.
    for (const [id, level] of this.deviceDrives) k += '|' + id + level[0]
    return k
  }

  /**
   * Push solved node voltages back into the emulator as digital input levels —
   * the other half of the PinBridge, without which digitalRead()'s equivalent
   * (`Pin.value()` on an input) never observes the circuit at all.
   */
  private driveInputs(): void {
    for (const [pinId, gp] of this.watched) {
      const drive = this.drives.get(pinId)
      if (drive === 'low' || drive === 'high') continue // the pad owns the line

      const netId = this.compiled.pinNets.get(pinId)
      if (netId === undefined) continue
      const v = netId < this.voltages.length ? this.voltages[netId] : 0

      const prev = this.inputLevels.get(pinId) ?? false
      const next = prev ? v > VIL : v > VIH
      if (next === prev && this.inputLevels.has(pinId)) continue
      this.inputLevels.set(pinId, next)
      this.mcu.gpio[gp].setInputValue(next)
    }
  }

  private advanceAverage(): void {
    const now = this.mcu.clock.nanos
    const dt = now - this.lastAvgNanos
    this.lastAvgNanos = now
    const decay = dt > 0 ? Math.exp(-dt / this.avgTauNanos) : 1
    const cur = this.latest.currents
    for (const partId of this.avg.keys()) if (!(partId in cur)) this.avg.delete(partId)
    for (const partId of Object.keys(cur)) {
      const target = cur[partId]
      const prev = this.avg.get(partId)
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

      for (const pinId of PICO_ADC_PINS) {
        const ch = adcChannelOf(pinId)
        if (ch === null) continue
        const netId = this.compiled.analogNets.get(pinId)
        this.mcu.adc.channelValues[ch] =
          netId !== undefined && netId < res.voltages.length ? res.voltages[netId] : 0
      }

      const brightness: Record<string, number> = {}
      const currents: Record<string, number> = {}
      for (const [partId, dev] of this.compiled.meters) currents[partId] = dev.current
      for (const [partId, diode] of this.compiled.leds) {
        const i = Math.max(diode.current, 0)
        brightness[partId] = Math.min(1, Math.pow(i / 0.02, 0.45))
      }
      this.latest = { brightness, currents, faults: res.faults, solveError, voltages: res.voltages }
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
   * Two departures from the AVR loop, both forced by the hardware:
   *
   *  - the RP2040 core can WAIT (WFE/WFI), and when it does there is nothing to
   *    execute until the next scheduled alarm. Skipping straight there is not
   *    an optimisation we invented, it is what the silicon does. In practice
   *    MicroPython's time.sleep() spends most of its time polling USB rather
   *    than waiting, so this buys less than one might hope — measured at about
   *    8% of simulated time on a 1 Hz blink.
   *  - time is counted in nanoseconds, not cycles, because rp2040js's peripheral
   *    alarms are scheduled in nanos.
   */
  run(micros: number): void {
    const core = this.mcu.core
    const clock = this.sim.clock
    const flag = this.dirtyFlag
    const target = clock.nanos + micros * 1000
    while (clock.nanos < target) {
      if (core.waiting) {
        const next = clock.nanosToNextAlarm
        clock.tick(next > 0 ? Math.min(next, target - clock.nanos) : target - clock.nanos)
      } else {
        clock.tick(core.executeInstruction() * CYCLE_NANOS)
      }
      if (flag[0] === 1) this.evaluate()
      if (clock.nanos >= this.nextReplCheckNanos) {
        this.nextReplCheckNanos = clock.nanos + 1_000_000 // 1 ms of sim time
        this.pumpRepl()
      }
    }
  }

  // ─── Getting the student's .py into the interpreter ────────────────────────

  /**
   * Type the script in, over emulated USB, the way a person would.
   *
   * There is no filesystem write path: rp2040js does not implement the SSI
   * peripheral, so the emulated MicroPython physically cannot save a file to
   * flash. Building a LittleFS image containing main.py and injecting it into
   * `mcu.flash` before boot is the other option and it works, but it costs a
   * LittleFS writer in JS and — worse — makes every edit a full reboot. The
   * REPL costs neither, and it is what the student's own workflow looks like.
   *
   * Ctrl-E puts MicroPython in paste mode, where it echoes lines but does not
   * evaluate or re-indent them; Ctrl-D ends the paste and runs the block. This
   * matters: in the ordinary REPL, a blank line terminates an indented block,
   * so any script with a blank line inside a `while` would be silently cut in
   * half. Paste mode has no such rule.
   */
  private pumpRepl(): void {
    if (this.replPhase === 'idle' || this.replPhase === 'running') {
      this.pumpScript()
      return
    }
    if (this.replPhase === 'booting') {
      if (!this.promptSeen) return
      this.replPhase = 'pasting'
      // Ctrl-C first: if the firmware auto-ran anything, interrupt it, so the
      // paste lands at a clean prompt rather than into a running loop.
      this.queue('\x03\x05')
      this.queue((this.script ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'))
      this.queue('\x04')
      this.replPhase = 'running'
    }
    this.pumpScript()
  }

  private queue(s: string): void {
    for (let i = 0; i < s.length; i++) this.pending.push(s.charCodeAt(i))
  }

  /**
   * Trickle queued bytes into the CDC FIFO.
   *
   * The FIFO is 512 entries and FIFO.push() DROPS silently when full, so
   * shovelling a 2 KB script in one go loses most of it and produces a
   * SyntaxError that looks like the student's fault. Topping up only while
   * there is headroom makes the length of the script irrelevant.
   */
  private pumpScript(): void {
    if (this.pending.length === 0) return
    const fifo = this.cdc.txFIFO
    let room = fifo.size - fifo.itemCount - 8
    while (room > 0 && this.pending.length > 0) {
      this.cdc.sendSerialByte(this.pending.shift()!)
      room--
    }
  }

  // ─── Readout ───────────────────────────────────────────────────────────────

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
   * Faults the solver found, plus the ones it structurally cannot see.
   *
   * `s.volts` is now the BOARD's own rail. compile() used to hardcode 5 V for a
   * shorted I/O pin, so this method recomputed the number from PICO_VDD to stop
   * a Pico fault being overstated by 52%; that workaround is gone, and the
   * assertion in pico.test.ts group I is what keeps it gone.
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
          value: s.volts / MIN_RESISTANCE,
          message:
            `The ${s.volts} V supply pin is wired directly to GND — that is a short circuit. ` +
            `On real hardware this destroys the board or the supply.`,
        })
      } else if (this.drives.get(s.pinId) === 'high') {
        const amps = s.volts / R_DRIVE
        out.push({
          kind: 'short_circuit',
          severity: 'destructive',
          deviceId: s.deviceId,
          value: amps,
          message:
            `${s.pinId} is driving ${s.volts} V straight into GND — ` +
            `${(amps * 1000).toFixed(0)} mA through a pad rated for ` +
            `${(PIN_RATED_CURRENT * 1000).toFixed(0)} mA. On real hardware this damages the pin.`,
        })
      }
    }
    return out.concat(this.latest.faults)
  }

  private limitations(): string[] {
    const out = [...this.compiled.limitations]
    for (const [, gp] of this.watched) {
      if (this.mcu.gpio[gp].value === GPIOPinState.InputBusKeeper) {
        out.push(
          'A pin is configured with both pull-up and pull-down (bus-keeper mode). ' +
            'That weak latch is not modelled; the pin is treated as a plain high-impedance input.',
        )
        break
      }
    }
    return [...new Set(out)]
  }

  /**
   * Reported device state at snapshot time.
   *
   * Motors are computed HERE rather than published by the device, because their
   * speed has to come from the TIME-AVERAGED current: a PWM-driven motor sits
   * at two DC operating points and a snapshot of either is a speed the shaft
   * never runs at. Speed is affine in current (DCMotor.rpmFor), so converting
   * the exact time-weighted average is exactly the average speed. Identical to
   * ../engine.ts — and it matters more here, because rp2040js drives the PWM
   * block through the same GPIOPin.value path, so a Pico PWM needs no other
   * special casing.
   */
  private states(averaged: Record<string, number>): Record<string, DeviceState> {
    // Give devices whose reading AGES (a buzzer that stopped being driven) a
    // chance to notice — solves only happen on pin edges, and silence has none.
    for (let i = 0; i < this.devices.length; i++) this.devices[i].refresh?.()

    const out: Record<string, DeviceState> = { ...this.deviceStates }
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

  snapshot(): PicoSnapshot {
    this.advanceAverage()
    const pins: Record<string, PicoPinDrive> = {}
    for (const [pinId] of this.watched) pins[pinId] = this.drives.get(pinId) ?? 'float'
    const adc: Record<string, number> = {}
    for (const pinId of PICO_ADC_PINS) {
      const ch = adcChannelOf(pinId)!
      const v = Number(this.mcu.adc.channelValues[ch] ?? 0)
      adc[pinId] = Math.max(0, Math.min(PICO_ADC_MAX, Math.round((v / PICO_VDD) * PICO_ADC_MAX)))
    }
    const currents = this.averagedCurrents()
    return {
      ledBrightness: this.averagedBrightness(),
      currents,
      deviceStates: this.states(currents),
      adc,
      faults: this.faults(),
      problems: this.compiled.problems,
      serial: this.serial.slice(-2000),
      pins,
      onboardLed: this.onboardLedOn,
      simSeconds: this.mcu.clock.nanos / 1e9,
      solves: this.solves,
      cacheHits: this.cacheHits,
      pinEdges: this.pinEdges,
      unknowns: this.compiled.unknowns,
      solveError: this.latest.solveError,
      limitations: this.limitations(),
      repl: this.replPhase,
    }
  }
}

/**
 * Protocol name → behavioural model.
 *
 * The SAME table as ../engine.ts's, and deliberately a duplicate of four lines
 * rather than a shared export: the two engines instantiate the same classes,
 * and if they ever stop agreeing that is a fact worth seeing in a diff.
 *
 * An unknown protocol returns null rather than throwing — a document authored
 * against a newer part library should degrade to an inert part, not take the
 * whole worker down.
 */
function makeBehavioural(
  protocol: string,
  partId: string,
  ctx: BehaviouralContext,
): BehaviouralDevice | null {
  switch (protocol) {
    case 'dht11':
      return new DHT11(partId, ctx)
    case 'hc_sr04':
      return new HCSR04(partId, ctx)
    case 'pir':
      return new PIRSensor(partId, ctx)
    case 'flow':
      return new FlowSensor(partId, ctx)
    case 'buzzer':
      return new BuzzerMonitor(partId, ctx, BUZZER_5V)
    default:
      return null
  }
}

/**
 * Attach the emulated USB CDC link.
 *
 * Instantiating USBCDC is what makes MicroPython believe a host is attached: it
 * runs the full enumeration handshake against the emulated USB controller.
 * Without it the firmware boots and then sits there, because the REPL will not
 * print a prompt to a port nobody has opened. This is the one place the Pico
 * track depends on rp2040js emulating a whole USB device stack, and it works.
 */
function attachSerial(mcu: RP2040, onText: (text: string) => void): USBCDC {
  const cdc = new USBCDC(mcu.usbCtrl)
  cdc.onSerialData = (buf: Uint8Array) => {
    let s = ''
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i])
    onText(s)
  }
  cdc.onDeviceConnected = () => {
    // Nudge the REPL so it prints its banner and prompt.
    cdc.sendSerialByte(13)
    cdc.sendSerialByte(10)
  }
  return cdc
}
