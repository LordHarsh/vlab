/**
 * Firmware compiled by a WebAssembly toolchain, executed on the real engine.
 *
 * WHAT IS BEING PROVED, AND WHY IT NEEDED A TEST OF ITS OWN. Until now every
 * .hex in this repository was built offline with arduino-cli on a machine that
 * no longer has it, which made "the student writes a sketch" the one thing the
 * Arduino track could not do. The three fixtures read here were built instead by
 * `cc1plus.wasm`, `avr-as.wasm`, `avr-ld.wasm` and `avr-objcopy.wasm` — the GNU
 * toolchain compiled to WebAssembly, the same four modules a browser Worker
 * would instantiate. AVR_COMPILE_FINDINGS.md records how, what it weighs, how
 * long it takes and what it is licensed under.
 *
 * "It compiled" is not the claim worth testing. A toolchain that produces a
 * well-formed .hex full of subtly wrong code is the failure that matters: it
 * loads, it runs, it prints nothing, and every metric is green. So nothing here
 * inspects the compiler. Each fixture is loaded into SimulationEngine, run
 * against a circuit a student could have drawn, and judged on what a student
 * would see — an LED lit, a number in the serial monitor.
 *
 * THREE THINGS MAKE THESE ASSERTIONS REAL RATHER THAN CIRCULAR:
 *
 *   1. HAND-DERIVED VALUES. The Mega sketch computes `3000 + analogRead(A0)*7`
 *      and prints it. The pot is set to a known position, the ADC count that
 *      follows from it is stated, the arithmetic is done here in the comments,
 *      and the exact string is compared. 6577 is not "what it printed last
 *      time" — it is 3000 + 511×7, and it can only appear if the ADC mux, the
 *      integer maths, Print::print(long) and the USART all work.
 *
 *   2. A CONTROL BUILT BY THE OTHER TOOLCHAIN. `blink.hex` (arduino-cli, 2026)
 *      and `wasm-blink.hex` drive the SAME circuit from the same pin and differ
 *      in one respect: a 1000 ms delay against a 100 ms one. Both consequences
 *      are then required to follow — 8.5× the edges, AND a reported LED current
 *      damped to 12.39/(1+e^-4) mA by the engine's 25 ms display filter, which
 *      is a number the slow build cannot produce and the fast one cannot avoid.
 *      Asserting the WASM build's figures on their own would prove far less.
 *
 *   3. A CHIP THAT HAD NO FIRMWARE AT ALL. The ATmega2560 support in
 *      avr/atmega2560.ts was written against the datasheet and proved by
 *      hand-assembled programs, because there was no Mega .hex in existence
 *      here (see the header of mega.test.ts, which says so). This file runs a
 *      real compiled Mega binary through it for the first time.
 *
 * Run: npx tsx lib/simulator/__tests__/wasmhex.test.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ATMEGA2560 } from '../avr/atmega2560'
import { ATMEGA328P } from '../avr/chip'
import { SimulationEngine, parseIntelHex } from '../engine'
import type { CircuitDoc, DocWire } from '../model/document'
import { EXPERIMENT_01, EXPERIMENT_01_DHT, STARTER_SMART_TRAFFIC } from '../model/examples'

// ─── Harness ──────────────────────────────────────────────────────────────────

interface Row {
  group: string
  name: string
  expected: string
  actual: string
  pass: boolean
}
const rows: Row[] = []
let currentGroup = ''
function group(g: string): void {
  currentGroup = g
}
function truth(name: string, pass: boolean, expected: string, actual: string): void {
  rows.push({ group: currentGroup, name, expected, actual, pass })
}
function eq(name: string, actual: unknown, expected: unknown): void {
  truth(name, String(actual) === String(expected), String(expected), String(actual))
}
function near(name: string, actual: number, expected: number, tol: number): void {
  truth(
    name,
    Math.abs(actual - expected) <= tol,
    `${expected.toFixed(2)} ±${tol}`,
    actual.toFixed(2),
  )
}

const FIXTURES = join(process.cwd(), 'lib/simulator/__spikes__/fixtures')
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')
/** The Mega image is read from public/, because that is the copy the app serves. */
const readShipped = (name: string): string =>
  readFileSync(join(process.cwd(), 'public/sim', name), 'utf8')

/** Data bytes an Intel HEX file actually loads — what "flash used" means. */
function flashBytes(hex: string): number {
  let total = 0
  for (const line of hex.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue
    if (parseInt(line.substring(7, 9), 16) === 0) total += parseInt(line.substring(1, 3), 16)
  }
  return total
}

function wire(id: string, a: string, ap: string, b: string, bp: string): DocWire {
  return { id, from: { partId: a, pinId: ap }, to: { partId: b, pinId: bp }, color: '#2563eb' }
}

// ══════════════════════════════════════════════════════════════════════════════
group('A. What the WebAssembly toolchain emitted')
// ══════════════════════════════════════════════════════════════════════════════
{
  const blink = read('wasm-blink.hex')
  const dht = read('wasm-dht11.hex')
  const mega = readShipped('traffic-mega.hex')

  /**
   * An Uno's bootloader occupies the top 512 bytes of the 32 KB part, so
   * arduino-cli treats 32,256 bytes as the sketch budget. Both Uno fixtures
   * must fit it or they could not be uploaded to the real board the lab uses —
   * which is decision D4 ("runs on real hardware" = source portability) in a
   * form a test can check.
   */
  const UNO_BUDGET = 32_256
  truth(
    `blink fits the Uno sketch budget (${flashBytes(blink)} of ${UNO_BUDGET} bytes)`,
    flashBytes(blink) <= UNO_BUDGET,
    `≤ ${UNO_BUDGET}`,
    String(flashBytes(blink)),
  )
  truth(
    `the DHT build fits too (${flashBytes(dht)} of ${UNO_BUDGET} bytes)`,
    flashBytes(dht) <= UNO_BUDGET,
    `≤ ${UNO_BUDGET}`,
    String(flashBytes(dht)),
  )
  truth(
    `the DHT build is larger than blink — the library is really linked in`,
    flashBytes(dht) > flashBytes(blink),
    `> ${flashBytes(blink)}`,
    String(flashBytes(dht)),
  )

  /**
   * The first word of an avr-gcc image is the reset vector. On both parts it is
   * a JMP, whose 32-bit encoding starts 1001 010k kkkk 110k — so the low word
   * is 0x940C for any target address whose bits 21-17 are zero. A .hex that
   * began with anything else would not be a program these chips can start.
   */
  const firstWord = (hex: string, size: number): number => parseIntelHex(hex, size)[0]
  eq('blink starts with a JMP (0x940c)', '0x' + firstWord(blink, 0x8000).toString(16), '0x940c')
  eq('the Mega image starts with a JMP too', '0x' + firstWord(mega, ATMEGA2560.flashBytes).toString(16), '0x940c')

  /**
   * parseIntelHex refuses a record past the end of flash rather than truncating
   * it. The Mega image is small enough to fit a 328P's flash, so this is proved
   * with a deliberately undersized load instead: 2 KB cannot hold it.
   */
  let refused = ''
  try {
    parseIntelHex(mega, 2048)
    refused = 'loaded silently'
  } catch (e) {
    refused = e instanceof Error && /different chip/.test(e.message) ? 'refused' : 'wrong error'
  }
  eq('a Mega image loaded into 2 KB of flash is refused, not truncated', refused, 'refused')

  eq('the Mega image is loadable into an ATmega2560 (256 KB)',
    parseIntelHex(mega, ATMEGA2560.flashBytes).length, ATMEGA2560.flashBytes / 2)
  eq('...and the 328P and 2560 flash sizes really do differ',
    `${ATMEGA328P.flashBytes} vs ${ATMEGA2560.flashBytes}`, '32768 vs 262144')
}

// ══════════════════════════════════════════════════════════════════════════════
group('B. ATmega328P — Serial.println, pinMode, digitalWrite, delay')
// ══════════════════════════════════════════════════════════════════════════════
/**
 * The sketch, compiled by the WASM toolchain:
 *
 *   #include <Arduino.h>
 *   void setup()  { pinMode(13, OUTPUT); Serial.begin(9600); Serial.println("VLAB"); }
 *   void loop()   { digitalWrite(13, HIGH); delay(100); digitalWrite(13, LOW); delay(100); }
 *
 * Every line of that is a piece of the Arduino core, not of the language:
 * pinMode and digitalWrite are wiring_digital.c walking the PROGMEM pin tables,
 * delay() is wiring.c reading the Timer0 overflow counter, and Serial is a
 * global constructed before main() whose print path runs through Print.cpp,
 * HardwareSerial.cpp and the UDRE interrupt. If the toolchain had mislinked any
 * of it, one of the three assertions below fails.
 */
{
  const engine = new SimulationEngine(parseIntelHex(read('wasm-blink.hex')), EXPERIMENT_01)
  engine.run(1_000_000)
  const at1s = engine.snapshot()

  eq('Serial.println("VLAB") reaches the monitor', JSON.stringify(at1s.serial), '"VLAB\\r\\n"')
  truth(
    'the string arrives exactly once — setup() ran once, loop() does not print',
    at1s.serial.split('VLAB').length - 1 === 1,
    '1 occurrence',
    `${at1s.serial.split('VLAB').length - 1} occurrences`,
  )

  /**
   * EDGE COUNT, DERIVED. loop() writes HIGH, waits 100 ms, writes LOW, waits
   * 100 ms: one full period is 200 ms, carrying two transitions. Five seconds
   * holds 25 periods = 50 transitions, plus the very first rising edge when
   * loop() runs for the first time — 51.
   */
  engine.run(4_000_000)
  const at5s = engine.snapshot()
  eq('D13 makes 2 transitions per 200 ms period, +1 initial rise, over 5 s', at5s.pinEdges, 51)

  /**
   * The LED must actually be driven, both ways. Sampling has to happen inside a
   * phase rather than at the end of a run, so the engine is stepped in 50 ms
   * slices — a quarter of the period, so no slice can span both phases.
   */
  const bright: number[] = []
  const dark: number[] = []
  for (let i = 0; i < 12; i++) {
    engine.run(50_000)
    const s = engine.snapshot()
    ;(s.pins['D13'] === 'high' ? bright : dark).push(s.ledBrightness['led1'] ?? 0)
  }
  truth('D13 is observed both high and low while sampling', bright.length > 0 && dark.length > 0,
    'both phases seen', `${bright.length} high, ${dark.length} low`)
  truth('the LED is lit on every high sample', bright.every((b) => b > 0.5),
    'all > 0.5', bright.map((b) => b.toFixed(2)).join(' '))
  truth('the LED is dark on every low sample', dark.every((b) => b < 0.5),
    'all < 0.5', dark.map((b) => b.toFixed(2)).join(' '))
}

// ══════════════════════════════════════════════════════════════════════════════
group('B2. The arduino-cli fixture as a control')
// ══════════════════════════════════════════════════════════════════════════════
/**
 * public/sim/blink.hex was built by arduino-cli before that toolchain was
 * removed from this machine. It drives the same circuit from the same pin, and
 * differs from the WASM build in exactly one respect: its delay is 1000 ms
 * rather than 100 ms.
 *
 * So the pair is a differential measurement. Ten times the delay must give a
 * tenth of the edges; the same output stage must give the same current. A
 * toolchain producing plausible-but-wrong code fails one of those. Asserting
 * only the WASM build's numbers in isolation would prove far less.
 */
{
  const control = new SimulationEngine(parseIntelHex(read('blink.hex')), EXPERIMENT_01)
  control.run(5_000_000)
  const c = control.snapshot()

  /** 1 s high + 1 s low = 2 s per period, 1 transition per second, +1 initial. */
  eq('the 1 s control makes 6 transitions in 5 s', c.pinEdges, 6)
  eq('the 100 ms WASM build makes 8.5x as many (51)', 51 / c.pinEdges, 8.5)

  /**
   * THE CURRENTS DO NOT MATCH, AND MUST NOT — which turns out to be the sharper
   * measurement. `snapshot().currents` is not the instantaneous solve: engine.ts
   * passes it through a first-order display filter with τ = 25 ms of simulated
   * time, so that PWM reads as a dim LED instead of a strobe.
   *
   * Under a square wave of period 2T that filter has a closed-form peak, at the
   * end of each ON phase:
   *
   *     x_hi = I_on + (x_lo − I_on)·e^(−T/τ),  x_lo = x_hi·e^(−T/τ)
   *     ⇒  x_hi = I_on / (1 + e^(−T/τ))
   *
   * The two builds put very different numbers into that formula:
   *
   *     arduino-cli, T = 1000 ms = 40τ : 12.39 / (1 + e^−40) = 12.39   (settled)
   *     WASM,        T =  100 ms =  4τ : 12.39 / (1 + e^−4)  = 12.167  (never settles)
   *
   * So agreement would actually be evidence of a BUG — it would mean the WASM
   * build was not blinking at the rate its source asks for. The DC operating
   * point they share is 12.39 mA: 5 V, a 220 Ω resistor, the LED model's own
   * drop and the pin's 25 Ω.
   */
  const wasm = new SimulationEngine(parseIntelHex(read('wasm-blink.hex')), EXPERIMENT_01)
  wasm.run(2_000_000)
  /** Peak over one full 200 ms period, sampled every millisecond. */
  let peak = 0
  for (let i = 0; i < 200; i++) {
    wasm.run(1_000)
    peak = Math.max(peak, (wasm.snapshot().currents['led1'] ?? 0) * 1000)
  }

  eq('the control has D13 high after 5 s, fully settled', c.pins['D13'], 'high')
  near('the 1 s control reports the undamped DC value, 12.39 mA',
    (c.currents['led1'] ?? 0) * 1000, 12.39, 0.05)
  near('the 100 ms build peaks at 12.39/(1+e^-4) = 12.167 mA', peak, 12.167, 0.05)
  truth(
    'it is below the control by exactly the filter ratio 1/(1+e^-4) = 0.9823',
    Math.abs(peak / ((c.currents['led1'] ?? 1) * 1000) - 0.98232) < 0.005,
    '0.9823 ±0.005',
    (peak / ((c.currents['led1'] ?? 1) * 1000)).toFixed(4),
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('C. ATmega328P — the DHT sensor library, bit-banged against the model')
// ══════════════════════════════════════════════════════════════════════════════
/**
 * This is the assertion that says the toolchain handles a real third-party
 * library and not just the core. DHT_sensor_library 1.4.7 reads the sensor by
 * timing a one-wire exchange in microseconds: it pulls DATA low for 18 ms,
 * releases it, then measures the width of eighty pulses to recover forty bits,
 * checking a checksum. Nothing about that survives a miscompilation — wrong
 * timing gives NaN, not a wrong number.
 *
 * The circuit is EXPERIMENT_01_DHT, whose sensor is authored at 24 °C and 45 %
 * RH, so the expected line is fixed by the document and not by the firmware.
 */
{
  const engine = new SimulationEngine(parseIntelHex(read('wasm-dht11.hex')), EXPERIMENT_01_DHT)
  engine.run(6_000_000)
  const s = engine.snapshot()
  const firstLine = s.serial.split('\r\n')[0] ?? ''

  eq('the library recovers the authored reading', firstLine, 'Humidity: 45.00%  Temperature: 24.00C')
  truth('no NaN anywhere in the output — the checksum passed every time',
    s.serial.length > 0 && !/nan/i.test(s.serial), 'no "nan"',
    /nan/i.test(s.serial) ? 'contains nan' : 'no "nan"')
  truth('it read the sensor more than once (loop() is looping)',
    s.serial.split('Humidity').length - 1 >= 2, '≥ 2 readings',
    `${s.serial.split('Humidity').length - 1} readings`)
}

// ══════════════════════════════════════════════════════════════════════════════
group('D. ATmega2560 — experiment 11, the sketch the lab actually publishes')
// ══════════════════════════════════════════════════════════════════════════════
/**
 * The firmware is the Smart Traffic Light Controller sketch from the
 * experiment's own Arduino Code section (seed 003, migration 016), unmodified
 * apart from the `#include <Arduino.h>` that arduino-cli would have inserted
 * when turning the .ino into a .cpp.
 *
 * The circuit is STARTER_SMART_TRAFFIC with lane 1 wired the way the procedure
 * asks — D22 → 220 Ω → red LED → GND, D24 → 220 Ω → green LED → GND — and the
 * lane 1 density pot across the rails with its wiper on A0. Nothing else is
 * connected, which is the honest state of a student who has done step one.
 *
 * THE SKETCH'S OWN ARITHMETIC IS THE ASSERTION:
 *
 *     int density   = analogRead(densityPin[i]);
 *     int greenTime = 3000 + (long)density * 7;
 *     Serial.print("Lane "); ... Serial.print(greenTime); Serial.println("ms");
 *
 * A pot at position p sits at p % of a 5 V divider, so the ADC returns
 * round(1023 × p/100) — 0, 511 and 1023 at 0 %, 50 % and 100 %. The printed
 * time is then fixed by hand:
 *
 *     0    → 3000 + 0    × 7 = 3000
 *     511  → 3000 + 3577     = 6577
 *     1023 → 3000 + 7161     = 10161
 *
 * There is no way to produce those three strings without the ADC multiplexer,
 * the 16-bit multiply, Print::print(int) and USART0 all being right on a chip
 * whose every register address differs from the 328P's.
 */
{
  const megaDoc = (potPercent: number): CircuitDoc => ({
    parts: STARTER_SMART_TRAFFIC.parts.map((p) =>
      p.id === 'pot1' ? { ...p, props: { ...p.props, position: potPercent } } : p,
    ),
    wires: [
      ...STARTER_SMART_TRAFFIC.wires,
      wire('pot_gnd', 'pot1', '1', 'mega', 'GND.1'),
      wire('pot_5v', 'pot1', '3', 'mega', '5V'),
      wire('pot_wiper', 'pot1', '2', 'mega', 'A0'),
      wire('red_a', 'mega', 'D22', 'r1_red', '1'),
      wire('red_b', 'r1_red', '2', 'led1_red', 'A'),
      wire('red_c', 'led1_red', 'C', 'mega', 'GND.3'),
      wire('grn_a', 'mega', 'D24', 'r1_green', '1'),
      wire('grn_b', 'r1_green', '2', 'led1_green', 'A'),
      wire('grn_c', 'led1_green', 'C', 'mega', 'GND.4'),
    ],
  })

  const runMega = (potPercent: number) => {
    const engine = new SimulationEngine(
      parseIntelHex(readShipped('traffic-mega.hex'), ATMEGA2560.flashBytes),
      megaDoc(potPercent),
    )
    engine.run(2_000_000)
    return engine.snapshot()
  }

  for (const [percent, adc, ms] of [[0, 0, 3000], [50, 511, 6577], [100, 1023, 10161]] as const) {
    const s = runMega(percent)
    eq(`pot at ${percent} % reads ${adc} on A0`, s.adc['A0'], adc)
    eq(`...and the sketch prints "Lane 1 Green: ${ms}ms"`,
      JSON.stringify(s.serial.split('\r\n')[0] ?? ''), JSON.stringify(`Lane 1 Green: ${ms}ms`))
  }

  /**
   * The lamps. setup() calls allRed(), then loop() immediately gives lane 1
   * green — so two seconds in, with a green time of at least three seconds
   * still running, D24 must be driving its LED and D22 must not.
   */
  const s = runMega(50)
  eq('D24 (lane 1 green) is driven high', s.pins['D24'], 'high')
  eq('D22 (lane 1 red) is driven low', s.pins['D22'], 'low')
  truth('the green LED is lit', (s.ledBrightness['led1_green'] ?? 0) > 0.5,
    '> 0.5', (s.ledBrightness['led1_green'] ?? 0).toFixed(2))
  truth('the red LED is dark', (s.ledBrightness['led1_red'] ?? 0) < 0.01,
    '< 0.01', (s.ledBrightness['led1_red'] ?? 0).toFixed(2))
  /**
   * 7.47 mA, and it is NOT the 12.39 mA a red LED draws on the same 220 Ω.
   *
   * This assertion used to read "the same 12.39 mA as an Uno LED" and passed —
   * because every lamp in the experiment 11 starter carried `props: {}` and was
   * therefore solved as RED, including the eight named `*_yellow` and
   * `*_green`. The test was encoding the bug. A green LED's forward drop is
   * 3.2 V against red's ~2.0 V (parts.ts LED_COLOURS, Kingbright WP7113 family),
   * so on the same 5 V pad through the same resistor it passes 7.47 mA — which
   * is the figure parts.ts documents and the reason a designer picks a
   * different series resistor per colour.
   */
  near('the green LED draws 7.47 mA — a green LED, not a red one',
    (s.currents['led1_green'] ?? 0) * 1000, 7.47, 0.05)

  /**
   * NEGATIVE CONTROL, and the reason mega.test.ts exists. avr8js's stock
   * ATmega328P configuration puts USART0's DATA REGISTER EMPTY vector at word
   * 0x26, which on an ATmega2560 is TIMER1 COMPARE C. Running this same
   * firmware on that configuration must therefore produce NO serial output at
   * all: the Serial.print path never gets its interrupt. If this passed, the
   * assertions above would be measuring nothing chip-specific.
   *
   * The control document wires ONLY the potentiometer, on A0 — a pin both chips
   * have. Handing SimulationEngine a document that wires D22 while telling it
   * the chip is a 328P throws a TypeError out of stateKey(), because
   * rebuildWatchList() drops pins missing from the chip's pinMap from `watched`
   * but keeps them in `wiredPins`. That is a real fragility in engine.ts and is
   * reported rather than patched here; it is unreachable in the app, where
   * chipForDoc() always derives the chip from the same document.
   */
  const potOnlyDoc: CircuitDoc = {
    parts: megaDoc(50).parts,
    wires: [
      ...STARTER_SMART_TRAFFIC.wires,
      wire('pot_gnd', 'pot1', '1', 'mega', 'GND.1'),
      wire('pot_5v', 'pot1', '3', 'mega', '5V'),
      wire('pot_wiper', 'pot1', '2', 'mega', 'A0'),
    ],
  }
  const program = parseIntelHex(readShipped('traffic-mega.hex'), ATMEGA2560.flashBytes)

  const rightChip = new SimulationEngine(program, potOnlyDoc, ATMEGA2560)
  rightChip.run(2_000_000)
  eq('on the ATmega2560 map the same firmware prints its first line',
    JSON.stringify(rightChip.snapshot().serial.split('\r\n')[0] ?? ''), '"Lane 1 Green: 6577ms"')

  const wrongChip = new SimulationEngine(program, potOnlyDoc, ATMEGA328P)
  wrongChip.run(2_000_000)
  eq('on the 328P map — same firmware, same circuit — it prints nothing',
    JSON.stringify(wrongChip.snapshot().serial), '""')
}

// ─── Report ───────────────────────────────────────────────────────────────────

const nameW = Math.min(84, Math.max(56, ...rows.map((r) => r.name.length)))
const expW = Math.min(46, Math.max(20, ...rows.map((r) => r.expected.length)))
const actW = Math.min(46, Math.max(20, ...rows.map((r) => r.actual.length)))

let lastGroup = ''
for (const r of rows) {
  if (r.group !== lastGroup) {
    lastGroup = r.group
    console.log('\n' + r.group)
    console.log('-'.repeat(Math.min(200, nameW + expW + actW + 14)))
  }
  console.log(
    `${r.name.padEnd(nameW)}  ${r.expected.padEnd(expW)}  ${r.actual.padEnd(actW)}  ` +
      (r.pass ? 'PASS' : '*** FAIL ***'),
  )
}

const failures = rows.filter((r) => !r.pass)
console.log('\n' + '='.repeat(Math.min(200, nameW + expW + actW + 14)))
console.log(`${rows.length - failures.length}/${rows.length} passed`)
if (failures.length) {
  console.log('\nFAILURES')
  for (const f of failures) {
    console.log(`  [${f.group}] ${f.name}`)
    console.log(`      expected: ${f.expected}`)
    console.log(`      actual  : ${f.actual}`)
  }
}
process.exit(failures.length > 0 ? 1 : 0)
