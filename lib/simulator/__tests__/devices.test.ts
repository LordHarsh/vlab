/**
 * Regression tests for the DEVICE MODELS added for the Arduino experiments:
 * the HC-SR04, the HC-SR501 PIR, the YF-S201 flow sensor, the buzzer (both
 * kinds) and the brushed DC motor.
 *
 * solver.test.ts covers the raw Circuit API, compile.test.ts covers document →
 * network and engine.test.ts covers firmware-in-the-loop. None of them can catch
 * a device that is electrically plausible but factually wrong — an ECHO pulse
 * of the wrong width still solves, still converges, and still returns ok:true
 * while telling the student a distance that does not exist.
 *
 * EVERY expected value here is written out from the part's datasheet in the
 * comment above it and computed IN THIS FILE. Nothing is asserted against the
 * model's own output, and no expected number is copied from the implementation:
 * where the model owns a constant (58 us/cm, 7.5 Hz per L/min, 3.3 V PIR output)
 * the constant is restated here, so changing it in the model fails the test
 * rather than silently moving the goalposts.
 *
 * The behavioural devices are driven by a FAKE deterministic clock rather than
 * by avr8js, so every transition is asserted at an exact cycle. That is the
 * point: these parts are timing, and a test that could only say "roughly right"
 * would not be testing them at all.
 *
 * Run: npx tsx lib/simulator/__tests__/devices.test.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CPU } from 'avr8js'
import { Circuit } from '../solver'
import { SimulationEngine, parseIntelHex } from '../engine'
import {
  BUZZER_5V,
  Buzzer,
  DCMotor,
  HOBBY_MOTOR_6V,
  VoltageSource,
} from '../devices'
import {
  BuzzerMonitor,
  FlowSensor,
  HCSR04,
  PIRSensor,
  type BehaviouralContext,
  type DeviceState,
  type DriveLevel,
} from '../behavioural'
import { compile } from '../model/compile'
import type { CircuitDoc, DocWire, PlacedPart } from '../model/document'
import { getPart } from '../model/parts'

const CLOCK_HZ = 16_000_000

/**
 * Datasheet constants, restated rather than imported.
 *
 * Importing them from the model would make this file assert only that the model
 * agrees with itself. Written out here, the test asserts that the model agrees
 * with the DATASHEET, and a change to either one shows up as a failure.
 */
const SHEET = {
  /** HC-SR04: "uS / 58 = centimeter", 2-400 cm range, 38 ms no-echo pulse. */
  hcsr04: { microsPerCm: 58, minCm: 2, maxCm: 400, noEchoMicros: 38_000, triggerMicros: 10 },
  /** HC-SR501: 3.3 V TTL output, fixed 2.5 s block time Ti. */
  pir: { outputHighVolts: 3.3, blockSeconds: 2.5 },
  /** YF-S201: F = 7.5 x Q(L/min); 450 pulses per litre; 50% duty. */
  flow: { hzPerLpm: 7.5, pulsesPerLitre: 450 },
  /** 5 V buzzer: 30 mA rated, 7 V absolute max, ~2300 Hz internal oscillator. */
  buzzer: { ratedVolts: 5, ratedAmps: 0.03, maxVolts: 7, oscillatorHz: 2300, minOperatingVolts: 4 },
  /** 6 V brushed hobby motor: 6000 rpm and 70 mA no load, 800 mA stalled. */
  motor: { vn: 6, n0: 6000, i0: 0.07, is: 0.8 },
}

/** The AVR pin model from engine.ts §2.6 and behavioural.ts, restated. */
const R_DRIVE = 25
const G_FLOAT = 1e-8
const R_PULLDOWN = 40
const VCC = 5
/** engine.ts input thresholds: VIL = 0.3·Vcc, VIH = 0.6·Vcc. */
const VIH = 0.6 * VCC

// ─── Harness ──────────────────────────────────────────────────────────────────

interface Row {
  group: string
  name: string
  expected: string
  actual: string
  pass: boolean
  note?: string
}
const rows: Row[] = []
let currentGroup = ''
function group(g: string): void {
  currentGroup = g
}
function record(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  rows.push({ group: currentGroup, name, expected, actual, pass, note })
}
function fmt(x: number): string {
  if (!Number.isFinite(x)) return String(x)
  const a = Math.abs(x)
  if (a !== 0 && (a < 1e-4 || a >= 1e7)) return x.toExponential(6)
  return x.toPrecision(10)
}
/** Assert against a theory value, absolute tolerance. NaN/Infinity always fails. */
function near(name: string, actual: number, expected: number, tol: number, unit = ''): void {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol
  record(
    name,
    pass,
    `${fmt(expected)}${unit} ±${fmt(tol)}`,
    `${fmt(actual)}${unit}`,
    pass ? undefined : `err ${Math.abs(actual - expected).toExponential(3)} > tol ${tol.toExponential(3)}`,
  )
}
/** Assert an exact integer — a cycle count, a pulse count. */
function exact(name: string, actual: number, expected: number, unit = ''): void {
  const pass = actual === expected
  record(name, pass, `${expected}${unit}`, `${actual}${unit}`)
}
function truth(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  record(name, pass, expected, actual, note)
}

// ─── Deterministic clock, standing in for avr8js ──────────────────────────────

/**
 * A CPU with nothing but a cycle counter and an event list.
 *
 * Behavioural devices schedule their transitions with cpu.addClockEvent, so a
 * fake clock is enough to exercise every one of them, and it makes the
 * assertions EXACT: a transition lands on a specific cycle, not "somewhere in
 * this millisecond". Firmware is not needed to test a sensor's protocol, and
 * using it would make the timing depend on the compiler.
 */
class FakeClock {
  cycles = 0
  private events: Array<{ at: number; cb: () => void }> = []

  addClockEvent(cb: () => void, cycles: number): () => void {
    this.events.push({ at: this.cycles + cycles, cb })
    return cb
  }
  updateClockEvent(): boolean {
    return false
  }
  clearClockEvent(cb: () => void): boolean {
    const i = this.events.findIndex((e) => e.cb === cb)
    if (i < 0) return false
    this.events.splice(i, 1)
    return true
  }

  /** Advance to an absolute cycle, firing every event due on the way, in order. */
  runTo(cycle: number): void {
    for (;;) {
      let best = -1
      for (let i = 0; i < this.events.length; i++) {
        if (this.events[i].at <= cycle && (best < 0 || this.events[i].at < this.events[best].at)) {
          best = i
        }
      }
      if (best < 0) break
      const e = this.events.splice(best, 1)[0]
      this.cycles = e.at
      e.cb()
    }
    this.cycles = cycle
  }
}

interface DriveRecord {
  cycle: number
  signal: string
  level: DriveLevel
  volts: number
}

/**
 * A BehaviouralContext backed by the fake clock.
 *
 * drive() DE-DUPLICATES exactly as engine.ts does, so the recorded list is a
 * list of real transitions. Without that, a device that re-asserts the same
 * level on every poll would look like it was toggling.
 */
class Harness implements BehaviouralContext {
  clock = new FakeClock()
  cpu = this.clock as unknown as CPU
  volts: Record<string, number> = {}
  propValues: Record<string, number | string> = {}
  drives: DriveRecord[] = []
  states: DeviceState[] = []
  private held = new Map<string, DriveLevel>()

  private heldVolts = new Map<string, number>()

  drive(signal: string, level: DriveLevel, v = VCC): void {
    // Level AND voltage, exactly as both engines de-duplicate. An analog part
    // re-drives 'high' at a new value every update, and dropping those would
    // make a pulse sensor look like a single step.
    if (this.held.get(signal) === level && this.heldVolts.get(signal) === v) return
    this.held.set(signal, level)
    this.heldVolts.set(signal, v)
    this.drives.push({ cycle: this.clock.cycles, signal, level, volts: v })
  }
  voltage(signal: string): number {
    return this.volts[signal] ?? 0
  }
  /** A signal is "present" here when the harness has given it a voltage. */
  hasSignal(signal: string): boolean {
    return signal in this.volts
  }
  props(): Record<string, number | string> {
    return this.propValues
  }
  report(state: DeviceState): void {
    this.states.push(state)
  }

  /** Transitions of one signal, in order. */
  edges(signal: string): DriveRecord[] {
    return this.drives.filter((d) => d.signal === signal)
  }
  /** The most recently reported state, or an empty object. */
  last(): DeviceState {
    return this.states[this.states.length - 1] ?? {}
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('1. HC-SR04 ultrasonic — ECHO pulse width IS the measurement')
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Trigger the sensor and return every ECHO transition.
 *
 * The trigger is a real measured pulse on the TRIG net, not a function call: the
 * model watches the solved voltage, so a sketch that forgets its 10 us pulse has
 * to get nothing back.
 */
function triggerHcsr04(
  distanceCm: number,
  opts: { triggerMicros?: number; supplyVolts?: number } = {},
): { h: Harness; echo: DriveRecord[]; startCycle: number } {
  const h = new Harness()
  h.volts.VCC = opts.supplyVolts ?? 5
  h.volts.TRIG = 0
  h.propValues = { distance: distanceCm }
  const dev = new HCSR04('u1', h)
  dev.poll()

  const start = 1_000
  h.clock.runTo(start)
  h.volts.TRIG = 5
  dev.poll() // rising edge of TRIG

  const width = Math.round((opts.triggerMicros ?? SHEET.hcsr04.triggerMicros) * 16)
  h.clock.runTo(start + width)
  h.volts.TRIG = 0
  dev.poll() // falling edge — the module latches here

  // Long enough for the burst turnaround plus the longest pulse the part emits.
  h.clock.runTo(start + width + 16 * (SHEET.hcsr04.noEchoMicros + 2000))
  return { h, echo: h.edges('ECHO'), startCycle: start + width }
}

/** Width of the single high ECHO pulse, in CPU cycles, or -1 if there was none. */
function echoWidthCycles(echo: DriveRecord[]): number {
  const rise = echo.find((e) => e.level === 'high')
  if (!rise) return -1
  const fall = echo.find((e) => e.level === 'low' && e.cycle > rise.cycle)
  return fall ? fall.cycle - rise.cycle : -1
}

{
  /**
   * Datasheet: "uS / 58 = centimeter". At 100 cm the module must hold ECHO high
   * for 100 x 58 = 5800 us, which at 16 MHz is 5800 x 16 = 92 800 cycles.
   */
  const { echo } = triggerHcsr04(100)
  const expectedMicros = 100 * SHEET.hcsr04.microsPerCm
  exact('100 cm → ECHO high for 92 800 cycles', echoWidthCycles(echo), expectedMicros * 16, ' cyc')
  near('   which is 5800 us', echoWidthCycles(echo) / 16, 5800, 0, ' us')

  /**
   * The inverse must round-trip: the sketch divides the pulse width by 58, so
   * the distance it computes has to be the distance the student set. This is the
   * assertion a student's Serial Monitor actually depends on.
   */
  const recovered = echoWidthCycles(echo) / 16 / SHEET.hcsr04.microsPerCm
  near('   and pulseIn()/58 recovers the distance', recovered, 100, 1e-9, ' cm')
}

{
  // Both ends of the datasheet's 2-400 cm ranging window.
  for (const cm of [SHEET.hcsr04.minCm, 10, 57, 200, SHEET.hcsr04.maxCm]) {
    const { echo } = triggerHcsr04(cm)
    exact(
      `${cm} cm → ${cm * SHEET.hcsr04.microsPerCm} us of ECHO`,
      echoWidthCycles(echo),
      cm * SHEET.hcsr04.microsPerCm * 16,
      ' cyc',
    )
  }
}

{
  /**
   * Datasheet: "if no obstacle is detected, the output pin will give a 38ms high
   * level signal". Anything outside 2-400 cm is out of range, and the module's
   * own timeout marker is what a sketch sees — not silence, which pulseIn()
   * could not distinguish from a broken wire.
   */
  for (const cm of [401, 1]) {
    const { echo } = triggerHcsr04(cm)
    exact(
      `${cm} cm is out of range → 38 ms timeout pulse`,
      echoWidthCycles(echo),
      SHEET.hcsr04.noEchoMicros * 16,
      ' cyc',
    )
  }
}

{
  /**
   * Datasheet: "you only need to supply a short 10uS pulse to the trigger
   * input". A 4 us pulse is not a trigger, and the module must stay silent
   * rather than inventing a reading — the student's bug has to be visible.
   */
  const { echo } = triggerHcsr04(100, { triggerMicros: 4 })
  truth(
    'a 4 us trigger is too short — no ECHO at all',
    echoWidthCycles(echo) === -1,
    'no high pulse',
    echoWidthCycles(echo) === -1 ? 'no high pulse' : `${echoWidthCycles(echo)} cyc`,
  )
}

{
  // An unwired VCC means an unpowered module. It must drive nothing at all —
  // not a low, which would look like a working sensor reading zero.
  const { echo } = triggerHcsr04(100, { supplyVolts: 0 })
  truth(
    'VCC unwired → the module never drives ECHO',
    echo.every((e) => e.level === 'release'),
    'released only',
    echo.map((e) => e.level).join(',') || '(none)',
  )
}

{
  /**
   * ECHO idles LOW on a powered module, not floating. A floating ECHO would let
   * the MCU's own input model decide the level, and pulseIn() would trigger on
   * noise instead of on the sensor.
   */
  const { echo } = triggerHcsr04(50)
  truth(
    'a powered module holds ECHO low between measurements',
    echo[1]?.level === 'low' && echo[echo.length - 1].level === 'low',
    'low … low',
    `${echo[1]?.level} … ${echo[echo.length - 1].level}`,
  )
  // The ECHO output is push-pull from the module's own 5 V rail.
  const rise = echo.find((e) => e.level === 'high')!
  near('   and drives ECHO high to its 5 V rail', rise.volts, 5, 0, ' V')
}

// ══════════════════════════════════════════════════════════════════════════════
group('2. HC-SR501 PIR — hold time, block time and the 3.3 V output')
// ══════════════════════════════════════════════════════════════════════════════

function pir(props: Record<string, number>): { h: Harness; dev: PIRSensor } {
  const h = new Harness()
  h.volts.VCC = 5
  h.propValues = { ...props }
  return { h, dev: new PIRSensor('p1', h) }
}

const SECOND = CLOCK_HZ

{
  /**
   * Datasheet: "Output: High 3.3V / Low 0V". This is NOT the supply rail, and it
   * matters: 3.3 V is only just above the ATmega's VIH of 0.6 x 5 = 3.0 V, which
   * is why a PIR works on a 5 V Arduino but has no margin to spare.
   */
  const { h } = pir({ motion: 1, hold: 5 })
  h.clock.runTo(SECOND)
  const rise = h.edges('OUT').find((e) => e.level === 'high')
  truth('motion → OUT goes high', !!rise, 'a high edge', rise ? 'high' : '(none)')
  near('   at the datasheet 3.3 V, not the 5 V rail', rise?.volts ?? 0, SHEET.pir.outputHighVolts, 0, ' V')
}

{
  /**
   * Hold time Tx. Motion is present for the first second and then stops; the
   * output must stay high until hold seconds AFTER the last motion, i.e. fall at
   * 1 + 5 = 6 s = 96 000 000 cycles. (Retriggerable mode — the factory H jumper.)
   */
  const hold = 5
  const { h } = pir({ motion: 1, hold })
  h.clock.runTo(1 * SECOND)
  h.propValues.motion = 0
  h.clock.runTo(10 * SECOND)

  const fall = h.edges('OUT').find((e) => e.level === 'low' && e.cycle > 0)
  exact('OUT falls hold seconds after motion stops', fall?.cycle ?? -1, (1 + hold) * SECOND, ' cyc')
  near('   i.e. at t = 6.0 s', (fall?.cycle ?? 0) / CLOCK_HZ, 1 + hold, 0, ' s')
}

{
  // Retriggerable: continuous motion keeps pushing the window out, so a 3 s hold
  // does not expire while someone is still standing there.
  const { h } = pir({ motion: 1, hold: 3 })
  h.clock.runTo(20 * SECOND)
  const falls = h.edges('OUT').filter((e) => e.level === 'low')
  truth(
    'continuous motion retriggers — OUT never falls',
    falls.length === 0,
    'no falling edge in 20 s',
    `${falls.length} falling edges`,
  )
}

{
  /**
   * Block time Ti, fixed at 2.5 s on an HC-SR501: after OUT falls the module
   * ignores triggers for 2.5 s. Motion stops at 1 s with a 2 s hold, so OUT
   * falls at 3 s; motion returns immediately, and the next rise must be at
   * 3 + 2.5 = 5.5 s.
   */
  const { h } = pir({ motion: 1, hold: 2 })
  h.clock.runTo(1 * SECOND)
  h.propValues.motion = 0
  h.clock.runTo(3 * SECOND)
  h.propValues.motion = 1
  h.clock.runTo(10 * SECOND)

  const rises = h.edges('OUT').filter((e) => e.level === 'high')
  const fall = h.edges('OUT').find((e) => e.level === 'low' && e.cycle > 0)!
  exact('OUT falls at 3.0 s (1 s of motion + 2 s hold)', fall.cycle, 3 * SECOND, ' cyc')
  exact(
    '   and cannot retrigger until Ti = 2.5 s later',
    rises[1]?.cycle ?? -1,
    (3 + SHEET.pir.blockSeconds) * SECOND,
    ' cyc',
  )
}

{
  /**
   * Warm-up. A real HC-SR501 needs 30-60 s of induction lockout after power-on.
   * It defaults to 0 here so the sim stays usable, but the mechanism is real:
   * with warmup = 30 the output must stay low for exactly 30 s of simulated
   * time even though motion is present the whole while.
   */
  const warmup = 30
  const { h } = pir({ motion: 1, hold: 5, warmup })
  h.clock.runTo(60 * SECOND)
  const rise = h.edges('OUT').find((e) => e.level === 'high')
  exact('warm-up holds OUT low for the full 30 s', rise?.cycle ?? -1, warmup * SECOND, ' cyc')

  const { h: h0 } = pir({ motion: 1, hold: 5 })
  h0.clock.runTo(2 * SECOND)
  const rise0 = h0.edges('OUT').find((e) => e.level === 'high')
  truth(
    '   and warm-up defaults to 0, so the part responds at once',
    (rise0?.cycle ?? Infinity) <= CLOCK_HZ / 1000,
    'high within 1 ms',
    `${((rise0?.cycle ?? -1) / CLOCK_HZ).toFixed(4)} s`,
  )
}

{
  // Unpowered: no supply, no output driver. Releasing is the only honest state.
  const h = new Harness()
  h.volts.VCC = 0
  h.propValues = { motion: 1 }
  new PIRSensor('p1', h)
  h.clock.runTo(5 * SECOND)
  truth(
    'VCC unwired → OUT is never driven',
    h.edges('OUT').every((e) => e.level === 'release'),
    'released only',
    h.edges('OUT').map((e) => e.level).join(',') || '(none)',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('3. YF-S201 flow sensor — F = 7.5 x Q, 450 pulses per litre')
// ══════════════════════════════════════════════════════════════════════════════

function flow(lpm: number, supplyVolts = 5): { h: Harness; dev: FlowSensor } {
  const h = new Harness()
  h.volts.VCC = supplyVolts
  h.propValues = { flow: lpm }
  return { h, dev: new FlowSensor('f1', h) }
}

{
  /**
   * Datasheet: F(Hz) = 7.5 x Q(L/min). At 10 L/min that is exactly 75 Hz, so the
   * time between successive falling edges must be 16e6/75 = 213 333.3 cycles.
   * A whole number of cycles cannot be exactly that, so the model rounds the
   * HALF period; the resulting frequency is within 0.001 Hz of 75.
   */
  const lpm = 10
  const { h } = flow(lpm)
  h.clock.runTo(2 * SECOND)
  const falling = h.edges('SIG').filter((e) => e.level === 'low')
  const period = falling[1].cycle - falling[0].cycle
  const hz = CLOCK_HZ / period
  near('10 L/min → 75.0 Hz measured between falling edges', hz, lpm * SHEET.flow.hzPerLpm, 0.01, ' Hz')

  // Datasheet: "duty ratio 50%". Low time and high time must be equal.
  const rising = h.edges('SIG').filter((e) => e.level === 'release' && e.cycle > falling[0].cycle)
  const lowTime = rising[0].cycle - falling[0].cycle
  const highTime = falling[1].cycle - rising[0].cycle
  exact('   at a 50% duty ratio (low time = high time)', lowTime, highTime, ' cyc')
}

{
  // Every point in the datasheet's 1-30 L/min working range.
  for (const lpm of [1, 5, 20, 30]) {
    const { h } = flow(lpm)
    h.clock.runTo(3 * SECOND)
    const falling = h.edges('SIG').filter((e) => e.level === 'low')
    const hz = CLOCK_HZ / (falling[1].cycle - falling[0].cycle)
    near(`${lpm} L/min → ${lpm * SHEET.flow.hzPerLpm} Hz`, hz, lpm * SHEET.flow.hzPerLpm, 0.02, ' Hz')
  }
}

{
  /**
   * The datasheet's two numbers have to be consistent with each other:
   * 7.5 Hz per L/min x 60 s = 450 pulses per litre. Run 30 L/min for 2 s — that
   * is exactly one litre — and the sensor must have emitted 450 pulses.
   */
  const { h } = flow(30)
  h.clock.runTo(2 * SECOND)
  const pulses = h.edges('SIG').filter((e) => e.level === 'low').length
  exact('one litre through the meter = 450 pulses', pulses, SHEET.flow.pulsesPerLitre, ' pulses')
  near('   and the reported volume is 1.000 L', Number(h.last().litres), 1, 1e-9, ' L')
}

{
  // A closed tap is silence, not a stuck level: the hall switch is off and the
  // open-collector output releases, letting the pull-up own the line.
  const { h } = flow(0)
  h.clock.runTo(3 * SECOND)
  truth(
    '0 L/min → no pulses, line released',
    h.edges('SIG').every((e) => e.level === 'release'),
    'released only',
    h.edges('SIG').map((e) => e.level).join(',') || '(none)',
  )
  near('   and the reported rate is 0 Hz', Number(h.last().hertz), 0, 0, ' Hz')
}

{
  const { h } = flow(10, 0)
  h.clock.runTo(3 * SECOND)
  truth(
    'VCC unwired → the hall switch never fires',
    h.edges('SIG').filter((e) => e.level === 'low').length === 0,
    '0 falling edges',
    `${h.edges('SIG').filter((e) => e.level === 'low').length} falling edges`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('4. Buzzer — electrical model')
// ══════════════════════════════════════════════════════════════════════════════

/** Solve a two-terminal device across an ideal source. */
function acrossSource(volts: number, make: (a: number, b: number) => Buzzer | DCMotor) {
  const c = new Circuit()
  const n = c.allocNet()
  c.add(new VoltageSource('v', n, 0, volts))
  const dev = make(n, 0)
  c.add(dev)
  const res = c.solve()
  return { res, dev }
}

{
  truth(
    'the model carries the datasheet numbers this file restates',
    BUZZER_5V.ratedVolts === SHEET.buzzer.ratedVolts &&
      BUZZER_5V.ratedAmps === SHEET.buzzer.ratedAmps &&
      BUZZER_5V.maxVolts === SHEET.buzzer.maxVolts &&
      BUZZER_5V.oscillatorHz === SHEET.buzzer.oscillatorHz,
    '5 V / 30 mA / 7 V max / 2300 Hz',
    `${BUZZER_5V.ratedVolts} V / ${BUZZER_5V.ratedAmps * 1000} mA / ${BUZZER_5V.maxVolts} V / ${BUZZER_5V.oscillatorHz} Hz`,
  )
}

{
  /**
   * An ACTIVE buzzer is a resistive load: rated 5 V at 30 mA is 5/0.03 = 166.67
   * ohm, so across a 5 V rail it draws exactly its rated 30 mA.
   */
  const { res, dev } = acrossSource(5, (a, b) => new Buzzer('bz', a, b, false))
  truth('active buzzer solves', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  near('active buzzer at 5 V draws its rated 30 mA', dev.current, SHEET.buzzer.ratedAmps, 1e-12, ' A')
  near(
    '   which is a load of 166.67 Ω',
    5 / dev.current,
    SHEET.buzzer.ratedVolts / SHEET.buzzer.ratedAmps,
    1e-6,
    ' Ω',
  )
}

{
  /**
   * A PASSIVE buzzer is a bare piezo element — a capacitor. At a DC operating
   * point it is an OPEN, so the honest current is zero (the 1e-12 S the
   * Capacitor stamps at DC, times 5 V). Reporting the same 30 mA an active
   * buzzer draws would be a wrong number, not a simplification.
   */
  const { res, dev } = acrossSource(5, (a, b) => new Buzzer('bz', a, b, true))
  truth('passive buzzer solves', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  truth(
    'passive buzzer passes no DC current (it is a capacitor)',
    Math.abs(dev.current) < 1e-10,
    '< 0.1 nA',
    `${dev.current.toExponential(3)} A`,
  )
}

{
  // Datasheet absolute maximum 7 V. 5 V is inside it; 9 V destroys the part.
  const ok = acrossSource(5, (a, b) => new Buzzer('bz', a, b, false))
  truth('at 5 V there is no fault', ok.res.faults.length === 0, '0 faults', `${ok.res.faults.length} faults`)

  const bad = acrossSource(9, (a, b) => new Buzzer('bz', a, b, false))
  const f = bad.res.faults.find((x) => x.deviceId === 'bz')
  truth(
    '9 V is past the 7 V absolute maximum → destructive',
    f?.severity === 'destructive' && f.kind === 'over_power',
    'over_power / destructive',
    f ? `${f.kind} / ${f.severity}` : '(no fault)',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('5. Buzzer — what it is actually playing')
// ══════════════════════════════════════════════════════════════════════════════

/** Drive the monitor with a square wave of `hz` for `cycles`, from cycle 0. */
function squareWave(h: Harness, dev: BuzzerMonitor, hz: number, periods: number): void {
  const period = Math.round(CLOCK_HZ / hz)
  for (let k = 0; k < periods; k++) {
    h.clock.runTo(k * period)
    h.volts.P = 5
    dev.poll()
    h.clock.runTo(k * period + period / 2)
    h.volts.P = 0
    dev.poll()
  }
  h.clock.runTo(periods * period)
  h.volts.P = 5
  dev.poll()
}

{
  /**
   * A passive piezo plays whatever it is driven at. tone(pin, 1000) toggles the
   * pin every 500 us, so successive rising edges are 16 000 cycles apart and the
   * reported pitch must be 16e6/16000 = 1000 Hz exactly.
   */
  const h = new Harness()
  h.propValues = { passive: 1 }
  const dev = new BuzzerMonitor('bz', h, BUZZER_5V)
  squareWave(h, dev, 1000, 4)
  near('a passive buzzer driven at 1000 Hz reports 1000 Hz', Number(h.last().hertz), 1000, 1e-9, ' Hz')
  truth('   and reports that it is sounding', h.last().sounding === true, 'true', String(h.last().sounding))
}

{
  // The measurement is a real period measurement, so it tracks any pitch.
  for (const hz of [262, 440, 2093]) {
    const h = new Harness()
    h.propValues = { passive: 1 }
    const dev = new BuzzerMonitor('bz', h, BUZZER_5V)
    squareWave(h, dev, hz, 4)
    // The model can only toggle on whole cycles, so the pitch it can express is
    // 16e6/round(16e6/hz) — computed here from the same rounding, not copied.
    const expressible = CLOCK_HZ / Math.round(CLOCK_HZ / hz)
    near(`   ${hz} Hz drive → ${expressible.toFixed(3)} Hz reported`, Number(h.last().hertz), expressible, 1e-9, ' Hz')
  }
}

{
  /**
   * The lesson every student learns once: digitalWrite(HIGH) on a PASSIVE buzzer
   * makes no sound. A piezo element only moves when the voltage across it
   * changes, so a steady 5 V has to report silence.
   */
  const h = new Harness()
  h.propValues = { passive: 1 }
  const dev = new BuzzerMonitor('bz', h, BUZZER_5V)
  h.volts.P = 5
  dev.poll()
  h.clock.runTo(Math.round(0.5 * CLOCK_HZ))
  dev.refresh()
  truth(
    'a passive buzzer held at a steady 5 V is silent',
    h.last().sounding === false && Number(h.last().hertz) === 0,
    'sounding:false, 0 Hz',
    `sounding:${h.last().sounding}, ${h.last().hertz} Hz`,
  )
}

{
  /**
   * An ACTIVE buzzer is the mirror image: it carries its own oscillator, so a
   * steady 5 V makes it sound at its own fixed ~2300 Hz, and the drive waveform
   * is irrelevant.
   */
  const h = new Harness()
  h.propValues = { passive: 0 }
  const dev = new BuzzerMonitor('bz', h, BUZZER_5V)
  h.volts.P = 5
  dev.poll()
  truth(
    'an active buzzer held at 5 V sounds',
    h.last().sounding === true,
    'sounding:true',
    `sounding:${h.last().sounding}`,
  )
  near('   at its own internal 2300 Hz', Number(h.last().hertz), SHEET.buzzer.oscillatorHz, 0, ' Hz')

  // Datasheet operating range 4-7 V: below 4 V the oscillator does not run.
  h.volts.P = 2
  dev.poll()
  truth(
    '   and is silent below its 4 V minimum operating voltage',
    h.last().sounding === false,
    'sounding:false',
    `sounding:${h.last().sounding}`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('6. DC motor — datasheet load line, speed and direction')
// ══════════════════════════════════════════════════════════════════════════════

const M = SHEET.motor
/** Ra = Vn/Is, the locked-rotor resistance. */
const RA = M.vn / M.is
/** Ke = (Vn − I0·Ra)/w0, volts per rpm. */
const KE = (M.vn - M.i0 * RA) / M.n0

{
  truth(
    'the model carries the datasheet numbers this file restates',
    HOBBY_MOTOR_6V.ratedVolts === M.vn &&
      HOBBY_MOTOR_6V.noLoadRpm === M.n0 &&
      HOBBY_MOTOR_6V.noLoadAmps === M.i0 &&
      HOBBY_MOTOR_6V.stallAmps === M.is,
    '6 V / 6000 rpm / 70 mA / 800 mA',
    `${HOBBY_MOTOR_6V.ratedVolts} V / ${HOBBY_MOTOR_6V.noLoadRpm} rpm / ${HOBBY_MOTOR_6V.noLoadAmps * 1000} mA / ${HOBBY_MOTOR_6V.stallAmps * 1000} mA`,
  )
}

{
  /**
   * Free-running at nominal voltage the motor must draw its datasheet no-load
   * current — 70 mA, NOT the 800 mA its coil resistance alone would suggest.
   * Back-EMF is what limits a spinning motor, and getting this wrong is an
   * order-of-magnitude error that would have every kit motor faulting the pin.
   */
  const { res, dev } = acrossSource(M.vn, (a, b) => new DCMotor('m', a, b, 0))
  const m = dev as DCMotor
  truth('free-running motor solves', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  near('6 V, no load → the datasheet 70 mA', m.current, M.i0, 1e-12, ' A')
  near('   i.e. it looks like Vn/I0 = 85.71 Ω, not Ra = 7.5 Ω', m.effectiveOhms, M.vn / M.i0, 1e-9, ' Ω')
  near('   and turns at its no-load 6000 rpm', m.rpmFor(m.current), M.n0, 1e-6, ' rpm')
  near('   coil resistance is Ra = Vn/Is = 7.5 Ω', m.coilOhms, RA, 1e-12, ' Ω')
}

{
  // Half the voltage, half the speed and half the current — the machine is
  // linear when free-running, which is the whole basis of PWM speed control.
  const { dev } = acrossSource(M.vn / 2, (a, b) => new DCMotor('m', a, b, 0))
  const m = dev as DCMotor
  near('3 V, no load → 35 mA', m.current, M.i0 / 2, 1e-12, ' A')
  near('   and 3000 rpm', m.rpmFor(m.current), M.n0 / 2, 1e-6, ' rpm')
}

{
  /**
   * Fully loaded, the back-EMF is gone: the motor IS its coil resistance and
   * draws the datasheet stall current of 800 mA at 0 rpm. w = (V − i·Ra)/Ke with
   * i = V/Ra gives exactly zero, at every voltage.
   */
  const { dev } = acrossSource(M.vn, (a, b) => new DCMotor('m', a, b, 1))
  const m = dev as DCMotor
  near('6 V, locked rotor → the datasheet 800 mA stall current', m.current, M.is, 1e-12, ' A')
  near('   i.e. the motor is now exactly Ra', m.effectiveOhms, RA, 1e-9, ' Ω')
  near('   and the shaft is stopped', m.rpmFor(m.current), 0, 1e-9, ' rpm')
}

{
  /**
   * Half load at nominal voltage. The datasheet current line is straight from
   * (no load, I0) to (stall, Is), so i = I0 + 0.5(Is − I0) = 0.435 A, and
   * w = (Vn − i·Ra)/Ke = (6 − 3.2625)/9.125e-4 = 3000 rpm — half speed, which is
   * the other end of the same straight line.
   */
  const { dev } = acrossSource(M.vn, (a, b) => new DCMotor('m', a, b, 0.5))
  const m = dev as DCMotor
  const iExpected = M.i0 + 0.5 * (M.is - M.i0)
  near('6 V, half load → 435 mA', m.current, iExpected, 1e-12, ' A')
  near('   at 3000 rpm', m.rpmFor(m.current), (M.vn - iExpected * RA) / KE, 1e-6, ' rpm')
}

{
  // Reverse the leads and the shaft reverses. The sign of the current is the
  // direction, which is what an H-bridge experiment depends on.
  const { dev } = acrossSource(-M.vn, (a, b) => new DCMotor('m', a, b, 0))
  const m = dev as DCMotor
  near('leads reversed → −70 mA', m.current, -M.i0, 1e-12, ' A')
  near('   and −6000 rpm (the same speed, the other way)', m.rpmFor(m.current), -M.n0, 1e-6, ' rpm')
}

{
  /**
   * The claim the ENGINE relies on: speed is LINEAR in current, so the exact
   * time-weighted average of a PWM-driven motor's current converts straight into
   * its average speed. A 40% duty cycle between 0 V and 6 V must report 40% of
   * the no-load speed. If rpmFor() ever stops being linear this fails and the
   * engine's averaging silently starts lying.
   */
  const m = new DCMotor('m', 1, 0, 0)
  const duty = 0.4
  const meanCurrent = duty * M.i0 + (1 - duty) * 0
  near(
    'rpm of the mean current = mean of the rpms (PWM averaging is exact)',
    m.rpmFor(meanCurrent),
    duty * m.rpmFor(M.i0) + (1 - duty) * m.rpmFor(0),
    1e-9,
    ' rpm',
  )
  near('   40% duty on a 6 V motor → 2400 rpm', m.rpmFor(meanCurrent), duty * M.n0, 1e-6, ' rpm')
}

{
  // Safety. A locked rotor at nominal voltage is a caution: it survives, hot.
  const stalled = acrossSource(M.vn, (a, b) => new DCMotor('m', a, b, 1))
  const f1 = stalled.res.faults.find((x) => x.deviceId === 'm')
  truth(
    'a stalled motor is flagged as a caution, not a death',
    f1?.severity === 'caution' && f1.kind === 'over_current',
    'over_current / caution',
    f1 ? `${f1.kind} / ${f1.severity}` : '(no fault)',
  )

  // Free-running at nominal voltage is exactly what the part is for.
  const fine = acrossSource(M.vn, (a, b) => new DCMotor('m', a, b, 0))
  truth(
    'a free-running motor at 6 V raises nothing',
    fine.res.faults.length === 0,
    '0 faults',
    `${fine.res.faults.length} faults`,
  )

  // 1.5x nominal is the absolute maximum; past it the insulation fails.
  const fried = acrossSource(1.6 * M.vn, (a, b) => new DCMotor('m', a, b, 0))
  const f2 = fried.res.faults.find((x) => x.deviceId === 'm')
  truth(
    '9.6 V on a 6 V motor is destructive',
    f2?.severity === 'destructive' && f2.kind === 'over_power',
    'over_power / destructive',
    f2 ? `${f2.kind} / ${f2.severity}` : '(no fault)',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('7. The new parts inside a real document')
// ══════════════════════════════════════════════════════════════════════════════

let seq = 0
function wire(from: [string, string], to: [string, string]): DocWire {
  return {
    id: `w${++seq}`,
    from: { partId: from[0], pinId: from[1] },
    to: { partId: to[0], pinId: to[1] },
    color: '#000',
  }
}
function place(id: string, type: string, props: Record<string, number | string> = {}): PlacedPart {
  return { id, type, x: 0, y: 0, rotation: 0, props }
}

{
  // Every new part must be placeable, or a student can never build with it.
  for (const type of ['hc_sr04', 'pir_motion', 'flow_sensor', 'buzzer', 'dc_motor']) {
    const def = getPart(type)
    truth(
      `${type} is in the palette with art and pins`,
      def.pins.length >= 2 && def.svg.length > 0 && def.width > 0 && def.height > 0,
      'pins + art',
      `${def.pins.length} pins, ${def.svg.length} chars of svg, ${def.width.toFixed(0)}x${def.height.toFixed(0)}`,
    )
  }

  /**
   * Sensor GND must be a PASSIVE pin, not a `gnd` one. compile() collapses every
   * `gnd` pin onto net 0 whether or not a wire reaches it, so typing it `gnd`
   * would silently ground an unwired sensor — turning the commonest beginner
   * mistake into a circuit that works.
   */
  for (const type of ['hc_sr04', 'pir_motion', 'flow_sensor', 'dht11']) {
    const gnd = getPart(type).pins.find((p) => p.id === 'GND')!
    truth(
      `${type} GND is a wire the student has to run`,
      gnd.type === 'passive',
      'passive',
      gnd.type,
    )
  }
}

{
  // The HC-SR04 as exp 2 wires it: VCC→5V, GND→GND, TRIG→D9, ECHO→D10.
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('us', 'hc_sr04', { distance: 100 })],
    wires: [
      wire(['us', 'VCC'], ['uno', '5V']),
      wire(['us', 'GND'], ['uno', 'GND.1']),
      wire(['us', 'TRIG'], ['uno', 'D9']),
      wire(['us', 'ECHO'], ['uno', 'D10']),
    ],
  }
  const c = compile(doc)
  const b = c.behavioural.find((x) => x.partId === 'us')
  truth('HC-SR04 compiles to a behavioural part', !!b, 'one entry', b ? b.protocol : '(none)')
  truth(
    '   with a driven ECHO port and readable TRIG/VCC nets',
    !!b?.ports.ECHO && b.nets.TRIG !== undefined && b.nets.VCC !== undefined,
    'ECHO port + TRIG/VCC nets',
    b ? `${Object.keys(b.ports)} / ${Object.keys(b.nets)}` : '(none)',
  )
  truth('   and no wiring problems', c.problems.length === 0, '0 problems', c.problems.join(' | ') || '0 problems')
}

{
  /**
   * A PIR's OUT pin driving a floating MCU input. The sensor drives 3.3 V behind
   * R_PULLDOWN = 40 Ω into the pin's 1e-8 S input model, so
   *   V = (3.3/40) / (1/40 + 1e-8 + gmin) = 3.29999868 V
   * — which clears the ATmega's VIH of 3.0 V, but by only 0.3 V. That thin
   * margin is real and the model must not paper over it by driving 5 V.
   */
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('pir', 'pir_motion', { motion: 1 })],
    wires: [
      wire(['pir', 'VCC'], ['uno', '5V']),
      wire(['pir', 'GND'], ['uno', 'GND.1']),
      wire(['pir', 'OUT'], ['uno', 'D7']),
    ],
  }
  const c = compile(doc)
  const b = c.behavioural.find((x) => x.partId === 'pir')!
  b.ports.OUT.set(1 / R_PULLDOWN, SHEET.pir.outputHighVolts / R_PULLDOWN)
  const res = c.circuit.solve()
  const v = res.voltages[c.netOf.get('pir OUT')!]
  const expected =
    SHEET.pir.outputHighVolts / R_PULLDOWN / (1 / R_PULLDOWN + G_FLOAT + 1e-12)
  near('PIR OUT drives its net to 3.2999987 V', v, expected, 1e-9, ' V')
  truth('   which reads HIGH, with 0.3 V to spare over VIH', v > VIH, `> ${VIH} V`, `${v.toFixed(4)} V`)
}

{
  /**
   * An active buzzer straight off D8, as exp 6 wires it. The pin is a 5 V source
   * behind R_DRIVE = 25 Ω and the buzzer is 166.67 Ω, so
   *   V = (5/25)/(1/25 + 0.03/5) = 4.347826 V,  I = V x 0.006 = 26.09 mA.
   * That is past the ATmega's 20 mA recommended per-pin current, and the pin
   * has to say so — driving a buzzer directly is exactly the mistake this
   * check exists for.
   */
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('bz', 'buzzer', {})],
    wires: [wire(['bz', 'P'], ['uno', 'D8']), wire(['bz', 'N'], ['uno', 'GND.1'])],
  }
  const c = compile(doc)
  c.mcuPorts.get('D8')!.set(1 / R_DRIVE, VCC / R_DRIVE)
  const res = c.circuit.solve()
  const gB = SHEET.buzzer.ratedAmps / SHEET.buzzer.ratedVolts
  const vExpected = VCC / R_DRIVE / (1 / R_DRIVE + gB + 1e-12)
  near('active buzzer on D8 draws 26.09 mA', c.meters.get('bz')!.current, vExpected * gB, 1e-9, ' A')
  const f = res.faults.find((x) => x.deviceId === 'uno.D8')
  truth(
    '   and the pin warns it is over its 20 mA rating',
    f?.severity === 'caution' && f.kind === 'over_current',
    'over_current / caution',
    f ? `${f.kind} / ${f.severity}` : '(no fault)',
  )
}

{
  /**
   * A motor straight off a pin. Free-running it is 85.71 Ω, so
   *   V = (5/25)/(1/25 + 0.07/6) = 3.870968 V,  I = 45.16 mA
   * — past the ATmega's 40 mA ABSOLUTE maximum, so the pin is destroyed. The
   * speed the motor would reach is w = (V − I·Ra)/Ke = 3871 rpm, computed here
   * from back-EMF rather than from the model.
   */
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('m', 'dc_motor', { load: 0 })],
    wires: [wire(['m', '1'], ['uno', 'D9']), wire(['m', '2'], ['uno', 'GND.1'])],
  }
  const c = compile(doc)
  c.mcuPorts.get('D9')!.set(1 / R_DRIVE, VCC / R_DRIVE)
  const res = c.circuit.solve()
  const gM = M.i0 / M.vn
  const vExpected = VCC / R_DRIVE / (1 / R_DRIVE + gM + 1e-12)
  const iExpected = vExpected * gM
  near('motor on D9 draws 45.16 mA', c.meters.get('m')!.current, iExpected, 1e-9, ' A')
  near(
    '   and would turn at 3871 rpm (from back-EMF, V = i·Ra + Ke·w)',
    c.motors.get('m')!.rpmFor(iExpected),
    (vExpected - iExpected * RA) / KE,
    1e-6,
    ' rpm',
  )
  const f = res.faults.find((x) => x.deviceId === 'uno.D9')
  truth(
    '   and the pin is destroyed — a motor needs a driver, not a pin',
    f?.severity === 'destructive' && f.kind === 'over_current',
    'over_current / destructive',
    f ? `${f.kind} / ${f.severity}` : '(no fault)',
  )
  truth(
    '   the motor also states what it cannot show (no inertia, no inrush)',
    c.limitations.some((l) => /transient/i.test(l) && /steady state/i.test(l)),
    'a transient limitation',
    c.limitations.join(' | ') || '(none)',
  )
}

{
  // The flow sensor as exp 4 wires it, with the sensor pulling its open-collector
  // line down against the MCU's internal pull-up (20 kΩ):
  //   V = (5/20000)/(1/20000 + 1/40 + 1e-8) = 0.00998 V — a solid logic low.
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('f', 'flow_sensor', { flow: 10 })],
    wires: [
      wire(['f', 'VCC'], ['uno', '5V']),
      wire(['f', 'GND'], ['uno', 'GND.1']),
      wire(['f', 'SIG'], ['uno', 'D2']),
    ],
  }
  const c = compile(doc)
  const b = c.behavioural.find((x) => x.partId === 'f')!
  const R_PULLUP = 20_000
  c.mcuPorts.get('D2')!.set(1 / R_PULLUP, VCC / R_PULLUP)
  b.ports.SIG.set(1 / R_PULLDOWN, 0)
  const res = c.circuit.solve()
  const v = res.voltages[c.netOf.get('f SIG')!]
  const expected = VCC / R_PULLUP / (1 / R_PULLUP + 1 / R_PULLDOWN + 1e-12)
  near('flow sensor pulls D2 down to 9.98 mV against INPUT_PULLUP', v, expected, 1e-9, ' V')
  truth('   a solid logic low (VIL = 1.5 V)', v < 0.3 * VCC, '< 1.5 V', `${v.toFixed(5)} V`)
}

// ══════════════════════════════════════════════════════════════════════════════
group('8. Inside the running engine, on real firmware')
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The fake clock proves the protocols. It cannot prove that they still work when
 * avr8js owns the clock — that the self-scheduling devices really get their
 * events back, that a drive change really invalidates the memoisation cache, and
 * that the reported state really reaches the snapshot. Only running compiled
 * firmware against the whole engine shows that, so this group does.
 */
{
  const hexPath = path.join(process.cwd(), 'public', 'sim', 'blink.hex')
  const program = parseIntelHex(fs.readFileSync(hexPath, 'utf8'))

  const doc: CircuitDoc = {
    parts: [
      place('uno', 'arduino_uno'),
      place('us', 'hc_sr04', { distance: 100 }),
      place('pir', 'pir_motion', { motion: 1, hold: 5 }),
      place('flow', 'flow_sensor', { flow: 10 }),
      place('bz', 'buzzer', { passive: 0 }),
      place('m', 'dc_motor', { load: 0 }),
    ],
    wires: [
      wire(['us', 'VCC'], ['uno', '5V']),
      wire(['us', 'GND'], ['uno', 'GND.1']),
      wire(['us', 'TRIG'], ['uno', 'D9']),
      wire(['us', 'ECHO'], ['uno', 'D10']),
      wire(['pir', 'VCC'], ['uno', '5V']),
      wire(['pir', 'GND'], ['uno', 'GND.1']),
      wire(['pir', 'OUT'], ['uno', 'D7']),
      wire(['flow', 'VCC'], ['uno', '5V']),
      wire(['flow', 'GND'], ['uno', 'GND.1']),
      wire(['flow', 'SIG'], ['uno', 'D2']),
      wire(['bz', 'P'], ['uno', 'D8']),
      wire(['bz', 'N'], ['uno', 'GND.2']),
      // On D13, so blink's own firmware really drives it and the reported speed
      // is not the trivial zero of an unwired part.
      wire(['m', '1'], ['uno', 'D13']),
      wire(['m', '2'], ['uno', 'GND.3']),
    ],
  }

  const eng = new SimulationEngine(program, doc)
  eng.run(300_000) // 0.3 s of simulated time
  const s = eng.snapshot()

  truth('a circuit with all five new parts solves', s.solveError === null, 'no error', s.solveError ?? 'no error')
  truth(
    'every behavioural part reports its state into the snapshot',
    ['us', 'pir', 'flow', 'bz', 'm'].every((id) => s.deviceStates[id] !== undefined),
    'us, pir, flow, bz, m',
    Object.keys(s.deviceStates).sort().join(', '),
  )

  /**
   * The self-clocked devices really got their clock events back from avr8js.
   * 0.3 s at 10 L/min is 75 Hz x 0.3 = 22.5 pulses, so at least 20 must have
   * been emitted — the fake clock cannot test this, and a device whose events
   * were silently dropped would look identical in every other assertion.
   */
  const pulses = Number(s.deviceStates.flow.pulses)
  truth(
    'the flow sensor really pulsed under avr8js (≈22 in 0.3 s at 75 Hz)',
    pulses >= 20 && pulses <= 25,
    '20-25 pulses',
    `${pulses} pulses`,
  )
  near(
    '   and the reported volume matches pulses/450',
    Number(s.deviceStates.flow.litres),
    pulses / SHEET.flow.pulsesPerLitre,
    1e-12,
    ' L',
  )

  // The PIR saw the motion prop with no pin activity of its own to wake it.
  truth('the PIR picked up motion from its prop alone', s.deviceStates.pir.motion === true, 'true', String(s.deviceStates.pir.motion))

  /**
   * The motor's reported speed must be exactly what back-EMF says for the
   * current the engine is reporting: w = (V − i·Ra)/Ke with V = i/G. Computed
   * here from the datasheet, so a change to rpmFor() cannot hide behind the
   * engine's averaging.
   */
  const amps = Number(s.deviceStates.m.amps)
  const gM = M.i0 / M.vn
  truth(
    'the motor really is being driven by the firmware',
    amps > 0.04,
    '> 40 mA',
    `${(amps * 1000).toFixed(2)} mA`,
  )
  near(
    'the motor speed in the snapshot is the back-EMF speed for its current',
    Number(s.deviceStates.m.rpm),
    Math.abs((amps / gM - amps * RA) / KE),
    1e-6,
    ' rpm',
  )
  truth(
    '   and its direction is reported',
    s.deviceStates.m.direction === 'forward',
    'forward',
    String(s.deviceStates.m.direction),
  )

  // An UNDRIVEN buzzer must not claim to be sounding.
  truth(
    'an unwired-to-a-driving-pin buzzer is silent',
    s.deviceStates.bz.sounding === false,
    'sounding:false',
    String(s.deviceStates.bz.sounding),
  )
}

{
  /**
   * An ACTIVE buzzer on a pin that is simply held HIGH sounds at its own pitch —
   * the drive waveform is irrelevant to it, which is the whole difference from a
   * passive one. Blink holds D13 high for its first second.
   */
  const program = parseIntelHex(
    fs.readFileSync(path.join(process.cwd(), 'public', 'sim', 'blink.hex'), 'utf8'),
  )
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('bz', 'buzzer', { passive: 0 })],
    wires: [wire(['bz', 'P'], ['uno', 'D13']), wire(['bz', 'N'], ['uno', 'GND.1'])],
  }
  const eng = new SimulationEngine(program, doc)
  eng.run(300_000)
  const st = eng.snapshot().deviceStates.bz
  truth('an active buzzer on a HIGH pin sounds', st.sounding === true, 'sounding:true', String(st.sounding))
  near('   at its own 2300 Hz, whatever the pin is doing', Number(st.hertz), SHEET.buzzer.oscillatorHz, 0, ' Hz')
  // 5 V behind 25 Ω into 166.67 Ω = 4.348 V, above the 4 V it needs to oscillate.
  near(
    '   with 4.348 V across it',
    Number(st.volts),
    VCC / R_DRIVE / (1 / R_DRIVE + SHEET.buzzer.ratedAmps / SHEET.buzzer.ratedVolts + 1e-12),
    1e-6,
    ' V',
  )

}

{
  /**
   * Editing the document mid-run must leave EXACTLY ONE sensor running, at the
   * new rate, and must not restart its meter.
   *
   * Two failures are in scope here and doubling the flow rate separates all
   * three outcomes cleanly:
   *
   *   45 pulses — correct. 0.2 s at 10 L/min (75 Hz) is 15, then 0.2 s at
   *               20 L/min (150 Hz) is 30. The turbine kept turning across the
   *               edit, which is what a hall-effect meter does when you open the
   *               tap: it does not reset to zero.
   *   30 pulses — the count was reset. That is what happened while ANY document
   *               edit destroyed and rebuilt every behavioural device; the same
   *               defect made an HC-SR501 drop its output the instant the motion
   *               checkbox was un-ticked, instead of holding for Tx.
   *   ~60       — a GHOST. The old device's callbacks are still on the CPU's
   *               event list and it is still driving a Norton port belonging to
   *               a compile nobody solves. dispose() is what prevents that, and
   *               it is still exercised here: the flow prop changes, so the
   *               sensor's WIRING is unchanged and it survives — but a device
   *               that was retired and rebuilt without disposal would double up.
   */
  const program = parseIntelHex(
    fs.readFileSync(path.join(process.cwd(), 'public', 'sim', 'blink.hex'), 'utf8'),
  )
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('f', 'flow_sensor', { flow: 10 })],
    wires: [
      wire(['f', 'VCC'], ['uno', '5V']),
      wire(['f', 'GND'], ['uno', 'GND.1']),
      wire(['f', 'SIG'], ['uno', 'D2']),
    ],
  }
  const eng = new SimulationEngine(program, doc)
  eng.run(200_000)
  eng.setDocument({
    ...doc,
    parts: doc.parts.map((p) => (p.id === 'f' ? { ...p, props: { flow: 20 } } : p)),
  })
  eng.run(200_000)
  const after = Number(eng.snapshot().deviceStates.f.pulses)
  truth(
    'a mid-run prop edit re-rates the sensor without resetting it or ghosting it',
    after >= 42 && after <= 48,
    '45 ±3 pulses (15 at 75 Hz, then 30 at 150 Hz)',
    `${after} pulses`,
  )
}

{
  /**
   * The same continuity, on the device it matters most to.
   *
   * An HC-SR501 is RETRIGGERABLE: OUT goes high on detection and stays high
   * until `hold` seconds after motion stops. Un-ticking "motion in front" is a
   * prop edit, and while every prop edit rebuilt the behavioural devices, that
   * edit reset holdUntilCycle to 0 and the output fell on the very next poll —
   * the module's whole timing behaviour was unobservable in the editor, because
   * the only way to ask for it was to destroy it.
   *
   * hold = 2 s here: 1 s after motion stops the output must still be HIGH, and
   * by 3 s it must have fallen. Both are checked, so a model that simply latched
   * high forever would fail too.
   */
  const program = parseIntelHex(
    fs.readFileSync(path.join(process.cwd(), 'public', 'sim', 'blink.hex'), 'utf8'),
  )
  const withMotion = (motion: number): CircuitDoc => ({
    parts: [place('uno', 'arduino_uno'), place('p', 'pir_motion', { motion, hold: 2, warmup: 0 })],
    wires: [
      wire(['p', 'VCC'], ['uno', '5V']),
      wire(['p', 'GND'], ['uno', 'GND.1']),
      wire(['p', 'OUT'], ['uno', 'D7']),
    ],
  })

  const eng = new SimulationEngine(program, withMotion(1))
  eng.run(500_000)
  const during = eng.snapshot().deviceStates.p.motion === true

  eng.setDocument(withMotion(0))
  eng.run(1_000_000)
  const held = eng.snapshot().deviceStates.p.motion === true

  eng.run(2_000_000)
  const released = eng.snapshot().deviceStates.p.motion === false

  truth('motion in front of a PIR drives its output high', during, 'high', during ? 'high' : 'low')
  truth(
    'un-ticking "motion" does NOT drop it — the 2 s hold survives the edit',
    held,
    'still high 1 s later',
    held ? 'still high' : 'dropped immediately',
  )
  truth('and it falls once the hold window really has expired', released, 'low by 3 s', released ? 'low' : 'still high')
}

// ─── Report ───────────────────────────────────────────────────────────────────

const nameW = Math.max(56, ...rows.map((r) => r.name.length))
const expW = Math.max(24, ...rows.map((r) => r.expected.length))
const actW = Math.max(24, ...rows.map((r) => r.actual.length))

let lastGroup = ''
for (const r of rows) {
  if (r.group !== lastGroup) {
    lastGroup = r.group
    console.log('\n' + r.group)
    console.log('-'.repeat(nameW + expW + actW + 14))
  }
  console.log(
    `${r.name.padEnd(nameW)}  ${r.expected.padEnd(expW)}  ${r.actual.padEnd(actW)}  ` +
      (r.pass ? 'PASS' : '*** FAIL ***'),
  )
  if (!r.pass && r.note) console.log(`${' '.repeat(nameW)}  -> ${r.note}`)
}

const failures = rows.filter((r) => !r.pass)
console.log('\n' + '='.repeat(nameW + expW + actW + 14))
console.log(`${rows.length - failures.length}/${rows.length} passed`)
if (failures.length) {
  console.log('\nFAILURES')
  for (const f of failures) {
    console.log(`  [${f.group}] ${f.name}`)
    console.log(`      expected: ${f.expected}`)
    console.log(`      actual  : ${f.actual}`)
    if (f.note) console.log(`      note    : ${f.note}`)
  }
}
process.exit(failures.length > 0 ? 1 : 0)
