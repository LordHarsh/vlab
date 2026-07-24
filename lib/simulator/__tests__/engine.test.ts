/**
 * Regression tests for the ENGINE — the layer where real firmware, the DC
 * solver and the on-screen readout meet (engine.ts + the shorted-pin half of
 * model/compile.ts).
 *
 * solver.test.ts covers the raw Circuit API and compile.test.ts covers
 * document → network. Neither can catch a defect that lives in TIME: the
 * numbers can each be individually correct and still be published at the wrong
 * moment, or published forever after they stopped being true. Both bugs pinned
 * here are of that kind, and both returned ok:true with a plausible number
 * while doing it — the failure mode SIMULATOR_ARCHITECTURE.md §2.3 calls the
 * dangerous one.
 *
 *   BUG A  Reported currents and LED brightness were one pin-hold interval
 *          STALE. The time-weighted average was only ever closed inside
 *          evaluate(), which only runs on a pin edge, and the edge published
 *          the average of the interval BEFORE it. Blink's symmetric 1 s hold
 *          made that a 180° inversion: the LED was lit exactly when D13 was
 *          low. A circuit that stopped producing edges froze forever.
 *
 *   BUG B  A pin wired straight to GND was silently deleted from the model.
 *          Its net IS net 0, so its VoltageSource / NortonPort was skipped
 *          entirely, the solver never saw an inconsistency, and the most
 *          destructive thing a student can do to a board came back as
 *          "No problems detected."
 *
 * Everything here is measured against real compiled firmware (public/sim/*.hex)
 * and against closed-form expectations stated in the comment above each block —
 * never against the engine's own previous output.
 *
 * Run: npx tsx lib/simulator/__tests__/engine.test.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { SimulationEngine, parseIntelHex, type EngineSnapshot } from '../engine'
import { SerialTextDecoder } from '../serial-text'
import { compile } from '../model/compile'
import { EXPERIMENT_01, POT_ADC } from '../model/examples'
import type { CircuitDoc, DocWire } from '../model/document'

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
function truth(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  record(name, pass, expected, actual, note)
}
/** Absolute tolerance. NaN/Infinity always fails. */
function near(name: string, actual: number, expected: number, tol: number, unit = 'mA'): void {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol
  record(
    name,
    pass,
    `${expected.toFixed(3)} ${unit} ±${tol.toFixed(3)}`,
    `${Number.isFinite(actual) ? actual.toFixed(3) : String(actual)} ${unit}`,
    pass ? undefined : `err ${Math.abs(actual - expected).toExponential(2)} > tol ${tol}`,
  )
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function firmware(name: string): Uint16Array {
  const p = path.join(process.cwd(), 'public', 'sim', name)
  if (!fs.existsSync(p)) {
    throw new Error(`Missing firmware fixture ${p}. Run this from the repository root.`)
  }
  return parseIntelHex(fs.readFileSync(p, 'utf8'))
}

let wireSeq = 0
function wire(from: [string, string], to: [string, string]): DocWire {
  return {
    id: `ew${++wireSeq}`,
    from: { partId: from[0], pinId: from[1] },
    to: { partId: to[0], pinId: to[1] },
    color: '#111827',
  }
}
function plus(doc: CircuitDoc, ...extra: DocWire[]): CircuitDoc {
  return { parts: doc.parts, wires: [...doc.wires, ...extra] }
}

/**
 * Experiment 01's operating point, from compile.test.ts's independent bisection
 * on the scalar KVL equation: 5 V through 220 Ω + 2 Ω into a red LED.
 */
const LED_ON_MA = 12.394
/** Half of it — the threshold that separates "lit" from "dark" unambiguously. */
const LIT_MA = LED_ON_MA / 2

/** Advance `micros` of SIMULATED time and take a reading. */
function step(eng: SimulationEngine, micros: number): EngineSnapshot {
  eng.run(micros)
  return eng.snapshot()
}

// ══════════════════════════════════════════════════════════════════════════════
group('A1. BUG A — the reported LED current is IN PHASE with the pin driving it')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Blink holds D13 high for 1 s and low for 1 s. There is no ambiguity about
   * what the LED should be doing: it is lit when, and only when, D13 is high.
   *
   * Sample the pin state, the reported current and the reported brightness
   * TOGETHER, from one snapshot, so nothing can drift between them. A sample is
   * only judged once the readout has had 150 ms of simulated time (six filter
   * time constants) since the last observed transition; the readout is a
   * deliberate trailing average, so the samples inside that ramp are honestly
   * mid-transition rather than wrong.
   */
  const eng = new SimulationEngine(firmware('blink.hex'), EXPERIMENT_01)
  const STEP_MS = 50
  const SETTLE_SAMPLES = 3 // 150 ms
  const samples: Array<{ t: number; high: boolean; ma: number; bright: number }> = []
  for (let i = 0; i < 240; i++) {
    const s = step(eng, STEP_MS * 1000)
    samples.push({
      t: s.simSeconds,
      high: s.pins.D13 === 'high',
      ma: s.currents.led1 * 1000,
      bright: s.ledBrightness.led1 ?? 0,
    })
  }

  let sinceEdge = 999
  let transitions = 0
  let judged = 0
  let inPhase = 0
  let antiPhase = 0
  let brightOk = 0
  const firstBad: string[] = []
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].high !== samples[i - 1].high) {
      transitions++
      sinceEdge = 0
      continue
    }
    if (++sinceEdge < SETTLE_SAMPLES) continue
    const s = samples[i]
    const lit = s.ma > LIT_MA
    judged++
    if (lit === s.high) inPhase++
    else {
      antiPhase++
      if (firstBad.length < 3) {
        firstBad.push(`t=${s.t.toFixed(2)}s D13=${s.high ? 'high' : 'low'} ${s.ma.toFixed(2)} mA`)
      }
    }
    if (s.high ? s.bright > 0.7 : s.bright < 0.05) brightOk++
  }

  truth('Blink produced at least 10 transitions to judge', transitions >= 10, '≥ 10', String(transitions))
  truth(
    'every settled sample is IN phase: LED lit ⟺ D13 high',
    judged > 0 && inPhase === judged,
    `${judged}/${judged} in phase`,
    `${inPhase}/${judged} in phase, ${antiPhase} anti-phase`,
    firstBad.length ? firstBad.join(' ; ') : undefined,
  )
  truth(
    'the pre-fix signature (lit while the pin is LOW) is absent',
    antiPhase === 0,
    '0 anti-phase samples',
    `${antiPhase} of ${judged}`,
  )
  truth(
    'reported brightness follows the same phase',
    judged > 0 && brightOk === judged,
    `${judged}/${judged}`,
    `${brightOk}/${judged}`,
  )

  // And the values themselves are still the right ones — a filter that reported
  // a plausible constant in phase would pass everything above.
  const litVals = samples.filter((s) => s.high && s.ma > LIT_MA).map((s) => s.ma)
  near(
    'the lit value is Experiment 01’s operating point',
    Math.max(...litVals),
    LED_ON_MA,
    0.02,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('A2. BUG A — a snapshot reflects the moment it is taken, not the last edge')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The sharpest statement of the bug. Between two pin edges the engine used to
   * publish a value that could not move, because the only thing that closed the
   * averaging window was an edge. Blink holds for a full second, so three
   * snapshots taken 50 ms apart inside one hold were byte-identical to each
   * other AND to the previous hold's value.
   *
   * Walk to a falling edge, then sample across the decay. The current must fall
   * strictly and reach zero — the LED is not being driven any more.
   */
  const eng = new SimulationEngine(firmware('blink.hex'), EXPERIMENT_01)
  let prevHigh = eng.snapshot().pins.D13 === 'high'
  let found = false
  for (let i = 0; i < 600 && !found; i++) {
    const s = step(eng, 5_000)
    const high = s.pins.D13 === 'high'
    if (prevHigh && !high) found = true
    prevHigh = high
  }
  truth('walked to a falling edge on D13', found, 'a falling edge', found ? 'found' : 'not found')

  const a = eng.snapshot().currents.led1 * 1000
  const b = step(eng, 25_000).currents.led1 * 1000
  const c = step(eng, 50_000).currents.led1 * 1000
  const d = step(eng, 400_000).currents.led1 * 1000
  truth(
    'the reading falls between edges instead of being frozen',
    a > b && b > c && c > d,
    'strictly decreasing',
    `${a.toFixed(3)} > ${b.toFixed(3)} > ${c.toFixed(3)} > ${d.toFixed(3)} mA`,
  )
  near('and reaches zero well inside the 1 s hold', d, 0, 0.01)
  truth(
    'the pin is still low the whole way down',
    eng.snapshot().pins.D13 === 'low',
    'low',
    String(eng.snapshot().pins.D13),
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('A3. BUG A — deleting the drive updates the reading instead of freezing it')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Measured symptom on the real editor: deleting the D13 wire left
   * reading-led1 at 12.39 mA from sim time 20 s to 37.4 s on a circuit with no
   * drive at all. Removing the wire removes every future pin edge from the
   * circuit, so nothing was left to close the window.
   */
  const eng = new SimulationEngine(firmware('blink.hex'), EXPERIMENT_01)
  let lit = 0
  for (let i = 0; i < 100 && lit <= LIT_MA; i++) lit = step(eng, 10_000).currents.led1 * 1000
  truth('the LED is lit before the wire is cut', lit > LIT_MA, `> ${LIT_MA.toFixed(2)} mA`, `${lit.toFixed(2)} mA`)

  // w1 is D13 → breadboard a5, the only path from the MCU into the LED branch.
  const cut: CircuitDoc = { parts: EXPERIMENT_01.parts, wires: EXPERIMENT_01.wires.filter((w) => w.id !== 'w1') }
  eng.setDocument(cut)
  const after = step(eng, 200_000).currents.led1 * 1000
  near('cutting the drive wire drops the reading to zero', after, 0, 0.01)

  // The part is gone entirely — not merely at zero.
  const gone: CircuitDoc = {
    parts: EXPERIMENT_01.parts.filter((p) => p.id !== 'led1'),
    wires: EXPERIMENT_01.wires.filter((w) => w.from.partId !== 'led1' && w.to.partId !== 'led1'),
  }
  eng.setDocument(gone)
  const s = step(eng, 50_000)
  truth(
    'a deleted LED stops being reported at all',
    !('led1' in s.currents) && !('led1' in s.ledBrightness),
    'no led1 key',
    JSON.stringify(Object.keys(s.currents)),
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('A4. BUG A — PWM still reads as a smooth average, at no extra solve cost')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The averaging exists for exactly this: analogWrite() makes D9 alternate
   * between two DC operating points, and the instantaneous solution is always
   * one extreme or the other. The readout must sit between them and stay there.
   *
   * pot.hex is analogRead(A0) → analogWrite(D9). At the wiper's mid position
   * A0 reads 511 counts, so the duty is floor(511/4)/255 = 127/255 and the mean
   * current is that fraction of Experiment 01's 12.394 mA.
   */
  const eng = new SimulationEngine(firmware('pot.hex'), potAt(50))
  eng.run(1_000_000) // let the sketch read the wiper and settle

  const before = eng.snapshot()
  const vals: number[] = []
  for (let i = 0; i < 20; i++) vals.push(step(eng, 50_000).currents.led1 * 1000)
  const after = eng.snapshot()
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const duty = Math.floor(after.adc.A0 / 4) / 255

  truth(
    'the reading never collapses to either PWM extreme',
    lo > 0.5 && hi < LED_ON_MA - 0.5,
    `strictly inside (0, ${LED_ON_MA.toFixed(2)}) mA`,
    `${lo.toFixed(3)}…${hi.toFixed(3)} mA`,
  )
  near('and equals the duty-weighted mean', (lo + hi) / 2, duty * LED_ON_MA, 0.25)
  truth(
    'ripple stays under 5% of full scale',
    hi - lo < 0.05 * LED_ON_MA,
    `< ${(0.05 * LED_ON_MA).toFixed(3)} mA`,
    `${(hi - lo).toFixed(3)} mA`,
  )

  /**
   * §2.4's promise: a blinking pin costs TWO DC solves, not one per cycle. Over
   * a second of 490 Hz PWM the engine sees ~2000 pin edges; every one of them
   * past the first two must be a cache hit.
   */
  const solves = after.solves - before.solves
  const hits = after.cacheHits - before.cacheHits
  truth(
    'PWM memoisation holds: no new solves across a second of 490 Hz PWM',
    solves === 0 && hits > 500,
    '0 solves, > 500 hits',
    `${solves} solves, ${hits} hits`,
  )
  truth(
    'total solves for the whole run stay at the operating-point count',
    after.solves <= 8,
    '≤ 8 solves',
    `${after.solves} solves / ${after.cacheHits} hits`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('A5. BUG A — the reading tracks the CURRENT knob position')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The measured symptom: setting the pot to 100% reported 11.81 mA, byte
   * identical to the previous 95% sample. 100% duty means D9 is held constantly
   * HIGH — no more edges — so the frozen window could never be closed again.
   * 0% is the same in reverse: constant LOW, and the LED stayed at full glow.
   *
   * Expected current is the duty the sketch actually programmed times
   * Experiment 01's operating point; the ADC count is read from the same
   * snapshot, so this is not a guess about the firmware's arithmetic.
   */
  const eng = new SimulationEngine(firmware('pot.hex'), potAt(50))
  eng.run(1_000_000)
  for (const pos of [0, 25, 50, 75, 95, 100, 50, 0]) {
    eng.setDocument(potAt(pos))
    const s = step(eng, 1_000_000)
    const ma = s.currents.led1 * 1000
    const expected = (Math.floor(s.adc.A0 / 4) / 255) * LED_ON_MA
    near(`knob ${pos}% (A0 ${s.adc.A0}) reads its own position`, ma, expected, 0.3)
    if (pos === 0) {
      truth(
        `knob 0% leaves the LED dark`,
        (s.ledBrightness.led1 ?? 1) < 0.02,
        'brightness < 0.02',
        (s.ledBrightness.led1 ?? 1).toFixed(4),
      )
    }
    if (pos === 100) {
      near('knob 100% reaches the full operating point', ma, LED_ON_MA, 0.02)
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('B1. BUG B — a supply pin shorted to ground is a reported fault')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Wiring 5V to GND is a dead short across the board's rail. Once shorted the
   * pin's net IS net 0, so the VoltageSource can never be stamped (a source
   * from ground to ground is a degenerate branch row) and the solver has
   * nothing to find. It has to be detected topologically or not at all.
   */
  const doc = plus(EXPERIMENT_01, wire(['uno', '5V'], ['uno', 'GND.2']))
  const c = compile(doc)
  truth(
    '5V wired to GND is recorded as a supply short',
    c.shortedPins.length === 1 && c.shortedPins[0].pinId === '5V' && c.shortedPins[0].role === 'supply',
    '1 supply short on 5V',
    JSON.stringify(c.shortedPins),
  )

  const eng = new SimulationEngine(firmware('blink.hex'), doc)
  const s = step(eng, 200_000)
  const f = s.faults.find((x) => x.deviceId === 'uno.5V')
  truth('and the engine reports a short_circuit fault', !!f && f.kind === 'short_circuit',
    'short_circuit on uno.5V', JSON.stringify(s.faults.map((x) => `${x.kind}:${x.deviceId}`)))
  truth('the message says what real hardware does about it',
    !!f && /On real hardware/.test(f.message) && /short circuit/i.test(f.message),
    'names the consequence', f?.message ?? '(none)')
  truth('the solve itself still succeeds — this is a fault, not an error',
    s.solveError === null, 'solveError null', String(s.solveError))

  // 3.3 V is the same rail-to-ground short, and must not be forgotten.
  const c33 = compile(plus(EXPERIMENT_01, wire(['uno', '3.3V'], ['uno', 'GND.1'])))
  truth('3.3V wired to GND is a supply short too',
    c33.shortedPins.length === 1 && c33.shortedPins[0].pinId === '3.3V' && c33.shortedPins[0].volts === 3.3,
    '1 supply short on 3.3V', JSON.stringify(c33.shortedPins))
}

// ══════════════════════════════════════════════════════════════════════════════
group('B2. BUG B — what must NOT fault')
// ══════════════════════════════════════════════════════════════════════════════
{
  // A GND pin connected to ground is the definition of correct wiring.
  const gnd = plus(EXPERIMENT_01, wire(['uno', 'GND.1'], ['uno', 'GND.2']))
  const cg = compile(gnd)
  truth('GND wired to GND is not a short', cg.shortedPins.length === 0, '0 shorts',
    JSON.stringify(cg.shortedPins))
  const sg = step(new SimulationEngine(firmware('blink.hex'), gnd), 200_000)
  truth('and raises no fault', sg.faults.length === 0, '0 faults',
    JSON.stringify(sg.faults.map((f) => f.kind)))

  /**
   * A pin pulled to ground THROUGH a part is ordinary engineering, not a short:
   * the part's two pins are separate nodes, so the pin keeps a net of its own.
   * This is the line the detection has to draw, and it draws it from topology
   * rather than from resistance, so it holds for a 10 kΩ pull-down and for a
   * closed push button alike.
   */
  const pull: CircuitDoc = {
    parts: [...EXPERIMENT_01.parts, { id: 'rpd', type: 'resistor', x: 0, y: 0, rotation: 0, props: { ohms: 10000 } }],
    wires: [...EXPERIMENT_01.wires, wire(['uno', 'D12'], ['rpd', '1']), wire(['rpd', '2'], ['uno', 'GND.2'])],
  }
  const cp = compile(pull)
  truth('a 10 kΩ pull-down to ground is not a short', cp.shortedPins.length === 0, '0 shorts',
    JSON.stringify(cp.shortedPins))

  const btn: CircuitDoc = {
    parts: [...EXPERIMENT_01.parts, { id: 'btn', type: 'push_button', x: 0, y: 0, rotation: 0, props: { pressed: 1 } }],
    wires: [...EXPERIMENT_01.wires, wire(['uno', 'D11'], ['btn', '1a']), wire(['btn', '2a'], ['uno', 'GND.2'])],
  }
  truth('a CLOSED push button to ground is not a short', compile(btn).shortedPins.length === 0,
    '0 shorts', JSON.stringify(compile(btn).shortedPins))

  // The untouched starter circuit is the control: it must stay clean.
  const base = compile(EXPERIMENT_01)
  truth('the starter circuit has no shorts', base.shortedPins.length === 0, '0 shorts',
    JSON.stringify(base.shortedPins))
  const sb = step(new SimulationEngine(firmware('blink.hex'), EXPERIMENT_01), 200_000)
  truth('and no faults', sb.faults.length === 0, '0 faults',
    JSON.stringify(sb.faults.map((f) => f.kind)))
}

// ══════════════════════════════════════════════════════════════════════════════
group('B3. BUG B — an I/O pin shorted to ground faults while it is driving')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * D13 wired to GND destroys the pin on real hardware — but only while the
   * sketch is driving it HIGH. The same wire on an input is a pin tied low,
   * which is harmless, so the fault has to be gated on runtime drive state
   * rather than asserted from topology alone.
   *
   * The current is the AVR pin model from §2.6: 5 V behind 25 Ω into 0 Ω, i.e.
   * 200 mA, against the ATmega328P's 40 mA absolute maximum.
   */
  const doc = plus(EXPERIMENT_01, wire(['uno', 'D13'], ['uno', 'GND.2']))
  const c = compile(doc)
  truth('D13 wired to GND is recorded as an I/O short',
    c.shortedPins.length === 1 && c.shortedPins[0].pinId === 'D13' && c.shortedPins[0].role === 'io',
    '1 io short on D13', JSON.stringify(c.shortedPins))

  /**
   * And the pin must NOT disappear. Skipping the shorted pin dropped it out of
   * mcuPorts, which is the list the engine watches, so a shorted D13 stopped
   * tracking its own drive state and vanished from the pin readout — the fault
   * could never have fired even if it had existed.
   */
  truth('the shorted pin is still a watched MCU port', c.mcuPorts.has('D13'),
    'mcuPorts has D13', JSON.stringify([...c.mcuPorts.keys()]))

  const eng = new SimulationEngine(firmware('blink.hex'), doc)
  let sawHighWithFault = 0
  let sawHighWithout = 0
  let sawLowWithFault = 0
  let sawLow = 0
  let sawHigh = 0
  let message = ''
  for (let i = 0; i < 60; i++) {
    const s = step(eng, 100_000)
    const f = s.faults.find((x) => x.deviceId === 'uno.D13')
    if (s.pins.D13 === 'high') {
      sawHigh++
      if (f) {
        sawHighWithFault++
        message = f.message
      } else sawHighWithout++
    } else if (s.pins.D13 === 'low') {
      sawLow++
      if (f) sawLowWithFault++
    }
  }
  truth('the shorted pin still reports its drive state', sawHigh > 5 && sawLow > 5,
    'both high and low seen', `${sawHigh} high, ${sawLow} low`)
  truth('every sample with D13 driving HIGH carries a short_circuit fault',
    sawHigh > 0 && sawHighWithFault === sawHigh, `${sawHigh}/${sawHigh}`,
    `${sawHighWithFault}/${sawHigh} (${sawHighWithout} missing)`)
  truth('and no sample with D13 LOW does — driving into ground is what hurts',
    sawLowWithFault === 0, '0 of the low samples', `${sawLowWithFault} of ${sawLow}`)
  truth('the message quantifies it against the pin rating',
    /200 mA/.test(message) && /40 mA/.test(message) && /On real hardware/.test(message),
    '200 mA vs 40 mA, names the consequence', message || '(none)')
}

// ══════════════════════════════════════════════════════════════════════════════
group('C. The serial monitor decodes UTF-8, streaming')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * THE BUG. Both engines appended `String.fromCharCode(b)` per byte, which is
   * a LATIN-1 decode. `pir-alarm-arduino` prints "No motion — System Idle"; the
   * em dash goes out as its UTF-8 encoding, e2 80 94, and a Latin-1 decode made
   * that three separate characters — the measured code points in the page were
   * 226, 128, 148 where one 8212 belonged. Every sketch printing °C (c2 b0) or
   * µ (c2 b5) had it too, which is most of the temperature experiments.
   *
   * WHY STREAMING IS THE WHOLE POINT. The AVR USART hands over exactly ONE byte
   * per callback, so a multi-byte character is ALWAYS split across writes; the
   * Pico's CDC hands over whatever fitted in the last USB packet, so it is split
   * whenever the packet boundary lands mid-character. A decoder constructed per
   * write would answer U+FFFD for precisely the characters this fix exists to
   * repair, which is why the split case is asserted at every offset rather than
   * only at the easy one.
   *
   * Expectations are the UTF-8 standard's, not the engine's: the byte sequences
   * are written out by hand and the expected code points are stated as numbers.
   */
  const EM_DASH = [0xe2, 0x80, 0x94] // U+2014
  const DEGREE = [0xc2, 0xb0] // U+00B0

  const whole = new SerialTextDecoder().bytes(new Uint8Array(EM_DASH))
  truth(
    'e2 80 94 in one write is one character, U+2014',
    whole === '—' && whole.length === 1,
    'U+2014 (—), 1 char',
    `${JSON.stringify(whole)} (${whole.length} chars)`,
  )

  // The engine's own feed: one byte per call, which is what an AVR USART does.
  for (const [label, bytes, expected] of [
    ['em dash', EM_DASH, '—'],
    ['degree sign', DEGREE, '°'],
  ] as Array<[string, number[], string]>) {
    const d = new SerialTextDecoder()
    let out = ''
    const partials: string[] = []
    for (const b of bytes) {
      const piece = d.byte(b)
      partials.push(JSON.stringify(piece))
      out += piece
    }
    truth(
      `${label}, fed one byte at a time, is ONE character`,
      out === expected && out.length === 1,
      `${JSON.stringify(expected)} (1 char)`,
      `${JSON.stringify(out)} (${out.length} chars) from ${partials.join(', ')}`,
    )
  }

  /**
   * Split at every interior offset. This is the case the task named and the one
   * a non-streaming decoder gets wrong: the tail of a packet holds the lead
   * byte and the head of the next holds the continuation.
   */
  for (let cut = 1; cut < EM_DASH.length; cut++) {
    const d = new SerialTextDecoder()
    const first = d.bytes(new Uint8Array(EM_DASH.slice(0, cut)))
    const second = d.bytes(new Uint8Array(EM_DASH.slice(cut)))
    truth(
      `a UTF-8 sequence split ${cut}/${EM_DASH.length - cut} across two writes decodes to one character`,
      first + second === '—' && (first + second).length === 1,
      'U+2014, and nothing before the sequence completes',
      `${JSON.stringify(first)} + ${JSON.stringify(second)}`,
    )
  }

  // The exact string from the reproduction, byte for byte off the wire.
  const line = 'No motion — System Idle'
  const wire = new TextEncoder().encode(line)
  const d = new SerialTextDecoder()
  let got = ''
  for (const b of wire) got += d.byte(b)
  truth(
    "pir-alarm's line survives a byte-at-a-time USART",
    got === line,
    JSON.stringify(line),
    JSON.stringify(got),
  )
  truth(
    'and the dash is U+2014, not 226/128/148',
    got.codePointAt(got.indexOf('—')) === 0x2014 && !/â/.test(got),
    '8212 at the dash, no 226',
    JSON.stringify([...got].map((c) => c.codePointAt(0)).filter((n) => (n ?? 0) > 127)),
  )

  /**
   * A lone continuation byte is not a character and must not become one. The
   * old code turned 0xb0 into 'º'-adjacent nonsense with total confidence;
   * U+FFFD is the honest answer, and it is what the encoding standard requires.
   */
  const lone = new SerialTextDecoder()
  const loneOut = lone.byte(0xb0) + lone.byte(0x41)
  truth(
    'a byte that is not valid UTF-8 becomes U+FFFD, not an invented character',
    loneOut === '�A',
    'U+FFFD then A',
    JSON.stringify([...loneOut].map((c) => c.codePointAt(0))),
  )

  /**
   * reset() is for a stream that is genuinely discontinuous — the MCU has been
   * reset under the decoder. Without it, a half-finished sequence from the old
   * stream would be completed by the first byte of the new one.
   */
  const across = new SerialTextDecoder()
  across.byte(0xe2)
  across.reset()
  const afterReset = across.byte(0x41)
  truth(
    'reset() drops a half-finished sequence instead of gluing it to the next stream',
    afterReset === 'A',
    '"A"',
    JSON.stringify(afterReset),
  )

  /**
   * And the engines must actually be on this path. Asserted against the SOURCE
   * because the bug was one expression: a decoder that exists but is bypassed
   * would pass every assertion above and ship the defect.
   */
  for (const rel of [
    ['lib', 'simulator', 'engine.ts'],
    ['lib', 'simulator', 'pico', 'engine.ts'],
  ]) {
    const src = fs.readFileSync(path.join(process.cwd(), ...rel), 'utf8')
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const builds = /new SerialTextDecoder\(\)/.test(body)
    const feeds = /\.(byte|bytes)\(/.test(body)
    const latin1 = /String\.fromCharCode/.test(body)
    truth(
      `${rel.join('/')} routes serial bytes through the decoder`,
      builds && feeds && !latin1,
      'a SerialTextDecoder is built and fed; no String.fromCharCode',
      `${builds ? 'built' : 'NOT BUILT'}, ${feeds ? 'fed' : 'NOT FED'}, ` +
        `${latin1 ? 'String.fromCharCode STILL PRESENT' : 'no fromCharCode'}`,
    )
  }

  /**
   * The REVERSE direction, which only the Pico has: the student's source is
   * typed into the emulated REPL. `charCodeAt` there was the same defect
   * mirrored — a script containing a degree sign put one 0xB0 byte on the wire
   * and MicroPython rejected it as an invalid UTF-8 start byte, so the fix on
   * the way out would have been unreachable for any script that used one.
   */
  {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'simulator', 'pico', 'engine.ts'),
      'utf8',
    )
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    truth(
      'pico/engine.ts types the script into the REPL as UTF-8',
      /TextEncoder\(\)/.test(body) && !/charCodeAt/.test(body),
      'TextEncoder, no charCodeAt',
      `${/TextEncoder\(\)/.test(body) ? 'TextEncoder' : 'NO TextEncoder'}, ` +
        `${/charCodeAt/.test(body) ? 'charCodeAt STILL PRESENT' : 'no charCodeAt'}`,
    )
  }
}

// ─── Builders that need the fixtures above ────────────────────────────────────

function potAt(position: number): CircuitDoc {
  return {
    parts: POT_ADC.parts.map((p) => (p.id === 'pot' ? { ...p, props: { position } } : p)),
    wires: POT_ADC.wires,
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

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
