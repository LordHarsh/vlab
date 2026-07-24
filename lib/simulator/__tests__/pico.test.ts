/**
 * Tests for the RASPBERRY PI PICO track — rp2040js + MicroPython driving the
 * same analog solver the Arduino track uses.
 *
 * Every electrical expectation here is derived from closed-form theory written
 * out longhand in this file — the Shockley equation and a KVL loop, solved by
 * an independent bisection — and never from the engine's own output. If the
 * engine and this file disagree, one of them is wrong and the test says which
 * number it expected and why.
 *
 * THE NUMBER THIS FILE EXISTS TO PIN
 * ----------------------------------
 * A Pico is a 3.3 V part. The Uno is a 5 V part. The same LED and the same
 * 220 Ω resistor therefore do NOT behave the same way, and the difference is
 * not small: about 12.4 mA on an Uno against about 4.9 mA here, because the
 * LED's ~2 V forward drop eats a far larger share of a 3.3 V budget. Group C
 * asserts that gap explicitly, because the failure mode it guards against —
 * someone copying the Uno's constants across — produces a circuit that solves
 * perfectly, reports no fault, and teaches the wrong resistor value.
 *
 * Run: npx tsx lib/simulator/__tests__/pico.test.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { GPIOPinState } from 'rp2040js'
import { compile } from '../model/compile'
import { loadPicoFirmware, uf2ToFlashImage, type PicoFirmware } from '../pico/firmware'
import {
  PicoSimulationEngine,
  PICO_VDD,
  PICO_ADC_MAX,
  type PicoSnapshot,
} from '../pico/engine'
import { PICO_PART, gpioIndexOf, adcChannelOf, registerPicoPart } from '../pico/board'
import type { CircuitDoc, DocWire } from '../model/document'

registerPicoPart()

// ─── Harness (same shape as engine.test.ts) ──────────────────────────────────

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
function truth(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  record(name, pass, expected, actual, note)
}
function near(name: string, actual: number, expected: number, tol: number, unit = 'mA'): void {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol
  record(
    name,
    pass,
    `${expected.toFixed(4)} ${unit} ±${tol}`,
    `${Number.isFinite(actual) ? actual.toFixed(4) : String(actual)} ${unit}`,
    pass ? undefined : `err ${Math.abs(actual - expected).toExponential(2)} > tol ${tol}`,
  )
}

// ─── Independent theory ──────────────────────────────────────────────────────

/**
 * Thermal voltage and the red-LED parameters, restated as literals.
 *
 * These are copies of the values in devices.ts and types.ts ON PURPOSE. The
 * point of the exercise is to solve the same PHYSICS by a different METHOD —
 * scalar bisection on one KVL equation versus the engine's Newton iteration on
 * a stamped matrix — so the parameters must match while the solution must not
 * come from the engine. Reading them through an import would be identical; only
 * the shared constant changing silently under both would be missed, which is
 * what the explicit restatement here is for.
 */
const VT = 0.025852
const LED_IS = 1e-20
const LED_N = 1.8
const LED_RS = 2.0

/** Shockley, exactly as the diode model states it. */
function diodeCurrent(vd: number): number {
  return LED_IS * (Math.exp(vd / (LED_N * VT)) - 1)
}

/**
 * Solve  Vsupply = I·Rtotal + Vd  with  I = Is·(exp(Vd/(n·VT)) − 1)
 * for the diode voltage, by bisection on the residual. Monotone in Vd, so
 * bisection cannot land on a wrong root — which is precisely the failure the
 * engine's junction limiting exists to avoid, so solving it a different way is
 * the whole value of this function.
 *
 * `rTotal` is everything in series with the junction: the pad's output
 * impedance, the LED's own bulk resistance, and the external resistor.
 */
function ledLoopCurrent(vSupply: number, rTotal: number): number {
  let lo = 0
  let hi = vSupply
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2
    const residual = mid + diodeCurrent(mid) * rTotal - vSupply
    if (residual > 0) hi = mid
    else lo = mid
  }
  return diodeCurrent((lo + hi) / 2)
}

/** Model constants restated from pico/engine.ts, for the same reason as above. */
const R_DRIVE = 50
const R_PULL = 55_000
const R_EXT = 220

/**
 * Hand-derived operating points. Printed by the report so the expected value is
 * auditable without reading code.
 */
const PICO_LED_A = ledLoopCurrent(PICO_VDD, R_DRIVE + LED_RS + R_EXT)
const UNO_LED_A = ledLoopCurrent(5.0, 25 + LED_RS + R_EXT)

// ─── Documents ───────────────────────────────────────────────────────────────

let wireSeq = 0
function wire(from: [string, string], to: [string, string]): DocWire {
  return {
    id: `pw${++wireSeq}`,
    from: { partId: from[0], pinId: from[1] },
    to: { partId: to[0], pinId: to[1] },
    color: '#111827',
  }
}

/** GP<n> → LED anode; LED cathode → 220 Ω → GND. Nothing else. */
function picoLedDoc(gpioPin = 'GP15', ohms = R_EXT): CircuitDoc {
  return {
    parts: [
      { id: 'pico', type: 'raspberry_pi_pico', x: 0, y: 0, rotation: 0, props: {} },
      { id: 'led1', type: 'led', x: 200, y: 0, rotation: 0, props: {} },
      { id: 'r1', type: 'resistor', x: 300, y: 0, rotation: 0, props: { ohms } },
    ],
    wires: [
      wire(['pico', gpioPin], ['led1', 'A']),
      wire(['led1', 'C'], ['r1', '1']),
      wire(['r1', '2'], ['pico', 'GND.1']),
    ],
  }
}

/** A voltage divider off the 3V3 rail into GP26 (ADC0). */
function picoDividerDoc(): CircuitDoc {
  return {
    parts: [
      { id: 'pico', type: 'raspberry_pi_pico', x: 0, y: 0, rotation: 0, props: {} },
      { id: 'rt', type: 'resistor', x: 200, y: 0, rotation: 0, props: { ohms: 10000 } },
      { id: 'rb', type: 'resistor', x: 300, y: 0, rotation: 0, props: { ohms: 10000 } },
    ],
    wires: [
      wire(['pico', '3.3V'], ['rt', '1']),
      wire(['rt', '2'], ['rb', '1']),
      wire(['rt', '2'], ['pico', 'GP26']),
      wire(['rb', '2'], ['pico', 'GND.1']),
    ],
  }
}

// ─── Firmware fixtures ───────────────────────────────────────────────────────

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

/**
 * A firmware that does nothing at all: 16 KB of zeroed bootrom and a single
 * Thumb `B .` (0xe7fe, branch-to-self) at the flash base.
 *
 * Groups A and C use this so the ELECTRICAL model can be tested in
 * milliseconds without booting a 320 KB interpreter. The pin states are driven
 * by writing the RP2040's own IO_BANK0/SIO/PADS registers over the emulator's
 * bus, which is the identical code path the firmware would take — the CPU is
 * simply not the thing under test there.
 */
function inertFirmware(): PicoFirmware {
  const flash = new Uint8Array(4)
  flash[0] = 0xfe
  flash[1] = 0xe7 // B .
  return loadPicoFirmware(new Uint8Array(16 * 1024), flash)
}

// ─── Poking GPIO without firmware ────────────────────────────────────────────

const IO_BANK0_BASE = 0x40014000
const PADS_BANK0_BASE = 0x4001c000
const SIO_BASE = 0xd0000000
const SIO_GPIO_OUT_SET = SIO_BASE + 0x014
const SIO_GPIO_OUT_CLR = SIO_BASE + 0x018
const SIO_GPIO_OE_SET = SIO_BASE + 0x024
const SIO_GPIO_OE_CLR = SIO_BASE + 0x028
const FUNCSEL_SIO = 5

/**
 * PADS_BANK0 values. Bit 1 schmitt, bit 2 pull-DOWN enable, bit 3 pull-UP
 * enable, bits 4–5 drive strength, bit 6 input enable, bit 7 output disable.
 *
 * Note what the RESET value is: an RP2040 GPIO comes out of reset with its
 * pull-DOWN already enabled. That is not a detail — it means a bare Pico pin
 * is a ~55 kΩ resistor to ground before any firmware touches it, which really
 * does load a high-impedance source (group E measures exactly that). Treating
 * the reset state as a clean high-impedance input would have been the easy
 * wrong assumption.
 */
const PAD_INPUT_PULLDOWN = 0b0110110 // the reset value
const PAD_INPUT_NOPULL = 0b0110010
const PAD_INPUT_PULLUP = 0b0111010

function selectSio(eng: PicoSimulationEngine, gp: number): void {
  eng.mcu.writeUint32(IO_BANK0_BASE + gp * 8 + 4, FUNCSEL_SIO)
}
function driveHigh(eng: PicoSimulationEngine, gp: number): void {
  selectSio(eng, gp)
  eng.mcu.writeUint32(SIO_GPIO_OE_SET, 1 << gp)
  eng.mcu.writeUint32(SIO_GPIO_OUT_SET, 1 << gp)
}
function driveLow(eng: PicoSimulationEngine, gp: number): void {
  selectSio(eng, gp)
  eng.mcu.writeUint32(SIO_GPIO_OE_SET, 1 << gp)
  eng.mcu.writeUint32(SIO_GPIO_OUT_CLR, 1 << gp)
}
function makeInput(eng: PicoSimulationEngine, gp: number, pad = PAD_INPUT_NOPULL): void {
  selectSio(eng, gp)
  eng.mcu.writeUint32(SIO_GPIO_OE_CLR, 1 << gp)
  eng.mcu.writeUint32(PADS_BANK0_BASE + 4 + gp * 4, pad)
}

/**
 * Advance far enough for the READOUT to have caught up, then sample.
 *
 * 200 ms is eight time constants of the engine's 25 ms display filter, so the
 * reported current is within 0.04% of the operating point. This is the single
 * easiest mistake to make when testing this engine: the solve is instantaneous
 * but `snapshot()` deliberately reports a trailing average, so sampling a few
 * microseconds after a pin edge returns ~0.8% of the true value — a number that
 * looks like a broken solver and is in fact a correctly-working filter.
 */
function settle(eng: PicoSimulationEngine, micros = 200_000): PicoSnapshot {
  eng.run(micros)
  return eng.snapshot()
}

// ══════════════════════════════════════════════════════════════════════════════
group('A. The board definition matches a real Pico')
// ══════════════════════════════════════════════════════════════════════════════
{
  truth('the header has 40 pins', PICO_PART.pins.length === 40, '40', String(PICO_PART.pins.length))

  const grounds = PICO_PART.pins.filter((p) => p.type === 'gnd')
  truth(
    'eight of them are ground (pins 3, 8, 13, 18, 23, 28, 33/AGND, 38)',
    grounds.length === 8,
    '8',
    String(grounds.length),
  )

  // Physical pin 1 is GP0 top-left; pin 20 is GP15 bottom-left; pin 40 is VBUS
  // top-right. Getting the right header's direction backwards is the classic
  // way to draw a Pico wrong, and it is invisible until someone wires one up.
  truth('pin 1 is GP0', PICO_PART.pins[0].id === 'GP0', 'GP0', PICO_PART.pins[0].id)
  truth('pin 20 is GP15', PICO_PART.pins[19].id === 'GP15', 'GP15', PICO_PART.pins[19].id)
  truth('pin 21 is GP16', PICO_PART.pins[20].id === 'GP16', 'GP16', PICO_PART.pins[20].id)
  truth('pin 40 is VBUS', PICO_PART.pins[39].name === 'VBUS', 'VBUS', PICO_PART.pins[39].name)
  truth(
    'and pin 40 sits at the TOP of the right header, not the bottom',
    PICO_PART.pins[39].y < PICO_PART.pins[20].y,
    `y(pin40) < y(pin21)`,
    `${PICO_PART.pins[39].y} < ${PICO_PART.pins[20].y}`,
  )

  // GP23/24/25 are on the die but have no pad on a Pico. Exposing them would
  // let a student wire to a pin that does not physically exist.
  const ids = new Set(PICO_PART.pins.map((p) => p.id))
  truth(
    'GP23/GP24/GP25 are absent — they have no header pad on a Pico',
    !ids.has('GP23') && !ids.has('GP24') && !ids.has('GP25'),
    'absent',
    [...ids].filter((i) => /^GP2[345]$/.test(i)).join(',') || 'absent',
  )
  truth(
    'GP26/GP27/GP28 are the three ADC pins and nothing else is analog',
    PICO_PART.pins.filter((p) => p.type === 'analog').map((p) => p.id).join(',') ===
      'GP26,GP27,GP28',
    'GP26,GP27,GP28',
    PICO_PART.pins.filter((p) => p.type === 'analog').map((p) => p.id).join(','),
  )
  truth(
    'the ADC channel map is GP26→0, GP27→1, GP28→2',
    adcChannelOf('GP26') === 0 && adcChannelOf('GP27') === 1 && adcChannelOf('GP28') === 2,
    '0,1,2',
    `${adcChannelOf('GP26')},${adcChannelOf('GP27')},${adcChannelOf('GP28')}`,
  )
  truth(
    'gpioIndexOf parses GP0 and GP28 but refuses VBUS',
    gpioIndexOf('GP0') === 0 && gpioIndexOf('GP28') === 28 && gpioIndexOf('5V') === null,
    '0, 28, null',
    `${gpioIndexOf('GP0')}, ${gpioIndexOf('GP28')}, ${gpioIndexOf('5V')}`,
  )

  // compile() keys its rail stamping off these exact pin ids, so a rename would
  // silently remove the Pico's power rails from every circuit.
  const doc = picoDividerDoc()
  const c = compile(doc)
  truth(
    'the 3V3 rail reaches the solver (compile keys on the id "3.3V")',
    c.circuit.size > 0 && c.problems.every((p) => !/not connected/.test(p)),
    'a solvable circuit, no dangling parts',
    `${c.circuit.size} unknowns, problems: ${c.problems.join(' | ') || 'none'}`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('B. UF2 → flash image')
// ══════════════════════════════════════════════════════════════════════════════
{
  // A hand-built two-block UF2: one real flash block and one flagged
  // NOT_MAIN_FLASH, which must be skipped rather than written.
  function uf2Block(addr: number, payload: number[], flags = 0, seq = 0, total = 1): Uint8Array {
    const b = new Uint8Array(512)
    const v = new DataView(b.buffer)
    v.setUint32(0, 0x0a324655, true)
    v.setUint32(4, 0x9e5d5157, true)
    v.setUint32(8, flags, true)
    v.setUint32(12, addr, true)
    v.setUint32(16, payload.length, true)
    v.setUint32(20, seq, true)
    v.setUint32(24, total, true)
    b.set(payload, 32)
    v.setUint32(508, 0x0ab16f30, true)
    return b
  }
  const good = uf2Block(0x10000000, [1, 2, 3, 4], 0, 0, 2)
  const skipped = uf2Block(0x20000000, [9, 9, 9, 9], 0x00000001, 1, 2)
  const joined = new Uint8Array(1024)
  joined.set(good, 0)
  joined.set(skipped, 512)

  const img = uf2ToFlashImage(joined)
  truth(
    'a NOT_MAIN_FLASH block is skipped, not written',
    img.blocks === 1 && img.data.length === 4 && [...img.data].join(',') === '1,2,3,4',
    '1 block, 4 bytes [1,2,3,4]',
    `${img.blocks} blocks, ${img.data.length} bytes [${[...img.data].join(',')}]`,
  )
  truth('the base address is recovered', img.baseAddress === 0x10000000, '0x10000000',
    '0x' + img.baseAddress.toString(16))

  let rejected = false
  try {
    uf2ToFlashImage(new Uint8Array(512))
  } catch {
    rejected = true
  }
  truth('a blob with no UF2 magic is REJECTED, not silently loaded as garbage',
    rejected, 'throws', rejected ? 'throws' : 'accepted')

  if (HAVE_FIRMWARE) {
    const fw = realFirmware()
    truth(
      'the shipped MicroPython image starts at the XIP flash base',
      fw.flashBase === 0x10000000,
      '0x10000000',
      '0x' + fw.flashBase.toString(16),
    )
    truth(
      'the shipped bootrom is exactly 4096 words',
      fw.bootrom.length === 4096,
      '4096',
      String(fw.bootrom.length),
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('C. A Pico GPIO drives the analog solver — at 3.3 V, not 5 V')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * GP15 → LED → 220 Ω → GND, with GP15 driven high through the pad's 50 Ω
   * output impedance. The loop is
   *
   *     3.3 = I·(50 + 2 + 220) + Vd,   I = 1e-20·(exp(Vd/(1.8·0.025852)) − 1)
   *
   * which the bisection above solves to I = PICO_LED_A. Nothing in that
   * derivation touches the engine.
   */
  const eng = new PicoSimulationEngine(inertFirmware(), picoLedDoc())

  const dark = settle(eng)
  near('LED is dark before anything drives GP15', dark.currents.led1 * 1000, 0, 0.01)

  driveHigh(eng, 15)
  const lit = settle(eng)
  near('LED current with GP15 high', lit.currents.led1 * 1000, PICO_LED_A * 1000, 0.02)
  truth(
    'and the pin reports itself as driving high',
    lit.pins.GP15 === 'high',
    'high',
    String(lit.pins.GP15),
  )

  /**
   * THE HEADLINE. The identical circuit on a 5 V Uno carries UNO_LED_A. If
   * anybody copies the Uno's rail or its 25 Ω pad impedance into the Pico
   * engine, this is the assertion that catches it — every other test in this
   * group would still pass, because a wrong-but-consistent rail solves
   * perfectly well.
   */
  truth(
    'the 3.3 V rail carries substantially LESS than the same circuit on 5 V',
    PICO_LED_A < UNO_LED_A * 0.55,
    `< ${(UNO_LED_A * 0.55 * 1000).toFixed(2)} mA (55% of the Uno's ${(UNO_LED_A * 1000).toFixed(2)} mA)`,
    `${(PICO_LED_A * 1000).toFixed(2)} mA`,
  )
  near(
    'the engine reproduces the 3.3 V figure and not the 5 V one',
    lit.currents.led1 * 1000,
    PICO_LED_A * 1000,
    0.02,
  )

  driveLow(eng, 15)
  const off = settle(eng)
  near('driving GP15 low extinguishes it', off.currents.led1 * 1000, 0, 0.01)
  truth('and the drive state follows', off.pins.GP15 === 'low', 'low', String(off.pins.GP15))

  /**
   * A high-impedance input must not light the LED, and an internal PULL-UP
   * must not either: 55 kΩ from 3.3 V can deliver at most 3.3/55000 = 60 µA,
   * three orders of magnitude below the ~5 mA the pad sources. This is the
   * assertion that fails if a pull-up is ever modelled with the pad's 50 Ω.
   */
  makeInput(eng, 15)
  const floating = settle(eng)
  near('a floating input sources nothing', floating.currents.led1 * 1000, 0, 0.001)
  truth('and reads as float', floating.pins.GP15 === 'float', 'float', String(floating.pins.GP15))

  makeInput(eng, 15, PAD_INPUT_PULLUP)
  const pulled = settle(eng)
  truth('a pulled-up input reads as pullup', pulled.pins.GP15 === 'pullup', 'pullup',
    String(pulled.pins.GP15))
  truth(
    `and sources at most VDD/R_PULL = ${((PICO_VDD / R_PULL) * 1e6).toFixed(0)} µA`,
    pulled.currents.led1 <= PICO_VDD / R_PULL,
    `≤ ${((PICO_VDD / R_PULL) * 1e6).toFixed(1)} µA`,
    `${(pulled.currents.led1 * 1e6).toFixed(2)} µA`,
  )

  /**
   * A pull-DOWN is a state an ATmega does not have. Folding it into 'float'
   * would be invisible on an LED but wrong on a button circuit, so it gets its
   * own drive state.
   */
  makeInput(eng, 15, PAD_INPUT_PULLDOWN)
  const down = settle(eng)
  truth(
    'a pulled-down input is reported as pulldown, not as float',
    down.pins.GP15 === 'pulldown',
    'pulldown',
    String(down.pins.GP15),
  )
  truth(
    'which rp2040js agrees with',
    eng.mcu.gpio[15].value === GPIOPinState.InputPullDown,
    'InputPullDown',
    GPIOPinState[eng.mcu.gpio[15].value],
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('D. Resistor sizing on 3.3 V behaves as theory says')
// ══════════════════════════════════════════════════════════════════════════════
{
  // Three resistors, three independent hand-derivations. A single value could
  // be matched by a wrong model with a compensating error; a monotone sweep
  // that agrees at every point cannot.
  for (const ohms of [100, 330, 1000]) {
    const eng = new PicoSimulationEngine(inertFirmware(), picoLedDoc('GP15', ohms))
    driveHigh(eng, 15)
    const s = settle(eng)
    const expected = ledLoopCurrent(PICO_VDD, R_DRIVE + LED_RS + ohms)
    near(`${ohms} Ω`, s.currents.led1 * 1000, expected * 1000, 0.02)
  }

  // The engine must publish a per-pin rating derived from the RP2040, not the
  // ATmega's 20 mA / 40 mA. 100 Ω on 3.3 V draws about 9 mA, comfortably under
  // the Pico's 12 mA, where the AVR thresholds would also stay quiet — so the
  // check that matters is that a genuinely over-driven pad DOES fault.
  const hot = new PicoSimulationEngine(inertFirmware(), picoLedDoc('GP15', 0))
  driveHigh(hot, 15)
  const s = settle(hot)
  const overCurrent = s.faults.filter((f) => f.kind === 'over_current')
  truth(
    'an LED with NO series resistor over-drives the pad and is reported',
    overCurrent.length > 0,
    'at least one over_current fault',
    `${overCurrent.length} faults: ${s.faults.map((f) => f.kind).join(',') || 'none'}`,
  )
  truth(
    'and the fault quotes the RP2040 12 mA figure, not the ATmega 40 mA one',
    overCurrent.length > 0 && /12 mA|16 mA/.test(overCurrent[0].message) &&
      !/40 mA/.test(overCurrent[0].message),
    'mentions 12/16 mA, never 40 mA',
    overCurrent[0]?.message.slice(0, 90) ?? '(no fault)',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('E. The ADC reads a real node voltage, 12-bit')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Two equal 10 kΩ resistors from 3V3 to GND, tapped at GP26.
   *
   * FIRST, the pin as it comes out of reset — pull-down enabled. The 55 kΩ
   * pull-down sits in parallel with the lower 10 kΩ leg:
   *
   *   R_lower = (10k · 55k)/(10k + 55k) = 8.4615 kΩ
   *   V       = 3.3 · 8.4615/(10 + 8.4615) = 1.5124 V
   *   counts  = 4095 · 1.5124/3.3 = 1877
   *
   * That is not a defect, it is what a real Pico does, and it is exactly the
   * sort of thing a student measuring a high-impedance sensor divider gets
   * bitten by. Asserting it keeps anyone from "fixing" the reset state.
   */
  const eng = new PicoSimulationEngine(inertFirmware(), picoDividerDoc())
  const loaded = settle(eng)
  const rLower = (10000 * R_PULL) / (10000 + R_PULL)
  const vLoaded = (PICO_VDD * rLower) / (10000 + rLower)
  near(
    'a pin still in its reset state loads the divider with its 55 kΩ pull-down',
    loaded.adc.GP26,
    Math.round((vLoaded / PICO_VDD) * PICO_ADC_MAX),
    1,
    'counts',
  )

  /**
   * NOW configure it the way machine.ADC() does — pulls off — and the divider
   * is exact: 3.3 × 10000/20000 = 1.65 V, which at 12 bits against a 3.3 V
   * reference is 4095 × 1.65/3.3 = 2047.5, i.e. 2048 after rounding.
   *
   * The Uno's ADC is 10-bit; publishing 1023 counts here would be a plausible
   * number and completely wrong, which is why the count is asserted and not
   * just the ratio.
   */
  makeInput(eng, 26, PAD_INPUT_NOPULL)
  const s = settle(eng)
  near('with the pulls off the divider taps half the 3V3 rail', s.adc.GP26, 2048, 1, 'counts')
  truth(
    'full scale is 4095 (12-bit), not 1023 (the AVR is a 10-bit part)',
    PICO_ADC_MAX === 4095,
    '4095',
    String(PICO_ADC_MAX),
  )
  truth(
    'and the emulator was handed the node voltage in VOLTS, as its ADC expects',
    Math.abs(eng.mcu.adc.channelValues[0] - 1.65) < 0.01,
    '1.650 V',
    `${eng.mcu.adc.channelValues[0].toFixed(4)} V`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('F. Rewiring mid-run')
// ══════════════════════════════════════════════════════════════════════════════
{
  const eng = new PicoSimulationEngine(inertFirmware(), picoLedDoc())
  driveHigh(eng, 15)
  const before = settle(eng)
  near('lit on GP15', before.currents.led1 * 1000, PICO_LED_A * 1000, 0.02)

  // Move the LED to GP16, which nothing is driving. The listener for GP15 must
  // be torn down; a leaked one would keep writing into `drives` for a pin that
  // no longer has a Norton port.
  eng.setDocument(picoLedDoc('GP16'))
  const after = settle(eng)
  near('dark after moving it to an undriven GP16', after.currents.led1 * 1000, 0, 0.01)
  truth(
    'GP15 has dropped out of the reported pin set',
    !('GP15' in after.pins) && 'GP16' in after.pins,
    'GP16 only',
    Object.keys(after.pins).join(',') || '(none)',
  )

  // Drive the NEW pin: this is what actually proves the re-subscription worked.
  driveHigh(eng, 16)
  const relit = settle(eng)
  near('and lights again once GP16 is driven', relit.currents.led1 * 1000, PICO_LED_A * 1000, 0.02)
}

// ══════════════════════════════════════════════════════════════════════════════
group('G. Real MicroPython, end to end')
// ══════════════════════════════════════════════════════════════════════════════
if (!HAVE_FIRMWARE) {
  truth(
    'firmware present in public/pico',
    false,
    'bootrom.bin + micropython.bin',
    'missing — run: npx tsx lib/simulator/pico/fetch-firmware.mts',
  )
} else {
  /**
   * The whole vertical slice: a prebuilt MicroPython boots on rp2040js, the
   * student's .py is typed into the emulated REPL over emulated USB, and the
   * GPIO it sets drives the SAME analog solver every other test in this file
   * uses. No part of this is stubbed.
   *
   * The script holds the pin high forever rather than blinking, so the
   * assertion is on a steady operating point and cannot be flaky about which
   * half of a duty cycle it sampled.
   */
  const script = ['from machine import Pin', 'led = Pin(15, Pin.OUT)', 'led.value(1)'].join('\n')
  const eng = new PicoSimulationEngine(realFirmware(), picoLedDoc(), { script })

  const t0 = Date.now()
  // 6 s of simulated time: boot to prompt takes ~1.8 s, the paste a fraction
  // of a second, and the rest is slack.
  eng.run(6_000_000)
  const s = eng.snapshot()
  const wall = (Date.now() - t0) / 1000

  truth(
    'MicroPython reaches its REPL prompt',
    /MicroPython .* on .*Raspberry Pi Pico/.test(s.serial) || s.serial.includes('>>>'),
    'a banner and a >>> prompt',
    JSON.stringify(s.serial.slice(0, 90)),
  )
  truth('the engine got the script pasted in', s.repl === 'running', 'running', s.repl)
  truth(
    'the interpreter accepted it — no traceback',
    !/Traceback|SyntaxError|NameError/.test(s.serial),
    'no traceback',
    /Traceback|SyntaxError|NameError/.test(s.serial) ? s.serial.slice(-160) : 'clean',
  )
  truth(
    'machine.Pin(15, Pin.OUT).value(1) drives the pad high',
    s.pins.GP15 === 'high',
    'high',
    String(s.pins.GP15),
  )
  near(
    'and the LED carries the hand-derived 3.3 V current',
    s.currents.led1 * 1000,
    PICO_LED_A * 1000,
    0.05,
  )
  record(
    'speed (informational, not a pass/fail criterion)',
    true,
    'measured',
    `${(6 / wall).toFixed(2)}x realtime (6.00 s sim in ${wall.toFixed(1)} s wall)`,
  )
}

// ─── Report ──────────────────────────────────────────────────────────────────

console.log(
  `\nHand-derived operating points (bisection on the Shockley loop, no engine involved):\n` +
    `  Pico  3.3 V, ${R_DRIVE} Ω pad + ${LED_RS} Ω + ${R_EXT} Ω  →  ${(PICO_LED_A * 1000).toFixed(4)} mA\n` +
    `  Uno   5.0 V,  25 Ω pad + ${LED_RS} Ω + ${R_EXT} Ω  →  ${(UNO_LED_A * 1000).toFixed(4)} mA\n` +
    `  ratio ${((PICO_LED_A / UNO_LED_A) * 100).toFixed(1)}%`,
)

const nameW = Math.max(50, ...rows.map((r) => r.name.length))
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
