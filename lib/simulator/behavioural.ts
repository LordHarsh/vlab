/**
 * Behavioural parts — tier 2 in SIMULATOR_ARCHITECTURE.md §7.1.
 *
 * A resistor is data. A DHT11 is not: it is a state machine that talks a
 * bit-banged wire protocol with microsecond timing, so it needs code. These
 * devices drive their own net through a Norton port and schedule their
 * transitions on the emulator's clock, which makes their timing exact rather
 * than approximated — the whole point of running real firmware is that the
 * student's own bit-banging loop has something real to talk to.
 *
 * Every timing constant below is quoted from the part's datasheet, with the
 * datasheet line it comes from written next to it. Nothing here is tuned to make
 * a particular experiment's sketch work.
 */

import type { CPU } from 'avr8js'
import {
  HALF_STEP_SEQUENCE,
  STEPPER_28BYJ48,
  StepTracker,
  degreesPerHalfStep,
  halfStepsPerRevolution,
  type StepperParams,
} from './devices'

const CLOCK_HZ = 16_000_000
const VCC = 5

/**
 * Drive strengths for a device sharing a line with the MCU.
 *
 * R_PULLDOWN is both the open-drain pull-down of a DHT11/YF-S201 and the output
 * impedance of a push-pull sensor output (an HC-SR04 ECHO, an HC-SR501 OUT) —
 * they are all small on-chip drivers of the same order, and the exact figure is
 * only visible against the MCU's own 25 Ω, which always wins a contest.
 */
export const R_PULLDOWN = 40
export const G_RELEASED = 1e-9

/**
 * What a behavioural device is doing to one of its signal nets.
 *
 *   'low'     — actively pulling the net down through R_PULLDOWN.
 *   'high'    — actively driving the net up to its own output voltage. Sensors
 *               with a push-pull output need this; an open-drain part never
 *               uses it.
 *   'release' — high impedance. The net is then owned by whatever else is on it
 *               (a pull-up, the MCU pin, nothing at all).
 */
export type DriveLevel = 'low' | 'high' | 'release'

/** What a device wants shown in the UI. Reported, never solved. */
export type DeviceState = Record<string, number | string | boolean>

export interface BehaviouralContext {
  cpu: CPU
  /**
   * Set this device's drive on one of ITS OWN signal nets, named by the pin id
   * the part declares (e.g. 'DATA', 'ECHO', 'OUT').
   *
   * Routed through the engine rather than written to the port directly, because
   * the memoisation cache is keyed on drive state (§2.4). A device that mutated
   * its port behind the cache's back would find every re-solve returning the
   * previous cached solution — which is exactly what happened: the DHT11 pulled
   * its line down and the solver kept reporting it high.
   *
   * `volts` is the device's own logic-high level, used only by 'high'. It is a
   * datasheet property of the part, not of the board: an HC-SR501 drives 3.3 V
   * even on a 5 V rail, and a sketch reading it has to cope with that.
   */
  drive(signal: string, level: DriveLevel, volts?: number): void
  /** Voltage on one of this device's nets at the last solve. 0 if unwired. */
  voltage(signal: string): number
  /** Live props from the document (sliders in the inspector). */
  props(): Record<string, number | string>
  /** Publish state for the engine snapshot. Reported only — never solved. */
  report(state: DeviceState): void
}

export interface BehaviouralDevice {
  readonly partId: string
  /** Called on every solve, so the device can watch its lines. */
  poll(): void
  /**
   * Optional: refresh REPORTED state at snapshot time. No electrical effect.
   * A device whose reading ages out (a buzzer that stopped being driven) needs
   * this, because solves only happen on pin edges and "nothing happened for
   * 100 ms" produces no edge to notice.
   */
  refresh?(): void
  /** Optional: cancel scheduled clock events before the device is discarded. */
  dispose?(): void
}

/** Whole cycles for a duration in microseconds, at least one. */
function cyclesFor(micros: number): number {
  return Math.max(1, Math.round((micros * CLOCK_HZ) / 1e6))
}

function numProp(p: Record<string, number | string>, key: string, fallback: number): number {
  const v = Number(p[key])
  return Number.isFinite(v) ? v : fallback
}

type Level = 'low' | 'release'

interface Step {
  micros: number
  level: Level
}

// ─── DHT11 ────────────────────────────────────────────────────────────────────

/**
 * DHT11 temperature/humidity sensor.
 *
 * Single-wire protocol, from the datasheet:
 *   - host pulls the line low for >=18 ms, then releases it
 *   - sensor answers 80 us low, 80 us high
 *   - then 40 bits, each 50 us low followed by 26-28 us high for 0 or 70 us
 *     high for 1
 *   - 5 bytes: humidity integer, humidity decimal, temperature integer,
 *     temperature decimal, checksum. A DHT11 always sends 0 for both decimals.
 *
 * The sensor is open-drain: it only ever pulls DOWN, and "releasing" means going
 * high-impedance and letting the host's pull-up raise the line. Modelling it as
 * a push-pull driver would fight the host instead of sharing the wire.
 */
export class DHT11 implements BehaviouralDevice {
  private seq: Step[] = []
  private step = -1
  private lowSinceCycle: number | null = null
  private wasLow = false
  private busy = false
  /** Last values published, so an unchanged reading costs no allocation. */
  private reported = { temperature: NaN, humidity: NaN }

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {
    // Start released; the host's pull-up owns the line at rest.
    ctx.drive('DATA', 'release')
  }

  dispose(): void {
    this.ctx.cpu.clearClockEvent(this.advance)
  }

  poll(): void {
    // poll() runs on EVERY solve, and a solve happens on every pin edge — Serial
    // TX alone is thousands a second. Publishing an unchanged reading would
    // allocate an object each time for nothing.
    const r = dht11Reading(this.ctx.props())
    if (r.temperature !== this.reported.temperature || r.humidity !== this.reported.humidity) {
      this.reported = r
      this.ctx.report({ ...r })
    }
    if (this.busy) return

    // A real DHT11 sees a logic low well below Vcc/2; 1.5 V is the datasheet's
    // worst-case VIL for a 5 V part.
    const low = this.ctx.voltage('DATA') < 1.5

    if (low && !this.wasLow) {
      this.lowSinceCycle = this.ctx.cpu.cycles
    } else if (!low && this.wasLow && this.lowSinceCycle !== null) {
      const heldMicros = ((this.ctx.cpu.cycles - this.lowSinceCycle) / CLOCK_HZ) * 1e6
      // The datasheet asks for >=18 ms. Accept a little less: libraries differ,
      // and a student whose timing is marginally short should still get an
      // answer rather than a silent failure they cannot diagnose.
      if (heldMicros >= 15_000) this.beginResponse()
      this.lowSinceCycle = null
    }
    this.wasLow = low
  }

  private beginResponse(): void {
    const p = this.ctx.props()
    const tempC = Math.round(numProp(p, 'temperature', 24))
    const humidity = Math.round(numProp(p, 'humidity', 45))

    const bytes = [humidity, 0, tempC, 0]
    const checksum = (bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff
    bytes.push(checksum)

    const seq: Step[] = [
      // Sensor acknowledges: pulls low 80 us, then lets the line rise 80 us.
      { micros: 30, level: 'release' },
      { micros: 80, level: 'low' },
      { micros: 80, level: 'release' },
    ]
    for (const byte of bytes) {
      for (let bit = 7; bit >= 0; bit--) {
        const one = (byte >> bit) & 1
        seq.push({ micros: 50, level: 'low' })
        seq.push({ micros: one ? 70 : 27, level: 'release' })
      }
    }
    // Final low before letting go of the bus.
    seq.push({ micros: 50, level: 'low' })
    seq.push({ micros: 0, level: 'release' })

    this.seq = seq
    this.step = -1
    this.busy = true
    this.advance()
  }

  /**
   * Play the next step, scheduling the one after it on the CPU clock.
   *
   * addClockEvent is what makes this exact: the transition lands on a specific
   * cycle rather than whenever a polling loop next happens to run, so a sketch
   * measuring pulse widths measures the real thing.
   */
  private advance = (): void => {
    this.step++
    if (this.step >= this.seq.length) {
      this.busy = false
      this.ctx.drive('DATA', 'release')
      this.wasLow = this.ctx.voltage('DATA') < 1.5
      return
    }

    const s = this.seq[this.step]
    this.ctx.drive('DATA', s.level)

    this.ctx.cpu.addClockEvent(this.advance, cyclesFor(s.micros))
  }
}

/** Reported so the UI can show what the sensor is currently sending. */
export function dht11Reading(props: Record<string, number | string>): {
  temperature: number
  humidity: number
} {
  return {
    temperature: Math.round(numProp(props, 'temperature', 24)),
    humidity: Math.round(numProp(props, 'humidity', 45)),
  }
}

// ─── HC-SR04 ultrasonic rangefinder ───────────────────────────────────────────

/**
 * HC-SR04 datasheet figures. Every one of these is quoted, not chosen.
 *
 * The 58 is the datasheet's own conversion ("uS / 58 = centimeter"), which is
 * the round trip at 340 m/s: 2 x 0.01 m / 340 = 58.8 us per cm, rounded down by
 * the manufacturer. Using the datasheet's number rather than the physics one is
 * deliberate — every published HC-SR04 sketch divides by 58 (or multiplies by
 * 0.034/2, which is the same thing), so the sensor and the sketch must agree on
 * the same rounding or a student sees a 1.4% error they cannot explain.
 */
export const HC_SR04 = {
  /** "uS / 58 = centimeter" — the ECHO pulse width for one cm of range. */
  MICROS_PER_CM: 58,
  /** "Ranging distance: 2cm – 400 cm". */
  MIN_CM: 2,
  MAX_CM: 400,
  /** "you only need to supply a short 10uS pulse to the trigger input". */
  TRIGGER_MICROS: 10,
  /**
   * "if no obstacle is detected, the output pin will give a 38ms high level
   * signal" — the module's own out-of-range marker.
   */
  NO_ECHO_MICROS: 38_000,
  /**
   * The module sends eight 40 kHz cycles before raising ECHO. The datasheet does
   * not name the turnaround; ~460 us is what the module measures on a scope. It
   * does not affect the reading, which is the ECHO pulse WIDTH.
   */
  BURST_MICROS: 460,
  /** "Working Voltage: DC 5 V". Below this the module does not run. */
  MIN_SUPPLY_VOLTS: 4.5,
  /** Push-pull ECHO output, driven from the module's own 5 V rail. */
  OUTPUT_HIGH_VOLTS: VCC,
} as const

/**
 * HC-SR04 ultrasonic rangefinder.
 *
 * TRIG is an input the sketch pulses; ECHO is a push-pull output the module
 * holds high for exactly `distance_cm x 58` microseconds. Both halves are real:
 * the trigger pulse is MEASURED off the solved net voltage (a sketch that
 * forgets delayMicroseconds(10) gets nothing back), and the echo is scheduled on
 * the CPU clock so pulseIn() measures a genuine pulse rather than a number we
 * handed it.
 */
export class HCSR04 implements BehaviouralDevice {
  /** Mid-rail TTL threshold for the TRIG input. */
  private static readonly TRIG_THRESHOLD = 2.5
  /**
   * Shortest TRIG pulse accepted, microseconds. The datasheet asks for 10; real
   * modules latch on rather less, and a sketch whose pulse is a microsecond
   * short should get an answer rather than a silent failure it cannot diagnose
   * — the same tolerance the DHT11 model extends to a short start pulse.
   */
  private static readonly MIN_TRIGGER_MICROS = 8

  private highSinceCycle: number | null = null
  private wasHigh = false
  private busy = false
  private echoMicros = 0

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {
    ctx.drive('ECHO', 'release')
  }

  dispose(): void {
    this.ctx.cpu.clearClockEvent(this.raiseEcho)
    this.ctx.cpu.clearClockEvent(this.dropEcho)
  }

  /** True when VCC is wired to a live rail. An unpowered module drives nothing. */
  private powered(): boolean {
    return this.ctx.voltage('VCC') >= HC_SR04.MIN_SUPPLY_VOLTS
  }

  /**
   * ECHO high time for the current distance prop, microseconds.
   *
   * Outside the module's 2–400 cm window there is no valid echo, and the
   * datasheet says exactly what the module does then: 38 ms high.
   */
  private echoMicrosFor(cm: number): number {
    if (!(cm >= HC_SR04.MIN_CM) || cm > HC_SR04.MAX_CM) return HC_SR04.NO_ECHO_MICROS
    return Math.round(cm * HC_SR04.MICROS_PER_CM)
  }

  poll(): void {
    const cm = numProp(this.ctx.props(), 'distance', 50)
    const powered = this.powered()
    this.ctx.report({
      distanceCm: cm,
      echoMicros: this.busy ? this.echoMicros : this.echoMicrosFor(cm),
      inRange: cm >= HC_SR04.MIN_CM && cm <= HC_SR04.MAX_CM,
      powered,
    })

    if (!powered) {
      this.ctx.drive('ECHO', 'release')
      this.wasHigh = false
      this.highSinceCycle = null
      return
    }
    if (this.busy) return
    // Idle ECHO is actively held LOW by the module, not left floating.
    this.ctx.drive('ECHO', 'low')

    const high = this.ctx.voltage('TRIG') > HCSR04.TRIG_THRESHOLD
    if (high && !this.wasHigh) {
      this.highSinceCycle = this.ctx.cpu.cycles
    } else if (!high && this.wasHigh && this.highSinceCycle !== null) {
      const heldMicros = ((this.ctx.cpu.cycles - this.highSinceCycle) / CLOCK_HZ) * 1e6
      if (heldMicros >= HCSR04.MIN_TRIGGER_MICROS) this.beginMeasurement(cm)
      this.highSinceCycle = null
    }
    this.wasHigh = high
  }

  private beginMeasurement(cm: number): void {
    this.echoMicros = this.echoMicrosFor(cm)
    this.busy = true
    this.ctx.cpu.addClockEvent(this.raiseEcho, cyclesFor(HC_SR04.BURST_MICROS))
  }

  private raiseEcho = (): void => {
    this.ctx.drive('ECHO', 'high', HC_SR04.OUTPUT_HIGH_VOLTS)
    this.ctx.cpu.addClockEvent(this.dropEcho, cyclesFor(this.echoMicros))
  }

  private dropEcho = (): void => {
    this.ctx.drive('ECHO', 'low')
    this.busy = false
    this.wasHigh = this.ctx.voltage('TRIG') > HCSR04.TRIG_THRESHOLD
  }
}

// ─── HC-SR501 PIR motion sensor ───────────────────────────────────────────────

/** HC-SR501 datasheet figures. */
export const HC_SR501 = {
  /** "Output: High 3.3 V / Low 0 V" — TTL, and NOT the 5 V supply rail. */
  OUTPUT_HIGH_VOLTS: 3.3,
  /** "Operating voltage range: DC 4.5-20 V". */
  MIN_SUPPLY_VOLTS: 4.5,
  /** Delay time Tx, adjustable 0.3 s – 200 s; ~5 s with the pot at minimum. */
  DEFAULT_HOLD_SECONDS: 5,
  /**
   * Block time Ti, fixed at 2.5 s: after OUT falls, the module ignores triggers
   * for this long. It is why a real PIR alarm cannot chatter.
   */
  BLOCK_SECONDS: 2.5,
  /** "Induction block time... 30-60 s" of settling after power-on. */
  TYPICAL_WARMUP_SECONDS: 60,
} as const

/**
 * A behavioural device whose output depends on a PROP rather than on a pin is
 * invisible to the engine's edge-driven scheduler: nothing the sketch does makes
 * the "motion" slider move, so nothing schedules a re-poll. These devices tick
 * themselves on the CPU clock instead. 1 ms of SIMULATED time is far finer than
 * any human slider movement and costs one linked-list check per millisecond.
 */
const SELF_TICK_MICROS = 1000

/**
 * HC-SR501 passive infra-red motion sensor.
 *
 * Retriggerable (H jumper, the factory position): OUT goes high on detection and
 * stays high until `hold` seconds after motion stops, then falls and blocks for
 * the fixed 2.5 s Ti. The 3.3 V output level is a real trap the model keeps —
 * it is above the ATmega's 3.0 V VIH, but only just.
 *
 * WARM-UP: a real HC-SR501 needs 30-60 s of settling after power-on, during
 * which its output is unreliable. Simulating that by default would mean a
 * student stares at a dead circuit for a minute before anything can happen, so
 * the `warmup` prop DEFAULTS TO 0 (disabled). The mechanism is real and the
 * student can dial in up to the datasheet's 60 s; during warm-up this model
 * holds OUT low, where a real module emits spurious highs.
 */
export class PIRSensor implements BehaviouralDevice {
  private high = false
  private holdUntilCycle = 0
  private blockedUntilCycle = 0
  private disposed = false

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {
    ctx.drive('OUT', 'release')
    ctx.cpu.addClockEvent(this.tick, cyclesFor(SELF_TICK_MICROS))
  }

  dispose(): void {
    this.disposed = true
    this.ctx.cpu.clearClockEvent(this.tick)
  }

  private tick = (): void => {
    if (this.disposed) return
    this.poll()
    this.ctx.cpu.addClockEvent(this.tick, cyclesFor(SELF_TICK_MICROS))
  }

  poll(): void {
    const p = this.ctx.props()
    const now = this.ctx.cpu.cycles
    const powered = this.ctx.voltage('VCC') >= HC_SR501.MIN_SUPPLY_VOLTS
    const warmupSeconds = Math.max(0, numProp(p, 'warmup', 0))
    const warmupCycles = warmupSeconds * CLOCK_HZ
    const warming = now < warmupCycles
    const holdSeconds = Math.max(0.3, numProp(p, 'hold', HC_SR501.DEFAULT_HOLD_SECONDS))
    const motion = numProp(p, 'motion', 0) >= 0.5

    if (!powered) {
      this.high = false
      this.ctx.drive('OUT', 'release')
    } else if (warming) {
      this.high = false
      this.ctx.drive('OUT', 'low')
    } else {
      if (motion && now >= this.blockedUntilCycle) {
        // Retriggerable: every moment of motion pushes the hold window out.
        this.high = true
        this.holdUntilCycle = now + holdSeconds * CLOCK_HZ
      } else if (this.high && now >= this.holdUntilCycle) {
        this.high = false
        this.blockedUntilCycle = now + HC_SR501.BLOCK_SECONDS * CLOCK_HZ
      }
      this.ctx.drive('OUT', this.high ? 'high' : 'low', HC_SR501.OUTPUT_HIGH_VOLTS)
    }

    this.ctx.report({
      motion: this.high,
      warming,
      warmupRemaining: warming ? (warmupCycles - now) / CLOCK_HZ : 0,
      holdSeconds,
      powered,
    })
  }
}

// ─── YF-S201 hall-effect water flow sensor ────────────────────────────────────

/** YF-S201 datasheet figures. */
export const YF_S201 = {
  /** "F = 7.5 x Q (L/min)" — the sensor's whole transfer function. */
  HZ_PER_LPM: 7.5,
  /** 450 pulses per litre, i.e. 7.5 Hz x 60 s. */
  PULSES_PER_LITRE: 450,
  /** "Flow rate range: 1-30 L/min". */
  MIN_LPM: 1,
  MAX_LPM: 30,
  /** "Working voltage: DC 5-18 V". */
  MIN_SUPPLY_VOLTS: 4.5,
  /** "Duty ratio: 50% +/- 10%". */
  DUTY: 0.5,
} as const

/**
 * YF-S201 water flow sensor.
 *
 * A turbine spins a magnet past a hall-effect switch, whose NPN open-collector
 * output pulls the signal line down once per revolution. Open-collector is why
 * the wiring needs a pull-up (or INPUT_PULLUP): the sensor can only pull DOWN.
 *
 * The pulse train is generated on the CPU clock, so an interrupt-driven sketch
 * counting FALLING edges counts real edges — the pulse count and the frequency
 * are the same object, not two numbers that could drift apart.
 */
export class FlowSensor implements BehaviouralDevice {
  private low = false
  private pulses = 0
  private disposed = false

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {
    ctx.drive('SIG', 'release')
    ctx.cpu.addClockEvent(this.edge, cyclesFor(SELF_TICK_MICROS))
  }

  dispose(): void {
    this.disposed = true
    this.ctx.cpu.clearClockEvent(this.edge)
  }

  /** Output frequency for the current flow prop, hertz. F = 7.5 x Q. */
  private hertz(): number {
    const lpm = Math.max(0, numProp(this.ctx.props(), 'flow', 0))
    return lpm * YF_S201.HZ_PER_LPM
  }

  private edge = (): void => {
    if (this.disposed) return
    const powered = this.ctx.voltage('VCC') >= YF_S201.MIN_SUPPLY_VOLTS
    const hz = this.hertz()

    if (!powered || hz <= 0) {
      // Still water, or no supply: the hall switch is off and the line floats up
      // to whatever pull-up the student wired. Keep ticking so a change to the
      // flow slider is noticed.
      if (this.low) {
        this.low = false
        this.ctx.drive('SIG', 'release')
      }
      this.ctx.cpu.addClockEvent(this.edge, cyclesFor(SELF_TICK_MICROS))
      this.publish(0)
      return
    }

    this.low = !this.low
    if (this.low) this.pulses++
    this.ctx.drive('SIG', this.low ? 'low' : 'release')

    // Half a period per edge, 50% duty as the datasheet specifies.
    const halfCycles = Math.max(1, Math.round(CLOCK_HZ / (2 * hz)))
    this.ctx.cpu.addClockEvent(this.edge, halfCycles)
    this.publish(hz)
  }

  private publish(hz: number): void {
    this.ctx.report({
      litresPerMinute: hz / YF_S201.HZ_PER_LPM,
      hertz: hz,
      pulses: this.pulses,
      litres: this.pulses / YF_S201.PULSES_PER_LITRE,
      inRange: hz === 0 || (hz >= YF_S201.MIN_LPM * YF_S201.HZ_PER_LPM &&
        hz <= YF_S201.MAX_LPM * YF_S201.HZ_PER_LPM),
    })
  }

  poll(): void {
    // Purely self-clocked: nothing on the wire changes what the turbine does.
  }
}

// ─── Buzzer drive monitor ─────────────────────────────────────────────────────

/**
 * How the buzzer decides it is being driven. Same shape as the MCU's own input
 * model (§2.6): a deadband, because a node parked near mid-rail would otherwise
 * chatter across the threshold on every re-solve and invent a megahertz tone.
 */
const BUZZ_VIL = 0.3 * VCC
const BUZZ_VIH = 0.6 * VCC

/**
 * Silence timeout. A pin that stops toggling produces no further edge, so the
 * last measured frequency has to age out on its own. 100 ms is longer than the
 * period of the lowest note tone() will play (31 Hz -> 32 ms), so a real low
 * tone is never mistaken for silence, and shorter than one blink of the UI.
 */
const BUZZ_SILENCE_CYCLES = CLOCK_HZ * 0.1

/**
 * Reports what a buzzer is actually doing, from the voltage across it.
 *
 * This is a MONITOR, not a driver: it never touches the net. It exists because
 * "buzzing" is a property of the drive waveform in TIME, and a DC operating
 * point has no opinion about time. Measuring the period between rising edges on
 * the solved terminal voltage is the honest way to get it — the pitch reported
 * is the pitch the student's own tone() call produced, not a number copied out
 * of their sketch.
 *
 * No audio is synthesised. The state is reported and the UI shows it.
 */
export class BuzzerMonitor implements BehaviouralDevice {
  private high = false
  private lastRiseCycle: number | null = null
  private lastEdgeCycle: number | null = null
  private hz = 0
  private volts = 0

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
    /** Datasheet numbers for the part; see BuzzerParams in devices.ts. */
    private spec: { oscillatorHz: number; minOperatingVolts: number },
  ) {}

  private passive(): boolean {
    return numProp(this.ctx.props(), 'passive', 0) >= 0.5
  }

  poll(): void {
    const v = this.ctx.voltage('P') - this.ctx.voltage('N')
    this.volts = v
    const high = this.high ? v > BUZZ_VIL : v > BUZZ_VIH
    if (high !== this.high) {
      this.high = high
      const now = this.ctx.cpu.cycles
      this.lastEdgeCycle = now
      if (high) {
        if (this.lastRiseCycle !== null && now > this.lastRiseCycle) {
          this.hz = CLOCK_HZ / (now - this.lastRiseCycle)
        }
        this.lastRiseCycle = now
      }
    }
    this.publish()
  }

  refresh(): void {
    this.publish()
  }

  private publish(): void {
    const now = this.ctx.cpu.cycles
    const stale =
      this.lastEdgeCycle === null || now - this.lastEdgeCycle > BUZZ_SILENCE_CYCLES
    const passive = this.passive()

    let sounding: boolean
    let hertz: number
    if (passive) {
      // A piezo element only moves when the voltage across it CHANGES. Held at a
      // steady 5 V it clicks once and then is silent — which is exactly why
      // digitalWrite() on a passive buzzer disappoints every student once.
      sounding = !stale && this.hz > 0
      hertz = sounding ? this.hz : 0
    } else {
      // An active buzzer carries its own oscillator: energise it above its
      // minimum operating voltage and it sounds at its own fixed pitch, whatever
      // the drive waveform is doing.
      sounding = Math.abs(this.volts) >= this.spec.minOperatingVolts
      hertz = sounding ? this.spec.oscillatorHz : 0
    }

    this.ctx.report({
      sounding,
      hertz,
      passive,
      volts: this.volts,
      /** Measured drive frequency, whether or not it makes a sound. */
      driveHertz: stale ? 0 : this.hz,
    })
  }
}

// ─── DS18B20 1-Wire temperature sensor ────────────────────────────────────────

/**
 * DS18B20 datasheet figures. Every one is quoted, none is tuned.
 *
 * The timing numbers below are the ones a real driver's delays are written
 * against, so they are the contract this model has to satisfy. MicroPython's
 * `onewire` module — frozen into the Pico firmware, so a student cannot avoid
 * it — bit-bangs a 480 µs reset, samples the presence pulse 70 µs after
 * releasing, writes a 1 as a 1 µs low and a 0 as a 60 µs low, and reads by
 * pulsing low ~6 µs and sampling at ~15 µs. Every one of those lands inside the
 * windows below, and onewire.test.ts drives this model with exactly those
 * timings rather than with convenient ones.
 */
export const DS18B20 = {
  /** Family code. ds18x20.py filters scan() results on 0x10/0x22/0x28. */
  FAMILY_CODE: 0x28,
  /** tRSTL — the master's reset low, 480 µs minimum. */
  RESET_LOW_MICROS: 480,
  /**
   * How much short of tRSTL a reset is still accepted.
   *
   * The DHT11 model extends the same courtesy to a short start pulse and for
   * the same reason: libraries differ, and a student whose pulse is marginally
   * short deserves an answer rather than a silent failure they cannot diagnose.
   * 10 % of 480 µs is 432 µs, which is still 3.6x the LONGEST write-zero slot
   * the datasheet permits (120 µs), so a data slot can never be mistaken for a
   * reset no matter how slow the master is.
   */
  RESET_TOLERANCE: 0.9,
  /** tPDHIGH — 15–60 µs of bus-high before the device answers. */
  PRESENCE_DELAY_MICROS: 30,
  /** tPDLOW — the presence pulse itself, 60–240 µs. */
  PRESENCE_LOW_MICROS: 120,
  /**
   * Where in a write slot the device samples the bus. The datasheet's sampling
   * window is 15–60 µs after the falling edge; 30 µs is the middle of it, which
   * is also where the typical figure sits.
   */
  WRITE_SAMPLE_MICROS: 30,
  /**
   * How long the device holds the bus down for a transmitted 0.
   *
   * tRDV says the master must sample within 15 µs of the falling edge, so the
   * bit has to be valid at least that long. 30 µs is twice that and still
   * inside the 60 µs minimum read slot, leaving the bus free well before the
   * next slot can begin.
   */
  READ_HOLD_MICROS: 30,
  /** tCONV at 12-bit resolution, milliseconds. Halves per bit dropped. */
  CONVERT_MILLIS_12BIT: 750,
  /** EEPROM write time for COPY SCRATCHPAD, 10 ms maximum. */
  COPY_MILLIS: 10,
  /** DC characteristics: VIL max 0.8 V, VIH min 2.2 V. */
  VIL: 0.8,
  VIH: 2.2,
  /** "Supply voltage: 3.0 V to 5.5 V". */
  MIN_SUPPLY_VOLTS: 3.0,
  MAX_SUPPLY_VOLTS: 5.5,
  /** Measurement range and quantum: −55 to +125 °C in 1/16 °C steps. */
  MIN_C: -55,
  MAX_C: 125,
  STEP_C: 1 / 16,
  /**
   * Power-on value of the temperature register: +85.0 °C = 0x0550.
   *
   * This is the single most useful fault in the whole part. A driver that reads
   * the scratchpad without waiting for the conversion gets exactly 85.0 °C, and
   * every 1-Wire tutorial on the internet has a paragraph about it. Seeding the
   * register with the real value is what lets a student meet that bug here.
   */
  POWER_ON_RAW: 0x0550,
  /** Datasheet power-on alarm thresholds: TH = +75 °C, TL = +70 °C. */
  DEFAULT_TH: 0x4b,
  DEFAULT_TL: 0x46,
  /** ROM commands. */
  READ_ROM: 0x33,
  MATCH_ROM: 0x55,
  SKIP_ROM: 0xcc,
  SEARCH_ROM: 0xf0,
  ALARM_SEARCH: 0xec,
  /** Function commands. */
  CONVERT_T: 0x44,
  WRITE_SCRATCHPAD: 0x4e,
  READ_SCRATCHPAD: 0xbe,
  COPY_SCRATCHPAD: 0x48,
  RECALL_E2: 0xb8,
  READ_POWER_SUPPLY: 0xb4,
} as const

/**
 * Dallas/Maxim CRC-8: x^8 + x^5 + x^4 + 1, i.e. polynomial 0x31, LSB first.
 *
 * 0x8C is 0x31 with its bits reversed, which is what an LSB-first shift needs —
 * feeding the data in least-significant-bit first means the polynomial has to
 * be reflected too. Getting that backwards produces a CRC that looks perfectly
 * plausible and fails on every real part, so the reflection is spelled out
 * rather than left as a magic constant, and onewire.test.ts recomputes the
 * expected values by a completely different route (MSB-first long division over
 * reversed input) instead of trusting this function.
 *
 * The property every driver actually relies on: running the CRC over the data
 * AND its appended CRC byte yields 0. MicroPython's ds18x20.read_scratch() does
 * exactly `if self.ow.crc8(self.buf): raise Exception("CRC error")`.
 */
export function oneWireCrc8(bytes: ArrayLike<number>): number {
  let crc = 0
  for (let i = 0; i < bytes.length; i++) {
    let b = bytes[i] & 0xff
    for (let bit = 0; bit < 8; bit++) {
      const mix = (crc ^ b) & 1
      crc >>= 1
      if (mix) crc ^= 0x8c
      b >>= 1
    }
  }
  return crc & 0xff
}

/**
 * Encode a temperature as the DS18B20's 16-bit register value.
 *
 * The format is two's complement in units of 1/16 °C, so +25.0625 °C is
 * 25.0625 × 16 = 401 = 0x0191 and −25.0625 °C is 0xFE6F. At less than 12-bit
 * resolution the datasheet says the undefined low bits READ AS ZERO, which for
 * a two's-complement number is truncation toward −∞ — masking them is not an
 * approximation, it is the specified behaviour.
 */
export function ds18b20Raw(celsius: number, bits = 12): number {
  const c = Math.min(DS18B20.MAX_C, Math.max(DS18B20.MIN_C, celsius))
  const raw = Math.round(c / DS18B20.STEP_C) & 0xffff
  const undefinedBits = Math.min(3, Math.max(0, 12 - bits))
  return raw & (0xffff ^ ((1 << undefinedBits) - 1)) & 0xffff
}

/** Decode a 16-bit register value back to °C, as ds18x20.py's read_temp does. */
export function ds18b20Celsius(raw: number): number {
  const r = raw & 0xffff
  return (r & 0x8000 ? r - 0x10000 : r) * DS18B20.STEP_C
}

/**
 * Configuration register byte for a resolution in bits.
 *
 * Bit 7 is 0, bits 6:5 are R1:R0, bits 4:0 read as 1 — so 9/10/11/12 bits are
 * 0x1F/0x3F/0x5F/0x7F.
 */
export function ds18b20ConfigByte(bits: number): number {
  const b = Math.min(12, Math.max(9, Math.round(bits)))
  return ((b - 9) << 5) | 0x1f
}

/** Resolution in bits encoded in a configuration register byte. */
export function ds18b20Resolution(config: number): number {
  return 9 + ((config >> 5) & 0b11)
}

/**
 * A deterministic 64-bit ROM code for one placed part.
 *
 * A real DS18B20 carries a laser-etched serial; the model derives one from the
 * part's document id so that two sensors on the same bus are distinguishable
 * (which is the entire point of SEARCH ROM) and so the same saved circuit
 * always produces the same addresses. Byte 0 is the family code, bytes 1–6 the
 * serial, byte 7 the CRC-8 of the first seven — computed, so a driver that
 * checks the ROM CRC is satisfied.
 */
export function ds18b20Rom(partId: string): Uint8Array {
  let h = 0x811c9dc5
  for (let i = 0; i < partId.length; i++) {
    h = Math.imul(h ^ partId.charCodeAt(i), 0x01000193) >>> 0
  }
  const rom = new Uint8Array(8)
  rom[0] = DS18B20.FAMILY_CODE
  let g = h
  for (let k = 1; k <= 6; k++) {
    rom[k] = g & 0xff
    g = (Math.imul(g ^ (g >>> 13), 0x85ebca6b) >>> 0) || 0x9e3779b9
  }
  rom[7] = oneWireCrc8(rom.subarray(0, 7))
  return rom
}

/** Where the bus state machine has got to. */
type OwPhase =
  | 'idle'
  | 'rom'
  | 'match'
  | 'search'
  | 'func'
  | 'write'
  | 'send'
  | 'status'
  | 'ignored'

/**
 * DS18B20 programmable-resolution 1-Wire digital thermometer.
 *
 * This is a protocol device, not a reading: it implements enough of the Dallas
 * 1-Wire bus that a REAL driver talks to it. That is not a preference — the
 * Pico firmware has `onewire` and `ds18x20` frozen in, so the student's
 * `ds18x20.DS18X20(onewire.OneWire(Pin(4)))` is the only client this will ever
 * have, and it does the whole dance: reset/presence, SEARCH ROM to enumerate,
 * MATCH ROM to address, CONVERT T, READ SCRATCHPAD, and a CRC-8 check that
 * raises on failure.
 *
 * Implemented: reset + presence, READ ROM, MATCH ROM, SKIP ROM, SEARCH ROM,
 * ALARM SEARCH, CONVERT T (with its real conversion time and busy polling),
 * READ SCRATCHPAD, WRITE SCRATCHPAD, COPY SCRATCHPAD, RECALL E2 and READ POWER
 * SUPPLY, over a nine-byte scratchpad with a computed CRC.
 *
 * OPEN DRAIN, ALWAYS. The device pulls the line DOWN or lets go; it never
 * drives high. The line only comes back up through the external pull-up the
 * experiment specifies (4.7 kΩ), so a student who omits it gets a bus stuck
 * low, no presence pulse, and `OneWireError` — which is exactly what happens on
 * a breadboard, and is reported through `busIdleHigh` so the UI can say why.
 *
 * MULTI-DROP WORKS, and it works for the right reason. Several of these on one
 * net each drive their own Norton port; the solver's node voltage IS the
 * wired-AND, so during a SEARCH ROM two devices disagreeing about a bit really
 * do pull the bus low in both halves of the triplet and the master really does
 * see a collision.
 *
 * HONEST LIMITATIONS:
 *
 *   - PARASITE POWER IS NOT MODELLED. The device needs VDD in its 3.0–5.5 V
 *     window; wiring VDD to ground and stealing power from the bus (which a
 *     real DS18B20 supports, and which needs the master to hold a strong
 *     pull-up during conversion) reports as unpowered. Guessing instead would
 *     turn "you forgot the VDD wire" into a circuit that works.
 *   - The EEPROM is not persistent: COPY SCRATCHPAD takes its 10 ms and RECALL
 *     E2 returns immediately, but nothing survives a rebuild of the part.
 *   - Self-heating, conversion noise and the ±0.5 °C accuracy spec are not
 *     modelled; the sensor reports exactly the temperature the slider asks for,
 *     quantised to the configured resolution.
 */
export class DS18B20Sensor implements BehaviouralDevice {
  private readonly rom: Uint8Array
  private readonly scratch = new Uint8Array(9)

  private phase: OwPhase = 'idle'
  /** Bits received in the current field, in arrival (LSB-first) order. */
  private rx: number[] = []
  /** Bits queued for transmission, in transmission order. */
  private tx: number[] = []
  private txAt = 0
  /** SEARCH ROM: which ROM bit, and where in its send/send-complement/receive. */
  private searchBit = 0
  private searchStep: 0 | 1 | 2 = 0
  private alarmSearch = false

  /** Our own drive on DQ. While 'low' the bus tells us nothing about the master. */
  private driving: 'low' | 'release' = 'release'
  private busLow = false
  /** Cycle at which the bus last went low, or null if the master has released. */
  private masterLowSince: number | null = null
  private samplePending = false

  /** Cycle at which the conversion in flight finishes. */
  private busyUntilCycle = 0
  /** Conversion result, held back until the conversion actually completes. */
  private pendingRaw: number | null = null
  /** True once a driver has written the configuration register itself. */
  private configWritten = false
  private disposed = false
  private lastReport = ''

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {
    this.rom = ds18b20Rom(partId)
    this.scratch[0] = DS18B20.POWER_ON_RAW & 0xff
    this.scratch[1] = (DS18B20.POWER_ON_RAW >> 8) & 0xff
    this.scratch[2] = DS18B20.DEFAULT_TH
    this.scratch[3] = DS18B20.DEFAULT_TL
    this.scratch[4] = ds18b20ConfigByte(12)
    // Datasheet: byte 5 reads FFh and byte 7 reads 10h; byte 6 is reserved and
    // unspecified. No driver reads any of them — but the CRC covers them, so
    // they have to be something fixed or the checksum would not close.
    this.scratch[5] = 0xff
    this.scratch[6] = 0x00
    this.scratch[7] = 0x10
    this.scratch[8] = oneWireCrc8(this.scratch.subarray(0, 8))
    ctx.drive('DQ', 'release')
  }

  dispose(): void {
    this.disposed = true
    this.ctx.cpu.clearClockEvent(this.presenceStart)
    this.ctx.cpu.clearClockEvent(this.presenceEnd)
    this.ctx.cpu.clearClockEvent(this.sampleWriteBit)
    this.ctx.cpu.clearClockEvent(this.releaseReadBit)
  }

  /** The 64-bit address this device answers to. */
  get romCode(): Uint8Array {
    return this.rom
  }

  /** A live view of the scratchpad, CRC included. */
  get scratchpad(): Uint8Array {
    this.commitConversion()
    return this.scratch
  }

  private powered(): boolean {
    const v = this.ctx.voltage('VDD')
    return v >= DS18B20.MIN_SUPPLY_VOLTS && v <= DS18B20.MAX_SUPPLY_VOLTS
  }

  private resolutionBits(): number {
    return ds18b20Resolution(this.scratch[4])
  }

  /** tCONV for the configured resolution, in whole CPU cycles. */
  private convertCycles(): number {
    const millis = DS18B20.CONVERT_MILLIS_12BIT / Math.pow(2, 12 - this.resolutionBits())
    return cyclesFor(millis * 1000)
  }

  private busy(): boolean {
    return this.ctx.cpu.cycles < this.busyUntilCycle
  }

  /** Publish a finished conversion into the scratchpad and refresh the CRC. */
  private commitConversion(): void {
    if (this.pendingRaw !== null && !this.busy()) {
      this.scratch[0] = this.pendingRaw & 0xff
      this.scratch[1] = (this.pendingRaw >> 8) & 0xff
      this.pendingRaw = null
    }
    this.scratch[8] = oneWireCrc8(this.scratch.subarray(0, 8))
  }

  // ─── Bus level ────────────────────────────────────────────────────────────

  private romBit(index: number): number {
    return (this.rom[index >> 3] >> (index & 7)) & 1
  }

  private driveLow(): void {
    this.driving = 'low'
    this.ctx.drive('DQ', 'low')
  }

  private release(): void {
    this.driving = 'release'
    this.ctx.drive('DQ', 'release')
  }

  /**
   * Watch the wire.
   *
   * Returns immediately while WE are pulling the line down: our own pull-down
   * masks the master completely, so anything read there would be our own
   * reflection. `masterLowSince` is deliberately NOT cleared when we start
   * driving — if the master is holding a reset low through one of our read
   * slots, the width measured at its release has to be the master's full low,
   * not the fragment after we let go.
   */
  private observe(): void {
    if (this.driving === 'low') return
    const v = this.ctx.voltage('DQ')
    const low = this.busLow ? v < DS18B20.VIH : v < DS18B20.VIL
    if (low === this.busLow) return
    this.busLow = low
    if (low) {
      this.masterLowSince = this.ctx.cpu.cycles
      this.onMasterFalling()
    } else {
      this.onMasterRising()
    }
  }

  private onMasterFalling(): void {
    if (!this.powered()) return
    // A slot that arrives before the previous one's sample point can only mean
    // the previous low was short — i.e. a 1 — because the line had to rise for
    // this edge to exist at all. Resolve it now rather than sampling this slot's
    // low and recording the previous bit as a 0.
    if (this.samplePending) {
      this.ctx.cpu.clearClockEvent(this.sampleWriteBit)
      this.samplePending = false
      this.receiveBit(1)
    }

    if (this.isSending()) {
      const bit = this.sendingBit()
      // A 1 is sent by doing nothing: the pull-up carries the line high, which
      // is the whole grammar of an open-drain bus.
      if (bit === 0) {
        this.driveLow()
        this.ctx.cpu.addClockEvent(this.releaseReadBit, cyclesFor(DS18B20.READ_HOLD_MICROS))
      }
      this.advanceSend()
    } else if (this.isReceiving()) {
      this.samplePending = true
      this.ctx.cpu.addClockEvent(this.sampleWriteBit, cyclesFor(DS18B20.WRITE_SAMPLE_MICROS))
    }
  }

  private onMasterRising(): void {
    const since = this.masterLowSince
    this.masterLowSince = null
    if (since === null || !this.powered()) return
    const micros = ((this.ctx.cpu.cycles - since) / CLOCK_HZ) * 1e6
    if (micros >= DS18B20.RESET_LOW_MICROS * DS18B20.RESET_TOLERANCE) this.beginPresence()
  }

  // ─── Scheduled transitions ────────────────────────────────────────────────

  private sampleWriteBit = (): void => {
    if (this.disposed || !this.samplePending) return
    this.samplePending = false
    // `busLow` is the hysteretic bus level maintained by observe(), which the
    // engine refreshes after every solve — so this is the level of the wire at
    // this instant, sampled where the datasheet says the device samples it.
    this.receiveBit(this.busLow ? 0 : 1)
  }

  private releaseReadBit = (): void => {
    if (this.disposed) return
    this.release()
  }

  private beginPresence(): void {
    this.ctx.cpu.clearClockEvent(this.sampleWriteBit)
    this.ctx.cpu.clearClockEvent(this.presenceStart)
    this.ctx.cpu.clearClockEvent(this.presenceEnd)
    this.ctx.cpu.clearClockEvent(this.releaseReadBit)
    this.samplePending = false
    this.release()
    // A conversion already in flight is NOT cancelled: the datasheet's own
    // usage is convert, wait, reset, read, and a driver that polls the bus for
    // completion must not restart the clock every time it does.
    this.phase = 'idle'
    this.rx = []
    this.tx = []
    this.txAt = 0
    this.searchBit = 0
    this.searchStep = 0
    this.alarmSearch = false
    this.ctx.cpu.addClockEvent(this.presenceStart, cyclesFor(DS18B20.PRESENCE_DELAY_MICROS))
  }

  private presenceStart = (): void => {
    if (this.disposed || !this.powered()) return
    this.driveLow()
    this.ctx.cpu.addClockEvent(this.presenceEnd, cyclesFor(DS18B20.PRESENCE_LOW_MICROS))
  }

  private presenceEnd = (): void => {
    if (this.disposed) return
    this.release()
    this.phase = 'rom'
  }

  // ─── Protocol ─────────────────────────────────────────────────────────────

  private isSending(): boolean {
    return (
      this.phase === 'send' ||
      this.phase === 'status' ||
      (this.phase === 'search' && this.searchStep < 2)
    )
  }

  private isReceiving(): boolean {
    return (
      this.phase === 'rom' ||
      this.phase === 'func' ||
      this.phase === 'match' ||
      this.phase === 'write' ||
      (this.phase === 'search' && this.searchStep === 2)
    )
  }

  /** The bit this device puts on the wire for the slot just started. */
  private sendingBit(): number {
    if (this.phase === 'status') {
      // While converting the device answers 0; when it is done, 1. That is the
      // whole "poll for completion" mechanism, and it is why a driver can skip
      // the fixed 750 ms wait.
      return this.busy() ? 0 : 1
    }
    if (this.phase === 'search') {
      const b = this.romBit(this.searchBit)
      return this.searchStep === 0 ? b : b ^ 1
    }
    return this.tx[this.txAt] ?? 1
  }

  private advanceSend(): void {
    if (this.phase === 'send') {
      this.txAt++
      // Run off the end of the queue and the transaction is over: the master
      // must reset before anything else can happen.
      if (this.txAt >= this.tx.length) this.phase = 'idle'
    } else if (this.phase === 'search') {
      this.searchStep = this.searchStep === 0 ? 1 : 2
    }
  }

  private receiveBit(bit: number): void {
    switch (this.phase) {
      case 'rom':
        this.rx.push(bit)
        if (this.rx.length === 8) {
          const cmd = bitsToByte(this.rx)
          this.rx = []
          this.onRomCommand(cmd)
        }
        break
      case 'func':
        this.rx.push(bit)
        if (this.rx.length === 8) {
          const cmd = bitsToByte(this.rx)
          this.rx = []
          this.onFunctionCommand(cmd)
        }
        break
      case 'match':
        if (bit !== this.romBit(this.rx.length)) {
          // Addressed to somebody else. Go silent until the next reset — which
          // is exactly what makes MATCH ROM work on a shared bus.
          this.phase = 'ignored'
          this.rx = []
          return
        }
        this.rx.push(bit)
        if (this.rx.length === 64) {
          this.rx = []
          this.phase = 'func'
        }
        break
      case 'write':
        this.rx.push(bit)
        if (this.rx.length === 24) {
          this.scratch[2] = bitsToByte(this.rx.slice(0, 8))
          this.scratch[3] = bitsToByte(this.rx.slice(8, 16))
          this.scratch[4] = ds18b20ConfigByte(ds18b20Resolution(bitsToByte(this.rx.slice(16, 24))))
          this.configWritten = true
          this.rx = []
          this.commitConversion()
          this.phase = 'idle'
        }
        break
      case 'search':
        // Third slot of the triplet: the master says which branch it is taking.
        if (bit !== this.romBit(this.searchBit)) {
          this.phase = 'ignored'
          return
        }
        this.searchBit++
        this.searchStep = 0
        if (this.searchBit === 64) this.phase = 'func'
        break
      default:
        break
    }
  }

  private onRomCommand(cmd: number): void {
    switch (cmd) {
      case DS18B20.SKIP_ROM:
        this.phase = 'func'
        break
      case DS18B20.MATCH_ROM:
        this.phase = 'match'
        this.rx = []
        break
      case DS18B20.READ_ROM:
        this.beginSend(Array.from(this.rom))
        break
      case DS18B20.SEARCH_ROM:
      case DS18B20.ALARM_SEARCH:
        this.alarmSearch = cmd === DS18B20.ALARM_SEARCH
        // An ALARM SEARCH is answered only by devices whose last conversion was
        // outside TH/TL. A device with nothing to report stays off the bus, so
        // the master's search finds nobody — which is the point of the command.
        this.phase = this.alarmSearch && !this.alarmSet() ? 'ignored' : 'search'
        this.searchBit = 0
        this.searchStep = 0
        break
      default:
        this.phase = 'idle'
        break
    }
  }

  private onFunctionCommand(cmd: number): void {
    switch (cmd) {
      case DS18B20.CONVERT_T: {
        // The conversion samples the world NOW and lands in the scratchpad when
        // it finishes, not before — which is what makes the 85 °C bug real.
        const bits = this.resolutionBits()
        this.pendingRaw = ds18b20Raw(
          numProp(this.ctx.props(), 'temperature', 25),
          bits,
        )
        this.busyUntilCycle = this.ctx.cpu.cycles + this.convertCycles()
        this.phase = 'status'
        break
      }
      case DS18B20.READ_SCRATCHPAD:
        this.commitConversion()
        this.beginSend(Array.from(this.scratch))
        break
      case DS18B20.WRITE_SCRATCHPAD:
        this.phase = 'write'
        this.rx = []
        break
      case DS18B20.COPY_SCRATCHPAD:
        this.busyUntilCycle = this.ctx.cpu.cycles + cyclesFor(DS18B20.COPY_MILLIS * 1000)
        this.phase = 'status'
        break
      case DS18B20.RECALL_E2:
        // No persistent EEPROM to recall from, so the recall is instantaneous
        // and the status bit reads done immediately.
        this.phase = 'status'
        break
      case DS18B20.READ_POWER_SUPPLY:
        // A parasite-powered device answers 0 by pulling the line down. This
        // model is externally powered, so it answers 1 by doing nothing.
        this.beginSendBits([1])
        break
      default:
        this.phase = 'idle'
        break
    }
  }

  /** True when the last conversion was outside the TH/TL alarm window. */
  private alarmSet(): boolean {
    const c = ds18b20Celsius((this.scratch[1] << 8) | this.scratch[0])
    const th = signedByte(this.scratch[2])
    const tl = signedByte(this.scratch[3])
    return c > th || c < tl
  }

  private beginSend(bytes: number[]): void {
    const bits: number[] = []
    for (const b of bytes) for (let i = 0; i < 8; i++) bits.push((b >> i) & 1)
    this.beginSendBits(bits)
  }

  private beginSendBits(bits: number[]): void {
    this.tx = bits
    this.txAt = 0
    this.phase = 'send'
  }

  // ─── Engine hooks ─────────────────────────────────────────────────────────

  /**
   * Follow the `resolution` prop until a driver takes the register over.
   *
   * The configuration register belongs to whoever wrote it last. Until a
   * program issues WRITE SCRATCHPAD the register is just a factory setting, so
   * the inspector slider owns it; the moment a driver writes its own, the
   * slider must stop overriding it or the program's own configuration would be
   * silently undone on the next poll.
   */
  private applyResolutionProp(): void {
    if (this.configWritten) return
    const cfg = ds18b20ConfigByte(numProp(this.ctx.props(), 'resolution', 12))
    if (cfg !== this.scratch[4]) this.scratch[4] = cfg
  }

  poll(): void {
    if (!this.powered()) {
      if (this.driving === 'low') this.release()
      this.phase = 'idle'
      this.busLow = false
      this.masterLowSince = null
      this.publish()
      return
    }
    this.applyResolutionProp()
    this.observe()
    this.publish()
  }

  refresh(): void {
    this.publish()
  }

  private publish(): void {
    this.commitConversion()
    const raw = (this.scratch[1] << 8) | this.scratch[0]
    const converting = this.busy()
    const powered = this.powered()
    const idleHigh = !this.busLow && this.driving === 'release'
    const sig = `${raw}|${converting ? 1 : 0}|${powered ? 1 : 0}|${idleHigh ? 1 : 0}|${this.scratch[4]}`
    if (sig === this.lastReport) return
    this.lastReport = sig
    this.ctx.report({
      celsius: ds18b20Celsius(raw),
      raw,
      rawHex: '0x' + raw.toString(16).toUpperCase().padStart(4, '0'),
      resolution: this.resolutionBits(),
      converting,
      powered,
      /** False means the pull-up is missing or too weak — nothing will work. */
      busIdleHigh: idleHigh,
      rom: Array.from(this.rom, (b) => b.toString(16).padStart(2, '0')).join(''),
      /** True while the driver has not written its own configuration register. */
      configFromProps: !this.configWritten,
    })
  }
}

/** Assemble a byte from bits in 1-Wire order: least significant bit first. */
function bitsToByte(bits: number[]): number {
  let v = 0
  for (let i = 0; i < bits.length && i < 8; i++) v |= (bits[i] & 1) << i
  return v & 0xff
}

function signedByte(b: number): number {
  return b & 0x80 ? (b & 0xff) - 256 : b & 0xff
}

// ─── 28BYJ-48 stepper — where the shaft has got to ────────────────────────────

/**
 * How much of its rated current a winding must carry to count as energised.
 *
 * A quarter is a judgement call and is written here as one: the datasheet
 * quotes pull-in torque only at the rated 5 V, so there is no published curve
 * to read a threshold off. It has to be low enough that a real drive still
 * counts — a ULN2003 eats about 1 V of a 5 V rail, and a student running the
 * coils from 3.3 V is down to 2.3 V, i.e. 46 % of rated — and high enough that
 * the microamps leaking through a switched-off open-collector output do not.
 * A quarter sits an octave clear of both.
 */
const STEPPER_ENERGISED_FRACTION = 0.25

/**
 * Silence timeout for the reported speed, in cycles.
 *
 * A stepper that stops stepping produces no further transition, so the last
 * measured rate has to age out on its own. Half a second is far longer than the
 * 10 ms period of the datasheet's own 100 Hz drive frequency, so a slow but
 * genuine step rate is never mistaken for a stopped motor.
 */
const STEP_SILENCE_CYCLES = CLOCK_HZ * 0.5

/**
 * Reports what a unipolar stepper's shaft is doing, from the coil voltages.
 *
 * A MONITOR, not a driver — it never touches the net, exactly like
 * BuzzerMonitor and for the same reason: position is a property of the
 * energisation sequence in TIME, and a DC operating point has no opinion about
 * time. Watching the four solved coil voltages is the honest way to get it, so
 * the angle reported is the angle the student's own step loop commanded, not a
 * number copied out of their program.
 *
 * The sequence rule lives in StepTracker (devices.ts) so that the electrical
 * model and the position model cannot drift apart.
 */
export class StepperMonitor implements BehaviouralDevice {
  private readonly tracker = new StepTracker()
  private lastStepCycle: number | null = null
  private halfStepHz = 0
  private energised = [false, false, false, false]

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
    private spec: StepperParams = STEPPER_28BYJ48,
  ) {}

  /** Half-steps in one revolution of the OUTPUT shaft: 4096 for a 28BYJ-48. */
  get halfStepsPerRev(): number {
    return halfStepsPerRevolution(this.spec)
  }

  /** Signed cumulative half-steps. */
  get halfSteps(): number {
    return this.tracker.halfSteps
  }

  /** Cumulative output-shaft rotation, degrees, unwrapped and signed. */
  get degrees(): number {
    return this.tracker.halfSteps * degreesPerHalfStep(this.spec)
  }

  /** Voltage across one winding, or 0 if either end is unwired. */
  private coilVolts(phase: string): number {
    return this.ctx.voltage('COM') - this.ctx.voltage(phase)
  }

  poll(): void {
    const threshold = STEPPER_ENERGISED_FRACTION * this.spec.ratedVolts
    const names = ['A', 'B', 'C', 'D']
    let pattern = 0
    for (let k = 0; k < 4; k++) {
      const on = this.coilVolts(names[k]) >= threshold
      this.energised[k] = on
      // Bit 3 is phase A, matching HALF_STEP_SEQUENCE.
      if (on) pattern |= 1 << (3 - k)
    }

    const moved = this.tracker.apply(pattern)
    if (moved !== 0) {
      const now = this.ctx.cpu.cycles
      if (this.lastStepCycle !== null && now > this.lastStepCycle) {
        this.halfStepHz = (moved * CLOCK_HZ) / (now - this.lastStepCycle)
      }
      this.lastStepCycle = now
    }
    this.publish()
  }

  refresh(): void {
    this.publish()
  }

  private publish(): void {
    const now = this.ctx.cpu.cycles
    const stale = this.lastStepCycle === null || now - this.lastStepCycle > STEP_SILENCE_CYCLES
    const hz = stale ? 0 : this.halfStepHz
    const perRev = this.halfStepsPerRev
    const degrees = this.degrees
    this.ctx.report({
      pattern: this.energised.map((e) => (e ? '1' : '0')).join(''),
      /** Where the drive is in the eight-state ring, or −1 if it is not on it. */
      phaseIndex: this.tracker.index,
      halfSteps: this.tracker.halfSteps,
      fullSteps: this.tracker.halfSteps / 2,
      degrees,
      /** Shaft angle wrapped into 0–360°, which is what a dial would show. */
      shaftDegrees: ((degrees % 360) + 360) % 360,
      revolutions: this.tracker.halfSteps / perRev,
      halfStepsPerRevolution: perRev,
      rpm: (hz / perRev) * 60,
      energisedPhases: this.energised.filter(Boolean).length,
      holding: this.energised.some(Boolean),
      /** Patterns the model refused: off the ring, or too big a jump. */
      sequenceErrors: this.tracker.sequenceErrors,
    })
  }
}

/** The half-step ring, re-exported so the UI can draw it. */
export { HALF_STEP_SEQUENCE }

export { VCC }
