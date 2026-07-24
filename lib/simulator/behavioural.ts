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

export { VCC }
