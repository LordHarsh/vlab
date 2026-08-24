/**
 * Behavioural parts — tier 2 in docs/SIMULATOR_ARCHITECTURE.md §7.1.
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
import { lcdChar, packLcdRow } from './lcd-font'
import { HC_SR501_FIELD } from './model/parts'

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
  /**
   * Whether `signal` reached a net at all.
   *
   * voltage() returns 0 for a signal the compiler never gave a net, which is
   * indistinguishable from a net genuinely sitting at 0 V. Usually that does not
   * matter — an unwired sensor pin reading 0 V is the right answer. It matters
   * for a device with OPTIONAL internal nodes: a relay module's coil node exists
   * only for the channels the compiler actually built, and 0 V on a coil node
   * means "energised", so absent and energised must be distinguishable.
   */
  hasSignal(signal: string): boolean
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

/**
 * HC-SR501 datasheet figures.
 *
 * The FIELD figures — the 100° cone angle and the 7 m reach — are not here; they
 * are `HC_SR501_FIELD` in model/parts.ts, because the canvas has to draw the
 * same wedge this model gates on and one declaration read by both is the only
 * arrangement in which the picture cannot promise a field the physics does not
 * have. Same contract RESISTOR_DEFAULT_OHMS has with compile.ts.
 */
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
    /**
     * WHERE the movement is, not just whether there is any.
     *
     * A real HC-SR501 sees a 100° cone out to about 7 m and nothing outside it,
     * and that boundary is the single most useful thing about the part: it is
     * why a sensor pointed at a doorway does not trigger on the street. The
     * canvas draws the same wedge from the same declaration, so a target the
     * student can see is outside the cone is one this model also refuses.
     *
     * The fallbacks are the prop defaults, which is what keeps a document
     * written before this existed behaving exactly as it did: 3 m dead ahead is
     * inside the field, so `motion` alone still decides everything.
     */
    const distanceCm = Math.max(0, numProp(p, 'distance', HC_SR501_FIELD.DEFAULT_TARGET_CM))
    const bearingDeg = numProp(p, 'bearing', 0)
    const inField =
      distanceCm <= HC_SR501_FIELD.RANGE_CM &&
      Math.abs(bearingDeg) <= HC_SR501_FIELD.HALF_ANGLE_DEG
    const motion = numProp(p, 'motion', 0) >= 0.5 && inField

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
      // Where the model believes the target is, so the canvas paints the cone
      // this poll actually used rather than re-deriving it from the document and
      // hoping the two agree.
      distanceCm,
      bearingDeg,
      inField,
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

// ─── Opto-isolated relay module — what the armature is doing ──────────────────

/**
 * Reports which way each relay's contact has thrown, from the COIL VOLTAGE.
 *
 * A MONITOR, not a driver — it never touches a net, exactly like BuzzerMonitor
 * and StepperMonitor.
 *
 * WHY IT READS THE COIL NODE AND NOT THE INPUT PIN. The obvious implementation
 * is to re-derive the switching decision from the IN pin, which means copying
 * the opto's diode curve, the series resistor, the pull-in threshold and both
 * hysteresis bands out of RelayChannel — and two copies of a rule with
 * independent hysteresis state WILL disagree near a threshold. The coil node is
 * the electrical model's own OUTPUT: an energised channel pulls it down to the
 * driver's VCE(sat), a released one leaves it at VCC through the coil. Reading
 * it cannot drift from RelayChannel, because it IS RelayChannel's answer.
 *
 * `_coil<k>` is not a pin on the part. compile() hands the monitor the internal
 * nodes it allocated for the coils under those keys, the same way it hands a
 * sensor its VCC net — see the relay branch in model/compile.ts.
 */
export class RelayMonitor implements BehaviouralDevice {
  private lastReport = ''

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
    private spec: { channels: number; coilOhms: number; coilVolts: number },
  ) {}

  poll(): void {
    this.publish()
  }

  refresh(): void {
    this.publish()
  }

  private publish(): void {
    const vcc = this.ctx.voltage('VCC')
    const gnd = this.ctx.voltage('GND')
    const supply = vcc - gnd
    // A supply the coil could never operate from is treated as no supply at
    // all, which also keeps the midpoint test below away from 0/0.
    const powered = supply > 1

    let pattern = ''
    let contacts = ''
    let energisedCount = 0
    let coilAmps = 0
    for (let k = 1; k <= this.spec.channels; k++) {
      const coil = this.ctx.voltage(`_coil${k}`)
      // A channel compile() never built has no internal node, so voltage()
      // returns 0 for it — indistinguishable from an energised coil. The
      // presence flag says which, so an unbuilt channel reads as absent rather
      // than as permanently on.
      if (!this.ctx.hasSignal(`_coil${k}`)) {
        pattern += '-'
        contacts += k > 1 ? ' -' : '-'
        continue
      }
      const across = vcc - coil
      const on = powered && across > 0.5 * supply
      if (on) {
        energisedCount++
        coilAmps += across / this.spec.coilOhms
      }
      pattern += on ? '1' : '0'
      contacts += (k > 1 ? ' ' : '') + (on ? 'NO' : 'NC')
    }

    const activeLow = numProp(this.ctx.props(), 'activeLow', 1) >= 0.5
    const sig = `${pattern}|${powered ? 1 : 0}|${supply.toFixed(3)}|${activeLow ? 1 : 0}`
    if (sig === this.lastReport) return
    this.lastReport = sig
    this.ctx.report({
      /** One character per channel: 1 energised, 0 released, - not wired. */
      pattern,
      /** Which contact each channel's COM is sitting on. */
      contacts,
      energised: energisedCount,
      channels: this.spec.channels,
      supplyVolts: supply,
      coilAmps,
      powered,
      activeLow,
      /** True when the supply is live but too low for this coil to pull in. */
      underVolted: powered && supply < this.spec.coilVolts * 0.75,
    })
  }
}

// ─── SEN-11574 pulse sensor ───────────────────────────────────────────────────

/**
 * Pulse Sensor Amped / SEN-11574 figures.
 *
 * The part is an optical PPG front end: an IR LED, an ambient-light photo
 * sensor and a two-stage op-amp filter/amplifier. What it puts on its one
 * signal wire is an ANALOG voltage that rests at half the supply — the
 * amplifier's own mid-rail reference — with the pulse riding on top of it.
 * That resting point is the published behaviour every Pulse Sensor sketch is
 * written against: "the signal hovers around 512" on a 10-bit ADC.
 */
export const PULSE_SENSOR = {
  /** "Operating voltage: 3 V to 5 V". */
  MIN_SUPPLY_VOLTS: 3.0,
  MAX_SUPPLY_VOLTS: 5.5,
  /** The amplifier's mid-rail reference: the signal rests at Vs/2. */
  BASELINE_FRACTION: 0.5,
  /**
   * Default peak swing above that baseline, as a fraction of the supply.
   *
   * 8 % of the rail is what a good finger reading looks like on the published
   * part: on a 5 V Arduino the signal sits at ~512 counts and a beat peaks
   * around 590, i.e. 78/1024 = 7.6 % of full scale. Scaling it to the SUPPLY
   * rather than fixing it in volts is what makes the same sensor behave the
   * same way on a 3.3 V board, which is what a ratiometric ADC reading of a
   * ratiometric sensor actually does.
   */
  DEFAULT_AMPLITUDE_PERCENT: 8,
  /**
   * Fraction of one beat interval occupied by the systolic peak.
   *
   * A resting adult's systolic ejection is roughly 200 ms of an 830 ms beat.
   * 0.22 is that ratio, held constant as the rate changes — which is a
   * simplification (a real systolic interval shortens far less than the beat
   * does) and is recorded as one in the class note.
   */
  SYSTOLIC_FRACTION: 0.22,
  /** How often the synthesised output is re-driven, microseconds. */
  UPDATE_MICROS: 2000,
  /**
   * Quantum of the driven voltage, volts.
   *
   * NOT cosmetic. The engine's memoisation key contains every behavioural
   * drive, so a continuously varying analog output would mint a new cache entry
   * on every update and never hit. 2 mV is below one LSB of a 10-bit converter
   * on a 3.3 V reference (3.22 mV), so the quantisation is invisible to
   * anything downstream, and it bounds the key space to a few hundred values.
   */
  STEP_VOLTS: 0.002,
  MIN_BPM: 30,
  MAX_BPM: 220,
} as const

/**
 * SEN-11574 pulse sensor.
 *
 * THE WAVEFORM IS SYNTHESISED, NOT SIMULATED. There is no optical model here:
 * no LED, no tissue, no photodiode, no ambient-light rejection and no motion
 * artefact. What this device does is put a periodic, ANALOG voltage on its
 * signal wire whose rate is the `bpm` prop and whose shape is a raised cosine —
 * one systolic bump per beat over a flat mid-rail baseline. It is a signal
 * GENERATOR standing in for a transducer, and it is labelled as one so nobody
 * reads a heart rate out of this and believes a body produced it.
 *
 * What IS real is everything downstream of the wire: the voltage is driven
 * through a Norton port into the solver, so whatever the student wired it to
 * loads it, an ADC reading it reads a genuine node voltage, and a peak-detecting
 * program has to find the peaks itself. A real PPG also carries a dicrotic notch
 * after the systolic peak — a second, smaller bump — which this does not
 * synthesise, so a naive detector will not meet the double-counting problem it
 * would meet on a bench.
 */
export class PulseSensor implements BehaviouralDevice {
  private disposed = false
  /** Simulated cycle at which the current beat started. */
  private beatStartCycle: number | null = null
  private beats = 0
  private volts = 0
  private lastReport = ''

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {
    ctx.drive('SIG', 'release')
    ctx.cpu.addClockEvent(this.tick, cyclesFor(PULSE_SENSOR.UPDATE_MICROS))
  }

  dispose(): void {
    this.disposed = true
    this.ctx.cpu.clearClockEvent(this.tick)
  }

  /** Supply the board is running from, volts. */
  private supplyVolts(): number {
    return this.ctx.voltage('VCC') - this.ctx.voltage('GND')
  }

  /** Beat rate the props ask for, clamped to what the part is sold to measure. */
  private bpm(): number {
    const raw = numProp(this.ctx.props(), 'bpm', 72)
    return Math.min(PULSE_SENSOR.MAX_BPM, Math.max(PULSE_SENSOR.MIN_BPM, raw))
  }

  /**
   * Output voltage at a phase through the beat, volts.
   *
   * Exposed and pure so the test can evaluate it independently of the clock:
   *
   *   v(p) = Vs/2                                             for p >= S
   *   v(p) = Vs/2 + A * (1 - cos(2*pi*p/S)) / 2               for p <  S
   *
   * which is 0 at p = 0, peaks at exactly A at p = S/2, and returns to 0 at
   * p = S with zero slope at both ends — a Hann window, so the trace has no
   * corner a differentiating detector would see as an edge.
   */
  waveformVolts(phase: number, supply: number, amplitude: number): number {
    const base = supply * PULSE_SENSOR.BASELINE_FRACTION
    const s = PULSE_SENSOR.SYSTOLIC_FRACTION
    const p = phase - Math.floor(phase)
    if (p >= s) return base
    return base + amplitude * 0.5 * (1 - Math.cos((2 * Math.PI * p) / s))
  }

  private tick = (): void => {
    if (this.disposed) return
    this.poll()
    this.ctx.cpu.addClockEvent(this.tick, cyclesFor(PULSE_SENSOR.UPDATE_MICROS))
  }

  poll(): void {
    const supply = this.supplyVolts()
    const powered =
      supply >= PULSE_SENSOR.MIN_SUPPLY_VOLTS && supply <= PULSE_SENSOR.MAX_SUPPLY_VOLTS
    if (!powered) {
      this.ctx.drive('SIG', 'release')
      this.beatStartCycle = null
      this.volts = 0
      this.publish(powered, 0)
      return
    }

    const now = this.ctx.cpu.cycles
    if (this.beatStartCycle === null) this.beatStartCycle = now
    const bpm = this.bpm()
    const periodCycles = (60 / bpm) * CLOCK_HZ
    let phase = (now - this.beatStartCycle) / periodCycles
    while (phase >= 1) {
      this.beatStartCycle += periodCycles
      phase -= 1
      this.beats++
    }

    const pct = Math.max(
      0,
      numProp(this.ctx.props(), 'amplitude', PULSE_SENSOR.DEFAULT_AMPLITUDE_PERCENT),
    )
    const amplitude = (pct / 100) * supply
    const raw = this.waveformVolts(phase, supply, amplitude)
    const v = Math.round(raw / PULSE_SENSOR.STEP_VOLTS) * PULSE_SENSOR.STEP_VOLTS
    this.volts = v
    this.ctx.drive('SIG', 'high', v)
    this.publish(powered, bpm)
  }

  refresh(): void {
    const s = this.supplyVolts()
    const powered = s >= PULSE_SENSOR.MIN_SUPPLY_VOLTS && s <= PULSE_SENSOR.MAX_SUPPLY_VOLTS
    this.publish(powered, powered ? this.bpm() : 0)
  }

  private publish(powered: boolean, bpm: number): void {
    const sig = `${powered ? 1 : 0}|${bpm}|${this.volts.toFixed(3)}|${this.beats}`
    if (sig === this.lastReport) return
    this.lastReport = sig
    this.ctx.report({
      powered,
      bpm: powered ? bpm : 0,
      /** What the amplifier is putting on the wire right now, volts. */
      driveVolts: this.volts,
      /** What the wire actually sits at once the load is accounted for. */
      signalVolts: this.ctx.voltage('SIG'),
      beats: this.beats,
      /** Stated plainly so the UI can too: this is a generator, not optics. */
      synthesised: true,
    })
  }
}

// ─── MCP3008 8-channel 10-bit SPI ADC ─────────────────────────────────────────

/**
 * MCP3008 datasheet figures (Microchip DS21295).
 *
 * The transfer function is the datasheet's own equation 4-2, and it is worth
 * writing out because a 1024 where a 1023 belongs is the classic off-by-one in
 * every home-made ADC model:
 *
 *   Digital Output Code = 1024 * VIN / VREF
 *
 * so a full-scale input produces 1024, which does not fit in ten bits and is
 * clipped to 1023. The floor is the quantiser.
 */
export const MCP3008 = {
  /** Resolution and the largest code that fits. */
  BITS: 10,
  MAX_CODE: 1023,
  /** Scale factor in the datasheet's transfer function. */
  FULL_SCALE: 1024,
  /** Single-ended input channels. */
  CHANNELS: 8,
  /** "VDD = 2.7 V to 5.5 V". */
  MIN_SUPPLY_VOLTS: 2.7,
  MAX_SUPPLY_VOLTS: 5.5,
  /** Digital input levels: VIH = 0.7 VDD, VIL = 0.3 VDD. */
  VIH_FRACTION: 0.7,
  VIL_FRACTION: 0.3,
  /**
   * Rising edges of CLK, counted from the START bit, at which each thing
   * happens. Derived once here so the model and its test cannot disagree about
   * the frame:
   *
   *   n = 0            the START bit (the first CLK with CS low and DIN high)
   *   n = 1 .. 4       SGL/DIFF, D2, D1, D0 sampled on DIN
   *   n = 5            the sample-and-hold closes; the conversion is committed
   *   n = 6            the master reads the NULL bit
   *   n = 7 .. 16      the master reads B9 .. B0
   *   n = 17 ..        the master reads B1, B2, ... — the datasheet's LSB-first
   *                    repeat, for a master that keeps clocking
   *
   * The device changes DOUT on the FALLING edge, so the bit the master reads at
   * rising edge n was placed on the falling edge after rising edge n-1.
   */
  CONFIG_BITS: 4,
  NULL_AT: 6,
  FIRST_DATA_AT: 7,
} as const

/** Single-ended (SGL) or pseudo-differential (DIFF) — the SGL/DIFF config bit. */
export type Mcp3008Mode = 'single' | 'differential'

/**
 * Convert an input voltage to the MCP3008's 10-bit code.
 *
 * ROUND, NOT TRUNCATE, and the difference is visible at exactly the value this
 * experiment sits at. The datasheet prints two things that have to be read
 * together: equation 4-2 gives the NOMINAL relation
 *
 *   Digital Output Code = 1024 * VIN / VREF
 *
 * and the transfer-function figure shows where the code actually CHANGES — the
 * first transition is at half an LSB, so code k covers (k − 0.5) to (k + 0.5)
 * LSBs and equation 4-2 describes the centre of each code, not its lower edge.
 * Quantising with floor() puts every boundary half an LSB low; a pulse sensor
 * resting at exactly Vref/2 then reads 511 instead of 512, which is the one
 * number every Pulse Sensor sketch is written around. (It is also the more
 * robust of the two numerically: floor() at an exact code boundary is decided
 * by the last bit of a solved voltage.)
 *
 * Exported so the test can call it with hand-computed voltages instead of
 * inferring it from a bus transaction, and so the UI can label a reading.
 */
export function mcp3008Code(volts: number, vref: number): number {
  if (!(vref > 0)) return 0
  const raw = Math.round((MCP3008.FULL_SCALE * volts) / vref)
  return Math.min(MCP3008.MAX_CODE, Math.max(0, raw))
}

/**
 * MCP3008 8-channel 10-bit SPI analogue-to-digital converter.
 *
 * WHY THIS PART IS HERE AT ALL. A Raspberry Pi has no analog input, so the
 * published circuit for experiment 12 reads its pulse sensor through one of
 * these over SPI. A Pico has three native ADCs and does not need it — so the
 * part is electrically unnecessary on this board and is kept anyway, because
 * the printed circuit the student is asked to build has it in it and building
 * the printed circuit has to be possible.
 *
 * PROTOCOL, not a reading. This implements the real bus: CS framing, the START
 * bit, the SGL/DIFF + D2 D1 D0 configuration word, the sample instant, the NULL
 * bit and ten data bits MSB-first, then the datasheet's LSB-first repeat if the
 * master keeps clocking. Mode 0,0 — DIN is sampled on the RISING edge of CLK
 * and DOUT changes on the FALLING edge — which is what a `SoftSPI(polarity=0,
 * phase=0)` produces. DOUT is genuinely high-impedance until the null bit and
 * again as soon as CS rises, so two devices can share the bus.
 *
 * The three-byte transaction every Raspberry Pi tutorial uses,
 *
 *   xfer2([1, (8 + ch) << 4, 0])  ->  ((r[1] & 3) << 8) | r[2]
 *
 * falls out of that frame rather than being special-cased; see MCP3008.NULL_AT
 * for the clock arithmetic that makes the answer land in those bits.
 *
 * HONEST LIMITATIONS:
 *
 *   - There is no conversion-rate limit. A real MCP3008 manages 200 ksps at
 *     5 V and 75 ksps at 2.7 V, and clocking it faster than that returns
 *     garbage; this model converts at whatever rate the master asks for.
 *   - The 100 nA leakage, the input sample capacitor's 1 kOhm switch resistance
 *     and therefore the source-impedance limit on the analog input are not
 *     modelled: the converter reads the solved node voltage without loading it.
 *   - Offset, gain and INL/DNL error are all zero. The only quantisation is the
 *     datasheet's own transfer function.
 */
export class MCP3008Device implements BehaviouralDevice {
  /** Hysteretic bus levels, as the device's own comparators see them. */
  private csLow = false
  private clkHigh = false
  /** Rising edges since the START bit; -1 before the start bit arrives. */
  private n = -1
  /** Config bits collected after the start bit, in arrival order. */
  private cfg: number[] = []
  /** The committed conversion for the transaction in flight. */
  private code = 0
  private lastCode = 0
  private lastChannel = 0
  private lastMode: Mcp3008Mode = 'single'
  private transactions = 0
  private driving: 'low' | 'high' | 'release' = 'release'
  private lastReport = ''

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {
    ctx.drive('DOUT', 'release')
  }

  private supply(): number {
    return this.ctx.voltage('VDD') - this.ctx.voltage('DGND')
  }

  private powered(): boolean {
    const v = this.supply()
    return v >= MCP3008.MIN_SUPPLY_VOLTS && v <= MCP3008.MAX_SUPPLY_VOLTS
  }

  /** Reference the converter measures against, volts. */
  private vref(): number {
    return this.ctx.voltage('VREF') - this.ctx.voltage('AGND')
  }

  /** One channel's input, referred to AGND as the datasheet specifies. */
  private channelVolts(ch: number): number {
    return this.ctx.voltage(`CH${ch & 7}`) - this.ctx.voltage('AGND')
  }

  /** Hysteretic read of a digital input against 0.3/0.7 VDD. */
  private level(signal: string, was: boolean): boolean {
    const vdd = this.supply()
    const v = this.ctx.voltage(signal) - this.ctx.voltage('DGND')
    return was ? v > vdd * MCP3008.VIL_FRACTION : v >= vdd * MCP3008.VIH_FRACTION
  }

  private set(level: 'low' | 'high' | 'release'): void {
    if (this.driving === level) return
    this.driving = level
    this.ctx.drive('DOUT', level, this.supply())
  }

  /**
   * What the converter samples when the configuration word completes.
   *
   * Single-ended is channel-to-AGND. Pseudo-differential pairs the channels
   * (0,1), (2,3), (4,5), (6,7) and the low config bit picks which of the pair
   * is IN+ — so D2 D1 D0 = 001 is CH0 as IN- and CH1 as IN+, which is why the
   * pair is read from the same three bits as a single-ended channel.
   */
  private convert(mode: Mcp3008Mode, sel: number): number {
    const vref = this.vref()
    if (mode === 'single') return mcp3008Code(this.channelVolts(sel), vref)
    const pair = sel & 0b110
    const plus = sel & 1 ? pair + 1 : pair
    const minus = sel & 1 ? pair : pair + 1
    return mcp3008Code(this.channelVolts(plus) - this.channelVolts(minus), vref)
  }

  /** The bit the device places on DOUT after rising edge `n`, or null for hi-Z. */
  private outputBit(n: number): number | null {
    if (n < MCP3008.NULL_AT - 1) return null
    if (n === MCP3008.NULL_AT - 1) return 0 // the NULL bit
    const k = n - (MCP3008.NULL_AT - 1) // 1 => B9, 10 => B0
    if (k <= MCP3008.BITS) return (this.code >> (MCP3008.BITS - k)) & 1
    // Past B0 the datasheet repeats the result LSB-first: B1, B2, ... B9.
    const j = k - MCP3008.BITS // 1 => B1
    if (j <= MCP3008.BITS - 1) return (this.code >> j) & 1
    return 0
  }

  private startFrame(): void {
    this.n = -1
    this.cfg = []
    this.set('release')
  }

  private onClockRising(): void {
    const din = this.level('DIN', false)
    if (this.n < 0) {
      // Leading zeros are ignored: the datasheet says the first clock with CS
      // low and DIN high IS the start bit, which is what lets a master send a
      // whole byte of 0x01 and have the frame begin on its eighth clock.
      if (!din) return
      this.n = 0
      return
    }
    this.n++
    if (this.n <= MCP3008.CONFIG_BITS) this.cfg.push(din ? 1 : 0)
  }

  private onClockFalling(): void {
    if (this.n < 0) return
    if (this.n === MCP3008.CONFIG_BITS) {
      // The sample-and-hold closes here, one and a half clocks after the last
      // configuration bit, and the conversion is committed against the input as
      // it is AT THIS INSTANT. A pulse waveform that moves later in the frame
      // does not change the answer already latched — which is what a real
      // sample-and-hold does and is why a peak can be missed rather than
      // smeared.
      const mode: Mcp3008Mode = this.cfg[0] === 1 ? 'single' : 'differential'
      const sel = ((this.cfg[1] ?? 0) << 2) | ((this.cfg[2] ?? 0) << 1) | (this.cfg[3] ?? 0)
      this.code = this.convert(mode, sel)
      this.lastCode = this.code
      this.lastChannel = sel
      this.lastMode = mode
      this.transactions++
    }
    const bit = this.outputBit(this.n)
    this.set(bit === null ? 'release' : bit ? 'high' : 'low')
  }

  poll(): void {
    if (!this.powered()) {
      this.set('release')
      this.csLow = false
      this.clkHigh = false
      this.n = -1
      this.publish()
      return
    }

    const csLow = !this.level('CS', !this.csLow)
    if (csLow !== this.csLow) {
      this.csLow = csLow
      if (csLow) {
        this.startFrame()
        // CS falling defines the clock reference, so a CLK left high by the
        // previous frame must not be mistaken for an edge inside this one.
        this.clkHigh = this.level('CLK', false)
      } else {
        // CS high releases DOUT — the whole reason several devices can share
        // one MISO line.
        this.set('release')
        this.n = -1
      }
    }

    if (this.csLow) {
      const clkHigh = this.level('CLK', this.clkHigh)
      if (clkHigh !== this.clkHigh) {
        this.clkHigh = clkHigh
        if (clkHigh) this.onClockRising()
        else this.onClockFalling()
      }
    }
    this.publish()
  }

  refresh(): void {
    this.publish()
  }

  private publish(): void {
    const powered = this.powered()
    const vref = this.vref()
    const sig = `${powered ? 1 : 0}|${this.lastCode}|${this.lastChannel}|${this.lastMode}|${vref.toFixed(3)}|${this.transactions}`
    if (sig === this.lastReport) return
    this.lastReport = sig
    this.ctx.report({
      powered,
      /** Last conversion, in counts. */
      code: this.lastCode,
      /** …and what that code means, in volts. */
      volts: (this.lastCode * vref) / MCP3008.FULL_SCALE,
      channel: this.lastChannel,
      mode: this.lastMode,
      vref,
      conversions: this.transactions,
    })
  }
}

// ─── HD44780 character LCD ────────────────────────────────────────────────────

/**
 * Hitachi HD44780U figures, and what the model does with each one.
 *
 *   [sheet] marks a printed datasheet line; [judged] a number the sheet does not
 *   give, with the reasoning that bounds it.
 */
export const HD44780 = {
  /**
   * [sheet] Operating supply: VCC 2.7 V to 5.5 V. Below the minimum the
   * controller is not running, so nothing it was told survives — the model does
   * a genuine power-on reset when the supply comes back, exactly as the silicon
   * does.
   */
  MIN_SUPPLY_VOLTS: 2.7,

  /**
   * [sheet] Input high/low levels. The sheet prints these TWICE, once as absolute
   * volts for a 5 V part and once as fractions of VCC for a low-voltage one:
   *
   *   VCC = 4.5-5.5 V   VIH1 = 2.2 V min,   VIL1 = 0.6 V max
   *   VCC = 2.7-4.5 V   VIH1 = 0.7 VCC,     VIL1 = 0.2 VCC
   *
   * Both are used, chosen by the supply that was actually solved — which is the
   * difference between a 3.3 V Pico's 3.3 V high being comfortably above a 2.31 V
   * threshold and it being compared against a 5 V part's numbers by accident.
   */
  VIH_5V: 2.2,
  VIL_5V: 0.6,
  VIH_FRACTION: 0.7,
  VIL_FRACTION: 0.2,
  /** The supply at which the sheet switches from one pair to the other. */
  LEVEL_SPLIT_VOLTS: 4.5,

  /**
   * LCD DRIVING VOLTAGE, VCC − V0, which is what the contrast trimmer sets.
   *
   * [sheet] A 1602 module's own spec gives "LCD driving voltage (VDD−V0) 4.2 V
   *         typ at 25 °C" and nothing either side of it.
   * [judged] The two ends. Below 3.8 V the segments are not driven hard enough
   *          to be seen at all (a blank screen with the trimmer wound to VDD is
   *          the single commonest "my LCD does not work"); above 4.6 V the
   *          UN-driven segments start to show as well, and by 5.0 V — V0 tied
   *          straight to ground — every cell is a solid block whether anything
   *          was written to it or not. Both ends are the observed behaviour of
   *          the part; the exact volt at which each begins is a judgement.
   */
  BIAS_TEXT_MIN_VOLTS: 3.8,
  BIAS_TEXT_FULL_VOLTS: 4.2,
  BIAS_BLOCKS_MIN_VOLTS: 4.6,
  BIAS_BLOCKS_FULL_VOLTS: 5.0,

  /** Visible columns and lines of the 1602 module. */
  COLUMNS: 16,
  ROWS: 2,
  /** [sheet] DDRAM per line in 2-line mode: 40 characters, 0x00-0x27. */
  LINE_CHARS: 40,
  /** [sheet] The second line's DDRAM base address. */
  LINE2_BASE: 0x40,
  /** [sheet] DDRAM in 1-line mode: 80 characters, 0x00-0x4F. */
  ONE_LINE_CHARS: 80,
} as const

/** DDRAM cells the model keeps: two lines of 40. */
const DDRAM_SIZE = HD44780.LINE_CHARS * HD44780.ROWS

/** The code a cleared HD44780 fills its DDRAM with: a space. */
const BLANK_CODE = 0x20

/** Linear ramp from 0 at `lo` to 1 at `hi`. */
function ramp(v: number, lo: number, hi: number): number {
  if (!(hi > lo)) return v >= hi ? 1 : 0
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
}

/**
 * HD44780 character LCD, decoded from the wire.
 *
 * ─── WHY THIS IS NOT SHAPED LIKE THE SENSORS ABOVE ────────────────────────────
 *
 * Every other protocol part in this file is a SENSOR: it owns a line, drives it,
 * and the MCU reads what it said. A display is the mirror image — the MCU owns
 * every line and the part's whole job is to work out what it was told. So this
 * is a MONITOR, in the same family as BuzzerMonitor and RelayMonitor: `ports` is
 * empty, it drives nothing, and it can never fight the sketch for the bus.
 *
 * ─── WHAT IS ACTUALLY DECODED ─────────────────────────────────────────────────
 *
 * The controller latches on the FALLING edge of E, and so does this. On each
 * fall it samples RS, R/W and the data lines at the levels the SOLVER produced —
 * not from any library call, and not from any AVR register. A sketch that
 * bit-bangs the port directly and a sketch that calls LiquidCrystal::print()
 * arrive here as the same sequence of edges, because on real hardware they are
 * the same sequence of edges.
 *
 * The full instruction set is decoded: function set (which is what selects 4-bit
 * or 8-bit, and the model follows the sketch into either), entry mode set,
 * display/cursor/blink on-off, clear display, return home, cursor/display shift,
 * set CGRAM address, set DDRAM address, and character writes. The address
 * counter, the 2x40 DDRAM and the display shift are all real, so
 * `setCursor(5, 1)` puts the next character where the glass would put it and
 * `scrollDisplayLeft()` moves the window rather than the text.
 *
 * ─── WHAT IS NOT ──────────────────────────────────────────────────────────────
 *
 * Reads (R/W high) return nothing. A transfer with R/W high is COUNTED and
 * reported and then ignored, which is the honest half-answer: the model knows
 * the sketch asked and knows it did not reply. Everything Arduino's stock
 * LiquidCrystal does is a write — it never wires R/W at all — so this costs a
 * standard sketch nothing, and a sketch that polls the busy flag would hang on
 * real silicon-accurate timing anyway. compile.ts says so out loud.
 *
 * CGRAM writes are accepted and stored so the address counter stays in step, but
 * the eight custom characters they build are not drawn.
 */
export class HD44780Display implements BehaviouralDevice {
  /** Two lines of 40 characters. Index 0-39 is line 1, 40-79 is line 2. */
  private ddram = new Uint8Array(DDRAM_SIZE).fill(BLANK_CODE)
  /** The 64 bytes of custom-character RAM. Stored, never drawn — see above. */
  private cgram = new Uint8Array(64)

  /** The address counter, in the controller's own address space. */
  private ac = 0
  /** True when the address counter is pointing into CGRAM instead of DDRAM. */
  private cgramSelected = false

  /* Entry mode set. */
  private increment = true
  private shiftOnWrite = false

  /* Display on/off control. */
  private displayOn = false
  private cursorOn = false
  private blinkOn = false

  /* Function set. A powered-up HD44780 is in 8-BIT, 1-LINE mode. */
  private fourBit = false
  private twoLine = false

  /** How far the visible window has been scrolled, in characters. */
  private displayShift = 0

  /**
   * The high nibble of a 4-bit transfer that has not been completed yet, and the
   * RS that came with it.
   *
   * RS IS CAPTURED WITH THE FIRST NIBBLE rather than read again at the second.
   * The datasheet requires the sketch to hold RS across both halves, so in every
   * correct sketch the two agree; where they do not, the first one is what
   * decided which operation was begun.
   */
  private pendingNibble: number | null = null
  private pendingRs = false

  /** Previous level of E, so a fall can be told from a level. */
  private eHigh = false
  /** Last level decided for each input, so the thresholds can have hysteresis. */
  private levels: Record<string, boolean> = {}

  private isPowered = false
  /** True once a function set has been received: the sketch has initialised it. */
  private initialised = false
  /** Transfers with R/W high — reads, which this model cannot answer. */
  private reads = 0
  /** Completed writes, so the panel can say the bus is live. */
  private writes = 0

  private lastReport = ''

  constructor(
    readonly partId: string,
    private ctx: BehaviouralContext,
  ) {}

  poll(): void {
    const vss = this.ctx.voltage('VSS')
    const vdd = this.ctx.voltage('VDD') - vss

    if (vdd < HD44780.MIN_SUPPLY_VOLTS) {
      // Not running. Whatever it held is gone, and it will come back reset.
      this.isPowered = false
      this.publish(vdd, vss)
      return
    }
    if (!this.isPowered) {
      this.isPowered = true
      this.powerOnReset()
    }

    const e = this.level('E', vdd, vss)
    // Sampled at the same instant E is, because that is when the controller
    // samples them: the datasheet's tAS/tAH hold RS and R/W either side of the
    // enable pulse precisely so this reading is well defined.
    const rs = this.level('RS', vdd, vss)
    const rw = this.level('RW', vdd, vss)

    if (this.eHigh && !e) this.latch(rs, rw, vdd, vss)
    this.eHigh = e

    this.publish(vdd, vss)
  }

  refresh(): void {
    // Contrast and supply move without any pin edge (a student turning the
    // trimmer is a document edit, not a port write), so the reported view has to
    // be able to close over the current solve at snapshot time.
    const vss = this.ctx.voltage('VSS')
    this.publish(this.ctx.voltage('VDD') - vss, vss)
  }

  /**
   * The state the controller's own reset circuit leaves it in, verbatim from the
   * datasheet's "Initializing by Internal Reset Circuit":
   *
   *   1. Display clear          — DDRAM filled with 0x20, address counter 0
   *   2. Function set           — DL = 1 (8-bit), N = 0 (1 line), F = 0 (5x8)
   *   3. Display on/off control — D = 0, C = 0, B = 0 (everything off)
   *   4. Entry mode set         — I/D = 1 (increment), S = 0 (no shift)
   *
   * Item 3 is the one worth knowing: a freshly powered HD44780 has its display
   * OFF, so a sketch that writes characters without ever sending a display-on
   * shows nothing, and this model shows nothing too.
   */
  private powerOnReset(): void {
    this.ddram.fill(BLANK_CODE)
    this.cgram.fill(0)
    this.ac = 0
    this.cgramSelected = false
    this.increment = true
    this.shiftOnWrite = false
    this.displayOn = false
    this.cursorOn = false
    this.blinkOn = false
    this.fourBit = false
    this.twoLine = false
    this.displayShift = 0
    this.pendingNibble = null
    this.pendingRs = false
    this.eHigh = false
    this.levels = {}
    this.initialised = false
    this.reads = 0
    this.writes = 0
  }

  /** One input pin as a logic level, with the datasheet's own thresholds. */
  private level(signal: string, vdd: number, vss: number): boolean {
    const v = this.ctx.voltage(signal) - vss
    const high = vdd >= HD44780.LEVEL_SPLIT_VOLTS
    const vih = high ? HD44780.VIH_5V : HD44780.VIH_FRACTION * vdd
    const vil = high ? HD44780.VIL_5V : HD44780.VIL_FRACTION * vdd
    const prev = this.levels[signal] ?? false
    // Between the two thresholds the part is not specified either way, so it
    // holds — which is also what stops a half-driven line rattling.
    const next = v >= vih ? true : v <= vil ? false : prev
    this.levels[signal] = next
    return next
  }

  /** D7..D4 as the high half of a byte. */
  private highNibble(vdd: number, vss: number): number {
    return (
      ((this.level('D7', vdd, vss) ? 1 : 0) << 3) |
      ((this.level('D6', vdd, vss) ? 1 : 0) << 2) |
      ((this.level('D5', vdd, vss) ? 1 : 0) << 1) |
      (this.level('D4', vdd, vss) ? 1 : 0)
    )
  }

  /** D3..D0, read only in 8-bit mode. */
  private lowNibble(vdd: number, vss: number): number {
    return (
      ((this.level('D3', vdd, vss) ? 1 : 0) << 3) |
      ((this.level('D2', vdd, vss) ? 1 : 0) << 2) |
      ((this.level('D1', vdd, vss) ? 1 : 0) << 1) |
      (this.level('D0', vdd, vss) ? 1 : 0)
    )
  }

  /** One E fall: assemble whatever the data lines are carrying and act on it. */
  private latch(rs: boolean, rw: boolean, vdd: number, vss: number): void {
    if (rw) {
      // A read cycle. The controller would drive the data bus here; this model
      // does not, so the only honest thing to do is count it and say so.
      this.reads++
      return
    }

    const hi = this.highNibble(vdd, vss)

    if (this.fourBit) {
      if (this.pendingNibble === null) {
        this.pendingNibble = hi
        this.pendingRs = rs
        return
      }
      const byte = (this.pendingNibble << 4) | hi
      const forData = this.pendingRs
      this.pendingNibble = null
      this.execute(byte, forData)
      return
    }

    /**
     * 8-BIT MODE, WHICH IS ALSO HOW EVERY 4-BIT SKETCH STARTS.
     *
     * A part comes out of reset in 8-bit mode, so the three 0x3 nibbles and the
     * single 0x2 that every 4-bit initialisation opens with are latched HERE, as
     * whole 8-bit bytes whose low half comes from D3-D0. On a 4-bit wiring those
     * four pins are not connected to anything, so they solve at 0 V and read
     * low, and the bytes come out as 0x30, 0x30, 0x30, 0x20 — which is exactly
     * what the silicon sees and exactly why the sequence works.
     */
    this.execute((hi << 4) | this.lowNibble(vdd, vss), rs)
  }

  /** A complete byte, with the RS that came with it. */
  private execute(byte: number, isData: boolean): void {
    this.writes++
    if (isData) this.write(byte)
    else this.command(byte)
  }

  /**
   * The instruction table, tested from the most significant bit down — which is
   * how the controller decodes it, and why the order below cannot be rearranged.
   */
  private command(byte: number): void {
    if (byte & 0x80) {
      // Set DDRAM address.
      this.cgramSelected = false
      this.ac = byte & 0x7f
      return
    }
    if (byte & 0x40) {
      // Set CGRAM address.
      this.cgramSelected = true
      this.ac = byte & 0x3f
      return
    }
    if (byte & 0x20) {
      // Function set: DL, N, F.
      this.fourBit = (byte & 0x10) === 0
      this.twoLine = (byte & 0x08) !== 0
      this.initialised = true
      // Switching the data length abandons any half-assembled transfer; the
      // controller has just been told the bus is a different width.
      this.pendingNibble = null
      return
    }
    if (byte & 0x10) {
      /**
       * Cursor or display shift. S/C picks which, R/L picks the direction — and
       * the two directions do NOT mean the same thing to the two targets, which
       * is the trap this decoded backwards on the first pass:
       *
       *   cursor right  moves the address counter UP by one.
       *   display left  moves the TEXT left across the glass, which means the
       *                 visible window moves UP the DDRAM — so `displayShift`
       *                 goes up when R/L says left, not down.
       *
       * `lcd.scrollDisplayLeft()` sends 0x18 (R/L = 0), and on a bench the
       * message walks off the left-hand edge. Adding −1 here made it walk the
       * other way.
       */
      const right = (byte & 0x04) !== 0
      if (byte & 0x08) this.displayShift = this.wrapShift(this.displayShift + (right ? -1 : 1))
      else this.ac = this.stepAddress(this.ac, right)
      return
    }
    if (byte & 0x08) {
      // Display on/off control: D, C, B.
      this.displayOn = (byte & 0x04) !== 0
      this.cursorOn = (byte & 0x02) !== 0
      this.blinkOn = (byte & 0x01) !== 0
      return
    }
    if (byte & 0x04) {
      // Entry mode set: I/D, S.
      this.increment = (byte & 0x02) !== 0
      this.shiftOnWrite = (byte & 0x01) !== 0
      return
    }
    if (byte & 0x02) {
      // Return home. DDRAM is NOT cleared — only the counter and the shift.
      this.ac = 0
      this.cgramSelected = false
      this.displayShift = 0
      return
    }
    if (byte & 0x01) {
      // Clear display. Also sets I/D to 1, which the datasheet states and which
      // a sketch that relies on it (clear() then print()) depends on.
      this.ddram.fill(BLANK_CODE)
      this.ac = 0
      this.cgramSelected = false
      this.increment = true
      this.displayShift = 0
    }
    // byte === 0: a NOP. Real sketches emit them while the bus settles.
  }

  /** A character write, to whichever memory the address counter is pointing at. */
  private write(byte: number): void {
    if (this.cgramSelected) {
      this.cgram[this.ac & 0x3f] = byte
      this.ac = (this.ac + (this.increment ? 1 : 63)) & 0x3f
      return
    }
    const cell = this.ddramIndex(this.ac)
    if (cell >= 0) this.ddram[cell] = byte
    this.ac = this.stepAddress(this.ac, this.increment)
    // Entry-mode S: the whole display follows the cursor, which is how a
    // right-justified readout is built without rewriting the line.
    if (this.shiftOnWrite) {
      this.displayShift = this.wrapShift(this.displayShift + (this.increment ? 1 : -1))
    }
  }

  /**
   * A DDRAM address as an index into the 2x40 store, or −1 for an address the
   * configured display does not have.
   *
   * The gap is real: in 2-line mode 0x28-0x3F is not memory at all, and a sketch
   * that lands there writes nothing. Silently folding it onto line 2 would make
   * `setCursor(40, 0)` appear to work.
   */
  private ddramIndex(ac: number): number {
    if (!this.twoLine) return ac < HD44780.ONE_LINE_CHARS ? ac % DDRAM_SIZE : -1
    if (ac < HD44780.LINE_CHARS) return ac
    const off = ac - HD44780.LINE2_BASE
    return off >= 0 && off < HD44780.LINE_CHARS ? HD44780.LINE_CHARS + off : -1
  }

  /**
   * The address counter's next value.
   *
   * In 2-line mode it runs 0x00-0x27 and then jumps to 0x40, skipping the hole,
   * so a sketch that writes 41 characters without moving the cursor puts the
   * 41st at the start of line 2 — which is what the hardware does and what
   * surprises everybody the first time.
   */
  private stepAddress(ac: number, up: boolean): number {
    if (!this.twoLine) {
      const n = HD44780.ONE_LINE_CHARS
      return up ? (ac + 1) % n : (ac + n - 1) % n
    }
    if (up) {
      if (ac === HD44780.LINE_CHARS - 1) return HD44780.LINE2_BASE
      if (ac === HD44780.LINE2_BASE + HD44780.LINE_CHARS - 1) return 0
      return ac + 1
    }
    if (ac === 0) return HD44780.LINE2_BASE + HD44780.LINE_CHARS - 1
    if (ac === HD44780.LINE2_BASE) return HD44780.LINE_CHARS - 1
    return ac - 1
  }

  private wrapShift(s: number): number {
    const n = HD44780.LINE_CHARS
    return ((s % n) + n) % n
  }

  /** The 16 codes visible on one line, after the display shift. */
  private visibleRow(row: number): number[] {
    const out: number[] = []
    for (let col = 0; col < HD44780.COLUMNS; col++) {
      if (!this.twoLine) {
        // A 1-line function set on a 16x2 module leaves the lower line dark.
        if (row > 0) {
          out.push(BLANK_CODE)
          continue
        }
        const idx = (this.displayShift + col) % HD44780.ONE_LINE_CHARS
        out.push(idx < DDRAM_SIZE ? this.ddram[idx] : BLANK_CODE)
        continue
      }
      const idx = row * HD44780.LINE_CHARS + ((this.displayShift + col) % HD44780.LINE_CHARS)
      out.push(this.ddram[idx])
    }
    return out
  }

  /** Where the cursor is on the GLASS, or null when it is scrolled off it. */
  private cursorCell(): { row: number; col: number } | null {
    if (this.cgramSelected) return null
    const row = this.twoLine && this.ac >= HD44780.LINE2_BASE ? 1 : 0
    const offset = row === 1 ? this.ac - HD44780.LINE2_BASE : this.ac
    const span = this.twoLine ? HD44780.LINE_CHARS : HD44780.ONE_LINE_CHARS
    if (offset < 0 || offset >= span) return null
    const col = ((offset - this.displayShift) % span + span) % span
    return col < HD44780.COLUMNS ? { row, col } : null
  }

  private publish(vdd: number, vss: number): void {
    const powered = vdd >= HD44780.MIN_SUPPLY_VOLTS

    /**
     * CONTRAST IS SOLVED, NOT A PROP.
     *
     * V0 is a real pin on a real net, so the trimmer between VDD and VSS that
     * every wiring diagram shows is doing here what it does on a bench: the
     * bias the segments are driven at is VDD − V0, and the two thresholds it is
     * measured against are the ones on HD44780 above. Wind it to VDD and the
     * screen goes blank with the text still in DDRAM; wind it to VSS and every
     * cell fills in whether anything was written to it or not.
     */
    const bias = powered ? vdd - (this.ctx.voltage('V0') - vss) : 0
    const contrast = ramp(bias, HD44780.BIAS_TEXT_MIN_VOLTS, HD44780.BIAS_TEXT_FULL_VOLTS)
    const blocks = ramp(bias, HD44780.BIAS_BLOCKS_MIN_VOLTS, HD44780.BIAS_BLOCKS_FULL_VOLTS)

    const row0 = this.visibleRow(0)
    const row1 = this.visibleRow(1)
    const cursor = this.cursorCell()
    const lit = powered && this.displayOn

    const hex0 = packLcdRow(row0)
    const hex1 = packLcdRow(row1)
    const sig =
      `${hex0}|${hex1}|${lit ? 1 : 0}|${this.cursorOn ? 1 : 0}|${this.blinkOn ? 1 : 0}|` +
      `${cursor ? `${cursor.row},${cursor.col}` : '-'}|${contrast.toFixed(3)}|` +
      `${blocks.toFixed(3)}|${powered ? 1 : 0}|${vdd.toFixed(3)}|${this.reads}|${this.writes}|` +
      `${this.fourBit ? 4 : 8}|${this.twoLine ? 2 : 1}`
    if (sig === this.lastReport) return
    this.lastReport = sig

    this.ctx.report({
      /**
       * The visible codes, packed as hex, because the RENDERER needs the code
       * and not a decoded character: it paints dots out of the CGROM table, and
       * a string would already have discarded the codes it cannot draw.
       */
      row0: hex0,
      row1: hex1,
      /** The same two lines as text, for the panel and for tests. */
      text0: row0.map(lcdChar).join(''),
      text1: row1.map(lcdChar).join(''),
      /** D of the display on/off instruction, ANDed with having a supply. */
      on: lit,
      cursor: this.cursorOn,
      blink: this.blinkOn,
      /** Cursor position on the glass. −1 when it is not on the glass. */
      cursorRow: cursor ? cursor.row : -1,
      cursorCol: cursor ? cursor.col : -1,
      /** 0 = invisible, 1 = fully driven. See the note above. */
      contrast,
      /** 0 = clean, 1 = every cell a solid block. Over-driven bias. */
      blocks,
      /** Volts across the LCD itself: VDD − V0. */
      bias,
      powered,
      supplyVolts: vdd,
      /** 4 or 8. Follows the function set the sketch actually sent. */
      busWidth: this.fourBit ? 4 : 8,
      lines: this.twoLine ? 2 : 1,
      initialised: this.initialised,
      writes: this.writes,
      /** Transfers with R/W high. Counted, not answered — see the class note. */
      reads: this.reads,
    })
  }
}

/** The half-step ring, re-exported so the UI can draw it. */
export { HALF_STEP_SEQUENCE }

export { VCC }
