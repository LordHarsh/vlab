/**
 * Regression tests for the device models that unblock experiments 8 and 9:
 * the DS18B20 1-Wire thermometer, the ULN2003 Darlington array, the L298N dual
 * H-bridge and the 28BYJ-48 geared unipolar stepper.
 *
 * WHY A SEPARATE FILE FROM devices.test.ts. Two reasons, and both are about
 * what a test can catch. First, these four parts fail differently from a
 * sensor: a 1-Wire state machine that answers the wrong bit still solves, still
 * converges and still returns ok:true while handing a driver a CRC error it
 * cannot explain, and a bridge that forgets its saturation drops reports a
 * motor voltage that is 50 % too high on a 5 V rail. Second, the protocol half
 * needs a genuine bus — several open-drain devices and a master sharing one
 * node — which is a different harness from the single-signal one next door.
 *
 * EVERY expected value here is written out from the part's datasheet in the
 * comment above it and computed IN THIS FILE. Nothing is asserted against the
 * model's own output. Where the model owns a constant (0.9 V of VCE(sat) at
 * 100 mA, 1.35 V of L298 source saturation, a 5.625°/64 stride) the constant is
 * restated below, so changing it in the model fails the test rather than
 * silently moving the goalposts. The CRC-8 is computed by a completely
 * different algorithm from the model's — MSB-first long division over
 * bit-reversed input instead of a reflected LSB-first shift — so the two can
 * only agree if both are right.
 *
 * THE 1-WIRE MASTER IS A REAL DRIVER. It is a port of MicroPython's own
 * `onewire`/`ds18x20` modules, timings included, because those modules are
 * frozen into the Pico firmware and are therefore the only client this device
 * model will ever have. A model that satisfied a convenient master and not that
 * one would be worthless.
 *
 * Run: npx tsx lib/simulator/__tests__/onewire.test.ts
 */

import type { CPU } from 'avr8js'
import { Circuit } from '../solver'
import {
  DarlingtonSink,
  HBridgeChannel,
  L298N,
  Resistor,
  STEPPER_28BYJ48,
  StepTracker,
  ULN2003,
  VoltageSource,
  createL298N,
  createStepper,
  createULN2003,
  degreesPerHalfStep,
  halfStepsPerRevolution,
  stepPhaseIndex,
  HALF_STEP_SEQUENCE,
} from '../devices'
import {
  DS18B20,
  DS18B20Sensor,
  StepperMonitor,
  ds18b20Celsius,
  ds18b20ConfigByte,
  ds18b20Raw,
  ds18b20Resolution,
  ds18b20Rom,
  oneWireCrc8,
  type BehaviouralContext,
  type BehaviouralDevice,
  type DeviceState,
  type DriveLevel,
} from '../behavioural'

const CLOCK_HZ = 16_000_000

/**
 * Datasheet constants, restated rather than imported.
 *
 * Importing them from the model would make this file assert only that the model
 * agrees with itself. Written out here, it asserts that the model agrees with
 * the DATASHEET.
 */
const SHEET = {
  /** DS18B20: 480 µs reset, 15–60 µs then a 60–240 µs presence, 750 ms tCONV. */
  ds18b20: {
    resetLowMicros: 480,
    presenceDelayMicros: 30,
    presenceLowMicros: 120,
    writeSampleMicros: 30,
    readHoldMicros: 30,
    convertMillis12: 750,
    familyCode: 0x28,
    powerOnRaw: 0x0550,
    stepC: 1 / 16,
    minC: -55,
    maxC: 125,
    minSupplyVolts: 3.0,
  },
  /** ULN2003A: VCE(sat) 0.9 V at 100 mA and 1.1 V at 200 mA; 1.3 V at 350 mA. */
  uln: {
    satVolts1: 0.9,
    satAmps1: 0.1,
    satVolts2: 1.1,
    satAmps2: 0.2,
    satVolts3: 1.3,
    satAmps3: 0.35,
    inputTestVolts: 3.85,
    inputTestAmps: 0.93e-3,
    vih: 2.4,
    vil: 1.4,
    ratedAmps: 0.35,
    maxAmps: 0.5,
    channels: 7,
  },
  /** L298: VCEsat(H) 1.35 V typ, VCEsat(L) 1.2 V typ, both at 1 A. */
  l298: {
    sourceSat: 1.35,
    sinkSat: 1.2,
    onOhms: 0.15,
    vil: 1.5,
    vih: 2.3,
    inputTestVolts: 5,
    inputTestAmps: 30e-6,
    minLogicVolts: 4.5,
    maxLogicVolts: 7,
    supplyHeadroom: 2.5,
    ratedAmps: 2,
    peakAmps: 3,
    totalDropMin: 1.8,
    totalDropMax: 3.2,
  },
  /** 28BYJ-48: 5 V, 50 Ω per phase, stride 5.625°/64, gear ratio 1/64. */
  stepper: { ratedVolts: 5, phaseOhms: 50, strideDegrees: 5.625, gearRatio: 64 },
}

/** Diode model constants from devices.ts, restated for the clamp check. */
const D1N4148 = { is: 2.52e-9, n: 1.752, vt: 0.025852 }

/**
 * The 1-Wire wiring the experiment specifies, and the pad model it hangs off.
 *
 * 4.7 kΩ is the pull-up in the DS18B20 experiment's own bill of materials.
 * 50 Ω is the RP2040 pad impedance from pico/engine.ts, 40 Ω is behavioural.ts's
 * R_PULLDOWN, and 1e-12 S is the solver's gmin. All four are restated here so
 * every bus voltage below is a number this file computes.
 */
const BUS = {
  pullupOhms: 4700,
  railVolts: 3.3,
  masterDriveOhms: 50,
  devicePulldownOhms: 40,
  gmin: 1e-12,
  /** RP2040 DC characteristics at IOVDD = 3.3 V: VIL 0.8 V max, VIH 2.0 V min. */
  masterVih: 2.0,
}

/**
 * MicroPython's own 1-Wire bit timings, in microseconds.
 *
 * These are the `timings` table in MicroPython's `_onewire` C module, which is
 * what `onewire.OneWire` calls: a 480 µs reset low, the presence sampled 70 µs
 * after release and a 410 µs tail; a 1 written as 1 µs low + 40 µs high and a 0
 * as 60 µs low + 5 µs high; a read slot of 6 µs low, sampled 9 µs later (so
 * 15 µs after the falling edge) with a 55 µs tail.
 *
 * Note the write-1 slot is only 41 µs, SHORTER than the 60 µs minimum the
 * DS18B20 datasheet asks for. That is not a mistake in this file — it is what
 * the shipped driver does, and a model that only worked with datasheet-perfect
 * slots would fail against the real thing.
 */
const OW = {
  resetLow: 480,
  resetSample: 70,
  resetTail: 410,
  write1Low: 1,
  write1High: 40,
  write0Low: 60,
  write0High: 5,
  readLow: 6,
  readSample: 9,
  readTail: 55,
}

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
    pass
      ? undefined
      : `err ${Math.abs(actual - expected).toExponential(3)} > tol ${tol.toExponential(3)}`,
  )
}
function exact(name: string, actual: number, expected: number, unit = ''): void {
  record(name, actual === expected, `${expected}${unit}`, `${actual}${unit}`)
}
function hex(name: string, actual: number, expected: number, width = 2): void {
  const h = (v: number) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(width, '0')
  record(name, actual === expected, h(expected), h(actual))
}
function truth(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  record(name, pass, expected, actual, note)
}

// ─── Deterministic clock ──────────────────────────────────────────────────────

/** Same fake clock devices.test.ts uses: a cycle counter and an event list. */
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
  runTo(cycle: number, after?: () => void): void {
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
      after?.()
    }
    this.cycles = cycle
  }
}

/** Whole cycles for a duration in microseconds — behavioural.ts's own rule. */
function cyc(micros: number): number {
  return Math.max(1, Math.round((micros * CLOCK_HZ) / 1e6))
}

// ─── A real open-drain 1-Wire bus ─────────────────────────────────────────────

interface DriveRecord {
  cycle: number
  level: DriveLevel
  nodeId: string
}

/**
 * One node shared by a master and any number of open-drain devices.
 *
 * The bus voltage is a genuine one-node DC solve — the pull-up to the rail in
 * parallel with every pull-down currently asserted, plus the solver's gmin —
 * computed from the same resistances the engine stamps. That matters: the whole
 * reason a 1-Wire SEARCH ROM works is that the wire performs a wired-AND, and a
 * harness that just tracked booleans would be assuming the thing under test.
 */
class OneWireBus {
  clock = new FakeClock()
  devices: BehaviouralDevice[] = []
  drives: DriveRecord[] = []
  private masterDriving = false
  private levels = new Map<string, DriveLevel>()
  private settling = false
  private dirty = false

  /** Node voltage from the conductances currently on the wire. */
  volts(): number {
    let g = 1 / BUS.pullupOhms + BUS.gmin
    const i = BUS.railVolts / BUS.pullupOhms
    if (this.masterDriving) g += 1 / BUS.masterDriveOhms
    for (const level of this.levels.values()) {
      if (level === 'low') g += 1 / BUS.devicePulldownOhms
    }
    return i / g
  }

  setDeviceDrive(nodeId: string, level: DriveLevel): void {
    if (this.levels.get(nodeId) === level) return
    this.levels.set(nodeId, level)
    this.drives.push({ cycle: this.clock.cycles, level, nodeId })
    this.settle()
  }

  masterLow(): void {
    if (this.masterDriving) return
    this.masterDriving = true
    this.settle()
  }

  masterRelease(): void {
    if (!this.masterDriving) return
    this.masterDriving = false
    this.settle()
  }

  /**
   * Re-poll every device until the wire stops changing.
   *
   * This is the engine's own loop: a drive change dirties the operating point,
   * the circuit is re-solved, and every behavioural device gets a poll() with
   * the new voltages. The re-entrancy guard is what lets a device change its own
   * drive from inside poll() without recursing.
   */
  settle(): void {
    if (this.settling) {
      this.dirty = true
      return
    }
    this.settling = true
    let guard = 0
    do {
      this.dirty = false
      for (const d of this.devices) d.poll()
    } while (this.dirty && ++guard < 16)
    this.settling = false
  }

  /** Advance simulated time, firing scheduled transitions and settling after each. */
  advance(micros: number): void {
    this.clock.runTo(this.clock.cycles + cyc(micros), () => this.settle())
    this.settle()
  }

  edges(nodeId: string): DriveRecord[] {
    return this.drives.filter((d) => d.nodeId === nodeId)
  }
}

/** A DS18B20's view of the world: the shared wire, its own VDD, its own props. */
class OwNode implements BehaviouralContext {
  cpu: CPU
  states: DeviceState[] = []

  constructor(
    private bus: OneWireBus,
    readonly nodeId: string,
    public vdd = BUS.railVolts,
    public propValues: Record<string, number | string> = {},
  ) {
    this.cpu = bus.clock as unknown as CPU
  }

  drive(signal: string, level: DriveLevel): void {
    if (signal !== 'DQ') return
    this.bus.setDeviceDrive(this.nodeId, level)
  }
  voltage(signal: string): number {
    if (signal === 'DQ') return this.bus.volts()
    if (signal === 'VDD') return this.vdd
    return 0
  }
  hasSignal(signal: string): boolean {
    return signal === 'DQ' || signal === 'VDD'
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
}

/**
 * A 1-Wire master: MicroPython's `onewire` module, ported line for line.
 *
 * Bits go out and come back least-significant first, which is the 1-Wire
 * convention and not an implementation detail — get it backwards and every
 * command byte is a different command.
 */
class OneWireMaster {
  constructor(private bus: OneWireBus) {}

  private sample(): number {
    return this.bus.volts() > BUS.masterVih ? 1 : 0
  }

  reset(): boolean {
    this.bus.masterLow()
    this.bus.advance(OW.resetLow)
    this.bus.masterRelease()
    this.bus.advance(OW.resetSample)
    const presence = this.sample() === 0
    this.bus.advance(OW.resetTail)
    return presence
  }

  writeBit(bit: number): void {
    this.bus.masterLow()
    this.bus.advance(bit ? OW.write1Low : OW.write0Low)
    this.bus.masterRelease()
    this.bus.advance(bit ? OW.write1High : OW.write0High)
  }

  readBit(): number {
    this.bus.masterLow()
    this.bus.advance(OW.readLow)
    this.bus.masterRelease()
    this.bus.advance(OW.readSample)
    const v = this.sample()
    this.bus.advance(OW.readTail)
    return v
  }

  writeByte(byte: number): void {
    for (let i = 0; i < 8; i++) this.writeBit((byte >> i) & 1)
  }

  readByte(): number {
    let v = 0
    for (let i = 0; i < 8; i++) v |= this.readBit() << i
    return v & 0xff
  }

  readBytes(n: number): number[] {
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(this.readByte())
    return out
  }

  /** onewire.py select_rom(): MATCH ROM followed by the 64-bit address. */
  selectRom(rom: ArrayLike<number>): void {
    this.writeByte(DS18B20.MATCH_ROM)
    for (let i = 0; i < 8; i++) this.writeByte(rom[i])
  }

  /** onewire.py _search_rom(), ported exactly, collision handling included. */
  searchRom(
    lastRom: Uint8Array | null,
    diff: number,
  ): { rom: Uint8Array | null; diff: number } {
    if (!this.reset()) return { rom: null, diff: 0 }
    this.writeByte(DS18B20.SEARCH_ROM)
    const prev = lastRom ?? new Uint8Array(8)
    const rom = new Uint8Array(8)
    let nextDiff = 0
    let i = 64
    for (let byte = 0; byte < 8; byte++) {
      let rB = 0
      for (let bit = 0; bit < 8; bit++) {
        let b = this.readBit()
        if (this.readBit()) {
          // Both halves of the triplet came back 1: nobody is on the bus.
          if (b) return { rom: null, diff: 0 }
        } else if (!b) {
          // Both came back 0: two devices disagree about this bit.
          if (diff > i || (prev[byte] & (1 << bit) && diff !== i)) {
            b = 1
            nextDiff = i
          }
        }
        this.writeBit(b)
        if (b) rB |= 1 << bit
        i--
      }
      rom[byte] = rB
    }
    return { rom, diff: nextDiff }
  }

  /** onewire.py scan(). */
  scan(): Uint8Array[] {
    const found: Uint8Array[] = []
    let diff = 65
    let rom: Uint8Array | null = null
    for (let i = 0; i < 0xff; i++) {
      const r = this.searchRom(rom, diff)
      rom = r.rom
      diff = r.diff
      if (rom) found.push(rom)
      if (diff === 0) break
    }
    return found
  }
}

/** ds18x20.py convert_temp(): reset, SKIP ROM, CONVERT T. */
function convertTemp(m: OneWireMaster): void {
  m.reset()
  m.writeByte(DS18B20.SKIP_ROM)
  m.writeByte(DS18B20.CONVERT_T)
}

/** ds18x20.py read_scratch(): reset, MATCH ROM, READ SCRATCHPAD, 9 bytes. */
function readScratch(m: OneWireMaster, rom: ArrayLike<number>): number[] {
  m.reset()
  m.selectRom(rom)
  m.writeByte(DS18B20.READ_SCRATCHPAD)
  return m.readBytes(9)
}

/** ds18x20.py read_temp() for a 0x28 part, sign extension and all. */
function readTemp(m: OneWireMaster, rom: ArrayLike<number>): number {
  const buf = readScratch(m, rom)
  if (crcLongDivision(buf) !== 0) return NaN
  let t = (buf[1] << 8) | buf[0]
  if (t & 0x8000) t = -((t ^ 0xffff) + 1)
  return t / 16
}

// ─── CRC-8, computed a different way from the model ───────────────────────────

function reverseBits(b: number): number {
  let r = 0
  for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i)
  return r
}

/**
 * The same CRC by MSB-first polynomial long division.
 *
 * The Dallas CRC-8 is the REFLECTED form of x^8 + x^5 + x^4 + 1. Reflected
 * means: feed each byte least-significant bit first through a register shifting
 * right, xoring the reversed polynomial 0x8C. This function does the textbook
 * thing instead — shift LEFT, xor the polynomial 0x31 as written, over
 * bit-reversed input, and reverse the register at the end. The two are the same
 * mathematics reached from opposite directions, so agreeing is evidence, and a
 * model that used 0x31 where it needed 0x8C (the classic mistake, and one that
 * still produces plausible-looking bytes) cannot survive both.
 */
function crcLongDivision(bytes: ArrayLike<number>): number {
  let reg = 0
  for (let k = 0; k < bytes.length; k++) {
    const rev = reverseBits(bytes[k] & 0xff)
    for (let i = 7; i >= 0; i--) {
      const inBit = (rev >> i) & 1
      const top = (reg >> 7) & 1
      reg = (reg << 1) & 0xff
      if (top ^ inBit) reg ^= 0x31
    }
  }
  return reverseBits(reg)
}

// ══════════════════════════════════════════════════════════════════════════════
group('1. DS18B20 — CRC-8, polynomial 0x31, LSB first')
// ══════════════════════════════════════════════════════════════════════════════

{
  /**
   * Hand-worked vectors. For the single byte 0x01 the reflected shift runs:
   *   mix=1 → crc=0x8C, then 0x46, 0x23, 0x9D, 0xC2, 0x61, 0xBC, 0x5E
   * so CRC8({0x01}) = 0x5E, and the same walk on 0x02 gives 0xBC. Both are the
   * values every published Dallas CRC table starts with.
   */
  hex('CRC8 of {0x00} is 0x00', oneWireCrc8([0x00]), 0x00)
  hex('CRC8 of {0x01} is 0x5E', oneWireCrc8([0x01]), 0x5e)
  hex('CRC8 of {0x02} is 0xBC', oneWireCrc8([0x02]), 0xbc)
}

{
  // The model and the long-division route must agree on arbitrary data.
  const vectors: number[][] = [
    [0x28, 0xff, 0x64, 0x1e, 0x0c, 0x8f, 0x21],
    [0x50, 0x05, 0x4b, 0x46, 0x7f, 0xff, 0x00, 0x10],
    [0x91, 0x01, 0x4b, 0x46, 0x1f, 0xff, 0x0c, 0x10],
    [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    [0x00],
    Array.from({ length: 32 }, (_, i) => (i * 37) & 0xff),
  ]
  let agree = true
  for (const v of vectors) if (oneWireCrc8(v) !== crcLongDivision(v)) agree = false
  truth(
    'the model agrees with MSB-first long division on 0x31',
    agree,
    'all 6 vectors agree',
    agree ? 'all 6 vectors agree' : 'a vector disagrees',
  )

  // A reflected CRC and an unreflected one are NOT the same function, so this
  // pins which of the two the model implements.
  let differs = false
  for (const v of vectors) {
    let reg = 0
    for (const byte of v) {
      for (let i = 7; i >= 0; i--) {
        const top = (reg >> 7) & 1
        reg = ((reg << 1) & 0xff) ^ (((byte >> i) & 1) << 0)
        if (top) reg ^= 0x31
      }
    }
    if (oneWireCrc8(v) !== (reg & 0xff)) differs = true
  }
  truth(
    '   and is NOT the unreflected MSB-first CRC (the classic mix-up)',
    differs,
    'the two differ',
    differs ? 'the two differ' : 'identical — reflection is missing',
  )
}

{
  /**
   * The property every driver depends on: running the CRC over the data AND its
   * appended CRC byte gives zero. ds18x20.py's read_scratch does literally
   * `if self.ow.crc8(self.buf): raise Exception("CRC error")` over all nine
   * bytes, so if this fails no student ever gets a reading.
   */
  const data = [0x91, 0x01, 0x4b, 0x46, 0x7f, 0xff, 0x00, 0x10]
  const c = oneWireCrc8(data)
  exact('CRC over data + its own CRC byte is 0', oneWireCrc8([...data, c]), 0)
  exact('   and the long-division route says 0 too', crcLongDivision([...data, c]), 0)

  // One flipped bit anywhere must break it — that is what the CRC is for.
  let caught = 0
  for (let i = 0; i < data.length * 8; i++) {
    const bad = [...data, c]
    bad[i >> 3] ^= 1 << (i & 7)
    if (oneWireCrc8(bad) !== 0) caught++
  }
  exact('every single-bit error in 64 bits is caught', caught, data.length * 8)
}

{
  // A DS18B20's ROM carries its own CRC in byte 7, over bytes 0..6.
  const rom = ds18b20Rom('t1')
  hex('the derived ROM starts with the 0x28 family code', rom[0], SHEET.ds18b20.familyCode)
  hex('   and byte 7 is the CRC-8 of bytes 0-6', rom[7], crcLongDivision(Array.from(rom.subarray(0, 7))))
  exact('   so a driver checking the ROM CRC sees 0', crcLongDivision(Array.from(rom)), 0)

  const other = ds18b20Rom('t2')
  truth(
    'two parts get different addresses (SEARCH ROM needs that)',
    Array.from(rom).join() !== Array.from(other).join(),
    'different ROMs',
    Array.from(rom).join() === Array.from(other).join() ? 'identical' : 'different ROMs',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('2. DS18B20 — temperature encoding, from the datasheet table')
// ══════════════════════════════════════════════════════════════════════════════

{
  /**
   * Datasheet "Temperature/Data Relationship" table, verbatim. Every one of
   * these is 16 x the temperature in two's complement, and the expected value
   * is computed from that rule below rather than copied out of the model.
   */
  const table: Array<[number, number]> = [
    [125, 0x07d0],
    [85, 0x0550],
    [25.0625, 0x0191],
    [10.125, 0x00a2],
    [0.5, 0x0008],
    [0, 0x0000],
    [-0.5, 0xfff8],
    [-10.125, 0xff5e],
    [-25.0625, 0xfe6f],
    [-55, 0xfc90],
  ]
  for (const [c, expected] of table) {
    // Recomputed here: raw = round(C / (1/16)), taken modulo 2^16.
    const derived = Math.round(c / SHEET.ds18b20.stepC) & 0xffff
    hex(`${c} °C encodes as 0x${expected.toString(16).toUpperCase().padStart(4, '0')}`, ds18b20Raw(c), derived, 4)
    truth(
      `   and the datasheet literal agrees`,
      derived === expected,
      `0x${expected.toString(16).toUpperCase().padStart(4, '0')}`,
      `0x${derived.toString(16).toUpperCase().padStart(4, '0')}`,
    )
  }
}

{
  // The decode must invert the encode exactly, which is what read_temp() does.
  let worst = 0
  for (let raw = 0; raw < 65536; raw += 7) {
    const c = ds18b20Celsius(raw)
    if (c < SHEET.ds18b20.minC || c > SHEET.ds18b20.maxC) continue
    worst = Math.max(worst, Math.abs(ds18b20Raw(c) - raw))
  }
  exact('encode(decode(raw)) is the identity over the whole range', worst, 0)
}

{
  // Out of range is clamped, not wrapped: +200 °C must not read as −56 °C.
  near('above +125 °C the register saturates', ds18b20Celsius(ds18b20Raw(200)), 125, 0, ' °C')
  near('below −55 °C the register saturates', ds18b20Celsius(ds18b20Raw(-200)), -55, 0, ' °C')
}

{
  /**
   * Resolution. The configuration register is 0R1R0 11111, so 9/10/11/12 bits
   * are 0x1F/0x3F/0x5F/0x7F, and at less than 12 bits the low bits of the
   * temperature register read as zero.
   */
  for (const [bits, cfg] of [
    [9, 0x1f],
    [10, 0x3f],
    [11, 0x5f],
    [12, 0x7f],
  ] as Array<[number, number]>) {
    hex(`${bits}-bit resolution is config 0x${cfg.toString(16).toUpperCase()}`, ds18b20ConfigByte(bits), cfg)
    exact(`   and reads back as ${bits} bits`, ds18b20Resolution(cfg), bits)
  }

  // 25.0625 °C is 0x0191. At 9 bits the bottom three bits are undefined and
  // read zero, so 0x0191 & 0xFFF8 = 0x0190 = 25.0 °C exactly.
  hex('25.0625 °C at 9-bit resolution truncates to 0x0190', ds18b20Raw(25.0625, 9), 0x0191 & 0xfff8, 4)
  near('   i.e. 25.0 °C, the 0.5 °C step of a 9-bit part', ds18b20Celsius(ds18b20Raw(25.0625, 9)), 25.0, 0, ' °C')
  hex('   at 10 bits, 0x0190 (0.25 °C steps)', ds18b20Raw(25.0625, 10), 0x0191 & 0xfffc, 4)
  hex('   at 11 bits, 0x0190 (0.125 °C steps)', ds18b20Raw(25.0625, 11), 0x0191 & 0xfffe, 4)
  hex('   at 12 bits, the full 0x0191', ds18b20Raw(25.0625, 12), 0x0191, 4)
}

// ══════════════════════════════════════════════════════════════════════════════
group('3. DS18B20 — reset, presence and the open-drain wire')
// ══════════════════════════════════════════════════════════════════════════════

function makeBus(
  ids: string[],
  props: Record<string, number | string> = {},
  vdd = BUS.railVolts,
): { bus: OneWireBus; master: OneWireMaster; nodes: OwNode[]; devs: DS18B20Sensor[] } {
  const bus = new OneWireBus()
  const nodes: OwNode[] = []
  const devs: DS18B20Sensor[] = []
  for (const id of ids) {
    const node = new OwNode(bus, id, vdd, { ...props })
    const dev = new DS18B20Sensor(id, node)
    nodes.push(node)
    devs.push(dev)
    bus.devices.push(dev)
  }
  bus.settle()
  return { bus, master: new OneWireMaster(bus), nodes, devs }
}

{
  /**
   * The wire, before any protocol. With nothing pulling down, a 4.7 kΩ pull-up
   * to 3.3 V puts the bus at the rail; a device's 40 Ω pull-down against that
   * pull-up gives (3.3/4700)/(1/4700 + 1/40) = 27.85 mV, a solid logic low.
   * These are the voltages that make the whole protocol legible, and if the
   * pull-up were missing they would not exist.
   */
  const { bus } = makeBus(['t1'])
  const idle = BUS.railVolts / BUS.pullupOhms / (1 / BUS.pullupOhms + BUS.gmin)
  near('an idle bus sits at the 3.3 V rail', bus.volts(), idle, 1e-9, ' V')
  truth('   which is a logic high to the master', bus.volts() > BUS.masterVih, '> 2.0 V', `${bus.volts().toFixed(3)} V`)

  bus.setDeviceDrive('t1', 'low')
  const pulled =
    BUS.railVolts / BUS.pullupOhms / (1 / BUS.pullupOhms + 1 / BUS.devicePulldownOhms + BUS.gmin)
  near('a device pulling down gives 27.85 mV', bus.volts(), pulled, 1e-9, ' V')
  truth('   well under the 0.8 V the part calls a low', bus.volts() < DS18B20.VIL, '< 0.8 V', `${(bus.volts() * 1000).toFixed(2)} mV`)
  bus.setDeviceDrive('t1', 'release')

  bus.masterLow()
  const byMaster =
    BUS.railVolts / BUS.pullupOhms / (1 / BUS.pullupOhms + 1 / BUS.masterDriveOhms + BUS.gmin)
  near('the master pulling down gives 34.74 mV', bus.volts(), byMaster, 1e-9, ' V')
  bus.masterRelease()
}

{
  /**
   * Presence timing, asserted at exact cycles. The master's reset low ends at a
   * known cycle T; the datasheet then allows 15–60 µs before the device answers
   * and a 60–240 µs answer. The model uses 30 µs and 120 µs, so the pull-down
   * lands at T + 30x16 = T + 480 cycles and the release at T + 150x16 = T + 2400.
   */
  const { bus } = makeBus(['t1'])
  const start = 1_000
  bus.clock.runTo(start, () => bus.settle())
  bus.masterLow()
  bus.advance(SHEET.ds18b20.resetLowMicros)
  const releasedAt = bus.clock.cycles
  bus.masterRelease()
  bus.advance(400)

  const edges = bus.edges('t1').filter((e) => e.cycle >= releasedAt)
  const low = edges.find((e) => e.level === 'low')
  const up = edges.find((e) => e.level === 'release' && low && e.cycle > low.cycle)
  exact(
    'presence pulse starts 30 µs after the master lets go',
    low?.cycle ?? -1,
    releasedAt + cyc(SHEET.ds18b20.presenceDelayMicros),
    ' cyc',
  )
  exact(
    '   and lasts exactly 120 µs',
    (up?.cycle ?? -1) - (low?.cycle ?? 0),
    cyc(SHEET.ds18b20.presenceLowMicros),
    ' cyc',
  )
  truth(
    '   both inside the datasheet windows (15-60 µs, 60-240 µs)',
    SHEET.ds18b20.presenceDelayMicros >= 15 &&
      SHEET.ds18b20.presenceDelayMicros <= 60 &&
      SHEET.ds18b20.presenceLowMicros >= 60 &&
      SHEET.ds18b20.presenceLowMicros <= 240,
    '15-60 / 60-240 µs',
    `${SHEET.ds18b20.presenceDelayMicros} / ${SHEET.ds18b20.presenceLowMicros} µs`,
  )
}

{
  /**
   * A driver samples the presence pulse 70 µs after releasing. The pulse runs
   * from 30 µs to 150 µs, so 70 µs lands squarely inside it and reset() returns
   * true — which is the one thing OneWire.reset(required=True) will not proceed
   * without.
   */
  const { master } = makeBus(['t1'])
  truth('a real driver reset() sees the presence pulse', master.reset(), 'true', String(master.reset()))
}

{
  /**
   * What is and is not a reset. The datasheet minimum is 480 µs; the model
   * accepts 10 % short of that. Both ends have to hold: a 440 µs pulse from a
   * sloppy library still works, and a 120 µs low — the LONGEST write-zero slot
   * the datasheet permits — must never be mistaken for one, or every zero bit
   * a driver writes would reset the device.
   */
  for (const [micros, expect] of [
    [SHEET.ds18b20.resetLowMicros, true],
    [440, true],
    [400, false],
    [120, false],
    [60, false],
  ] as Array<[number, boolean]>) {
    const { bus } = makeBus(['t1'])
    bus.clock.runTo(1000, () => bus.settle())
    bus.masterLow()
    bus.advance(micros)
    const at = bus.clock.cycles
    bus.masterRelease()
    bus.advance(400)
    const answered = bus.edges('t1').some((e) => e.level === 'low' && e.cycle > at)
    truth(
      `a ${micros} µs low ${expect ? 'is' : 'is not'} a reset`,
      answered === expect,
      expect ? 'presence pulse' : 'silence',
      answered ? 'presence pulse' : 'silence',
    )
  }
}

{
  // No pull-up at all: the wire never rises, so there is no edge to see and no
  // presence to detect. That is exactly the bench symptom, and the model must
  // reproduce it rather than working anyway.
  const bus = new OneWireBus()
  const node = new OwNode(bus, 'nopu')
  // Model the missing resistor by leaving the pull-up off: only gmin holds the
  // node, so it sits at 0 V whatever anybody does.
  const original = bus.volts.bind(bus)
  bus.volts = () => 0
  const dev = new DS18B20Sensor('nopu', node)
  bus.devices.push(dev)
  bus.settle()
  const m = new OneWireMaster(bus)
  m.reset()
  bus.advance(500)
  truth(
    'with no pull-up the bus is dead and nothing answers',
    !bus.edges('nopu').some((e) => e.level === 'low'),
    'no presence pulse',
    bus.edges('nopu').some((e) => e.level === 'low') ? 'answered' : 'no presence pulse',
  )
  truth(
    '   and the sensor reports the bus is not idling high',
    node.last().busIdleHigh === false,
    'busIdleHigh:false',
    String(node.last().busIdleHigh),
  )
  bus.volts = original
}

{
  // VDD below the 3.0 V operating minimum: no supply, no answer. A student who
  // forgets the power wire must see nothing work, not a plausible reading.
  const { bus, master, nodes } = makeBus(['t1'], {}, 0)
  const present = master.reset()
  bus.advance(500)
  truth('an unpowered sensor never answers a reset', !present, 'no presence', present ? 'presence' : 'no presence')
  truth('   and reports powered:false', nodes[0].last().powered === false, 'powered:false', String(nodes[0].last().powered))
}

// ══════════════════════════════════════════════════════════════════════════════
group('4. DS18B20 — a real MicroPython driver, end to end')
// ══════════════════════════════════════════════════════════════════════════════

{
  /**
   * The whole ds18x20 flow at 25.0625 °C: scan(), convert_temp(), wait the
   * datasheet's 750 ms, read_temp(). The value that comes back has to be the
   * value the slider asked for, and the CRC has to close, or the driver raises.
   */
  const { bus, master, devs } = makeBus(['t1'], { temperature: 25.0625 })
  const found = master.scan()
  exact('scan() finds exactly one device', found.length, 1)
  truth(
    '   at the address the model owns',
    found[0] !== undefined && Array.from(found[0]).join() === Array.from(devs[0].romCode).join(),
    'the device ROM',
    found[0] ? Array.from(found[0], (b) => b.toString(16).padStart(2, '0')).join('') : '(none)',
  )
  truth(
    '   with the 0x28 family code ds18x20.scan() filters on',
    found[0]?.[0] === SHEET.ds18b20.familyCode,
    '0x28',
    '0x' + (found[0]?.[0] ?? 0).toString(16),
  )

  convertTemp(master)
  // The driver's own time.sleep_ms(750).
  bus.advance(SHEET.ds18b20.convertMillis12 * 1000)

  const buf = readScratch(master, found[0]!)
  exact('the nine scratchpad bytes pass their CRC', crcLongDivision(buf), 0)
  hex('   and the CRC byte is the one the data implies', buf[8], crcLongDivision(buf.slice(0, 8)))

  const t = readTemp(master, found[0]!)
  near('read_temp() returns 25.0625 °C exactly', t, 25.0625, 0, ' °C')
  hex('   from a register holding 0x0191', (buf[1] << 8) | buf[0], Math.round(25.0625 / SHEET.ds18b20.stepC), 4)
}

{
  /**
   * The 85 °C bug, on purpose. A driver that reads the scratchpad without
   * waiting for the conversion gets the power-on value of the temperature
   * register, which the datasheet fixes at +85.0 °C = 0x0550. This is the most
   * commonly reported DS18B20 symptom in the world and it is real here.
   */
  const { master } = makeBus(['t1'], { temperature: 21 })
  const rom = master.scan()[0]!
  convertTemp(master)
  const early = readTemp(master, rom)
  near('reading before the conversion finishes gives 85.0 °C', early, ds18b20Celsius(SHEET.ds18b20.powerOnRaw), 0, ' °C')
  hex('   i.e. the datasheet power-on register 0x0550', SHEET.ds18b20.powerOnRaw, 0x0550, 4)
}

{
  /**
   * Busy polling. After CONVERT T the device answers read slots with 0 until
   * the conversion completes and 1 afterwards — which is how a driver can skip
   * the fixed 750 ms wait. tCONV at 12 bits is 750 ms, so 700 ms in it must
   * still say busy and 760 ms in it must say done.
   */
  const { bus, master } = makeBus(['t1'], { temperature: 30 })
  convertTemp(master)
  bus.advance(700_000)
  const midway = master.readBit()
  bus.advance(100_000)
  const after = master.readBit()
  exact('700 ms into a 750 ms conversion the status bit is 0', midway, 0)
  exact('   and past 750 ms it is 1', after, 1)
}

{
  /**
   * Resolution really changes both the value AND the conversion time. Writing
   * 0x1F to the configuration register selects 9 bits, whose tCONV is
   * 750/2^3 = 93.75 ms, and 25.0625 °C then reads back as 25.0 °C.
   */
  const { bus, master } = makeBus(['t1'], { temperature: 25.0625 })
  const rom = master.scan()[0]!
  master.reset()
  master.selectRom(rom)
  master.writeByte(DS18B20.WRITE_SCRATCHPAD)
  master.writeByte(0x4b) // TH
  master.writeByte(0x46) // TL
  master.writeByte(ds18b20ConfigByte(9))

  convertTemp(master)
  const tconv9 = SHEET.ds18b20.convertMillis12 / Math.pow(2, 12 - 9)
  near('9-bit tCONV is 93.75 ms', tconv9, 93.75, 0, ' ms')
  bus.advance(80_000)
  const stillBusy = master.readBit()
  bus.advance(20_000)
  const done = master.readBit()
  exact('   80 ms in, still converting', stillBusy, 0)
  exact('   100 ms in, done', done, 1)

  const t = readTemp(master, rom)
  near('   and 25.0625 °C reads back as 25.0 at 9 bits', t, 25.0, 0, ' °C')
  const buf = readScratch(master, rom)
  hex('   with the config register the driver wrote', buf[4], ds18b20ConfigByte(9))
}

{
  /**
   * The `resolution` inspector prop configures the part until a program
   * configures it itself. With the slider at 10 bits, 25.0625 °C must come back
   * as 25.0 (0x0191 & 0xFFFC = 0x0190) and tCONV must be 750/4 = 187.5 ms —
   * and once the driver writes its own config byte, the slider must stop
   * overriding it.
   */
  const { bus, master, nodes } = makeBus(['t1'], { temperature: 25.0625, resolution: 10 })
  const rom = master.scan()[0]!
  convertTemp(master)
  bus.advance(200_000)
  const buf = readScratch(master, rom)
  hex('the resolution prop sets the config register', buf[4], ds18b20ConfigByte(10))
  near('   and 25.0625 °C reads as 25.0 at 10 bits', readTemp(master, rom), 25.0, 0, ' °C')
  near('   with tCONV of 187.5 ms', SHEET.ds18b20.convertMillis12 / Math.pow(2, 12 - 10), 187.5, 0, ' ms')

  // Now the driver takes the register over; the slider must not fight it.
  master.reset()
  master.selectRom(rom)
  master.writeByte(DS18B20.WRITE_SCRATCHPAD)
  master.writeByte(0x4b)
  master.writeByte(0x46)
  master.writeByte(ds18b20ConfigByte(12))
  nodes[0].propValues.resolution = 9
  const after = readScratch(master, rom)
  hex('   a driver’s own WRITE SCRATCHPAD wins over the slider', after[4], ds18b20ConfigByte(12))
}

{
  // Negative temperatures round-trip through the real driver's sign extension.
  for (const c of [-0.5, -10.125, -25.0625, -55]) {
    const { bus, master } = makeBus(['t1'], { temperature: c })
    const rom = master.scan()[0]!
    convertTemp(master)
    bus.advance(SHEET.ds18b20.convertMillis12 * 1000)
    near(`read_temp() returns ${c} °C`, readTemp(master, rom), c, 0, ' °C')
  }
}

{
  /**
   * A live prop. The temperature is sampled when CONVERT T is issued, not when
   * the scratchpad is read — which is what a real sensor does and why moving
   * the slider does nothing until the next conversion.
   */
  const { bus, master, nodes } = makeBus(['t1'], { temperature: 20 })
  const rom = master.scan()[0]!
  convertTemp(master)
  bus.advance(SHEET.ds18b20.convertMillis12 * 1000)
  near('a conversion captures the slider value', readTemp(master, rom), 20, 0, ' °C')

  nodes[0].propValues.temperature = 40
  near('   and the OLD reading survives until the next convert', readTemp(master, rom), 20, 0, ' °C')
  convertTemp(master)
  bus.advance(SHEET.ds18b20.convertMillis12 * 1000)
  near('   which then picks up 40 °C', readTemp(master, rom), 40, 0, ' °C')
}

{
  /**
   * MATCH ROM really addresses. Talking to the wrong address must return
   * nothing at all — every bit reads back as 1, because no device is pulling
   * the wire down and the pull-up owns it.
   */
  const { master, devs } = makeBus(['t1'], { temperature: 22 })
  const wrong = Uint8Array.from(devs[0].romCode)
  wrong[3] ^= 0xff
  const buf = readScratch(master, wrong)
  truth(
    'a wrong MATCH ROM address gets no answer at all',
    buf.every((b) => b === 0xff),
    'all 0xFF',
    buf.map((b) => b.toString(16)).join(' '),
  )
  truth(
    '   which fails the CRC, as a driver expects',
    crcLongDivision(buf) !== 0,
    'non-zero CRC',
    '0x' + crcLongDivision(buf).toString(16),
  )
}

{
  /**
   * READ ROM (0x33) is only legal with ONE device on the bus, and returns the
   * 64-bit address directly. It is the cheapest possible check that the model's
   * bit order is right: get LSB-first backwards and the family code reads 0x14
   * instead of 0x28.
   */
  const { master, devs } = makeBus(['t1'])
  master.reset()
  master.writeByte(DS18B20.READ_ROM)
  const rom = master.readBytes(8)
  truth(
    'READ ROM returns the address, LSB of each byte first',
    rom.join() === Array.from(devs[0].romCode).join(),
    Array.from(devs[0].romCode, (b) => b.toString(16).padStart(2, '0')).join(''),
    rom.map((b) => b.toString(16).padStart(2, '0')).join(''),
  )
  hex('   family code first', rom[0], SHEET.ds18b20.familyCode)
}

{
  /**
   * Two sensors on one wire. This is the case SEARCH ROM exists for, and it
   * only works because the bus really performs a wired-AND: when the two
   * devices disagree about a bit they pull the line down in BOTH halves of the
   * triplet and the master sees 0,0 — a collision it then resolves by walking
   * the tree.
   */
  const { master, devs } = makeBus(['probe-a', 'probe-b'])
  const found = master.scan()
  exact('scan() finds both devices on one wire', found.length, 2)
  const addrs = found.map((r) => Array.from(r).join()).sort()
  const want = devs.map((d) => Array.from(d.romCode).join()).sort()
  truth(
    '   and finds exactly the two addresses present',
    addrs.join('|') === want.join('|'),
    'both ROMs',
    addrs.join('|') === want.join('|') ? 'both ROMs' : 'mismatch',
  )
  truth(
    '   every ROM found passes its own CRC',
    found.every((r) => crcLongDivision(Array.from(r)) === 0),
    'CRC 0 for both',
    found.map((r) => crcLongDivision(Array.from(r))).join(','),
  )
}

{
  // ...and each one can then be addressed and read independently.
  const { bus, master, nodes, devs } = makeBus(['probe-a', 'probe-b'])
  nodes[0].propValues.temperature = 12.5
  nodes[1].propValues.temperature = -7.25
  convertTemp(master)
  bus.advance(SHEET.ds18b20.convertMillis12 * 1000)
  near('the first probe reads 12.5 °C', readTemp(master, devs[0].romCode), 12.5, 0, ' °C')
  near('the second reads −7.25 °C on the same wire', readTemp(master, devs[1].romCode), -7.25, 0, ' °C')
}

{
  /**
   * READ POWER SUPPLY (0xB4). An externally powered part answers 1 by leaving
   * the wire alone; a parasite-powered one would pull it down. The model is
   * externally powered and says so — see the class note on why parasite power
   * is deliberately not simulated.
   */
  const { master } = makeBus(['t1'])
  master.reset()
  master.writeByte(DS18B20.SKIP_ROM)
  master.writeByte(DS18B20.READ_POWER_SUPPLY)
  exact('READ POWER SUPPLY answers 1 (externally powered)', master.readBit(), 1)
}

// ══════════════════════════════════════════════════════════════════════════════
group('5. ULN2003 — Darlington saturation, from two datasheet points')
// ══════════════════════════════════════════════════════════════════════════════

/** R_on and the zero-current offset, derived here from the datasheet pair. */
const ULN_RON = (SHEET.uln.satVolts2 - SHEET.uln.satVolts1) / (SHEET.uln.satAmps2 - SHEET.uln.satAmps1)
const ULN_V0 = SHEET.uln.satVolts1 - SHEET.uln.satAmps1 * ULN_RON
const ULN_RIN = SHEET.uln.inputTestVolts / SHEET.uln.inputTestAmps

{
  truth(
    'the model carries the datasheet numbers this file restates',
    ULN2003.satVolts1 === SHEET.uln.satVolts1 &&
      ULN2003.satAmps1 === SHEET.uln.satAmps1 &&
      ULN2003.satVolts2 === SHEET.uln.satVolts2 &&
      ULN2003.satAmps2 === SHEET.uln.satAmps2 &&
      ULN2003.vih === SHEET.uln.vih &&
      ULN2003.maxAmps === SHEET.uln.maxAmps &&
      ULN2003.channels === SHEET.uln.channels,
    '0.9 V@100 mA, 1.1 V@200 mA, VIH 2.4 V, 500 mA max, 7 channels',
    `${ULN2003.satVolts1} V@${ULN2003.satAmps1 * 1000} mA, ${ULN2003.satVolts2} V@${ULN2003.satAmps2 * 1000} mA, ` +
      `VIH ${ULN2003.vih} V, ${ULN2003.maxAmps * 1000} mA max, ${ULN2003.channels} ch`,
  )
  near('R_on derives to 2 Ω from the two points', ULN_RON, 2, 1e-12, ' Ω')
  near('   and the zero-current offset to 0.7 V', ULN_V0, 0.7, 1e-12, ' V')
}

/** Solve one Darlington channel sinking a resistive load from a supply. */
function darlington(opts: {
  supplyVolts: number
  loadOhms: number
  inputVolts: number
  warmInputVolts?: number
}): { res: ReturnType<Circuit['solve']>; ch: DarlingtonSink; vOut: number } {
  const c = new Circuit()
  const vcc = c.allocNet()
  const inNet = c.allocNet()
  const out = c.allocNet()
  const supply = new VoltageSource('vcc', vcc, 0, opts.supplyVolts)
  const drive = new VoltageSource('drv', inNet, 0, opts.warmInputVolts ?? opts.inputVolts)
  c.add(supply)
  c.add(drive)
  c.add(new Resistor('load', vcc, out, opts.loadOhms))
  const ch = new DarlingtonSink('u1.ch1', inNet, out, 0)
  c.add(ch)
  if (opts.warmInputVolts !== undefined) {
    c.solve()
    drive.volts = opts.inputVolts
  }
  const res = c.solve()
  return { res, ch, vOut: res.voltages[out] }
}

{
  /**
   * A 28BYJ-48 coil (50 Ω) off a 5 V rail. In saturation the channel is
   * 0.7 V + 2 Ω, so the loop is 5 = i x 50 + 0.7 + i x 2, giving
   * i = 4.3/52 = 82.69 mA and VCE(sat) = 0.7 + 0.165 = 0.865 V. That drop is
   * the whole reason a "5 V" stepper coil only ever sees about 4.1 V.
   */
  const { res, ch, vOut } = darlington({
    supplyVolts: 5,
    loadOhms: SHEET.stepper.phaseOhms,
    inputVolts: 3.3,
  })
  const i = (5 - ULN_V0) / (SHEET.stepper.phaseOhms + ULN_RON)
  truth('a driven channel solves', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  truth('   and is reported on', ch.on, 'on', ch.on ? 'on' : 'off')
  near('50 Ω coil off 5 V draws 82.69 mA', ch.current, i, 1e-9, ' A')
  near('   with VCE(sat) = 0.865 V', vOut, ULN_V0 + i * ULN_RON, 1e-9, ' V')
  near('   so the coil sees 4.135 V, not 5', 5 - vOut, 5 - (ULN_V0 + i * ULN_RON), 1e-9, ' V')
}

{
  /**
   * The two-point fit has to reproduce the points it was made from, and it must
   * land near the THIRD datasheet point it never saw: 1.3 V typ at 350 mA.
   */
  const { ch } = darlington({ supplyVolts: 5, loadOhms: 50, inputVolts: 3.3 })
  near('the fit reproduces 0.9 V at 100 mA', ch.saturationVolts(SHEET.uln.satAmps1), SHEET.uln.satVolts1, 1e-12, ' V')
  near('   and 1.1 V at 200 mA', ch.saturationVolts(SHEET.uln.satAmps2), SHEET.uln.satVolts2, 1e-12, ' V')
  near(
    '   and predicts 1.40 V at the unused 350 mA point (datasheet 1.3 V typ)',
    ch.saturationVolts(SHEET.uln.satAmps3),
    SHEET.uln.satVolts3,
    0.15,
    ' V',
  )
}

{
  /**
   * The input is a real load on the driving pin. The datasheet's own input
   * characteristic is 0.93 mA at 3.85 V, so a 3.3 V Pico pad supplies
   * 3.3 x 0.93e-3/3.85 = 0.797 mA into each channel it turns on.
   */
  const { ch } = darlington({ supplyVolts: 5, loadOhms: 50, inputVolts: 3.3 })
  near('the input resistance derives to 4.14 kΩ', ch.inputOhms, ULN_RIN, 1e-9, ' Ω')
  near('   so 3.3 V costs the pin 0.797 mA', ch.inputCurrent, 3.3 / ULN_RIN, 1e-9, ' A')
  truth(
    '   comfortably inside a Pico pad’s 12 mA rating',
    3.3 / ULN_RIN < 0.012,
    '< 12 mA',
    `${((3.3 / ULN_RIN) * 1000).toFixed(3)} mA`,
  )
}

{
  /**
   * Below 1.4 V — two base-emitter drops — nothing happens, so the output
   * floats up to the supply through the coil and no current flows.
   */
  const { ch, vOut } = darlington({ supplyVolts: 5, loadOhms: 50, inputVolts: 1.0 })
  truth('a 1.0 V input leaves the channel off', !ch.on, 'off', ch.on ? 'on' : 'off')
  near('   with the output pulled up to the 5 V rail', vOut, 5, 1e-6, ' V')
  near('   and no collector current', ch.current, 0, 1e-12, ' A')
}

{
  // At the datasheet's guaranteed-on 2.4 V it must be on.
  const { ch } = darlington({ supplyVolts: 5, loadOhms: 50, inputVolts: SHEET.uln.vih })
  truth('at VI(on) = 2.4 V the channel is on', ch.on, 'on', ch.on ? 'on' : 'off')
}

{
  /**
   * Hysteresis across the undefined band. At 2.0 V — above 1.4 V, below 2.4 V —
   * a real part may do either thing, so the model holds whatever it was doing.
   * Without that a node parked mid-band chatters on every re-solve.
   */
  const cold = darlington({ supplyVolts: 5, loadOhms: 50, inputVolts: 2.0 })
  const warm = darlington({ supplyVolts: 5, loadOhms: 50, inputVolts: 2.0, warmInputVolts: 3.3 })
  truth('2.0 V from off stays off', !cold.ch.on, 'off', cold.ch.on ? 'on' : 'off')
  truth('2.0 V from on stays on', warm.ch.on, 'on', warm.ch.on ? 'on' : 'off')
}

{
  // Safety, graduated. 400 mA is past the highest current the datasheet
  // characterises (350 mA) but inside the 500 mA maximum: hot, not dead.
  // 8.75 Ω gives (5 − 0.7)/(8.75 + 2) = 400 mA exactly.
  const rCaution = (5 - ULN_V0) / 0.4 - ULN_RON
  const caution = darlington({ supplyVolts: 5, loadOhms: rCaution, inputVolts: 3.3 })
  const f1 = caution.res.faults.find((f) => f.deviceId === 'u1.ch1')
  near('   (the load that gives exactly 400 mA)', caution.ch.current, 0.4, 1e-9, ' A')
  truth(
    '400 mA is a caution, not a death',
    f1?.severity === 'caution' && f1.kind === 'over_current',
    'over_current / caution',
    f1 ? `${f1.kind} / ${f1.severity}` : '(no fault)',
  )

  // 82 mA through the channel is unremarkable. (The stand-in load resistor is a
  // quarter-watt part dissipating 0.34 W and DOES fault — correctly — so the
  // check is on the channel's own device id rather than on the fault count.)
  const fine = darlington({ supplyVolts: 5, loadOhms: 50, inputVolts: 3.3 })
  const chFaults = fine.res.faults.filter((f) => f.deviceId === 'u1.ch1')
  truth('82 mA raises nothing against the channel', chFaults.length === 0, '0 faults', `${chFaults.length} faults`)

  // 1 Ω gives 4.3/3 = 1.43 A, far past the 500 mA absolute maximum.
  const dead = darlington({ supplyVolts: 5, loadOhms: 1, inputVolts: 3.3 })
  const f2 = dead.res.faults.find((f) => f.deviceId === 'u1.ch1')
  truth(
    '1.43 A destroys the channel',
    f2?.severity === 'destructive' && f2.kind === 'over_current',
    'over_current / destructive',
    f2 ? `${f2.kind} / ${f2.severity}` : '(no fault)',
  )
}

{
  /**
   * The flyback diodes are real silicon and they clamp. Drive an output ABOVE
   * COM through 1 kΩ and the diode must conduct; the solved forward voltage has
   * to satisfy Shockley for the model this codebase uses, which is checked here
   * from the diode equation rather than assumed.
   */
  const c = new Circuit()
  const com = c.allocNet()
  const inNet = c.allocNet()
  const out = c.allocNet()
  const push = c.allocNet()
  c.add(new VoltageSource('com', com, 0, 5))
  c.add(new VoltageSource('in', inNet, 0, 0))
  c.add(new VoltageSource('push', push, 0, 8))
  c.add(new Resistor('r', push, out, 1000))
  const { devices } = createULN2003('u1', { in: [inNet], out: [out], com, gnd: 0 })
  c.add(...devices)
  const res = c.solve()
  const vOut = res.voltages[out]
  const vf = vOut - 5
  const iR = (8 - vOut) / 1000
  const iD = D1N4148.is * (Math.exp(vf / (D1N4148.n * D1N4148.vt)) - 1)
  truth('a ULN2003 with COM wired gets its clamp diodes', devices.length === 2, '1 channel + 1 diode', `${devices.length} devices`)
  truth('   an output driven above COM is clamped', vOut < 6.5, '< 6.5 V', `${vOut.toFixed(4)} V`)
  near('   and the clamp current obeys the Shockley equation', iD, iR, Math.abs(iR) * 1e-3, ' A')

  const noCom = createULN2003('u2', { in: [inNet], out: [out], com: undefined, gnd: 0 })
  exact('   no COM net means no diode, as on the real board', noCom.devices.length, 1)
}

// ══════════════════════════════════════════════════════════════════════════════
group('6. L298N — the saturation drop is the lesson')
// ══════════════════════════════════════════════════════════════════════════════

interface BridgeRig {
  res: ReturnType<Circuit['solve']>
  ch: HBridgeChannel
  motorVolts: number
  motorAmps: number
}

function bridge(opts: {
  vsVolts: number
  vssVolts: number | null
  in1: number
  in2: number
  en: number
  loadOhms: number
  warm?: { in1: number; in2: number; en: number }
}): BridgeRig {
  const c = new Circuit()
  const vs = c.allocNet()
  const vss = opts.vssVolts === null ? undefined : c.allocNet()
  const n1 = c.allocNet()
  const n2 = c.allocNet()
  const nEn = c.allocNet()
  const o1 = c.allocNet()
  const o2 = c.allocNet()
  c.add(new VoltageSource('vs', vs, 0, opts.vsVolts))
  if (vss !== undefined) c.add(new VoltageSource('vss', vss, 0, opts.vssVolts!))
  const s1 = new VoltageSource('s1', n1, 0, opts.warm?.in1 ?? opts.in1)
  const s2 = new VoltageSource('s2', n2, 0, opts.warm?.in2 ?? opts.in2)
  const se = new VoltageSource('se', nEn, 0, opts.warm?.en ?? opts.en)
  c.add(s1, s2, se)
  const load = new Resistor('m', o1, o2, opts.loadOhms)
  c.add(load)
  const ch = new HBridgeChannel('l298.A', {
    in1: n1,
    in2: n2,
    en: nEn,
    outA: o1,
    outB: o2,
    vs,
    vss,
    gnd: 0,
  })
  c.add(ch)
  if (opts.warm) {
    c.solve()
    s1.volts = opts.in1
    s2.volts = opts.in2
    se.volts = opts.en
  }
  const res = c.solve()
  return {
    res,
    ch,
    motorVolts: res.voltages[o1] - res.voltages[o2],
    motorAmps: load.current,
  }
}

{
  truth(
    'the model carries the datasheet numbers this file restates',
    L298N.sourceSatVolts === SHEET.l298.sourceSat &&
      L298N.sinkSatVolts === SHEET.l298.sinkSat &&
      L298N.vil === SHEET.l298.vil &&
      L298N.vih === SHEET.l298.vih &&
      L298N.minLogicVolts === SHEET.l298.minLogicVolts &&
      L298N.maxLogicVolts === SHEET.l298.maxLogicVolts &&
      L298N.ratedAmps === SHEET.l298.ratedAmps &&
      L298N.peakAmps === SHEET.l298.peakAmps,
    '1.35/1.2 V sat, VIL 1.5 VIH 2.3, Vss 4.5-7 V, 2 A / 3 A peak',
    `${L298N.sourceSatVolts}/${L298N.sinkSatVolts} V, ${L298N.vil}/${L298N.vih} V, ` +
      `${L298N.minLogicVolts}-${L298N.maxLogicVolts} V, ${L298N.ratedAmps}/${L298N.peakAmps} A`,
  )
}

{
  /**
   * Forward, a 100 Ω motor on a 5 V supply. Two transistors sit in series with
   * the load at all times, so the loop is
   *   5 = 1.35 + i x 0.15 + i x 100 + i x 0.15 + 1.2
   * i.e. i = (5 − 2.55)/100.3 = 24.43 mA and the motor sees 2.443 V out of 5.
   * A student measuring 2.4 V on a "5 V" bridge has not made a mistake.
   */
  const r = 100
  const rig = bridge({ vsVolts: 5, vssVolts: 5, in1: 3.3, in2: 0, en: 3.3, loadOhms: r })
  const i = (5 - SHEET.l298.sourceSat - SHEET.l298.sinkSat) / (r + 2 * SHEET.l298.onOhms)
  truth('a forward-driven bridge solves', rig.res.ok, 'ok:true', `ok:${rig.res.ok} ${rig.res.error ?? ''}`)
  truth('   in forward mode', rig.ch.mode === 'forward', 'forward', rig.ch.mode)
  near('100 Ω on 5 V draws 24.43 mA', rig.motorAmps, i, 1e-9, ' A')
  near('   and the motor sees 2.443 V, not 5', rig.motorVolts, i * r, 1e-9, ' V')
  near('   the bridge eats 2.557 V', 5 - rig.motorVolts, 5 - i * r, 1e-9, ' V')
  near('   which is the channel current the model reports', rig.ch.current, i, 1e-9, ' A')
}

{
  // The total drop must stay inside the datasheet's own 1.80–3.2 V window at
  // every current the part allows — that is the check on the one number in the
  // model (0.15 Ω of bulk) that is not off the datasheet.
  const ch = new HBridgeChannel('probe', {
    in1: 1,
    in2: 2,
    en: 3,
    outA: 4,
    outB: 5,
    vs: 6,
    vss: 7,
    gnd: 0,
  })
  const atZero = ch.totalDropVolts(0)
  const atRated = ch.totalDropVolts(SHEET.l298.ratedAmps)
  near('total drop at no load is 2.55 V', atZero, SHEET.l298.sourceSat + SHEET.l298.sinkSat, 1e-12, ' V')
  near(
    '   and 3.15 V at the 2 A rating',
    atRated,
    SHEET.l298.sourceSat + SHEET.l298.sinkSat + 2 * SHEET.l298.ratedAmps * SHEET.l298.onOhms,
    1e-12,
    ' V',
  )
  truth(
    '   both inside the datasheet 1.80-3.2 V window',
    atZero >= SHEET.l298.totalDropMin &&
      atZero <= SHEET.l298.totalDropMax &&
      atRated >= SHEET.l298.totalDropMin &&
      atRated <= SHEET.l298.totalDropMax,
    '1.80-3.2 V',
    `${atZero.toFixed(2)}-${atRated.toFixed(2)} V`,
  )
}

{
  /**
   * The datasheet truth table, all four rows:
   *   Ven=H C=H D=L  Forward       Ven=H C=L D=H  Reverse
   *   Ven=H C=D      Fast stop     Ven=L          Free running stop
   */
  const fwd = bridge({ vsVolts: 12, vssVolts: 5, in1: 3.3, in2: 0, en: 3.3, loadOhms: 100 })
  const rev = bridge({ vsVolts: 12, vssVolts: 5, in1: 0, in2: 3.3, en: 3.3, loadOhms: 100 })
  const i = (12 - SHEET.l298.sourceSat - SHEET.l298.sinkSat) / (100 + 2 * SHEET.l298.onOhms)
  near('12 V forward: +94.2 mA', fwd.motorAmps, i, 1e-9, ' A')
  near('12 V reverse: the same current the other way', rev.motorAmps, -i, 1e-9, ' A')
  truth('   and the mode says so', rev.ch.mode === 'reverse', 'reverse', rev.ch.mode)

  const brakeHigh = bridge({ vsVolts: 12, vssVolts: 5, in1: 3.3, in2: 3.3, en: 3.3, loadOhms: 100 })
  const brakeLow = bridge({ vsVolts: 12, vssVolts: 5, in1: 0, in2: 0, en: 3.3, loadOhms: 100 })
  truth('C = D = H is a fast stop', brakeHigh.ch.mode === 'brake', 'brake', brakeHigh.ch.mode)
  near('   with both outputs on the same rail, so 0 V across the motor', brakeHigh.motorVolts, 0, 1e-9, ' V')
  truth('C = D = L is also a fast stop', brakeLow.ch.mode === 'brake', 'brake', brakeLow.ch.mode)
  near('   likewise 0 V', brakeLow.motorVolts, 0, 1e-9, ' V')

  const coast = bridge({ vsVolts: 12, vssVolts: 5, in1: 3.3, in2: 0, en: 0, loadOhms: 100 })
  truth('EN low is a FREE-RUNNING stop, not a brake', coast.ch.mode === 'coast', 'coast', coast.ch.mode)
  truth(
    '   with the outputs genuinely floating',
    Math.abs(coast.motorAmps) < 1e-9,
    '< 1 nA',
    `${coast.motorAmps.toExponential(2)} A`,
  )
}

{
  /**
   * The logic supply. An L298 with no Vss does nothing at all — which is the
   * failure a student hits when they power the motor rail and forget the 5 V
   * one — and 12 V on Vss destroys it, because that pin is rated 4.5–7 V.
   */
  const noLogic = bridge({ vsVolts: 12, vssVolts: null, in1: 3.3, in2: 0, en: 3.3, loadOhms: 100 })
  truth('no logic supply, no output', noLogic.ch.mode === 'coast', 'coast', noLogic.ch.mode)
  truth('   and logicOk says why', !noLogic.ch.logicOk, 'logicOk:false', String(noLogic.ch.logicOk))

  const low = bridge({ vsVolts: 12, vssVolts: 3.3, in1: 3.3, in2: 0, en: 3.3, loadOhms: 100 })
  truth('3.3 V is below the 4.5 V logic minimum', low.ch.mode === 'coast', 'coast', low.ch.mode)

  const fried = bridge({ vsVolts: 12, vssVolts: 12, in1: 3.3, in2: 0, en: 3.3, loadOhms: 100 })
  const f = fried.res.faults.find((x) => x.deviceId === 'l298.A')
  truth(
    '12 V on the 4.5-7 V logic pin is destructive',
    f?.severity === 'destructive' && f.kind === 'over_power',
    'over_power / destructive',
    f ? `${f.kind} / ${f.severity}` : '(no fault)',
  )
}

{
  /**
   * The motor supply floor. The datasheet writes it as VIH + 2.5 V = 4.8 V, so
   * a 3.3 V rail cannot run the output stage at all and a 5 V one only just
   * can. That is a real reason the part is sold for 7–12 V work.
   */
  const rig = bridge({ vsVolts: 3.3, vssVolts: 5, in1: 3.3, in2: 0, en: 3.3, loadOhms: 100 })
  near('the supply floor derives to 4.8 V', rig.ch.minSupplyVolts, SHEET.l298.vih + SHEET.l298.supplyHeadroom, 1e-12, ' V')
  truth('   so a 3.3 V motor rail drives nothing', rig.ch.mode === 'coast', 'coast', rig.ch.mode)
  const ok = bridge({ vsVolts: 5, vssVolts: 5, in1: 3.3, in2: 0, en: 3.3, loadOhms: 100 })
  truth('   and 5 V just clears it', ok.ch.mode === 'forward', 'forward', ok.ch.mode)
}

{
  // Logic thresholds and their hysteresis, same treatment as the ULN2003.
  const cold = bridge({ vsVolts: 12, vssVolts: 5, in1: 2.0, in2: 0, en: 3.3, loadOhms: 100 })
  const warm = bridge({
    vsVolts: 12,
    vssVolts: 5,
    in1: 2.0,
    in2: 0,
    en: 3.3,
    loadOhms: 100,
    warm: { in1: 3.3, in2: 0, en: 3.3 },
  })
  truth('IN1 at 2.0 V from off is a low (VIH is 2.3 V)', cold.ch.mode === 'brake', 'brake', cold.ch.mode)
  truth('   and from on it holds (VIL is 1.5 V)', warm.ch.mode === 'forward', 'forward', warm.ch.mode)

  // The inputs are a real, tiny load: 30 µA at 5 V is 166.7 kΩ.
  const rin = SHEET.l298.inputTestVolts / SHEET.l298.inputTestAmps
  near('each logic input is 166.7 kΩ', cold.ch.inputOhms, rin, 1e-6, ' Ω')
  truth(
    '   so three inputs cost a 3.3 V pad under 60 µA',
    (3 * 3.3) / rin < 60e-6,
    '< 60 µA',
    `${((3 * 3.3) / rin) * 1e6} µA`,
  )
}

{
  // Over-current, graduated. On 12 V, 3.48 Ω gives 9.45/3.78 = 2.5 A — past the
  // 2 A continuous rating but inside the 3 A non-repetitive peak.
  const rCaution = (12 - SHEET.l298.sourceSat - SHEET.l298.sinkSat) / 2.5 - 2 * SHEET.l298.onOhms
  const caution = bridge({ vsVolts: 12, vssVolts: 5, in1: 3.3, in2: 0, en: 3.3, loadOhms: rCaution })
  const f1 = caution.res.faults.find((x) => x.deviceId === 'l298.A')
  near('   (the load that gives exactly 2.5 A)', caution.motorAmps, 2.5, 1e-9, ' A')
  truth(
    '2.5 A is a caution',
    f1?.severity === 'caution' && f1.kind === 'over_current',
    'over_current / caution',
    f1 ? `${f1.kind} / ${f1.severity}` : '(no fault)',
  )

  const dead = bridge({ vsVolts: 12, vssVolts: 5, in1: 3.3, in2: 0, en: 3.3, loadOhms: 1 })
  const f2 = dead.res.faults.find((x) => x.deviceId === 'l298.A')
  truth(
    '7.3 A past the 3 A peak is destructive',
    f2?.severity === 'destructive' && f2.kind === 'over_current',
    'over_current / destructive',
    f2 ? `${f2.kind} / ${f2.severity}` : '(no fault)',
  )
}

{
  // Both channels exist and are independent — that is what "dual" means.
  const c = new Circuit()
  const vs = c.allocNet()
  const vss = c.allocNet()
  const nets = Array.from({ length: 10 }, () => c.allocNet())
  c.add(new VoltageSource('vs', vs, 0, 12))
  c.add(new VoltageSource('vss', vss, 0, 5))
  c.add(new VoltageSource('a1', nets[0], 0, 3.3))
  c.add(new VoltageSource('a2', nets[1], 0, 0))
  c.add(new VoltageSource('ea', nets[2], 0, 3.3))
  c.add(new VoltageSource('b1', nets[3], 0, 0))
  c.add(new VoltageSource('b2', nets[4], 0, 3.3))
  c.add(new VoltageSource('eb', nets[5], 0, 0))
  const mA = new Resistor('mA', nets[6], nets[7], 100)
  const mB = new Resistor('mB', nets[8], nets[9], 100)
  c.add(mA, mB)
  const { devices, channels } = createL298N('l298', {
    in1: nets[0],
    in2: nets[1],
    ena: nets[2],
    in3: nets[3],
    in4: nets[4],
    enb: nets[5],
    out1: nets[6],
    out2: nets[7],
    out3: nets[8],
    out4: nets[9],
    vs,
    vss,
    gnd: 0,
  })
  c.add(...devices)
  const res = c.solve()
  const i = (12 - SHEET.l298.sourceSat - SHEET.l298.sinkSat) / (100 + 2 * SHEET.l298.onOhms)
  truth('a whole L298N solves', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  near('channel A runs at 94.2 mA', mA.current, i, 1e-9, ' A')
  truth('   while channel B, disabled, coasts', channels[1].mode === 'coast', 'coast', channels[1].mode)
  near('   drawing nothing', mB.current, 0, 1e-9, ' A')
}

// ══════════════════════════════════════════════════════════════════════════════
group('7. 28BYJ-48 — 4096 half-steps is exactly one output revolution')
// ══════════════════════════════════════════════════════════════════════════════

/** Derived here from the datasheet line "stride angle 5.625°/64", ratio 1/64. */
const HALF_PER_MOTOR_REV = 360 / SHEET.stepper.strideDegrees
const HALF_PER_OUTPUT_REV = HALF_PER_MOTOR_REV * SHEET.stepper.gearRatio
const DEG_PER_HALF = SHEET.stepper.strideDegrees / SHEET.stepper.gearRatio

{
  truth(
    'the model carries the datasheet numbers this file restates',
    STEPPER_28BYJ48.ratedVolts === SHEET.stepper.ratedVolts &&
      STEPPER_28BYJ48.phaseOhms === SHEET.stepper.phaseOhms &&
      STEPPER_28BYJ48.strideDegrees === SHEET.stepper.strideDegrees &&
      STEPPER_28BYJ48.gearRatio === SHEET.stepper.gearRatio,
    '5 V / 50 Ω / 5.625° / 1:64',
    `${STEPPER_28BYJ48.ratedVolts} V / ${STEPPER_28BYJ48.phaseOhms} Ω / ` +
      `${STEPPER_28BYJ48.strideDegrees}° / 1:${STEPPER_28BYJ48.gearRatio}`,
  )
  exact('64 half-steps per MOTOR revolution (360/5.625)', HALF_PER_MOTOR_REV, 64)
  exact('4096 half-steps per OUTPUT revolution (64 x 64)', halfStepsPerRevolution(STEPPER_28BYJ48), HALF_PER_OUTPUT_REV)
  exact('   which is 4096 exactly', HALF_PER_OUTPUT_REV, 4096)
  near('one half-step is 0.087890625° of shaft', degreesPerHalfStep(STEPPER_28BYJ48), DEG_PER_HALF, 0, '°')
  near('   and 4096 of them is 360.000000° exactly', HALF_PER_OUTPUT_REV * DEG_PER_HALF, 360, 0, '°')
  exact('2048 FULL steps per output revolution', halfStepsPerRevolution(STEPPER_28BYJ48) / 2, 2048)
}

{
  /**
   * The eight-state ring. Adjacent entries must differ by exactly one coil —
   * that is what makes it a half-step sequence rather than an arbitrary list,
   * and it is checked rather than assumed.
   */
  let adjacent = true
  for (let k = 0; k < 8; k++) {
    const diff = HALF_STEP_SEQUENCE[k] ^ HALF_STEP_SEQUENCE[(k + 1) % 8]
    // Exactly one bit set.
    if (diff === 0 || (diff & (diff - 1)) !== 0) adjacent = false
  }
  truth('each ring step changes exactly one coil', adjacent, 'one bit per step', adjacent ? 'one bit per step' : 'not a ring')
  exact('the ring has eight states', HALF_STEP_SEQUENCE.length, 8)
  exact('   four of which energise one coil (wave drive)', HALF_STEP_SEQUENCE.filter((p) => popcount(p) === 1).length, 4)
  exact('   and four energise two (two-phase-on)', HALF_STEP_SEQUENCE.filter((p) => popcount(p) === 2).length, 4)
  exact('0b1010 is not in the ring (opposing coils)', stepPhaseIndex(0b1010), -1)
  exact('0b1111 is not in the ring', stepPhaseIndex(0b1111), -1)
}

function popcount(n: number): number {
  let c = 0
  for (let i = 0; i < 8; i++) c += (n >> i) & 1
  return c
}

{
  /**
   * Half-stepping. Note the counting: the FIRST energisation is the origin and
   * cannot be a step, because there is no previous coil state to have moved
   * from. A lap of the ring is therefore nine applications — the origin plus
   * eight transitions — and the model is right to report seven for eight.
   */
  const t = new StepTracker()
  t.apply(HALF_STEP_SEQUENCE[0])
  exact('energising the first pattern is the origin, not a step', t.halfSteps, 0)
  for (let k = 1; k <= 8; k++) t.apply(HALF_STEP_SEQUENCE[k % 8])
  exact('one lap of the ring forward is then +8 half-steps', t.halfSteps, 8)
  exact('   with no sequence errors', t.sequenceErrors, 0)

  const back = new StepTracker()
  back.apply(HALF_STEP_SEQUENCE[0])
  for (let k = 1; k <= 8; k++) back.apply(HALF_STEP_SEQUENCE[(8 - k) % 8])
  exact('one lap backwards is −8', back.halfSteps, -8)
  exact('   also with no errors', back.sequenceErrors, 0)
}

{
  /**
   * Full-step drives. Wave drive visits the odd ring entries (one coil at a
   * time), two-phase-on the even ones (two coils, more torque). Both jump two
   * ring positions per step and both are legitimate, so both must be credited.
   */
  const wave = new StepTracker()
  const wavePattern = [0b1000, 0b0100, 0b0010, 0b0001, 0b1000]
  for (const p of wavePattern) wave.apply(p)
  exact('wave drive: four full steps is +8 half-steps', wave.halfSteps, 8)
  exact('   with no errors', wave.sequenceErrors, 0)

  const twoPhase = new StepTracker()
  for (const p of [0b1100, 0b0110, 0b0011, 0b1001, 0b1100]) twoPhase.apply(p)
  exact('two-phase-on drive: also +8 half-steps', twoPhase.halfSteps, 8)
  exact('   with no errors', twoPhase.sequenceErrors, 0)
}

{
  // Refusals. A pattern off the ring, and a jump too big to be a drive mode.
  const bad = new StepTracker()
  bad.apply(0b1000)
  bad.apply(0b1010)
  exact('opposing coils (0b1010) do not step', bad.halfSteps, 0)
  exact('   and are counted as a sequence error', bad.sequenceErrors, 1)

  const jump3 = new StepTracker()
  jump3.apply(HALF_STEP_SEQUENCE[0])
  jump3.apply(HALF_STEP_SEQUENCE[3])
  exact('a three-position jump is refused, not guessed', jump3.halfSteps, 0)
  exact('   and counted', jump3.sequenceErrors, 1)

  const jump4 = new StepTracker()
  jump4.apply(HALF_STEP_SEQUENCE[0])
  jump4.apply(HALF_STEP_SEQUENCE[4])
  exact('a 180° reversal is refused (no defined direction)', jump4.halfSteps, 0)
  exact('   and counted', jump4.sequenceErrors, 1)

  const off = new StepTracker()
  off.apply(0b1000)
  off.apply(0b0000)
  off.apply(0b1100)
  exact('all coils off is not an error', off.sequenceErrors, 0)
  exact('   and de-energising then re-energising still steps once', off.halfSteps, 1)

  const first = new StepTracker()
  first.apply(0b0110)
  exact('the first energisation is the origin, not a step', first.halfSteps, 0)
  exact('   and picks up the right ring position', first.index, 3)
}

{
  /**
   * The headline: 4096 half-steps really is one turn of the output shaft.
   * 512 laps of the eight-state ring is 4096 half-steps, which must be exactly
   * 360.000000° and exactly 1.0 revolutions.
   */
  const t = new StepTracker()
  t.apply(HALF_STEP_SEQUENCE[0]) // the origin, which is not a step
  for (let k = 1; k <= HALF_PER_OUTPUT_REV; k++) t.apply(HALF_STEP_SEQUENCE[k % 8])
  exact('512 laps of the ring is 4096 half-steps', t.halfSteps, HALF_PER_OUTPUT_REV)
  near('   which is 360.000000° of output shaft', t.halfSteps * DEG_PER_HALF, 360, 0, '°')
  exact('   and no step was lost', t.sequenceErrors, 0)
}

// ══════════════════════════════════════════════════════════════════════════════
group('8. 28BYJ-48 — the windings, and what the shaft does')
// ══════════════════════════════════════════════════════════════════════════════

{
  /**
   * Electrically the motor is four 50 Ω windings from the common tap. At its
   * rated 5 V one phase draws 5/50 = 100 mA, and two-phase-on draws 200 mA —
   * which is why a ULN2003 and not a GPIO pin.
   */
  const c = new Circuit()
  const com = c.allocNet()
  const a = c.allocNet()
  const b = c.allocNet()
  c.add(new VoltageSource('v', com, 0, 5))
  c.add(new VoltageSource('ga', a, 0, 0))
  c.add(new VoltageSource('gb', b, 0, 0))
  // createStepper, not `new UnipolarStepper`: the four phase windings are
  // separate reactive devices and the circuit needs all of them.
  const { devices: coils, stepper: m } = createStepper('m', com, [a, b, undefined, undefined])
  c.add(...coils)
  const res = c.solve()
  const iPhase = SHEET.stepper.ratedVolts / SHEET.stepper.phaseOhms
  truth('the windings solve', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  near('one phase at 5 V draws 100 mA', m.phaseCurrents[0], iPhase, 1e-9, ' A')
  near('   two phases draw 200 mA in total', m.current, 2 * iPhase, 1e-9, ' A')
  near('   which is the rated phase current', m.ratedPhaseAmps, iPhase, 1e-12, ' A')
  near('   an unwired phase draws nothing', m.phaseCurrents[2], 0, 0, ' A')
}

{
  // Over-voltage on a winding. A stepper holds its coils energised
  // continuously, so 6 V on a 5 V winding is a caution and 9 V kills it.
  const rig = (volts: number) => {
    const c = new Circuit()
    const com = c.allocNet()
    const a = c.allocNet()
    c.add(new VoltageSource('v', com, 0, volts))
    c.add(new VoltageSource('g', a, 0, 0))
    const { devices: coils, stepper: m } = createStepper('m', com, [a, undefined, undefined, undefined])
    c.add(...coils)
    return { res: c.solve(), m }
  }
  truth('5 V raises nothing', rig(5).res.faults.length === 0, '0 faults', `${rig(5).res.faults.length} faults`)
  const hot = rig(6).res.faults.find((f) => f.deviceId === 'm')
  truth(
    '6 V on a 5 V winding is a caution',
    hot?.severity === 'caution' && hot.kind === 'over_power',
    'over_power / caution',
    hot ? `${hot.kind} / ${hot.severity}` : '(no fault)',
  )
  const dead = rig(9).res.faults.find((f) => f.deviceId === 'm')
  truth(
    '9 V destroys the insulation',
    dead?.severity === 'destructive' && dead.kind === 'over_power',
    'over_power / destructive',
    dead ? `${dead.kind} / ${dead.severity}` : '(no fault)',
  )
}

/** A monitor harness: set the five coil-node voltages, poll, read the report. */
class StepHarness implements BehaviouralContext {
  clock = new FakeClock()
  cpu = this.clock as unknown as CPU
  volts: Record<string, number> = { COM: 5, A: 5, B: 5, C: 5, D: 5 }
  states: DeviceState[] = []
  drive(): void {}
  voltage(signal: string): number {
    return this.volts[signal] ?? 0
  }
  hasSignal(signal: string): boolean {
    return signal in this.volts
  }
  props(): Record<string, number | string> {
    return {}
  }
  report(state: DeviceState): void {
    this.states.push(state)
  }
  last(): DeviceState {
    return this.states[this.states.length - 1] ?? {}
  }
  /** Energise a pattern by pulling the chosen phases down to a Darlington's Vsat. */
  set(pattern: number, satVolts = 0.9): void {
    const names = ['A', 'B', 'C', 'D']
    for (let k = 0; k < 4; k++) {
      this.volts[names[k]] = pattern & (1 << (3 - k)) ? satVolts : this.volts.COM
    }
  }
}

{
  /**
   * The monitor, driven through a Darlington's real saturation voltage rather
   * than an ideal 0 V: a coil pulled to 0.9 V from a 5 V tap has 4.1 V across
   * it, which is 82 % of rated current and must count as energised.
   */
  const h = new StepHarness()
  const dev = new StepperMonitor('s1', h)
  h.set(HALF_STEP_SEQUENCE[0]) // the origin: energised, but not yet a step
  dev.poll()
  for (let k = 1; k <= HALF_PER_OUTPUT_REV; k++) {
    h.set(HALF_STEP_SEQUENCE[k % 8])
    h.clock.runTo(h.clock.cycles + 160) // 10 µs between coil changes
    dev.poll()
  }
  exact('4096 half-steps through the monitor', Number(h.last().halfSteps), HALF_PER_OUTPUT_REV)
  near('   is exactly one revolution', Number(h.last().revolutions), 1, 0, ' rev')
  near('   and 360.000000° of shaft', Number(h.last().degrees), 360, 0, '°')
  near('   which wraps to 0° on a dial', Number(h.last().shaftDegrees), 0, 1e-9, '°')
  exact('   with no refused patterns', Number(h.last().sequenceErrors), 0)
  exact('   reporting 2048 full steps', Number(h.last().fullSteps), 2048)
}

{
  /**
   * A coil that is barely driven does not count. At 1.0 V across a 50 Ω winding
   * the phase carries 20 mA — a fifth of rated — and the rotor will not follow
   * the field, so the monitor must see nothing energised.
   */
  const h = new StepHarness()
  const dev = new StepperMonitor('s1', h)
  h.volts.COM = 5
  h.volts.A = 4.0 // 1.0 V across the winding: 20 % of rated current
  dev.poll()
  exact('a winding at 20 % of rated current is not energised', Number(h.last().energisedPhases), 0)

  h.volts.A = 2.7 // 2.3 V across it: what a 3.3 V rail through a Darlington gives
  dev.poll()
  exact('   but 2.3 V (a 3.3 V drive) is', Number(h.last().energisedPhases), 1)
}

{
  // Speed. Stepping every 10 ms is 100 half-steps/s, which on a 4096-half-step
  // shaft is 100/4096 rev/s = 1.4648 rpm.
  const h = new StepHarness()
  const dev = new StepperMonitor('s1', h)
  const periodCycles = Math.round(CLOCK_HZ * 0.01)
  for (let k = 0; k < 12; k++) {
    h.set(HALF_STEP_SEQUENCE[k % 8])
    h.clock.runTo(h.clock.cycles + periodCycles)
    dev.poll()
  }
  const expectedRpm = (100 / HALF_PER_OUTPUT_REV) * 60
  near('100 half-steps per second is 1.4648 rpm', Number(h.last().rpm), expectedRpm, 1e-9, ' rpm')

  // A stopped motor must decay to zero rather than freeze at its last rate.
  h.clock.runTo(h.clock.cycles + CLOCK_HZ)
  dev.refresh()
  near('   and a stopped motor reports 0 rpm', Number(h.last().rpm), 0, 0, ' rpm')
  truth('   while still holding its position', Number(h.last().halfSteps) === 11, '11 half-steps', String(h.last().halfSteps))
}

// ══════════════════════════════════════════════════════════════════════════════
group('9. The whole drive chain — GPIO → ULN2003 → 28BYJ-48')
// ══════════════════════════════════════════════════════════════════════════════

{
  /**
   * Experiment 9's actual wiring, solved: four Pico pads drive four ULN2003
   * inputs, four open-collector outputs sink four windings, and the common tap
   * sits on the 5 V rail. Every number below is derived from the two datasheets
   * and nothing is read off the engine.
   *
   * With one phase on:  5 = i x 50 + 0.7 + i x 2  →  i = 82.69 mA
   * so the winding sees 4.135 V of its nominal 5 — the Darlington tax, and the
   * reason a 28BYJ-48 on a ULN2003 is slightly weaker than its datasheet.
   */
  const c = new Circuit()
  const rail = c.allocNet()
  const ins = [c.allocNet(), c.allocNet(), c.allocNet(), c.allocNet()]
  const outs = [c.allocNet(), c.allocNet(), c.allocNet(), c.allocNet()]
  c.add(new VoltageSource('v5', rail, 0, 5))
  const pads = ins.map((n, k) => new VoltageSource(`gp${k}`, n, 0, 0))
  c.add(...pads)
  const { devices, channels } = createULN2003('u1', {
    in: ins,
    out: outs,
    com: rail,
    gnd: 0,
  })
  c.add(...devices)
  const { devices: motorDevices, stepper: motor } = createStepper('m', rail, outs)
  c.add(...motorDevices)

  // Drive IN1 only, as the first entry of the ring does.
  pads[0].volts = 3.3
  const res = c.solve()
  const i1 = (5 - ULN_V0) / (SHEET.stepper.phaseOhms + ULN_RON)
  truth('the whole chain solves', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  truth('   with channel 1 on and the rest off', channels[0].on && !channels[1].on, 'ch1 on only', `${channels.map((x) => (x.on ? '1' : '0')).join('')}`)
  // Tolerances here are 1e-6 rather than the 1e-9 used on the bare channel: the
  // whole chain carries seven reverse-biased clamp diodes, so it is a NONLINEAR
  // circuit and stops at Newton's reltol of 1e-3 rather than at the exact
  // linear root. 1e-6 V is still four orders below anything observable.
  near('phase A draws 82.69 mA', motor.phaseCurrents[0], i1, 1e-6, ' A')
  near('   seeing 4.135 V of its nominal 5', 5 - res.voltages[outs[0]], SHEET.stepper.ratedVolts - (ULN_V0 + i1 * ULN_RON), 1e-6, ' V')
  near('   an unenergised phase carries nothing', motor.phaseCurrents[1], 0, 1e-9, ' A')
  truth('   and no part is over its ratings', res.faults.length === 0, '0 faults', `${res.faults.length} faults`)

  // Two-phase-on doubles the supply current, which is what the 5 V rail sees.
  pads[1].volts = 3.3
  const res2 = c.solve()
  near('two phases on draw 165.4 mA from the rail', motor.current, 2 * i1, 1e-6, ' A')
  truth('   and it still solves', res2.ok, 'ok:true', `ok:${res2.ok} ${res2.error ?? ''}`)
}

{
  /**
   * The same chain, stepped 4096 times through the real solver with a monitor
   * reading the SOLVED coil voltages — not a synthetic pattern. One output
   * revolution, computed end to end.
   */
  const c = new Circuit()
  const rail = c.allocNet()
  const ins = [c.allocNet(), c.allocNet(), c.allocNet(), c.allocNet()]
  const outs = [c.allocNet(), c.allocNet(), c.allocNet(), c.allocNet()]
  c.add(new VoltageSource('v5', rail, 0, 5))
  const pads = ins.map((n, k) => new VoltageSource(`gp${k}`, n, 0, 0))
  c.add(...pads)
  const { devices } = createULN2003('u1', { in: ins, out: outs, com: rail, gnd: 0 })
  c.add(...devices)
  c.add(...createStepper('m', rail, outs).devices)

  const h = new StepHarness()
  const monitor = new StepperMonitor('s1', h)
  let solves = 0
  let allOk = true
  const names = ['A', 'B', 'C', 'D']
  // Step 0 energises the first pattern and establishes the origin; steps 1..4096
  // are the transitions that actually move the shaft.
  for (let step = 0; step <= HALF_PER_OUTPUT_REV; step++) {
    const pattern = HALF_STEP_SEQUENCE[step % 8]
    for (let k = 0; k < 4; k++) pads[k].volts = pattern & (1 << (3 - k)) ? 3.3 : 0
    const r = c.solve()
    solves++
    if (!r.ok) allOk = false
    h.volts.COM = r.voltages[rail]
    for (let k = 0; k < 4; k++) h.volts[names[k]] = r.voltages[outs[k]]
    if (step > 0) h.clock.runTo(h.clock.cycles + 16_000) // 1 ms per half-step
    monitor.poll()
  }
  truth(`all ${solves} operating points solved`, allOk, 'every solve ok', allOk ? 'every solve ok' : 'a solve failed')
  exact('4096 solved half-steps', Number(h.last().halfSteps), HALF_PER_OUTPUT_REV)
  near('   is one output revolution', Number(h.last().revolutions), 1, 0, ' rev')
  near('   and 360.000000°', Number(h.last().degrees), 360, 0, '°')
  exact('   with no pattern refused', Number(h.last().sequenceErrors), 0)
  // 4096 half-steps at 1 ms each is 1000 half-steps/s = 14.648 rpm.
  near('   at 14.648 rpm', Number(h.last().rpm), (1000 / HALF_PER_OUTPUT_REV) * 60, 1e-9, ' rpm')
}

{
  /**
   * A wrong sequence table, which is the commonest stepper bug there is. Firing
   * IN1 and IN3 together energises two coils wound in opposition; the rotor
   * feels no net field, and the model must refuse rather than invent motion.
   */
  const h = new StepHarness()
  const dev = new StepperMonitor('s1', h)
  for (const p of [0b1000, 0b1010, 0b0010, 0b0101, 0b0100]) {
    h.set(p)
    h.clock.runTo(h.clock.cycles + 16_000)
    dev.poll()
  }
  truth(
    'a bad sequence table is reported, not silently stepped',
    Number(h.last().sequenceErrors) >= 2,
    '>= 2 refusals',
    `${h.last().sequenceErrors} refusals`,
  )
  exact('   and the phase index says where the coils actually are', Number(h.last().phaseIndex), stepPhaseIndex(0b0100))
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
