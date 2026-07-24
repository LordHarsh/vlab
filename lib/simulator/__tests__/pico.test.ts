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
import { PICO_PART, gpioIndexOf, adcChannelOf } from '../pico/board'
import { BEHAVIOURAL_CPU_SURFACE, NANOS_PER_AVR_CYCLE } from '../pico/clock-shim'
import { PICO_EXPERIMENTS } from '../pico/experiments'
import { BOARDS, detectBoard } from '../model/boards'
import { PALETTE, PART_LIBRARY, getPart } from '../model/parts'
import type { CircuitDoc, DocWire, PlacedPart } from '../model/document'

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

/**
 * The same "input, no pulls" pad, plus bit 6: INPUT ENABLE.
 *
 * A finding worth writing down, because it cost an hour. rp2040js resets
 * padValue to 0b0110110, which has INPUT ENABLE CLEAR; the datasheet's own
 * reset value for PADS_BANK0_GPIOn is 0x56, which has it SET. The difference
 * does not touch the analog model at all — `GPIOPin.value`, which is what the
 * engine's PinBridge listens to, is derived from the output enable and the pull
 * bits and never consults it — but `GPIOPin.inputValue` is gated on it, and
 * that is the observable group L uses to watch the DHT11's reply on the wire.
 * Real firmware always sets it (pico-sdk's gpio_init calls
 * gpio_set_input_enabled), so a test that pokes registers by hand must too, or
 * it is watching a line that is wired up but not listening.
 */
const PAD_OPEN_DRAIN = 0b1110010

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
 * Open-drain, exactly as MicroPython's `mp_hal_pin_open_drain` configures a pad
 * for a one-wire sensor: SIO function, no pulls, input enabled, and the line
 * driven by TOGGLING THE OUTPUT ENABLE rather than the output value. `od_low`
 * turns the pad into an output already holding 0; `od_high` turns it back into
 * an input and lets whatever pull-up is on the wire raise it.
 */
function openDrainInit(eng: PicoSimulationEngine, gp: number): void {
  selectSio(eng, gp)
  eng.mcu.writeUint32(PADS_BANK0_BASE + 4 + gp * 4, PAD_OPEN_DRAIN)
  eng.mcu.writeUint32(SIO_GPIO_OUT_CLR, 1 << gp)
  eng.mcu.writeUint32(SIO_GPIO_OE_CLR, 1 << gp)
}
function odLow(eng: PicoSimulationEngine, gp: number): void {
  eng.mcu.writeUint32(SIO_GPIO_OUT_CLR, 1 << gp)
  eng.mcu.writeUint32(SIO_GPIO_OE_SET, 1 << gp)
}
function odHigh(eng: PicoSimulationEngine, gp: number): void {
  eng.mcu.writeUint32(SIO_GPIO_OE_CLR, 1 << gp)
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

/**
 * What the PROGRAM printed, with the REPL's echo of its own source removed.
 *
 * This is not tidiness, it is correctness, and it caught a false assertion in
 * this very file. MicroPython's paste mode echoes every character it receives,
 * so the serial buffer contains the script's own source — including the string
 * literals inside its `print()` calls. Asserting `/Sensor read failed/` against
 * the raw buffer therefore matches the ECHO of `print("Sensor read failed")`
 * and reports a failure that never happened; asserting `/Press button to toggle
 * LED\./` matches the echo and passes whether or not the program ever ran.
 *
 * Everything the program prints necessarily comes after the last line of the
 * echoed source, so that is where the cut is made. If the echo has already
 * scrolled out of the 2 KB buffer there is nothing to strip and the whole
 * buffer is program output.
 */
function programOutput(serial: string, script: string): string {
  const lastLine = script.trimEnd().split('\n').pop()!.trim()
  const at = serial.lastIndexOf(lastLine)
  return at < 0 ? serial : serial.slice(at + lastLine.length)
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

// ══════════════════════════════════════════════════════════════════════════════
group('H. The Pico is a first-class part, not a runtime splice')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The Pico used to insert itself into PART_LIBRARY and PALETTE from an
   * import side-effect, because model/parts.ts belonged to another workstream.
   * That stopgap is the thing this group exists to keep dead: a part that
   * registers itself is invisible to anyone who imports parts.ts alone, so the
   * palette a student sees would depend on which modules the page happened to
   * pull in.
   */
  const partsSrc = fs.readFileSync(
    path.join(process.cwd(), 'lib', 'simulator', 'model', 'parts.ts'),
    'utf8',
  )
  const boardSrc = fs.readFileSync(
    path.join(process.cwd(), 'lib', 'simulator', 'pico', 'board.ts'),
    'utf8',
  )

  truth(
    'parts.ts itself registers raspberry_pi_pico in PART_LIBRARY',
    /raspberry_pi_pico:\s*makePico\(\)/.test(partsSrc),
    'a literal entry in the registry',
    /raspberry_pi_pico:\s*makePico\(\)/.test(partsSrc) ? 'present' : 'missing',
  )
  truth(
    'and pico/board.ts no longer mutates PART_LIBRARY or PALETTE at import time',
    !/PART_LIBRARY\[/.test(boardSrc) && !/PALETTE\.splice/.test(boardSrc),
    'no mutation',
    /PART_LIBRARY\[|PALETTE\.splice/.test(boardSrc) ? 'still splices itself in' : 'no mutation',
  )
  truth(
    'getPart("raspberry_pi_pico") resolves',
    getPart('raspberry_pi_pico').label === 'Raspberry Pi Pico',
    'Raspberry Pi Pico',
    getPart('raspberry_pi_pico').label,
  )
  /**
   * The boards lead the palette, in one contiguous run.
   *
   * This used to assert `pico === uno + 1`, which was the same statement while
   * there were exactly two boards. The Arduino Mega now sits between them, so
   * the check is written as what it always meant: every MCU part, and no other
   * part, occupies the head of the list — that is what makes "reach for a board
   * first" true for a student scanning the palette.
   */
  const boardIdx = PALETTE.map((t, i) => [t, i] as const).filter(
    ([t]) => PART_LIBRARY[t]?.electrical.kind === 'mcu',
  )
  const contiguousHead = boardIdx.every(([, i], k) => i === k)
  truth(
    'and the boards lead the palette as one contiguous group',
    contiguousHead && boardIdx.some(([t]) => t === 'raspberry_pi_pico'),
    'every MCU part first, Pico among them',
    boardIdx.map(([t, i]) => `${t}@${i}`).join(', ') || 'no boards in palette',
  )

  const picoEl = PART_LIBRARY.raspberry_pi_pico.electrical
  const unoEl = PART_LIBRARY.arduino_uno.electrical
  truth(
    'the Pico declares its own 3.3 V logic rail',
    picoEl.kind === 'mcu' && picoEl.board === 'raspberry_pi_pico' && picoEl.logicVolts === 3.3,
    'mcu / raspberry_pi_pico / 3.3 V',
    picoEl.kind === 'mcu' ? `mcu / ${picoEl.board} / ${picoEl.logicVolts} V` : picoEl.kind,
  )
  truth(
    'and the Uno still declares 5 V — the union widened, the Uno did not move',
    unoEl.kind === 'mcu' && unoEl.board === 'arduino_uno' && unoEl.logicVolts === 5,
    'mcu / arduino_uno / 5 V',
    unoEl.kind === 'mcu' ? `mcu / ${unoEl.board} / ${unoEl.logicVolts} V` : unoEl.kind,
  )

  /**
   * The art is hand-drawn, and this asserts WHY rather than trusting a comment:
   * @wokwi/elements ships no Pico, so there is nothing harvested to use, and
   * borrowing the Uno's would put a student's wire on a pin that does not
   * exist. If a Pico element ever appears in the harvest, this fails and
   * somebody gets to decide deliberately.
   */
  const artPath = path.join(process.cwd(), 'lib', 'simulator', 'model', 'wokwi-art.generated.json')
  const art = JSON.parse(fs.readFileSync(artPath, 'utf8')) as { parts: Record<string, unknown> }
  const picoArt = Object.keys(art.parts).filter((k) => /pico|rp2040|raspberry/i.test(k))
  truth(
    'no harvested wokwi art exists for a Pico, so the SVG is honestly hand-drawn',
    picoArt.length === 0,
    'no pico element in the harvest',
    picoArt.join(',') || 'none',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('I. compile() takes the rail from the board, not from a constant')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * A pin wired STRAIGHT to GND. The solver cannot see this fault — once
   * shorted, the pin's net IS net 0, so there is no node to solve for — so
   * compile() reports it, and the number it reports is the voltage the pin
   * would be driving. That number used to be the literal 5.
   *
   * The hand derivation is Ohm's law through the pad's own output impedance:
   *
   *   Pico   3.3 V / 50 Ω = 66.0 mA
   *   Uno    5.0 V / 25 Ω = 200.0 mA
   *
   * and the bug being pinned is that 5 V through the PICO's 50 Ω pad gives
   * 100 mA — 51.5% too high, and quoted to the student in the fault message.
   */
  const picoShort: CircuitDoc = {
    parts: [{ id: 'pico', type: 'raspberry_pi_pico', x: 0, y: 0, rotation: 0, props: {} }],
    wires: [wire(['pico', 'GP15'], ['pico', 'GND.1'])],
  }
  const unoShort: CircuitDoc = {
    parts: [{ id: 'uno', type: 'arduino_uno', x: 0, y: 0, rotation: 0, props: {} }],
    wires: [wire(['uno', 'D13'], ['uno', 'GND.1'])],
  }

  const picoIo = compile(picoShort).shortedPins.find((s) => s.pinId === 'GP15')
  const unoIo = compile(unoShort).shortedPins.find((s) => s.pinId === 'D13')

  truth(
    'a shorted Pico I/O pin is reported at 3.3 V',
    picoIo?.volts === 3.3,
    '3.3',
    String(picoIo?.volts),
  )
  truth(
    'a shorted Uno I/O pin is still reported at 5 V — the Uno path is unchanged',
    unoIo?.volts === 5,
    '5',
    String(unoIo?.volts),
  )

  const picoAmps = PICO_VDD / R_DRIVE
  const wrongAmps = 5 / R_DRIVE
  truth(
    `the old constant would have overstated the Pico fault by ` +
      `${(((wrongAmps - picoAmps) / picoAmps) * 100).toFixed(0)}%`,
    Math.abs((wrongAmps - picoAmps) / picoAmps - 0.5152) < 0.001,
    '51.5% (100.0 mA claimed vs 66.0 mA real)',
    `${(((wrongAmps - picoAmps) / picoAmps) * 100).toFixed(1)}%`,
  )

  // And the engine must quote the corrected figure, not recompute around it.
  const eng = new PicoSimulationEngine(inertFirmware(), picoShort)
  driveHigh(eng, 15)
  const s = settle(eng, 1000)
  const fault = s.faults.find((f) => f.kind === 'short_circuit')
  truth(
    'the engine raises the short only while the pin is DRIVING',
    fault !== undefined,
    'one short_circuit fault',
    `${s.faults.length} faults: ${s.faults.map((f) => f.kind).join(',') || 'none'}`,
  )
  near('and quotes the hand-derived current', (fault?.value ?? 0) * 1000, picoAmps * 1000, 0.001)
  truth(
    'the message says 3.3 V and 66 mA, never 5 V or 100 mA',
    fault !== undefined &&
      /3\.3 V/.test(fault.message) &&
      /66 mA/.test(fault.message) &&
      !/5 V|100 mA/.test(fault.message),
    'mentions 3.3 V / 66 mA only',
    fault?.message.slice(0, 100) ?? '(no fault)',
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('J. Board-aware engine selection')
// ══════════════════════════════════════════════════════════════════════════════
{
  const picoDoc = picoLedDoc()
  const unoDoc: CircuitDoc = {
    parts: [{ id: 'uno', type: 'arduino_uno', x: 0, y: 0, rotation: 0, props: {} }],
    wires: [],
  }
  const bothDoc: CircuitDoc = {
    parts: [...picoDoc.parts, { id: 'uno', type: 'arduino_uno', x: 600, y: 0, rotation: 0, props: {} }],
    wires: picoDoc.wires,
  }

  const p = detectBoard(picoDoc)
  const u = detectBoard(unoDoc)
  const none = detectBoard({ parts: [], wires: [] })
  const both = detectBoard(bothDoc)

  truth(
    'a document with a Pico selects the rp2040 track',
    p.board?.track === 'rp2040' && p.board.language === 'micropython' && p.problem === null,
    'rp2040 / micropython / no problem',
    `${p.board?.track} / ${p.board?.language} / ${p.problem ?? 'no problem'}`,
  )
  truth(
    'a document with an Uno still selects the avr track',
    u.board?.track === 'avr' && u.board.language === 'arduino_c' && u.problem === null,
    'avr / arduino_c / no problem',
    `${u.board?.track} / ${u.board?.language} / ${u.problem ?? 'no problem'}`,
  )
  truth(
    'a document with no board runs nothing, and says so',
    none.board === null && /No microcontroller/.test(none.problem ?? ''),
    'null board, a problem naming the fix',
    `${none.board?.type ?? 'null'} / ${none.problem ?? 'silent'}`,
  )
  /**
   * Two boards is a real thing a student can draw. Picking whichever was
   * placed first would leave the other one wired but inert — a circuit that
   * looks live and is not. Refusing is the honest answer: the two emulators own
   * independent clocks and there is no co-simulation.
   */
  truth(
    'a document with BOTH boards refuses rather than guessing',
    both.board === null &&
      both.present.length === 2 &&
      /Only one board can run at a time/.test(both.problem ?? ''),
    'null board, both listed, an explanation',
    `${both.board?.type ?? 'null'} / present=${both.present.join('+')} / ${both.problem?.slice(0, 40) ?? 'silent'}`,
  )

  // One source of truth: the profile table must not drift from the part data.
  for (const [type, profile] of Object.entries(BOARDS)) {
    const el = PART_LIBRARY[type].electrical
    truth(
      `BOARDS.${type}.logicVolts agrees with the part definition`,
      el.kind === 'mcu' && el.logicVolts === profile.logicVolts,
      `${profile.logicVolts} V`,
      el.kind === 'mcu' ? `${el.logicVolts} V` : el.kind,
    )
  }

  /**
   * `circuits.board` is a CHECK-constrained column created in migration 015,
   * long before either of the newer parts existed, and it does not accept the
   * string 'raspberry_pi_pico'. Whoever authors the Pico starter migration has
   * to write 'rp2040'. Asserting the mapping against the real SQL is what stops
   * that being discovered by a failing insert in production.
   *
   * READ IN MIGRATION ORDER, not from 015 alone. A constraint is not a fact
   * about one file: migration 025 drops and re-adds it to admit 'arduino_mega'
   * for the Arduino Mega, so the set the DATABASE will accept is whatever the
   * LAST `check (board in (…))` in the sequence says. Pinning this to 015 would
   * mean a correctly widened constraint reads as a failure, which trains
   * whoever sees it to widen the test instead of the database.
   */
  const migDir = path.join(process.cwd(), 'supabase', 'migrations')
  let allowed = ''
  let allowedFrom = '(constraint not found)'
  for (const file of fs.readdirSync(migDir).sort()) {
    if (!file.endsWith('.sql')) continue
    const sql = fs.readFileSync(path.join(migDir, file), 'utf8')
    for (const m of sql.matchAll(/check \(board in \(([^)]*)\)\)/g)) {
      allowed = m[1]
      allowedFrom = file
    }
  }
  for (const profile of Object.values(BOARDS)) {
    truth(
      `${profile.type} maps to a board value the check constraint accepts ('${profile.dbBoard}')`,
      allowed.includes(`'${profile.dbBoard}'`),
      `'${profile.dbBoard}' in ${allowed.trim() || allowedFrom} (from ${allowedFrom})`,
      allowed.includes(`'${profile.dbBoard}'`) ? 'accepted' : 'REJECTED by the check constraint',
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('K. Experiment 5 — led-button-rpi, end to end')
// ══════════════════════════════════════════════════════════════════════════════
{
  const exp = PICO_EXPERIMENTS['led-button-rpi']

  /** Set the push button's `pressed` prop without mutating the shared doc. */
  function withButton(pressed: number): CircuitDoc {
    return {
      ...exp.doc,
      parts: exp.doc.parts.map((p: PlacedPart) =>
        p.id === 'btn' ? { ...p, props: { pressed } } : p,
      ),
    }
  }

  const c = compile(exp.doc)
  truth(
    'the circuit is fully wired — no dangling leads, no channel crossings',
    c.problems.length === 0,
    'no problems',
    c.problems.join(' | ') || 'none',
  )
  truth(
    'GP17 (the LED) and GP27 (the button) both reach the solver',
    c.mcuPorts.has('GP17') && c.mcuPorts.has('GP27'),
    'GP17 + GP27 stamped',
    [...c.mcuPorts.keys()].join(','),
  )
  truth(
    'and it is a Pico circuit, so the rp2040 track runs it',
    detectBoard(exp.doc).board?.track === 'rp2040',
    'rp2040',
    String(detectBoard(exp.doc).board?.track),
  )
  truth(
    'the script is MicroPython, with no RPi.GPIO left in it',
    /from machine import Pin/.test(exp.script) && !/RPi\.GPIO|GPIO\.(BCM|setup|cleanup)/.test(exp.script),
    'machine.Pin, no RPi.GPIO',
    /RPi\.GPIO/.test(exp.script) ? 'still imports RPi.GPIO' : 'ported',
  )

  if (!HAVE_FIRMWARE) {
    truth('firmware present in public/pico', false, 'bootrom.bin + micropython.bin', 'missing')
  } else {
    const eng = new PicoSimulationEngine(realFirmware(), exp.doc, { script: exp.script })
    const t0 = Date.now()
    // 6 s: boot to prompt is ~1.8 s, the paste a fraction of a second, and the
    // rest lets the script's 50 ms polling loop get going.
    eng.run(6_000_000)
    let s = eng.snapshot()
    let out = programOutput(s.serial, exp.script)

    truth(
      'MicroPython accepted the ported script — no traceback',
      s.repl === 'running' && !/Traceback|SyntaxError|NameError/.test(s.serial),
      'running, clean',
      /Traceback|SyntaxError|NameError/.test(s.serial) ? s.serial.slice(-160) : s.repl,
    )
    truth(
      'and it printed its prompt line',
      /Press button to toggle LED\./.test(out),
      'Press button to toggle LED.',
      JSON.stringify(out.slice(-60)),
    )
    /**
     * With the contacts OPEN the only thing on GP27 is the Pico's own
     * PULL_DOWN, so the input reads 0 and the LED must be dark. This is the
     * assertion that fails if the button were wired to GND the way the
     * published Circuit Diagram section says — there the input reads 0 whether
     * or not the button is pressed and NOTHING ever happens.
     */
    truth(
      'button open: GP27 is held down by the internal pull-down',
      s.pins.GP27 === 'pulldown',
      'pulldown',
      String(s.pins.GP27),
    )
    truth('and GP17 is driving low, so the LED is off', s.pins.GP17 === 'low', 'low', String(s.pins.GP17))
    near('LED dark', s.currents.led * 1000, 0, 0.01)
    truth('nothing has toggled yet', !/LED ON/.test(out), 'no "LED ON"', /LED ON/.test(out) ? 'toggled early' : 'quiet')

    /**
     * Press. The loop polls every 50 ms and then debounces for 300 ms, so
     * 150 ms is long enough for exactly ONE toggle and far too short for a
     * second — which is what makes this deterministic rather than a race.
     */
    eng.setDocument(withButton(1))
    eng.run(150_000)
    s = eng.snapshot()
    out = programOutput(s.serial, exp.script)
    truth(
      'pressing the button toggles the LED on, once',
      s.pins.GP17 === 'high' && /LED ON/.test(out) && !/LED OFF/.test(out),
      'GP17 high, one "LED ON"',
      `GP17 ${s.pins.GP17}, printed ${JSON.stringify(out.slice(-24))}`,
    )

    // Release and let the readout settle. The state is LATCHED — this is a
    // toggle, not a momentary — so the LED must stay lit with nothing pressed.
    eng.setDocument(withButton(0))
    eng.run(500_000)
    s = eng.snapshot()
    const wall = (Date.now() - t0) / 1000
    truth('the LED stays on after the button is released', s.pins.GP17 === 'high', 'high', String(s.pins.GP17))
    /**
     * THE ELECTRICAL ASSERTION. GP17 → 220 Ω → LED → GND on a 3.3 V rail
     * through the pad's 50 Ω, which the bisection at the top of this file
     * solves independently of the engine. Same number as group C, reached
     * through real MicroPython and a real button instead of a register poke.
     */
    near('and carries the hand-derived 3.3 V current', s.currents.led * 1000, PICO_LED_A * 1000, 0.05)
    near(
      'the 220 Ω resistor carries the same current (it is a series loop)',
      s.currents.r220 * 1000,
      PICO_LED_A * 1000,
      0.05,
    )
    record(
      'exp 5 speed (informational)',
      true,
      'measured',
      `${(6.65 / wall).toFixed(2)}x realtime (6.65 s sim in ${wall.toFixed(1)} s wall)`,
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('L. Experiment 7 — the DHT11 answers PICO timing')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The open question the previous pass left: behavioural.ts's DHT11 was
   * written against an AVR library's bit-banging and had never been driven by
   * a Pico. It runs on avr8js's cycle counter; rp2040js counts nanoseconds.
   * pico/clock-shim.ts translates between them, and this group decodes the
   * sensor's reply OFF THE WIRE to prove the translation is exact rather than
   * approximately right.
   *
   * The expected waveform is the DHT11 datasheet, restated here rather than
   * imported, for the same reason the Shockley parameters are restated at the
   * top of this file:
   *
   *   host holds the line low >= 18 ms, then releases it
   *   sensor idles 30 us, then acknowledges: 80 us LOW, 80 us HIGH
   *   then 40 bits, each 50 us LOW followed by 27 us HIGH (a 0)
   *                                       or 70 us HIGH (a 1)
   *   then one last 50 us LOW, and the bus is released
   *   payload: humidity int, humidity dec, temp int, temp dec, checksum
   *            (a DHT11 always sends 0 for both decimals)
   */
  const ACK_LOW_US = 80
  const ACK_HIGH_US = 80
  const BIT_LOW_US = 50
  const ZERO_HIGH_US = 27
  const ONE_HIGH_US = 70
  /** Anything between the two is a 1; the gap is 43 us wide, so this is safe. */
  const BIT_THRESHOLD_US = (ZERO_HIGH_US + ONE_HIGH_US) / 2

  const TEMP_C = 27
  const HUMIDITY = 61
  const expectedBytes = [HUMIDITY, 0, TEMP_C, 0, (HUMIDITY + 0 + TEMP_C + 0) & 0xff]

  const exp = PICO_EXPERIMENTS['dht11-rpi']
  function dhtDoc(temperature: number, humidity: number): CircuitDoc {
    return {
      ...exp.doc,
      parts: exp.doc.parts.map((p: PlacedPart) =>
        p.id === 'dht' ? { ...p, props: { temperature, humidity } } : p,
      ),
    }
  }

  const c = compile(exp.doc)
  truth(
    'the circuit is fully wired — VCC, GND, DATA and the 10 kΩ pull-up',
    c.problems.length === 0,
    'no problems',
    c.problems.join(' | ') || 'none',
  )
  truth(
    'the DHT11 gets a Norton port on DATA so it can pull the line down',
    c.behavioural.length === 1 &&
      c.behavioural[0].protocol === 'dht11' &&
      'DATA' in c.behavioural[0].ports,
    'one dht11 with a DATA port',
    c.behavioural.map((b) => `${b.protocol}:${Object.keys(b.ports).join('+')}`).join(',') || 'none',
  )

  // ── L1: the waveform on the wire, with no interpreter involved ─────────────
  {
    const eng = new PicoSimulationEngine(inertFirmware(), dhtDoc(TEMP_C, HUMIDITY))
    const GP = 4
    openDrainInit(eng, GP)
    odLow(eng, GP)
    eng.run(18_000) // the driver's 18 ms start pulse
    odHigh(eng, GP)
    eng.run(2)

    /**
     * Sample the line at 1 us. That is what quantises the measured widths, so
     * every expectation below carries a ±2 us tolerance — ample, since the two
     * bit symbols are 43 us apart.
     */
    const edges: Array<{ us: number; high: boolean }> = []
    let prev = eng.mcu.gpio[GP].inputValue
    const t0 = eng.mcu.clock.nanos
    for (let i = 0; i < 6000; i++) {
      eng.run(1)
      const v = eng.mcu.gpio[GP].inputValue
      if (v !== prev) {
        edges.push({ us: (eng.mcu.clock.nanos - t0) / 1000, high: v })
        prev = v
      }
    }

    // 1 falling (ack low) + 1 rising (ack high) + 40 x (falling, rising) + the
    // final falling and release = 84 transitions.
    truth(
      'the sensor answers the start pulse with a full 40-bit frame',
      edges.length === 84,
      '84 transitions (ack + 40 bits + release)',
      String(edges.length),
    )

    if (edges.length === 84) {
      const width = (i: number) => edges[i + 1].us - edges[i].us
      near('acknowledge LOW width', width(0), ACK_LOW_US, 2, 'us')
      near('acknowledge HIGH width', width(1), ACK_HIGH_US, 2, 'us')

      // Bits start at index 2: each is a LOW then a HIGH.
      const bits: number[] = []
      let lowOk = true
      let symbolOk = true
      for (let b = 0; b < 40; b++) {
        const lowAt = 2 + b * 2
        const highAt = lowAt + 1
        if (Math.abs(width(lowAt) - BIT_LOW_US) > 2) lowOk = false
        const high = width(highAt)
        const bit = high > BIT_THRESHOLD_US ? 1 : 0
        if (Math.abs(high - (bit ? ONE_HIGH_US : ZERO_HIGH_US)) > 2) symbolOk = false
        bits.push(bit)
      }
      truth('every bit is preceded by the datasheet 50 us LOW', lowOk, `all 40 within ±2 us of ${BIT_LOW_US}`, lowOk ? 'ok' : 'drifted')
      truth(
        `and every HIGH is either ${ZERO_HIGH_US} us or ${ONE_HIGH_US} us`,
        symbolOk,
        'clean symbols',
        symbolOk ? 'ok' : 'a symbol was between the two',
      )

      const bytes: number[] = []
      for (let i = 0; i < 5; i++) {
        let v = 0
        for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b]
        bytes.push(v)
      }
      truth(
        `the decoded frame is the reading the part is set to (${HUMIDITY}%, ${TEMP_C} °C)`,
        bytes.join(',') === expectedBytes.join(','),
        expectedBytes.join(','),
        bytes.join(','),
      )
      truth(
        'and its checksum is the sum of the four data bytes, as the datasheet says',
        bytes[4] === ((bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff),
        String((bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff),
        String(bytes[4]),
      )
    }
  }

  // ── L2: MicroPython's own frozen `dht` driver reading it ───────────────────
  if (!HAVE_FIRMWARE) {
    truth('firmware present in public/pico', false, 'bootrom.bin + micropython.bin', 'missing')
  } else {
    const eng = new PicoSimulationEngine(realFirmware(), dhtDoc(TEMP_C, HUMIDITY), {
      script: exp.script,
    })
    const t0 = Date.now()
    eng.run(5_000_000)
    let s = eng.snapshot()
    let out = programOutput(s.serial, exp.script)

    truth(
      'MicroPython accepted the ported script — no traceback',
      s.repl === 'running' && !/Traceback|SyntaxError|NameError/.test(s.serial),
      'running, clean',
      /Traceback|SyntaxError|NameError/.test(s.serial) ? s.serial.slice(-200) : s.repl,
    )
    truth(
      'the frozen `dht` module read the behavioural sensor and printed the reading',
      new RegExp(`Temp=${TEMP_C}\\.0C\\s+Humidity=${HUMIDITY}\\.0%`).test(out),
      `Temp=${TEMP_C}.0C  Humidity=${HUMIDITY}.0%`,
      JSON.stringify(out.slice(-70)),
    )
    /**
     * Every reading, not just one. A DHT11 frame ends in a checksum and
     * MicroPython's driver raises if it does not match, so a single mistimed
     * bit anywhere in 40 would surface here as a failed read rather than as a
     * wrong number.
     */
    truth(
      'no read failed — the checksum matched every time',
      !/Sensor read failed/.test(out),
      'no failures',
      /Sensor read failed/.test(out) ? 'at least one read failed' : 'clean',
    )
    truth(
      'and the engine reports what the sensor is sending',
      s.deviceStates.dht?.temperature === TEMP_C && s.deviceStates.dht?.humidity === HUMIDITY,
      `${TEMP_C} °C / ${HUMIDITY}%`,
      JSON.stringify(s.deviceStates.dht ?? null),
    )

    /**
     * Move the sliders mid-run. This is what separates "the sensor works" from
     * "the number was baked in at boot": the NEXT reading has to change, and it
     * has to change without restarting the interpreter.
     */
    eng.setDocument(dhtDoc(9, 88))
    eng.run(4_000_000)
    s = eng.snapshot()
    out = programOutput(s.serial, exp.script)
    const wall = (Date.now() - t0) / 1000
    truth(
      'moving the temperature/humidity sliders changes the NEXT reading',
      /Temp=9\.0C\s+Humidity=88\.0%/.test(out),
      'Temp=9.0C  Humidity=88.0%',
      JSON.stringify(out.slice(-70)),
    )
    record(
      'exp 7 speed (informational)',
      true,
      'measured',
      `${(9 / wall).toFixed(2)}x realtime (9.00 s sim in ${wall.toFixed(1)} s wall)`,
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('M. The behavioural clock shim')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The one cast on the Pico's behavioural path hands rp2040js's clock to a
   * model that is typed against avr8js's CPU. That is only safe while the
   * models touch nothing but the three members the shim implements — so this
   * reads behavioural.ts and checks.
   */
  const src = fs.readFileSync(
    path.join(process.cwd(), 'lib', 'simulator', 'behavioural.ts'),
    'utf8',
  )
  const used = [...new Set([...src.matchAll(/\bcpu\.([a-zA-Z_]\w*)/g)].map((m) => m[1]))].sort()
  const extra = used.filter((m) => !BEHAVIOURAL_CPU_SURFACE.includes(m))
  truth(
    'behavioural.ts uses only the CPU members the shim implements',
    extra.length === 0,
    BEHAVIOURAL_CPU_SURFACE.join(', '),
    used.join(', ') + (extra.length ? `  — UNIMPLEMENTED: ${extra.join(', ')}` : ''),
  )

  truth(
    'the cycle scale is 16 MHz, matching behavioural.ts’s own CLOCK_HZ',
    NANOS_PER_AVR_CYCLE * 16e6 === 1e9,
    '62.5 ns x 16e6 = 1e9',
    `${NANOS_PER_AVR_CYCLE} x 16e6 = ${NANOS_PER_AVR_CYCLE * 16e6}`,
  )
  truth(
    'and behavioural.ts really does convert its microseconds at 16 MHz',
    /const CLOCK_HZ = 16_000_000/.test(src),
    'CLOCK_HZ = 16_000_000',
    /const CLOCK_HZ = ([\d_]+)/.exec(src)?.[1] ?? '(not found)',
  )

  /**
   * The translation end to end, measured rather than argued: a device asking
   * for a 27 us step must get an edge 27 us of RP2040 time later. Group L
   * measures exactly that on a real waveform (the ZERO_HIGH_US symbol), so
   * this only has to pin the arithmetic that gets it there — 27 us is 432 AVR
   * cycles, which is 27,000 ns.
   */
  const cycles = Math.max(1, Math.round((27 * 16_000_000) / 1e6))
  truth(
    '27 us of datasheet time is 432 notional AVR cycles is 27,000 ns of Pico time',
    cycles === 432 && cycles * NANOS_PER_AVR_CYCLE === 27_000,
    '432 cycles, 27000 ns',
    `${cycles} cycles, ${cycles * NANOS_PER_AVR_CYCLE} ns`,
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
