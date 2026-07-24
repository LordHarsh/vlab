/**
 * Tests for the three device models experiments 10 and 12 needed: the
 * opto-isolated RELAY MODULE, the SEN-11574 PULSE SENSOR, and the MCP3008 SPI
 * ADC.
 *
 * EVERY expected value here is written out from the part's datasheet in the
 * comment above it and computed IN THIS FILE, by a different method from the
 * one the model uses. The relay's input current comes from a scalar bisection
 * on the Shockley equation rather than from the engine's Newton iteration on a
 * stamped matrix; the MCP3008's codes come from the datasheet's transfer
 * function evaluated directly rather than from a bus transaction; the pulse
 * sensor's waveform is re-derived from the raised-cosine expression rather than
 * read off the device. Nothing is asserted against the model's own output.
 *
 * Where the model owns a constant (a 70 Ω coil, a 1 kΩ input resistor, the
 * PC817's 1.2 V at 20 mA) it is RESTATED here rather than imported, so changing
 * it in the model fails this file rather than silently moving the goalposts.
 * The two exceptions are marked: MIN_RESISTANCE and VT are imported, because
 * they are shared numerical constants and a stale copy of one is exactly the
 * "test oracle went stale" failure this suite has already been bitten by.
 *
 * Run: npx tsx lib/simulator/__tests__/relay-spi.test.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CPU } from 'avr8js'
import { Circuit } from '../solver'
import { VT } from '../types'
import {
  NortonPort,
  OPTO_LED,
  RELAY_MODULE_4CH,
  Resistor,
  VoltageSource,
  createRelayModule,
  type RelayChannel,
} from '../devices'
import {
  MCP3008Device,
  PULSE_SENSOR,
  PulseSensor,
  RelayMonitor,
  mcp3008Code,
  type BehaviouralContext,
  type DeviceState,
  type DriveLevel,
} from '../behavioural'
import { compile } from '../model/compile'
import { PICO_EXPERIMENTS } from '../pico/experiments'
import { EXPERIMENT_STARTERS } from '../model/examples'
import { getPart } from '../model/parts'
import { pinKeyOf } from '../model/document'
import { loadPicoFirmware, type PicoFirmware } from '../pico/firmware'
import { PicoSimulationEngine } from '../pico/engine'

const CLOCK_HZ = 16_000_000

// ─── Datasheet constants, restated ────────────────────────────────────────────

/**
 * Songle SRD-05VDC-SL-C, Sharp PC817, and the board they are fitted to.
 *
 * The relay's own three numbers are internally consistent and that consistency
 * is itself a check: 5 V / 70 Ω = 71.4 mA, which is the nominal coil current
 * the same datasheet prints, and 5 × 71.4 mA = 0.357 W, which is its 0.36 W
 * coil power.
 */
const SHEET = {
  relay: {
    coilVolts: 5,
    coilOhms: 70,
    nominalCoilAmps: 0.0714,
    coilWatts: 0.36,
    /** Pick-up <= 75 % of nominal, drop-out >= 10 %, maximum 110 %. */
    pullInVolts: 0.75 * 5,
    dropOutVolts: 0.1 * 5,
    maxCoilVolts: 1.1 * 5,
    contactAmps: 10,
    contactOhms: 0.1,
  },
  /** PC817: Vf 1.2 V typ at IF = 20 mA; IF 50 mA absolute maximum. */
  opto: { forwardVolts: 1.2, forwardTestAmps: 0.02, maxAmps: 0.05, n: 1.8 },
  /** Board: 1 kΩ in series with the opto LED; an S8050 driving the coil. */
  board: { inputOhms: 1000, driverSatVolts: 0.3, driverOhms: 0.5 },
  /** MCP3008: 10 bits, 1024 × VIN/VREF, 2.7–5.5 V supply, VIH/VIL 0.7/0.3 VDD. */
  mcp: { bits: 10, fullScale: 1024, maxCode: 1023, minSupply: 2.7, maxSupply: 5.5 },
  /** SEN-11574: 3–5 V supply, output rests at Vs/2. */
  pulse: { minSupply: 3.0, baselineFraction: 0.5 },
}

/** Model constants restated: the RP2040 pad, and behavioural.ts's drive model. */
const PICO_VDD = 3.3
const PICO_R_DRIVE = 50
const G_FLOAT = 1e-8

/**
 * The two thresholds the relay model owns that are JUDGEMENT rather than
 * datasheet — see the note above RelayModuleParams. Restated so a change to
 * either shows up here, and used only where the test asserts a decision rather
 * than a measured current.
 */
const OPTO_ON_AMPS = 2.0e-3
const OPTO_OFF_AMPS = 1.0e-3

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
function exact(name: string, actual: number | string, expected: number | string, unit = ''): void {
  const pass = actual === expected
  record(name, pass, `${expected}${unit}`, `${actual}${unit}`)
}
function truth(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  record(name, pass, expected, actual, note)
}

/** A CPU with nothing but a cycle counter and an event list. */
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

/** A BehaviouralContext over a plain voltage table. */
class Bench implements BehaviouralContext {
  clock = new FakeClock()
  cpu = this.clock as unknown as CPU
  volts: Record<string, number> = {}
  propValues: Record<string, number | string> = {}
  states: DeviceState[] = []
  /** Every drive transition, level AND voltage, de-duplicated as the engines do. */
  drives: Array<{ cycle: number; signal: string; level: DriveLevel; volts: number }> = []
  private held = new Map<string, string>()

  drive(signal: string, level: DriveLevel, v = 0): void {
    const stamp = `${level}@${v}`
    if (this.held.get(signal) === stamp) return
    this.held.set(signal, stamp)
    this.drives.push({ cycle: this.clock.cycles, signal, level, volts: v })
  }
  voltage(signal: string): number {
    return this.volts[signal] ?? 0
  }
  hasSignal(signal: string): boolean {
    return signal in this.volts
  }
  props(): Record<string, number | string> {
    return this.propValues
  }
  report(state: DeviceState): void {
    this.states.push(state)
  }
  last(): DeviceState {
    return this.states[this.states.length - 1] ?? {}
  }
  /** The most recent drive on a signal, or a released default. */
  driveOn(signal: string): { level: DriveLevel; volts: number } {
    for (let i = this.drives.length - 1; i >= 0; i--) {
      if (this.drives[i].signal === signal) return this.drives[i]
    }
    return { level: 'release', volts: 0 }
  }
}

// ─── Independent theory ───────────────────────────────────────────────────────

/**
 * The PC817's saturation current, DERIVED from its one datasheet point.
 *
 * Vf = n·VT·ln(If/Is)  ⇒  Is = If·exp(−Vf/(n·VT))
 *
 * VT is imported rather than copied: it is a shared constant and a stale copy of
 * it is exactly the "oracle went stale" failure this suite has been bitten by.
 */
const OPTO_IS = SHEET.opto.forwardTestAmps * Math.exp(-SHEET.opto.forwardVolts / (SHEET.opto.n * VT))

/** Shockley, for the opto's LED. */
function optoCurrent(vd: number): number {
  return OPTO_IS * (Math.exp(vd / (SHEET.opto.n * VT)) - 1)
}

/**
 * Solve  vSupply = Vd + I·rTotal  with I = Is·(exp(Vd/(n·VT)) − 1), by bisection.
 *
 * Monotone in Vd, so bisection cannot land on a wrong root — which is precisely
 * the failure the engine's junction limiting exists to avoid, so solving it a
 * different way is the whole value of this function.
 */
function optoLoopCurrent(vSupply: number, rTotal: number): number {
  let lo = 0
  let hi = Math.max(vSupply, 1)
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2
    if (mid + optoCurrent(mid) * rTotal - vSupply > 0) hi = mid
    else lo = mid
  }
  return optoCurrent((lo + hi) / 2)
}

/**
 * The MCP3008's transfer function, from the datasheet.
 *
 * Equation 4-2 gives the nominal relation, code = 1024·VIN/VREF; the transfer
 * figure puts the first code transition at half an LSB, so code k spans
 * (k − 0.5) to (k + 0.5) LSBs and the quantiser is a ROUND. Clipped to ten bits.
 */
function sheetCode(volts: number, vref: number): number {
  if (!(vref > 0)) return 0
  return Math.min(SHEET.mcp.maxCode, Math.max(0, Math.round((SHEET.mcp.fullScale * volts) / vref)))
}

// ══════════════════════════════════════════════════════════════════════════════
group('A. The opto-coupler LED is an infra-red die, not an indicator LED')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * A PC817 drops 1.2 V at 20 mA; a red indicator LED drops nearly 1.9 V at the
   * same current. On a 5 V rail behind the board's 1 kΩ that is a 20 % error in
   * the input current, i.e. in the exact number that decides whether the channel
   * switches — so the model needs its own diode parameters and this group is
   * what stops LED_RED being reused there.
   */
  near('A1 OPTO_LED.is matches the derivation from Vf(20 mA) = 1.2 V', OPTO_LED.is, OPTO_IS, OPTO_IS * 2e-3, ' A')
  exact('A2 emission coefficient is the one the derivation assumed', OPTO_LED.n, SHEET.opto.n)

  // Round trip: the model's own parameters must reproduce the datasheet point.
  const vf = OPTO_LED.n * VT * Math.log(SHEET.opto.forwardTestAmps / OPTO_LED.is + 1)
  near('A3 …and reproduce 1.2 V at the datasheet test current', vf, SHEET.opto.forwardVolts, 1e-3, ' V')

  // A red LED at the same current, for contrast — this is the error avoided.
  const redVf = 1.8 * VT * Math.log(SHEET.opto.forwardTestAmps / 1e-20 + 1)
  truth(
    'A4 a red LED would drop far more at the same current',
    redVf - vf > 0.6,
    'more than 0.6 V higher',
    `${redVf.toFixed(3)} V vs ${vf.toFixed(3)} V`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('B. Relay module — the input side is solved, not assumed')
// ══════════════════════════════════════════════════════════════════════════════

/**
 * One relay channel on a bench.
 *
 * `driveVolts === null` leaves the pin floating (a 100 MΩ input). Otherwise the
 * pin is a Norton source of `driveVolts` behind `PICO_R_DRIVE`, which is exactly
 * how pico/engine.ts stamps a driven pad.
 */
function relayBench(opts: {
  supplyVolts?: number
  driveVolts?: number | null
  activeLow?: boolean
  /** A resistive load from the supply, through COM and out of NO or NC. */
  load?: { ohms: number; via: 'NO' | 'NC' }
}): {
  circuit: Circuit
  channel: RelayChannel
  supply: VoltageSource
  pad: NortonPort
  nets: { gnd: number; vcc: number; in: number; com: number; no: number; nc: number }
  solve: () => ReturnType<Circuit['solve']>
} {
  const activeLow = opts.activeLow ?? true
  const circuit = new Circuit()
  const gnd = 0
  const vcc = circuit.allocNet()
  const inNet = circuit.allocNet()
  const com = circuit.allocNet()
  const no = circuit.allocNet()
  const nc = circuit.allocNet()
  const optoJunction = circuit.allocNet()
  const coilNode = circuit.allocNet()

  const supply = new VoltageSource('vs', vcc, gnd, opts.supplyVolts ?? SHEET.relay.coilVolts)
  supply.maxCurrent = 5
  circuit.add(supply)

  const pad = new NortonPort(
    'pad',
    gnd,
    inNet,
    opts.driveVolts === null || opts.driveVolts === undefined ? G_FLOAT : 1 / PICO_R_DRIVE,
    opts.driveVolts === null || opts.driveVolts === undefined ? 0 : opts.driveVolts / PICO_R_DRIVE,
  )
  pad.ratedCurrent = 1
  pad.maxCurrent = 1
  circuit.add(pad)

  const { devices, channels } = createRelayModule(
    'relay',
    {
      vcc,
      gnd,
      in: [inNet, undefined, undefined, undefined],
      com: [com, undefined, undefined, undefined],
      no: [no, undefined, undefined, undefined],
      nc: [nc, undefined, undefined, undefined],
      internal: [[optoJunction, coilNode], undefined, undefined, undefined],
    },
    activeLow,
  )
  circuit.add(...devices)

  if (opts.load) {
    // A bench load, not a quarter-watt resistor: the point of the group below is
    // the CONTACT's rating, and a load that burnt out first would mask it.
    const load = new Resistor('load', opts.load.via === 'NO' ? no : nc, gnd, opts.load.ohms)
    load.rating = 1e6
    circuit.add(load)
    const feed = new Resistor('comfeed', vcc, com, 1e-3)
    feed.rating = 1e6
    circuit.add(feed)
  }

  return {
    circuit,
    channel: channels[0],
    supply,
    pad,
    nets: { gnd, vcc, in: inNet, com, no, nc },
    solve: () => circuit.solve(),
  }
}

{
  /**
   * ACTIVE LOW, pin driving 0 V. Current runs VCC → opto LED → 1 kΩ → IN, and
   * the pin has to SINK it through its own 50 Ω pad:
   *
   *   5 V = Vf(I) + 1000·I + 50·I
   *
   * so the loop resistance is 1050 Ω and the answer is a bisection away.
   */
  const expected = optoLoopCurrent(SHEET.relay.coilVolts, SHEET.board.inputOhms + PICO_R_DRIVE)
  const b = relayBench({ driveVolts: 0 })
  const res = b.solve()
  truth('B1 the bench solves', res.ok, 'ok', res.error ?? 'ok')
  near('B2 opto current with IN pulled low', b.channel.optoAmps * 1000, expected * 1000, 0.002, ' mA')
  truth(
    'B3 …which is above the current the channel switches at',
    expected >= OPTO_ON_AMPS,
    `>= ${OPTO_ON_AMPS * 1000} mA`,
    `${(expected * 1000).toFixed(3)} mA`,
  )
  truth('B4 so the channel is energised', b.channel.on, 'on', b.channel.on ? 'on' : 'off')

  /**
   * The pin is not at 0 V, and saying so is the point of solving rather than
   * assuming: it sits at I·50 above ground because that is where a 50 Ω pad
   * sinking this current has to be.
   */
  near('B5 …and IN sits at I·50 Ω above ground, not at 0 V', res.voltages[b.nets.in], expected * PICO_R_DRIVE, 2e-4, ' V')
}

{
  /**
   * ACTIVE LOW, pin driving 3.3 V into a board whose VCC is 5 V. This is the
   * case every Pi and Pico meets, and it is genuinely marginal on a bench:
   *
   *   5 − 3.3 = Vf(I) + 1000·I + 50·I
   *
   * leaves only 1.7 V for the loop, and the channel must RELEASE.
   */
  const expected = optoLoopCurrent(
    SHEET.relay.coilVolts - PICO_VDD,
    SHEET.board.inputOhms + PICO_R_DRIVE,
  )
  const b = relayBench({ driveVolts: 0 })
  b.solve() // energise first, so the release is tested through the hysteresis
  truth('B6 starts energised', b.channel.on, 'on', b.channel.on ? 'on' : 'off')
  b.pad.set(1 / PICO_R_DRIVE, PICO_VDD / PICO_R_DRIVE)
  const res = b.solve()
  near('B7 opto current with 3.3 V logic on a 5 V board', b.channel.optoAmps * 1000, expected * 1000, 0.002, ' mA')
  truth(
    'B8 …which is below the release current, by a real but small margin',
    expected <= OPTO_OFF_AMPS,
    `<= ${OPTO_OFF_AMPS * 1000} mA`,
    `${(expected * 1000).toFixed(3)} mA`,
  )
  truth('B9 so the channel releases', !b.channel.on, 'off', b.channel.on ? 'on' : 'off')
  truth('B10 and it still solves', res.ok, 'ok', res.error ?? 'ok')
}

{
  /**
   * A floating input does nothing. An unconnected IN pin on a bench leaves the
   * opto LED with no return path, so no current flows and the relay is off —
   * which is why these boards are safe to power up before anything drives them.
   */
  const b = relayBench({ driveVolts: null })
  b.solve()
  truth('B11 a floating IN leaves the channel released', !b.channel.on, 'off', b.channel.on ? 'on' : 'off')
  truth(
    'B12 …with essentially no opto current',
    Math.abs(b.channel.optoAmps) < 1e-5,
    '< 10 µA',
    `${(b.channel.optoAmps * 1e6).toFixed(3)} µA`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('C. Relay module — the coil, and why 3.3 V is not enough')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Coil current, hand-derived. The driver transistor is an offset plus a bulk
   * resistance in series with the coil:
   *
   *   I = (Vs − VCE(sat)) / (Rcoil + Rdriver) = (5 − 0.3)/(70 + 0.5) = 66.67 mA
   *
   * and the coil's low side must then sit at VCE(sat) + I·Rdriver above ground,
   * which is the self-consistency check that catches a stamp with the current
   * source the wrong way round.
   */
  const expectedI =
    (SHEET.relay.coilVolts - SHEET.board.driverSatVolts) /
    (SHEET.relay.coilOhms + SHEET.board.driverOhms)
  const expectedCoilNode = SHEET.board.driverSatVolts + expectedI * SHEET.board.driverOhms

  const b = relayBench({ driveVolts: 0 })
  const res = b.solve()
  near('C1 coil current at 5 V', b.channel.current * 1000, expectedI * 1000, 1e-3, ' mA')
  // The coil node is internal, so read it through the supply and the coil drop.
  const vCoil = SHEET.relay.coilVolts - b.channel.current * SHEET.relay.coilOhms
  near('C2 …and the coil low side sits at VCE(sat) + I·Rdriver', vCoil, expectedCoilNode, 1e-3, ' V')
  truth('C3 the bench solves', res.ok, 'ok', res.error ?? 'ok')

  /**
   * The nominal coil current the datasheet prints, 5/70 = 71.4 mA, is what the
   * coil would draw from an IDEAL 5 V. The 66.7 mA above is lower for a real
   * reason — the driver's saturation drop — and the two must not be confused.
   */
  near('C4 nominal coil current is the datasheet 71.4 mA', b.channel.nominalCoilAmps * 1000, SHEET.relay.nominalCoilAmps * 1000, 0.03, ' mA')
  truth(
    'C5 …and the real one is lower, because the transistor eats VCE(sat)',
    expectedI < SHEET.relay.nominalCoilAmps,
    'less than nominal',
    `${(expectedI * 1000).toFixed(2)} mA vs ${(SHEET.relay.nominalCoilAmps * 1000).toFixed(1)} mA`,
  )
  // Coil power at nominal: 5 × 71.4 mA = 0.357 W, the datasheet's 0.36 W.
  near(
    'C6 the datasheet coil numbers are self-consistent (V·I = coil power)',
    SHEET.relay.coilVolts * SHEET.relay.nominalCoilAmps,
    SHEET.relay.coilWatts,
    0.005,
    ' W',
  )
}

{
  /**
   * THE HEADLINE BEHAVIOUR OF THIS PART. A 5 V relay board run from a 3.3 V
   * rail gets 3.3 − 0.3 = 3.0 V on the coil, below the 3.75 V the datasheet
   * guarantees pick-up at, so the opto switches and the armature does not move.
   * A model that closed the contact anyway would teach a circuit that does not
   * work on a bench.
   */
  const vAvail = PICO_VDD - SHEET.board.driverSatVolts
  truth(
    'C7 a 3.3 V supply leaves the coil below its pick-up voltage',
    vAvail < SHEET.relay.pullInVolts,
    `< ${SHEET.relay.pullInVolts} V`,
    `${vAvail.toFixed(2)} V`,
  )
  const b = relayBench({ supplyVolts: PICO_VDD, driveVolts: 0 })
  b.solve()
  truth('C8 …so the contact does not close', !b.channel.on, 'released', b.channel.on ? 'energised' : 'released')
  // And the opto DOES conduct — which is why the board's LED lights and the
  // student believes it is working.
  const optoAt3v3 = optoLoopCurrent(PICO_VDD, SHEET.board.inputOhms + PICO_R_DRIVE)
  truth(
    'C9 …even though the opto-coupler is conducting',
    optoAt3v3 >= OPTO_ON_AMPS,
    `>= ${OPTO_ON_AMPS * 1000} mA`,
    `${(optoAt3v3 * 1000).toFixed(3)} mA`,
  )
}

{
  /**
   * Pick-up and drop-out hysteresis, exercised on the coil alone.
   *
   * An ACTIVE-HIGH board is used here for a structural reason: on that variant
   * the opto runs from the DRIVING PIN and the coil runs from VCC, so VCC can be
   * varied without also starving the input. On an active-low board the two share
   * a rail and the opto releases first, which the group above already covers.
   */
  const b = relayBench({ activeLow: false, driveVolts: 5, supplyVolts: 5 })
  b.solve()
  truth('C10 active-high: driving IN high energises the channel', b.channel.on, 'on', b.channel.on ? 'on' : 'off')

  // Just above drop-out: 1.0 V supply leaves 0.7 V on the coil, over the 0.5 V
  // must-release figure, so a relay already pulled in STAYS in.
  b.supply.volts = 1.0
  b.solve()
  truth(
    'C11 …and holds down to just above the drop-out voltage',
    b.channel.on,
    'still on',
    b.channel.on ? 'still on' : 'released',
  )

  // Below drop-out it must let go.
  b.supply.volts = 0.7
  b.solve()
  truth('C12 …then releases below it', !b.channel.on, 'released', b.channel.on ? 'still on' : 'released')

  // And it will NOT pull back in until the pick-up voltage, not the drop-out —
  // that gap is the hysteresis, and without it a supply sitting between the two
  // makes the armature chatter.
  b.supply.volts = 3.0
  b.solve()
  truth(
    'C13 …and does not re-close until the pick-up voltage, not the drop-out',
    !b.channel.on,
    'still released at 3.0 V',
    b.channel.on ? 'closed' : 'still released',
  )
  b.supply.volts = 5
  b.solve()
  truth('C14 …closing again at 5 V', b.channel.on, 'on', b.channel.on ? 'on' : 'off')
}

// ══════════════════════════════════════════════════════════════════════════════
group('D. Relay module — the contact really switches a load')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * A 100 Ω load through COM and NO. Energised, the path is
   * supply → COM → 0.1 Ω contact → NO → 100 Ω → ground, so
   *
   *   I = 5 / (100 + 0.1 + 0.001) ≈ 49.95 mA
   *
   * (the 1 mΩ is the bench's own feed to COM). Released, the NO contact is a
   * 1e12 Ω open and the load must carry essentially nothing.
   */
  const rTotal = 100 + SHEET.relay.contactOhms + 1e-3
  const expectedI = SHEET.relay.coilVolts / rTotal

  const on = relayBench({ driveVolts: 0, load: { ohms: 100, via: 'NO' } })
  const onRes = on.solve()
  truth('D1 solves with a load on NO', onRes.ok, 'ok', onRes.error ?? 'ok')
  near('D2 energised: the load carries 5 V / (100 + Rcontact)', on.channel.contactCurrent * 1000, expectedI * 1000, 0.02, ' mA')

  const off = relayBench({ driveVolts: PICO_VDD, load: { ohms: 100, via: 'NO' } })
  off.solve()
  truth('D3 released: the NO contact is open', !off.channel.on, 'released', off.channel.on ? 'closed' : 'released')
  truth(
    'D4 …and the load on NO carries nothing',
    Math.abs(off.circuit.solve().voltages[off.nets.no]) < 1e-6,
    '< 1 µV on NO',
    `${off.circuit.solve().voltages[off.nets.no].toExponential(2)} V`,
  )

  /**
   * NC IS THE OTHER HALF, and it is the one that surprises people: a relay at
   * rest has COM on NC, so a load wired there is POWERED with no signal at all
   * and goes OFF when the program energises the coil.
   */
  const idleNc = relayBench({ driveVolts: PICO_VDD, load: { ohms: 100, via: 'NC' } })
  idleNc.solve()
  near('D5 de-energised: a load on NC is already powered', idleNc.channel.contactCurrent * 1000, expectedI * 1000, 0.02, ' mA')

  const drivenNc = relayBench({ driveVolts: 0, load: { ohms: 100, via: 'NC' } })
  const r = drivenNc.solve()
  truth('D6 energised: the NC load loses its supply', Math.abs(r.voltages[drivenNc.nets.nc]) < 1e-6, '< 1 µV on NC', `${r.voltages[drivenNc.nets.nc].toExponential(2)} V`)
}

{
  /** Over-voltage on the module's VCC is destructive, at 110 % of nominal. */
  const b = relayBench({ supplyVolts: SHEET.relay.maxCoilVolts + 0.5, driveVolts: 0 })
  const res = b.solve()
  const fault = res.faults.find((f) => f.deviceId === 'relay.ch1')
  truth(
    'D7 VCC above the coil maximum is a destructive fault',
    fault?.severity === 'destructive',
    'destructive',
    fault ? `${fault.kind}:${fault.severity}` : 'no fault',
  )
  // …and exactly at the maximum it is not.
  const ok = relayBench({ supplyVolts: SHEET.relay.maxCoilVolts, driveVolts: 0 })
  const okRes = ok.solve()
  truth(
    'D8 …and exactly at the maximum it is not',
    !okRes.faults.some((f) => f.deviceId === 'relay.ch1'),
    'no fault at 5.5 V',
    okRes.faults.map((f) => f.deviceId).join(',') || 'none',
  )
}

{
  /**
   * Contact over-current. 10 A is the datasheet rating; a 0.3 Ω load off a 5 V
   * supply asks for 5/(0.3 + 0.1) = 12.5 A and must be refused out loud.
   */
  const b = relayBench({ driveVolts: 0, load: { ohms: 0.3, via: 'NO' } })
  b.supply.maxCurrent = 100
  const res = b.solve()
  const fault = res.faults.find((f) => f.deviceId === 'relay.ch1' && f.kind === 'over_current')
  truth(
    'D9 more than 10 A through a contact is destructive',
    fault?.severity === 'destructive',
    'destructive over_current',
    fault ? `${fault.kind}:${fault.severity}` : res.faults.map((f) => `${f.deviceId}:${f.kind}`).join(',') || 'no fault',
  )
  truth(
    'D10 …and the rating quoted is the datasheet 10 A',
    RELAY_MODULE_4CH.contactAmps === SHEET.relay.contactAmps,
    `${SHEET.relay.contactAmps} A`,
    `${RELAY_MODULE_4CH.contactAmps} A`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('E. Relay monitor — the report comes from the coil, not from a second rule')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The monitor reads the coil nodes, which are RelayChannel's own output, so
   * the two cannot drift. This group pins the mapping, including the one case a
   * naive implementation gets wrong: a channel the compiler never built has no
   * coil node, and 0 V on a missing node would otherwise read as "energised".
   */
  const h = new Bench()
  h.volts = { VCC: 5, GND: 0, _coil1: 0.333, _coil2: 5, _coil3: 0.333 }
  h.propValues = { activeLow: 1 }
  const dev = new RelayMonitor('relay', h, RELAY_MODULE_4CH)
  dev.poll()
  const s = h.last()
  exact('E1 pattern: energised, released, energised, absent', String(s.pattern), '101-')
  exact('E2 …and the contacts each channel is sitting on', String(s.contacts), 'NO NC NO -')
  exact('E3 energised count', Number(s.energised), 2)
  near('E4 coil current is the two energised coils only', Number(s.coilAmps) * 1000, ((5 - 0.333) / SHEET.relay.coilOhms) * 2 * 1000, 0.01, ' mA')
  truth('E5 the board reports itself powered', s.powered === true, 'true', String(s.powered))
  truth('E6 …and reports its trigger polarity', s.activeLow === true, 'true', String(s.activeLow))

  // Under-volted: a 3.3 V rail is live but below 75 % of the coil's nominal.
  const u = new Bench()
  u.volts = { VCC: PICO_VDD, GND: 0, _coil1: PICO_VDD }
  u.propValues = { activeLow: 1 }
  new RelayMonitor('relay', u, RELAY_MODULE_4CH).poll()
  truth('E7 a 3.3 V rail is flagged as under-volted', u.last().underVolted === true, 'true', String(u.last().underVolted))

  // No supply at all.
  const d = new Bench()
  d.volts = { VCC: 0, GND: 0, _coil1: 0 }
  new RelayMonitor('relay', d, RELAY_MODULE_4CH).poll()
  truth('E8 an unpowered board reports no power', d.last().powered === false, 'false', String(d.last().powered))
  exact('E9 …and no channel reads energised', String(d.last().pattern), '0---')
}

// ══════════════════════════════════════════════════════════════════════════════
group('F. Pulse sensor — a synthesised waveform, stated as one')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The waveform, re-derived here rather than read off the device:
   *
   *   v(p) = Vs/2                                     for p >= S
   *   v(p) = Vs/2 + A·(1 − cos(2π·p/S))/2             for p <  S
   *
   * which is 0 at p = 0, exactly A at p = S/2, and back to 0 at p = S.
   */
  const Vs = PICO_VDD
  const S = PULSE_SENSOR.SYSTOLIC_FRACTION
  const A = 0.08 * Vs
  const theory = (p: number): number =>
    p % 1 >= S ? Vs / 2 : Vs / 2 + (A * (1 - Math.cos((2 * Math.PI * (p % 1)) / S))) / 2

  const h = new Bench()
  h.volts = { VCC: Vs, GND: 0, SIG: 0 }
  h.propValues = { bpm: 72, amplitude: 8 }
  const dev = new PulseSensor('p1', h)

  for (const p of [0, 0.05, S / 2, 0.15, S, 0.4, 0.9]) {
    near(`F1 waveform at phase ${p.toFixed(3)}`, dev.waveformVolts(p, Vs, A), theory(p), 1e-12, ' V')
  }
  near('F2 the resting level is half the supply', dev.waveformVolts(0.5, Vs, A), Vs * SHEET.pulse.baselineFraction, 1e-12, ' V')
  near('F3 the peak is exactly the amplitude above it', dev.waveformVolts(S / 2, Vs, A) - Vs / 2, A, 1e-12, ' V')

  /**
   * On a 3.3 V rail with an 8 % swing, an MCP3008 reading against a 3.3 V VREF
   * sees 512 at rest and 594 at the peak. Those two numbers are what the
   * experiment's peak-detection threshold is chosen between, so they are pinned.
   */
  exact('F4 the resting level reads 512 counts on a 10-bit ratiometric ADC', sheetCode(Vs / 2, Vs), 512)
  exact('F5 …and the peak reads 594', sheetCode(Vs / 2 + A, Vs), 594)
}

{
  /**
   * The rate really is the rate. Run the device for four beats at 72 BPM and
   * measure the interval between successive peaks off the DRIVEN voltage — the
   * same thing a sketch measures off the wire.
   */
  const h = new Bench()
  h.volts = { VCC: PICO_VDD, GND: 0, SIG: 0 }
  h.propValues = { bpm: 72, amplitude: 8 }
  const dev = new PulseSensor('p1', h)
  dev.poll()
  h.clock.runTo(Math.round(CLOCK_HZ * 4))

  const peakVolts = PICO_VDD / 2 + 0.08 * PICO_VDD
  const threshold = PICO_VDD / 2 + 0.04 * PICO_VDD
  const crossings: number[] = []
  let above = false
  for (const d of h.drives) {
    if (d.signal !== 'SIG' || d.level !== 'high') continue
    if (!above && d.volts >= threshold) {
      above = true
      crossings.push(d.cycle)
    } else if (above && d.volts < threshold) {
      above = false
    }
  }
  truth('F6 four seconds at 72 BPM produces four or five upstrokes', crossings.length >= 4 && crossings.length <= 5, '4–5', String(crossings.length))
  if (crossings.length >= 3) {
    const intervals: number[] = []
    for (let i = 1; i < crossings.length; i++) intervals.push((crossings[i] - crossings[i - 1]) / CLOCK_HZ)
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    near('F7 the beat interval is 60/72 s', mean, 60 / 72, 0.01, ' s')
  }
  const maxV = Math.max(...h.drives.filter((d) => d.signal === 'SIG').map((d) => d.volts))
  near('F8 the peak reached is the amplitude above the baseline', maxV, peakVolts, PULSE_SENSOR.STEP_VOLTS, ' V')
  const minV = Math.min(...h.drives.filter((d) => d.signal === 'SIG' && d.level === 'high').map((d) => d.volts))
  near('F9 …and the trough is the baseline, never below it', minV, PICO_VDD / 2, PULSE_SENSOR.STEP_VOLTS, ' V')

  /**
   * Quantisation, and it is not cosmetic: the engine's memo key contains the
   * driven voltage, so a continuously varying output would never hit the cache.
   * One step must stay under one LSB of the converter reading it.
   */
  const lsb = PICO_VDD / SHEET.mcp.fullScale
  truth(
    'F10 the drive is quantised below one ADC LSB',
    PULSE_SENSOR.STEP_VOLTS < lsb,
    `< ${lsb.toFixed(5)} V`,
    `${PULSE_SENSOR.STEP_VOLTS} V`,
  )
  for (const d of h.drives) {
    if (d.signal !== 'SIG' || d.level !== 'high') continue
    const steps = d.volts / PULSE_SENSOR.STEP_VOLTS
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
      truth('F11 every driven voltage is on the quantisation grid', false, 'on grid', `${d.volts}`)
      break
    }
  }
  truth('F11 every driven voltage is on the quantisation grid', true, 'on grid', 'on grid')
}

{
  /** Below its 3 V minimum the amplifier is dead and the output is released. */
  const h = new Bench()
  h.volts = { VCC: 2.5, GND: 0, SIG: 0 }
  h.propValues = { bpm: 72, amplitude: 8 }
  const dev = new PulseSensor('p1', h)
  dev.poll()
  exact('F12 an under-powered sensor releases its output', h.driveOn('SIG').level, 'release')
  truth('F13 …and says so', h.last().powered === false, 'false', String(h.last().powered))
  truth('F14 …and never claims a heart rate', Number(h.last().bpm) === 0, '0', String(h.last().bpm))
  truth('F15 the reading is labelled synthesised, always', h.last().synthesised === true, 'true', String(h.last().synthesised))
}

// ══════════════════════════════════════════════════════════════════════════════
group('G. MCP3008 — the real SPI frame, bit by bit')
// ══════════════════════════════════════════════════════════════════════════════

/** An MCP3008 on a bench, with every pin at a settable voltage. */
function mcpBench(vdd = PICO_VDD, vref = PICO_VDD): { h: Bench; dev: MCP3008Device } {
  const h = new Bench()
  h.volts = {
    VDD: vdd,
    DGND: 0,
    AGND: 0,
    VREF: vref,
    CS: vdd,
    CLK: 0,
    DIN: 0,
    CH0: 0,
    CH1: 0,
    CH2: 0,
    CH3: 0,
    CH4: 0,
    CH5: 0,
    CH6: 0,
    CH7: 0,
  }
  const dev = new MCP3008Device('adc', h)
  dev.poll()
  return { h, dev }
}

/**
 * A hand-written SPI master, mode 0,0.
 *
 * Written out rather than reused so the test drives the model the way a bus
 * does: MOSI is set while the clock is low, the device samples on the RISING
 * edge, the master samples MISO on that same rising edge, and the device changes
 * its output on the FALLING edge. Getting any of those the wrong way round
 * produces a transaction that looks plausible and returns the wrong bits, which
 * is the failure this whole group exists to catch.
 */
function xfer(
  h: Bench,
  dev: MCP3008Device,
  tx: number[],
  hooks: { atRising?: (n: number) => void } = {},
): { rx: number[]; hiZ: boolean[] } {
  const vdd = h.volts.VDD
  h.volts.CS = 0
  dev.poll()
  const rx: number[] = []
  const hiZ: boolean[] = []
  let clocks = 0
  for (const byte of tx) {
    let v = 0
    for (let bit = 7; bit >= 0; bit--) {
      h.volts.DIN = (byte >> bit) & 1 ? vdd : 0
      dev.poll()
      h.volts.CLK = vdd
      dev.poll()
      clocks++
      hooks.atRising?.(clocks)
      const d = h.driveOn('DOUT')
      hiZ.push(d.level === 'release')
      v = (v << 1) | (d.level === 'high' ? 1 : 0)
      h.volts.CLK = 0
      dev.poll()
    }
    rx.push(v)
  }
  h.volts.CS = vdd
  dev.poll()
  return { rx, hiZ }
}

/** The published three-byte read, decoded exactly as spidev examples decode it. */
function readChannel(h: Bench, dev: MCP3008Device, ch: number): number {
  const { rx } = xfer(h, dev, [1, (8 + ch) << 4, 0])
  return ((rx[1] & 3) << 8) | rx[2]
}

{
  const { h, dev } = mcpBench()
  // Eight distinct voltages, one per channel, so a channel-select bug cannot
  // hide behind a coincidence.
  const volts = [1.65, 0.0, 3.3, 0.825, 2.475, 0.33, 3.0, 1.0]
  for (let k = 0; k < 8; k++) h.volts[`CH${k}`] = volts[k]

  for (let k = 0; k < 8; k++) {
    exact(`G1 CH${k} at ${volts[k]} V reads its datasheet code`, readChannel(h, dev, k), sheetCode(volts[k], PICO_VDD))
  }
  exact('G2 a full-scale input clips to ten bits rather than overflowing', readChannel(h, dev, 2), SHEET.mcp.maxCode)
  exact('G3 a grounded input reads zero', readChannel(h, dev, 1), 0)

  // The converter's own helper must agree with the datasheet function.
  for (const v of [0, 0.001, 0.825, 1.65, 2.5, 3.2999, 3.3, 4.0, -1]) {
    exact(`G4 mcp3008Code(${v} V) matches the datasheet transfer function`, mcp3008Code(v, PICO_VDD), sheetCode(v, PICO_VDD))
  }
}

{
  /**
   * The frame itself. The first byte carries seven leading zeros and the start
   * bit; the answer arrives in the low two bits of the second byte and all of
   * the third. Anything else in there — a stray one where the null bit should
   * be — corrupts the reading by 512 counts and nothing else would notice.
   */
  const { h, dev } = mcpBench()
  h.volts.CH0 = 1.65
  const { rx, hiZ } = xfer(h, dev, [1, (8 + 0) << 4, 0])
  exact('G5 the first byte returns nothing — DOUT is not driving yet', rx[0], 0)
  exact('G6 the NULL bit is zero', (rx[1] >> 2) & 1, 0)
  exact('G7 the ten data bits decode to the expected code', ((rx[1] & 3) << 8) | rx[2], sheetCode(1.65, PICO_VDD))

  /**
   * DOUT IS HIGH-IMPEDANCE UNTIL THE NULL BIT. That is what lets a second
   * device share the MISO line, and it is invisible in the decoded value — a
   * model that drove 0 from the first clock would return exactly the same
   * bytes.
   */
  const firstDriven = hiZ.findIndex((z) => !z)
  exact('G8 DOUT stays high-impedance until the null bit, on clock 14', firstDriven + 1, 14)
  truth(
    'G9 …and is released again once CS rises',
    h.driveOn('DOUT').level === 'release',
    'release',
    h.driveOn('DOUT').level,
  )
}

{
  /**
   * Leading zeros before the start bit are IGNORED, which is what lets a master
   * send whole bytes: the datasheet says the first clock with CS low and DIN
   * high is the start bit, wherever it falls.
   */
  const { h, dev } = mcpBench()
  h.volts.CH5 = 2.0
  const { rx } = xfer(h, dev, [0, 1, (8 + 5) << 4, 0])
  exact('G10 an extra byte of leading zeros shifts the frame, not the answer', ((rx[2] & 3) << 8) | rx[3], sheetCode(2.0, PICO_VDD))
}

{
  /**
   * The sample-and-hold closes right after the configuration word. Moving the
   * input LATER in the frame must not change the answer — a model that read the
   * pin when it finished shifting would smear a moving waveform instead of
   * sampling it, and a peak-detecting sketch would see peaks that were never
   * there.
   */
  const { h, dev } = mcpBench()
  h.volts.CH0 = 1.0
  const { rx } = xfer(h, dev, [1, (8 + 0) << 4, 0], {
    atRising: (n) => {
      if (n === 13) h.volts.CH0 = 3.0 // well after the config word, before the data
    },
  })
  exact('G11 the answer is the input at the sample instant, not later', ((rx[1] & 3) << 8) | rx[2], sheetCode(1.0, PICO_VDD))
}

{
  /**
   * Pseudo-differential mode. SGL/DIFF = 0 pairs the channels (0,1), (2,3)…
   * and the low config bit says which of the pair is IN+.
   */
  const { h, dev } = mcpBench()
  h.volts.CH0 = 2.0
  h.volts.CH1 = 0.5
  const plus = xfer(h, dev, [1, 0 << 4, 0]).rx
  exact('G12 differential CH0(+) − CH1(−)', ((plus[1] & 3) << 8) | plus[2], sheetCode(1.5, PICO_VDD))
  const minus = xfer(h, dev, [1, 1 << 4, 0]).rx
  exact('G13 …and the reversed pair clips at zero, not negative', ((minus[1] & 3) << 8) | minus[2], 0)
}

{
  /**
   * Past B0 the datasheet keeps clocking the result out LSB-first. Nothing in
   * this lab depends on it, and it is implemented because a master that sends a
   * fourth byte gets a defined answer instead of an invented one.
   */
  const { h, dev } = mcpBench()
  h.volts.CH0 = 1.65
  const code = sheetCode(1.65, PICO_VDD)
  const { rx } = xfer(h, dev, [1, (8 + 0) << 4, 0, 0])
  let repeat = 0
  for (let k = 1; k <= 8; k++) repeat |= ((rx[3] >> (8 - k)) & 1) << k
  exact('G14 a fourth byte repeats B1..B8, LSB first', repeat, code & 0b111111110)
}

{
  /** VREF sets full scale, so halving it doubles the code — up to the clip. */
  const { h, dev } = mcpBench(PICO_VDD, PICO_VDD / 2)
  h.volts.CH0 = 0.4125
  exact('G15 the conversion is ratiometric to VREF, not to VDD', readChannel(h, dev, 0), sheetCode(0.4125, PICO_VDD / 2))
}

{
  /** Below 2.7 V the converter is out of specification and must not answer. */
  const { h, dev } = mcpBench(2.0, 2.0)
  h.volts.CH0 = 1.0
  const before = h.drives.length
  const code = readChannel(h, dev, 0)
  exact('G16 an under-powered converter returns nothing', code, 0)
  truth(
    'G17 …and never drives the bus',
    h.drives.slice(before).every((d) => d.level === 'release'),
    'released throughout',
    h.drives.slice(before).map((d) => d.level).join(',') || 'no drives',
  )
  truth('G18 …and says it has no power', h.last().powered === false, 'false', String(h.last().powered))
}

{
  /** With no reference there is no full scale, and 0 is the honest answer. */
  const { h, dev } = mcpBench(PICO_VDD, 0)
  h.volts.CH0 = 1.65
  exact('G19 an unwired VREF reads zero rather than dividing by it', readChannel(h, dev, 0), 0)
}

// ══════════════════════════════════════════════════════════════════════════════
group('H. The parts are wired into the library and the compiler')
// ══════════════════════════════════════════════════════════════════════════════
{
  for (const [type, pinCount, label] of [
    ['relay_4ch', 18, '4-channel relay module'],
    ['pulse_sensor', 3, 'Pulse sensor (SEN-11574)'],
    ['mcp3008', 16, 'MCP3008 SPI ADC'],
  ] as Array<[string, number, string]>) {
    const def = getPart(type)
    exact(`H1 ${type} declares the real part's pin count`, def.pins.length, pinCount)
    exact(`H2 ${type} is labelled for the part a student holds`, def.label, label)
    const ids = def.pins.map((p) => p.id)
    exact(`H3 ${type} pin ids are unique`, new Set(ids).size, ids.length)
  }

  /**
   * MCP3008 pin ORDER, walked the way a 16-pin DIP is walked: pin 1 top left,
   * down to pin 8, across to pin 9 bottom right, back up to pin 16. Getting this
   * wrong puts a student's SPI wire on an analog input.
   */
  const mcp = getPart('mcp3008')
  const byY = [...mcp.pins].filter((p) => p.x > 50).sort((a, b) => b.y - a.y).map((p) => p.id)
  exact('H4 the right-hand column runs pin 9 → 16 bottom to top', byY.join(','), 'DGND,CS,DIN,DOUT,CLK,AGND,VREF,VDD')

  /** The relay's terminals are NO, COM, NC per channel — the block's own order. */
  const relay = getPart('relay_4ch')
  const top = relay.pins.filter((p) => p.y === 15).map((p) => p.id)
  exact('H5 each screw block is NO, COM, NC', top.join(','), 'NO1,COM1,NC1,NO2,COM2,NC2,NO3,COM3,NC3,NO4,COM4,NC4')

  /**
   * GND is `passive`, not `gnd`, on both parts that have one. compile() puts
   * every `gnd` pin on net 0 whether or not a wire reaches it, so typing them
   * that way would silently ground a module the student never connected.
   */
  for (const [type, pin] of [['relay_4ch', 'GND'], ['pulse_sensor', 'GND'], ['mcp3008', 'DGND'], ['mcp3008', 'AGND']] as Array<[string, string]>) {
    const p = getPart(type).pins.find((q) => q.id === pin)!
    exact(`H6 ${type}.${pin} is a real wire, not an implicit ground`, p.type, 'passive')
  }
}

{
  /**
   * The starters open with exactly the to-do list and nothing else: no crossed
   * centre channel, no dangling MCU pin, no fault, no solver error. Anything
   * beyond "part is not connected" is a bug in the starter, not the student's.
   */
  for (const [slug, expected] of [
    [
      'home-automation-rpi',
      [
        '4-channel relay module "relay" is not connected to anything.',
        'Resistor "r220" is not connected to anything.',
        'LED "led" is not connected to anything.',
      ],
    ],
    [
      'health-monitoring-rpi',
      [
        'DS18B20 temperature "ds" is not connected to anything.',
        'Resistor "r4k7" is not connected to anything.',
        'MCP3008 SPI ADC "adc" is not connected to anything.',
        'Pulse sensor (SEN-11574) "pulse" is not connected to anything.',
      ],
    ],
  ] as Array<[string, string[]]>) {
    const c = compile(EXPERIMENT_STARTERS[slug])
    exact(`H7 ${slug}: problems are exactly the unwired-part to-do list`, c.problems.join(' | '), expected.join(' | '))
    exact(`H8 ${slug}: nothing is shorted`, c.shortedPins.length, 0)
    exact(`H9 ${slug}: no unsimulatable parts in the opening state`, c.limitations.length, 0)
    const res = c.circuit.solve()
    truth(`H10 ${slug}: solves`, res.ok, 'ok', res.error ?? 'ok')
    exact(`H11 ${slug}: no faults`, res.faults.length, 0)
  }
}

{
  /**
   * A relay channel costs two internal nodes and two diodes, so a board sitting
   * in the tray with nothing attached must not build any. This is what keeps the
   * unwired starter from spending eight unknowns proving four relays are off.
   */
  const tray = compile(EXPERIMENT_STARTERS['home-automation-rpi'])
  const wired = compile(PICO_EXPERIMENTS['home-automation-rpi'].doc)
  truth(
    'H12 an unattached relay board builds no channels',
    tray.unknowns < wired.unknowns,
    'fewer unknowns than the wired circuit',
    `${tray.unknowns} vs ${wired.unknowns}`,
  )
  exact('H13 the wired circuit reports no problems', wired.problems.length, 0)
  exact(
    'H14 …and the relay reaches the engine as a monitor with no ports',
    wired.behavioural.map((b) => `${b.partId}:${b.protocol}:${Object.keys(b.ports).length}`).join(','),
    'relay:relay:0',
  )
  // The coil nodes really are handed over, or the monitor could not see them.
  const relayNets = wired.behavioural[0].nets
  exact('H15 …with its four coil nodes exposed under synthetic keys', [1, 2, 3, 4].filter((k) => `_coil${k}` in relayNets).length, 4)
}

{
  const wired = compile(PICO_EXPERIMENTS['health-monitoring-rpi'].doc)
  exact('H16 the wired health monitor reports no problems', wired.problems.length, 0)
  exact(
    'H17 …and all three behavioural parts reach the engine with their ports',
    wired.behavioural.map((b) => `${b.partId}:${b.protocol}:${Object.keys(b.ports).join('+')}`).join(','),
    'ds:ds18b20:DQ,adc:mcp3008:DOUT,pulse:pulse:SIG',
  )
  // The published circuit's own pin numbers, all of which exist on a Pico.
  for (const [pin, gp] of [['DQ', 'GP4'], ['CLK', 'GP11'], ['DIN', 'GP10'], ['DOUT', 'GP9'], ['CS', 'GP8']] as Array<[string, string]>) {
    const partId = pin === 'DQ' ? 'ds' : 'adc'
    // −1 rather than undefined so a MISSING net can never compare equal to
    // another missing one and pass by accident.
    exact(
      `H18 ${pin} is on ${gp}, the published circuit's own number`,
      wired.netOf.get(pinKeyOf({ partId, pinId: pin })) ?? -1,
      wired.pinNets.get(gp) ?? -2,
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('I. End to end — real MicroPython on the real solver')
// ══════════════════════════════════════════════════════════════════════════════

const PICO_DIR = path.join(process.cwd(), 'public', 'pico')
const HAVE_FIRMWARE =
  fs.existsSync(path.join(PICO_DIR, 'bootrom.bin')) &&
  fs.existsSync(path.join(PICO_DIR, 'micropython.bin'))

function realFirmware(): PicoFirmware {
  return loadPicoFirmware(
    fs.readFileSync(path.join(PICO_DIR, 'bootrom.bin')),
    fs.readFileSync(path.join(PICO_DIR, 'micropython.bin')),
  )
}

/** Program output, with the REPL's echo of the pasted source removed. */
function programOutput(serial: string, script: string): string {
  const lastLine = script.trimEnd().split('\n').pop()!.trim()
  const at = serial.lastIndexOf(lastLine)
  return at < 0 ? serial : serial.slice(at + lastLine.length)
}

if (!HAVE_FIRMWARE) {
  truth(
    'I0 firmware present in public/pico',
    false,
    'bootrom.bin + micropython.bin',
    'missing — run: npx tsx lib/simulator/pico/fetch-firmware.mts',
  )
} else {
  {
    /**
     * Experiment 10, whole. MicroPython boots, the script is typed into the
     * emulated REPL, its GPIO writes reach the relay board's opto-couplers
     * through the solver, four coils energise, and a lamp lights through a
     * contact. The only thing that is not real is the HTTP.
     */
    const exp = PICO_EXPERIMENTS['home-automation-rpi']
    const eng = new PicoSimulationEngine(realFirmware(), exp.doc, { script: exp.script })
    eng.run(6_000_000)
    const s = eng.snapshot()
    const out = programOutput(s.serial, exp.script)

    truth('I1 the interpreter accepted the script', !/Traceback|SyntaxError|NameError/.test(s.serial), 'no traceback', /Traceback|SyntaxError/.test(s.serial) ? s.serial.slice(-160) : 'clean')
    truth(
      'I2 it prints the canonical widget line, HTTP request and all',
      /GPIO17 \(Light\): LOW - ON {2}\| HTTP GET \/toggle\/Light/.test(out),
      'GPIO17 (Light): LOW - ON  | HTTP GET /toggle/Light',
      out.split('\n').find((l) => l.includes('Light')) ?? '(nothing)',
    )
    truth(
      'I3 …and reports LOW for ON, because the board is active-low',
      !/GPIO\d+ \([A-Za-z]+\): HIGH - ON/.test(out),
      'no HIGH - ON line',
      out.split('\n').find((l) => /HIGH - ON/.test(l)) ?? 'none',
    )
    const relay = s.deviceStates.relay ?? {}
    truth('I4 the relay board sees its 5 V supply', Number(relay.supplyVolts) > 4.9, '> 4.9 V', String(relay.supplyVolts))
    truth('I5 …and channels really are energised', Number(relay.energised) >= 1, '>= 1', String(relay.energised))
    /**
     * The lamp. 5 V through a 0.1 Ω contact, 220 Ω and an LED — this is the
     * number that proves the contact is carrying current rather than the model
     * merely reporting a state.
     */
    truth(
      'I6 the lamp on channel 1 is lit through the contact',
      s.currents.led > 0.008 && s.currents.led < 0.02,
      '8–20 mA',
      `${((s.currents.led ?? 0) * 1000).toFixed(2)} mA`,
    )
    exact('I7 no faults', s.faults.length, 0)
  }

  {
    /**
     * Experiment 12, whole. The DS18B20 is enumerated over real 1-Wire, the
     * pulse sensor's synthesised waveform is read through a real MCP3008 SPI
     * transaction on a bit-banged SoftSPI, and the BPM printed is one the
     * script's own peak detector measured off those readings.
     *
     * 12 s of simulated time: ~1.8 s to a prompt, a 4 s measurement window and
     * a 750 ms conversion, with slack for a second report.
     */
    const exp = PICO_EXPERIMENTS['health-monitoring-rpi']
    const eng = new PicoSimulationEngine(realFirmware(), exp.doc, { script: exp.script })
    eng.run(12_000_000)
    const s = eng.snapshot()
    const out = programOutput(s.serial, exp.script)

    truth('I8 the interpreter accepted the script', !/Traceback|SyntaxError|NameError/.test(s.serial), 'no traceback', /Traceback|SyntaxError/.test(s.serial) ? s.serial.slice(-200) : 'clean')
    truth('I9 the DS18B20 is found on the 1-Wire bus', /Found 1 1-Wire device\(s\)\./.test(out), 'Found 1 1-Wire device(s).', out.split('\n').find((l) => l.includes('1-Wire')) ?? '(nothing)')

    const adc = s.deviceStates.adc ?? {}
    truth('I10 the MCP3008 really was clocked', Number(adc.conversions) > 100, '> 100 conversions', String(adc.conversions))
    truth('I11 …against the 3.3 V reference it is wired to', Math.abs(Number(adc.vref) - PICO_VDD) < 1e-6, `${PICO_VDD} V`, String(adc.vref))

    /**
     * The reported line, and the number in it. 36.5 °C is the DS18B20 slider
     * and 72 BPM is the pulse sensor's; the script measured the second of those
     * itself, so a tolerance of a beat or two is the peak detector's own
     * quantisation, not slack.
     */
    const line = out.split('\n').reverse().find((l) => l.includes('ThingSpeak')) ?? ''
    truth('I12 it prints the canonical widget line', /Temp: 36\.5C {2}BPM: \d+ {2}Status: NORMAL -> ThingSpeak updated/.test(line), 'Temp: 36.5C  BPM: 72  Status: NORMAL -> ThingSpeak updated', line || '(nothing)')
    const bpm = Number(/BPM: (\d+)/.exec(line)?.[1] ?? NaN)
    near('I13 …and the BPM its own peak detector measured', bpm, 72, 3, ' BPM')
    exact('I14 no faults', s.faults.length, 0)
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

/** Capped, so one long expectation cannot make every other row unreadable. */
const nameW = Math.min(76, Math.max(56, ...rows.map((r) => r.name.length)))
const expW = Math.min(46, Math.max(24, ...rows.map((r) => r.expected.length)))
const actW = Math.min(46, Math.max(24, ...rows.map((r) => r.actual.length)))

let lastGroup = ''
for (const r of rows) {
  if (r.group !== lastGroup) {
    lastGroup = r.group
    console.log('\n' + r.group)
    console.log('-'.repeat(nameW + expW + actW + 14))
  }
  const clip = (s: string, w: number): string =>
    (s.length > w ? s.slice(0, w - 1) + '…' : s).padEnd(w)
  console.log(
    `${clip(r.name, nameW)}  ${clip(r.expected, expW)}  ${clip(r.actual, actW)}  ` +
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
