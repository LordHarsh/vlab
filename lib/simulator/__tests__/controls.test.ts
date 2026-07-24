/**
 * Device-control tests — the logic behind the inspector and the canvas knob.
 *
 * These cover the three gaps closed against Tinkercad's inspector
 * (DEVICE_CONTROLS_AUDIT.md §5): free numeric entry with a unit selector, LED
 * colour as a per-instance property, and a potentiometer knob that turns on the
 * canvas. Every function under test is PURE and lives in model/parts.ts rather
 * than inside a React component, precisely so it can be asserted here without
 * mounting anything — the rules they enforce are too load-bearing to be
 * reachable only through a rendered DOM.
 *
 * What "load-bearing" means concretely, and why each group exists:
 *
 *   §1  `Resistor.stamp` THROWS on a negative or non-finite resistance, and
 *       `Circuit.solve()` surfaces that as a dead simulation. The typed field is
 *       the last thing standing between a student and that stack trace.
 *   §2  The unit dropdown MULTIPLIES. A capacitance stored in µF that accepts a
 *       figure typed in nF is one missing factor of 1000 away from silently
 *       simulating the wrong circuit.
 *   §3  LED colour is electrical, not cosmetic. If `is` does not move with the
 *       colour, a blue LED behaves like a red one and the panel lies.
 *   §4  A knob that wraps from 0 % to 100 % as the pointer crosses its dead zone
 *       is worse than one that does not move.
 *   §5  A prop declared in a shape the inspector cannot render honestly.
 *
 * Run: npx tsx lib/simulator/__tests__/controls.test.ts
 */

import {
  CAPACITOR_MAX_UF,
  CAPACITOR_MIN_UF,
  FARAD_UNITS,
  LED_COLOURS,
  LED_DEFAULT_COLOUR,
  OHM_UNITS,
  PART_LIBRARY,
  RESISTOR_DEFAULT_OHMS,
  RESISTOR_MAX_OHMS,
  formatValueUnit,
  knobAngleFor,
  knobValueFor,
  ledBodyFill,
  ledColour,
  ledGlowFill,
  ledSaturationCurrent,
  parseValueUnit,
  propDeclarationProblems,
  splitValueUnit,
  type PropSpec,
} from '../model/parts'
import { LED_RED } from '../devices'
import { compile } from '../model/compile'
import type { CircuitDoc } from '../model/document'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(name, a === b, a === b ? '' : `expected ${b}, got ${a}`)
}

function near(name: string, actual: number, expected: number, tol: number): void {
  check(
    name,
    Math.abs(actual - expected) <= tol,
    `expected ${expected} ±${tol}, got ${actual}`,
  )
}

/** The resistor's own declared prop — the real thing, not a stand-in. */
const OHMS = PART_LIBRARY.resistor.props!.find((p) => p.key === 'ohms')!
const FARADS = PART_LIBRARY.capacitor.props!.find((p) => p.key === 'microfarads')!
const POSITION = PART_LIBRARY.potentiometer.props!.find((p) => p.key === 'position')!
const POT_KNOB = PART_LIBRARY.potentiometer.knob!

const OHM_BASE = OHM_UNITS.findIndex((u) => u.mul === 1)
const KILO = OHM_UNITS.findIndex((u) => u.label === 'kΩ')
const MEG = OHM_UNITS.findIndex((u) => u.label === 'MΩ')

// ─── 1. Typed values are validated, not reinterpreted ─────────────────────────

console.log('\n1. Validation')

{
  // The owner's named example, end to end.
  const r = parseValueUnit('4.7', OHMS, KILO)
  check('1.1 "4.7" + kΩ parses', r.ok, r.ok ? '' : r.reason)
  eq('1.2 ... to exactly 4700 Ω', r.ok && r.value, 4700)

  eq('1.3 a plain integer in the base unit', parseValueUnit('150', OHMS, OHM_BASE), { ok: true, value: 150 })
  eq('1.4 surrounding whitespace is ignored', parseValueUnit('  220  ', OHMS, OHM_BASE), { ok: true, value: 220 })
  eq('1.5 exponent notation is a legitimate way to type it', parseValueUnit('1e5', OHMS, OHM_BASE), { ok: true, value: 100000 })
  eq('1.6 3.3 kΩ — a value the old ten-entry dropdown could not express', parseValueUnit('3.3', OHMS, KILO), { ok: true, value: 3300 })

  /**
   * ZERO SURVIVES. `0 Ω` is "none (wire)" and a deliberate affordance — the
   * compiler clamps it to MIN_RESISTANCE and the part behaves as the piece of
   * wire it is drawn as. A validator that rejected it as "not a real resistance"
   * would take a working feature away.
   */
  eq('1.7 zero is accepted — "none (wire)" stays reachable', parseValueUnit('0', OHMS, OHM_BASE), { ok: true, value: 0 })
}

{
  /**
   * The four rejections. Each of these reaching the document means
   * `Resistor.stamp` throws and the whole simulation dies with a stack trace,
   * so "the field said no" is the entire point.
   */
  const bad: Array<[string, string]> = [
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['abc', 'not a number'],
    ['12abc', 'trailing garbage'],
    ['NaN', 'the literal NaN'],
    ['Infinity', 'the literal Infinity'],
    ['-Infinity', 'negative infinity'],
  ]
  for (const [text, why] of bad) {
    const r = parseValueUnit(text, OHMS, OHM_BASE)
    check(`1.8 "${text}" is rejected (${why})`, !r.ok, r.ok ? `accepted as ${r.value}` : '')
  }

  const neg = parseValueUnit('-5', OHMS, OHM_BASE)
  check('1.9 a negative resistance is REJECTED, not clamped to zero', !neg.ok, neg.ok ? `accepted as ${neg.value}` : '')
  check(
    '1.10 ... and says so in words a student can act on',
    !neg.ok && /cannot be negative/i.test(neg.reason),
    neg.ok ? '' : neg.reason,
  )
}

{
  /**
   * Out-of-range is NOT invalid, and is treated differently on purpose: a real
   * number that is merely too big is clamped and the clamp is reported, rather
   * than the student's entry being thrown away.
   */
  // 999 GΩ is 9.99e11, still UNDER the 1e12 ceiling — so it is a legitimate
  // value and must pass through untouched. Asserted because getting the ceiling
  // and the top of the ladder the wrong way round would silently cap real entries.
  eq(
    '1.11 999 GΩ is under the ceiling, so it is stored as typed',
    parseValueUnit('999', OHMS, OHM_UNITS.findIndex((u) => u.label === 'GΩ')),
    { ok: true, value: 999e9 },
  )
  const huge = parseValueUnit('9999', OHMS, OHM_UNITS.findIndex((u) => u.label === 'GΩ'))
  check('1.12 an over-range value is clamped, not rejected', huge.ok)
  eq('1.12a ... to the declared maximum', huge.ok && huge.value, RESISTOR_MAX_OHMS)

  // The capacitor floor is 1e-9 µF — one femtofarad — so a picofarad is three
  // decades ABOVE it and passes through. 1 aF is what actually clamps.
  eq(
    '1.13 1 pF is well above the floor and is stored as 1e-6 µF',
    parseValueUnit('1', FARADS, FARAD_UNITS.findIndex((u) => u.label === 'pF')),
    { ok: true, value: 1e-6 },
  )
  const tiny = parseValueUnit('0.000001', FARADS, FARAD_UNITS.findIndex((u) => u.label === 'pF'))
  eq('1.14 a sub-femtofarad clamps to the floor rather than to zero', tiny.ok && tiny.value, CAPACITOR_MIN_UF)
  check(
    '1.15 a capacitance can never reach zero — a 0 F cap is a floating node',
    tiny.ok && tiny.value > 0,
  )
  eq(
    '1.15a a capacitance of exactly zero is refused the same way',
    parseValueUnit('0', FARADS, FARAD_UNITS.findIndex((u) => u.label === 'μF')),
    { ok: true, value: CAPACITOR_MIN_UF },
  )

  const big = parseValueUnit('9999', FARADS, FARAD_UNITS.findIndex((u) => u.label === 'F'))
  eq('1.16 an over-range capacitance clamps to the ceiling', big.ok && big.value, CAPACITOR_MAX_UF)
}

// ─── 2. The unit dropdown multiplies, and the split round-trips ───────────────

console.log('\n2. Units')

{
  /**
   * THE FACTOR-OF-1000 TRAP. compile.ts reads `props.microfarads` and multiplies
   * by 1e-6, so the DOCUMENT is in microfarads — a student typing 100 and
   * picking nF must end up with 0.1 in the document, not 100. Getting this
   * backwards simulates a 100 µF cap where a 100 nF one was asked for, a
   * thousand-fold error that nothing downstream could detect.
   */
  const nano = FARAD_UNITS.findIndex((u) => u.label === 'nF')
  eq('2.1 100 nF stores 0.1 µF, not 100', parseValueUnit('100', FARADS, nano), { ok: true, value: 0.1 })
  eq('2.2 470 nF stores 0.47 µF', parseValueUnit('470', FARADS, nano), { ok: true, value: 0.47 })
  eq('2.3 1 mF stores 1000 µF', parseValueUnit('1', FARADS, FARAD_UNITS.findIndex((u) => u.label === 'mF')), { ok: true, value: 1000 })

  check(
    '2.4 exactly one farad unit is the stored one',
    FARAD_UNITS.filter((u) => u.mul === 1).length === 1,
  )
  check('2.5 ... and it is µF, which is what compile.ts reads', FARAD_UNITS.find((u) => u.mul === 1)!.label === 'μF')
  check(
    '2.6 exactly one ohm unit is the stored one, and it is Ω',
    OHM_UNITS.filter((u) => u.mul === 1).length === 1 && OHM_UNITS.find((u) => u.mul === 1)!.label === 'Ω',
  )
  eq(
    '2.7 the ohm ladder is Tinkercad\'s, verbatim',
    OHM_UNITS.map((u) => u.label),
    ['pΩ', 'nΩ', 'μΩ', 'mΩ', 'Ω', 'kΩ', 'MΩ', 'GΩ'],
  )
}

{
  /** The split picks the unit a human would have said out loud. */
  eq('2.8 4700 Ω reads as 4.7 k', splitValueUnit(4700, OHM_UNITS), { text: '4.7', unitIndex: KILO })
  eq('2.9 220 Ω stays in the base unit', splitValueUnit(220, OHM_UNITS), { text: '220', unitIndex: OHM_BASE })
  eq('2.10 100000 Ω reads as 100 k, not 0.1 M', splitValueUnit(100000, OHM_UNITS), { text: '100', unitIndex: KILO })
  eq('2.11 1e6 Ω reads as 1 M', splitValueUnit(1e6, OHM_UNITS), { text: '1', unitIndex: MEG })
  eq('2.12 zero has no meaningful prefix', splitValueUnit(0, OHM_UNITS), { text: '0', unitIndex: OHM_BASE })

  /**
   * FLOATING-POINT LITTER. 0.47 µF split through the nF row and multiplied back
   * is 0.46999999999999997 in IEEE754. A student who opens the field and sees
   * that has found a bug in the editor, not a value.
   */
  eq('2.13 0.47 µF reads as 470 nF, not "0.46999999999999997 µF"', splitValueUnit(0.47, FARAD_UNITS), { text: '470', unitIndex: FARAD_UNITS.findIndex((u) => u.label === 'nF') })

  /**
   * The split has to walk DOWN the ladder as well as up. A 100 pF capacitor is
   * stored as 0.0001 µF, and a split that could only ever climb showed exactly
   * that figure in the box — the unreadable number the unit dropdown exists to
   * abolish. This is the assertion that caught it.
   */
  eq('2.13a 100 pF does not display as "0.0001 µF"', splitValueUnit(1e-4, FARAD_UNITS), { text: '100', unitIndex: FARAD_UNITS.findIndex((u) => u.label === 'pF') })
  eq('2.13b a value under the smallest unit stays on that unit', splitValueUnit(1e-9, FARAD_UNITS), { text: '0.001', unitIndex: FARAD_UNITS.findIndex((u) => u.label === 'pF') })
  eq('2.13c and a milliohm reads as a milliohm', splitValueUnit(0.005, OHM_UNITS), { text: '5', unitIndex: OHM_UNITS.findIndex((u) => u.label === 'mΩ') })

  /**
   * FLOAT LITTER IN THE DOCUMENT, not just on screen. The parsed value is what
   * gets autosaved and sent to the database, so 470 nF has to store 0.47 rather
   * than 0.47000000000000003 — otherwise the student's own saved circuit reads
   * back a figure they never typed.
   */
  eq('2.13d the STORED value is clean, not just the displayed one', parseValueUnit('470', FARADS, FARAD_UNITS.findIndex((u) => u.label === 'nF')).ok && parseValueUnit('470', FARADS, FARAD_UNITS.findIndex((u) => u.label === 'nF')), { ok: true, value: 0.47 })
  check(
    '2.13e ... and it survives a JSON round-trip unchanged, as autosave does it',
    JSON.parse(JSON.stringify({ v: 0.47 })).v === 0.47,
  )

  // Round-trip: every value the suggestion list offers survives a split/parse.
  for (const o of OHMS.options ?? []) {
    const s = splitValueUnit(o, OHM_UNITS)
    const back = parseValueUnit(s.text, OHMS, s.unitIndex)
    check(`2.14 ${o} Ω round-trips through split → parse`, back.ok && back.value === o, JSON.stringify({ s, back }))
  }
  for (const o of FARADS.options ?? []) {
    const s = splitValueUnit(o, FARAD_UNITS)
    const back = parseValueUnit(s.text, FARADS, s.unitIndex)
    check(`2.15 ${o} µF round-trips through split → parse`, back.ok && back.value === o, JSON.stringify({ s, back }))
  }

  eq('2.16 formatting reads like a sentence', formatValueUnit(4700, OHM_UNITS), '4.7 kΩ')
  eq('2.17 ... including zero', formatValueUnit(0, OHM_UNITS), '0 Ω')
}

// ─── 3. LED colour is electrical ──────────────────────────────────────────────

console.log('\n3. LED colour')

{
  eq(
    '3.1 the six colours Tinkercad offers, and no others',
    LED_COLOURS.map((c) => c.value).sort(),
    ['blue', 'green', 'orange', 'red', 'white', 'yellow'],
  )
  eq('3.2 red is the default', LED_DEFAULT_COLOUR, 'red')
  eq('3.3 an unknown colour falls back to red rather than throwing', ledColour('chartreuse').value, 'red')
  eq('3.4 so does a missing one', ledColour(undefined).value, 'red')

  /**
   * RED KEEPS THE HISTORIC CONSTANT. `LED_RED` was fitted against the ngspice
   * reference solves in SIMULATOR_ARCHITECTURE.md §5.5; if the colour table
   * replaced it with its own derived figure, every existing starter number and
   * every solver reference would shift by a fraction of a milliamp for no
   * reason anybody could later explain.
   */
  const red = ledColour('red')
  eq('3.5 red reuses LED_RED\'s saturation current exactly', red.is, LED_RED.is)
  eq('3.6 ... and its emission coefficient', red.n, LED_RED.n)

  /**
   * And the literal agrees with its own derivation, so the table is not merely
   * self-consistent — it is consistent with the datasheet figure beside it.
   * 2 % in `is` is n·VT·ln(1.02) ≈ 0.9 mV of forward voltage.
   */
  const derived = ledSaturationCurrent(red.vfVolts)
  check(
    '3.7 red\'s literal is within 5 % of ledSaturationCurrent(1.96 V)',
    Math.abs(derived - red.is) / red.is < 0.05,
    `derived ${derived.toExponential(4)} vs literal ${red.is.toExponential(4)}`,
  )

  /** Every other colour is DERIVED, so it cannot drift from its datasheet Vf. */
  for (const c of LED_COLOURS.filter((x) => x.value !== 'red')) {
    near(`3.8 ${c.value}: is reproduces its ${c.vfVolts} V datasheet drop`, c.is, ledSaturationCurrent(c.vfVolts), c.is * 1e-9)
  }

  check(
    '3.9 blue and green really do sit far above red — the whole point',
    ledColour('blue').vfVolts - red.vfVolts > 1.0,
    `${ledColour('blue').vfVolts} vs ${red.vfVolts}`,
  )
}

{
  /**
   * THE END-TO-END CHECK. parts.ts can hold the most beautiful colour table in
   * the world and it means nothing if compile.ts calls `createLED` without it —
   * which is exactly what the first cut of this feature did. Solve the same
   * circuit twice, changing only the colour, and compare the currents.
   */
  function ledDoc(color: string): CircuitDoc {
    return {
      parts: [
        { id: 'uno', type: 'arduino_uno', x: 0, y: 0, rotation: 0, props: {} },
        { id: 'r', type: 'resistor', x: 0, y: 300, rotation: 0, props: { ohms: 220 } },
        { id: 'led', type: 'led', x: 200, y: 300, rotation: 0, props: color ? { color } : {} },
      ],
      wires: [
        { id: 'w1', from: { partId: 'uno', pinId: 'D13' }, to: { partId: 'r', pinId: '1' }, color: '#111' },
        { id: 'w2', from: { partId: 'r', pinId: '2' }, to: { partId: 'led', pinId: 'A' }, color: '#111' },
        { id: 'w3', from: { partId: 'led', pinId: 'C' }, to: { partId: 'uno', pinId: 'GND.2' }, color: '#111' },
      ],
    }
  }

  function mA(color: string): number {
    const c = compile(ledDoc(color))
    for (const [name, port] of c.mcuPorts) {
      if (name === 'D13') port.set(1 / 25, 5 / 25)
      else port.set(1e-8, 0)
    }
    const res = c.circuit.solve()
    check(`3.10 a ${color || 'colourless'} LED circuit solves`, res.ok, res.error ?? '')
    return Math.abs(c.leds.get('led')!.current) * 1000
  }

  const redMa = mA('red')
  const blueMa = mA('blue')
  const yellowMa = mA('yellow')
  const legacyMa = mA('')

  near('3.11 red through 220 Ω on a 5 V pad draws 12.39 mA', redMa, 12.39, 0.05)
  near('3.12 blue, same circuit, draws 7.47 mA', blueMa, 7.47, 0.05)
  near('3.13 yellow lands between them at 11.84 mA', yellowMa, 11.84, 0.05)
  check(
    '3.14 colour reaches the SOLVER — red and blue differ by ~5 mA',
    redMa - blueMa > 4,
    `${redMa.toFixed(2)} vs ${blueMa.toFixed(2)} mA`,
  )

  /**
   * BACKWARD COMPATIBILITY, asserted rather than assumed. Every starter authored
   * before this prop, and every attempt a student has already saved, carries no
   * `color` at all. Those documents must compile to precisely the circuit they
   * did before — not approximately.
   */
  eq('3.15 a document with no colour prop is bit-identical to an explicit red', legacyMa, redMa)
}

{
  /** The rendered colour tracks brightness without ever leaving the gamut. */
  const blue = ledColour('blue')
  eq('3.16 an unlit LED shows its epoxy body colour', ledBodyFill(blue, 0), 'rgb(47,111,208)')
  eq('3.17 a fully lit one shows its emitted colour', ledBodyFill(blue, 1), 'rgb(70,140,255)')
  eq('3.18 an unlit LED has no glow at all', ledGlowFill(blue, 0), 'rgba(70,140,255,0)')
  check('3.19 out-of-range brightness is clamped, not extrapolated', ledBodyFill(blue, 9) === ledBodyFill(blue, 1))
  check('3.20 ... including NaN, which would otherwise render "rgb(NaN,…)"', ledBodyFill(blue, NaN) === ledBodyFill(blue, 0))

  for (const c of LED_COLOURS) {
    for (const b of [0, 0.5, 1]) {
      check(
        `3.21 ${c.value}@${b} renders a well-formed colour`,
        /^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(ledBodyFill(c, b)),
        ledBodyFill(c, b),
      )
    }
  }

  /** The artwork can actually be recoloured — the hook is in the shipped SVG. */
  check(
    '3.22 the LED\'s SVG carries the --led-body variable the canvas sets',
    PART_LIBRARY.led.svg.includes('var(--led-body'),
  )
  check(
    '3.23 ... and no longer hardcodes the red dome it used to',
    !PART_LIBRARY.led.svg.includes('opacity=".65" fill="red"'),
  )
}

// ─── 4. The knob ──────────────────────────────────────────────────────────────

console.log('\n4. Knob')

{
  /** A real single-turn pot: 300° of sweep, centre detent at twelve o'clock. */
  eq('4.1 the pot knob drives its `position` prop', POT_KNOB.key, 'position')
  eq('4.2 0 % sits at the left-hand stop', knobAngleFor(POT_KNOB, POSITION, 0), -150)
  eq('4.3 100 % sits at the right-hand stop', knobAngleFor(POT_KNOB, POSITION, 100), 150)
  eq('4.4 50 % points straight up', knobAngleFor(POT_KNOB, POSITION, 50), 0)
  eq('4.5 25 % is a quarter of the way round', knobAngleFor(POT_KNOB, POSITION, 25), -75)

  /** Angle → value is the exact inverse, so the tick points at the finger. */
  eq('4.6 straight up reads 50 %', knobValueFor(POT_KNOB, POSITION, 0, -10), 50)
  eq('4.7 due right reads 80 %', knobValueFor(POT_KNOB, POSITION, 10, 0), 80)
  eq('4.8 due left reads 20 %', knobValueFor(POT_KNOB, POSITION, -10, 0), 20)

  for (const v of [0, 1, 25, 50, 75, 99, 100]) {
    const deg = knobAngleFor(POT_KNOB, POSITION, v)
    const rad = (deg * Math.PI) / 180
    const back = knobValueFor(POT_KNOB, POSITION, Math.sin(rad) * 20, -Math.cos(rad) * 20)
    eq(`4.9 ${v} % round-trips through angle → value`, back, v)
  }

  /**
   * THE DEAD ZONE. Below the knob there is 60° with no track on it. Without a
   * stop, a pointer crossing six o'clock wraps the value from 0 % to 100 % — the
   * knob leaps the full width of its range under a finger that moved a
   * millimetre, which is far worse than refusing to move.
   */
  /** Point the pointer at a given angle, `r` units from the shaft. */
  function at(deg: number, r = 15): number {
    const rad = (deg * Math.PI) / 180
    return knobValueFor(POT_KNOB, POSITION, Math.sin(rad) * r, -Math.cos(rad) * r)
  }

  // Inside the sweep the value tracks the angle linearly: 3° of the 300° travel
  // is 1 %. Asserted just inside the stop, where a clamp would be indetectable
  // from a correct reading if the two happened to agree at the stop itself.
  eq('4.10 −147°, just inside the left stop, reads 1 % rather than clamping', at(-147), 1)
  eq('4.10a +147°, just inside the right stop, reads 99 %', at(147), 99)
  eq('4.11 −160° is past the left stop and clamps to 0 %, it does not wrap', at(-160), 0)
  eq('4.12 +160° is past the right stop and clamps to 100 %', at(160), 100)
  eq('4.13 just short of straight down, on the left, stays at 0 %', at(-179), 0)
  eq('4.14 just short of straight down, on the right, stays at 100 %', at(179), 100)

  /**
   * THE WRAP THIS PREVENTS. Crossing six o'clock must not swing the value the
   * full width of its range: a pointer moving one degree, from −179° to +179°,
   * passes through the dead zone and would otherwise take the pot from 0 % to
   * 100 % — a lamp going from off to full brightness under a finger that barely
   * moved. The two ends are allowed to differ; what is forbidden is a *smooth*
   * path between them through the bottom.
   */
  check(
    '4.15 the dead zone is a pair of stops, not a wrap-around',
    at(-179) === 0 && at(179) === 100 && at(-160) === 0 && at(160) === 100,
    `${at(-179)} ${at(179)} ${at(-160)} ${at(160)}`,
  )

  /** Never outside the declared range, whatever the pointer does. */
  for (let deg = -180; deg <= 180; deg += 3) {
    const rad = (deg * Math.PI) / 180
    const v = knobValueFor(POT_KNOB, POSITION, Math.sin(rad) * 15, -Math.cos(rad) * 15)
    check(
      `4.16 ${deg}° yields a value inside [0, 100]`,
      v >= 0 && v <= 100 && Number.isFinite(v),
      String(v),
    )
  }

  /** The value snaps to the declared step, so the readout is never 43.7194 %. */
  for (let deg = -150; deg <= 150; deg += 7) {
    const rad = (deg * Math.PI) / 180
    const v = knobValueFor(POT_KNOB, POSITION, Math.sin(rad) * 15, -Math.cos(rad) * 15)
    check(`4.17 ${deg}° snaps to the 1 % step`, Number.isInteger(v), String(v))
  }

  /**
   * A degenerate centre would put the grab target on the origin, where every
   * drag reads the same angle. Cheap to assert, impossible to see by eye.
   */
  check('4.18 the knob has a usable grab radius', POT_KNOB.r > 5, String(POT_KNOB.r))
  check(
    '4.19 the knob sits inside the part it is drawn on',
    POT_KNOB.cx > 0 &&
      POT_KNOB.cy > 0 &&
      POT_KNOB.cx < PART_LIBRARY.potentiometer.width &&
      POT_KNOB.cy < PART_LIBRARY.potentiometer.height,
    `${POT_KNOB.cx},${POT_KNOB.cy} in ${PART_LIBRARY.potentiometer.width}x${PART_LIBRARY.potentiometer.height}`,
  )
  /**
   * The grab target must not swallow the pin row: a pointer aimed at a pin that
   * lands on the knob instead cannot start a wire, which would break wiring the
   * pot up at all.
   */
  const topPin = Math.min(...PART_LIBRARY.potentiometer.pins.map((p) => p.y))
  check(
    '4.20 ... and clear of the pin row, so pins stay wireable',
    POT_KNOB.cy + POT_KNOB.r < topPin,
    `knob reaches y=${POT_KNOB.cy + POT_KNOB.r}, pins at y=${topPin}`,
  )

  /**
   * wokwi's own artwork rotates on `--knob-angle`. Naming a different variable
   * would leave the tick frozen while the value moved — the exact "inert knob"
   * complaint this work exists to fix, but harder to spot because the panel
   * would still track.
   */
  eq('4.19 the knob drives wokwi\'s own rotation variable', POT_KNOB.angleVar, '--knob-angle')
  check(
    '4.22 ... which the shipped artwork actually reads',
    PART_LIBRARY.potentiometer.svg.includes('var(--knob-angle'),
  )
}

// ─── 5. Declarations the inspector can render honestly ────────────────────────

console.log('\n5. Declarations')

{
  eq('5.1 no part declares a prop the inspector cannot render', propDeclarationProblems(), [])

  /**
   * MUTATION CHECK. A self-check that cannot fail is decoration. Each of these
   * breaks a declaration in a way that has actually shipped, or is one typo
   * away, and asserts the guard names it.
   */
  const originals = new Map<string, PropSpec[] | undefined>()
  function withBrokenProp(type: string, patch: Partial<PropSpec>, name: string, expect: RegExp): void {
    const def = PART_LIBRARY[type]
    if (!originals.has(type)) originals.set(type, def.props)
    const base = originals.get(type)!
    def.props = base!.map((p, i) => (i === 0 ? { ...p, ...patch } : p))
    const problems = propDeclarationProblems()
    check(name, problems.some((p) => expect.test(p)), problems.join(' | ') || 'no problem reported')
    def.props = base
  }

  withBrokenProp('resistor', { default: undefined }, '5.2 a prop with no default is caught', /declares no `default`/)
  withBrokenProp('resistor', { units: undefined }, '5.3 a number prop with no units is caught', /no `units`/)
  withBrokenProp(
    'resistor',
    { units: [{ label: 'kΩ', mul: 1e3 }] },
    '5.4 a unit ladder with no `mul: 1` row is caught',
    /no unit with `mul: 1`/,
  )
  withBrokenProp('resistor', { min: undefined }, '5.5 a number prop with no bounds is caught', /without both `min` and `max`/)
  withBrokenProp('resistor', { min: 500 }, '5.6 a default outside its own range is caught', /outside its own/)
  withBrokenProp('resistor', { min: 10, max: 5 }, '5.7 an inverted range is caught', /min 10 >= max 5/)
  withBrokenProp('led', { default: 'chartreuse' }, '5.8 a choice default not in its choices is caught', /not in its choices/)
  withBrokenProp('led', { choices: [] }, '5.9 a choice prop with no choices is caught', /no `choices`/)
  withBrokenProp('led', { default: 3 }, '5.10 a choice holding a number is caught', /choice` stores\s+strings|stores strings/)
  withBrokenProp(
    'resistor',
    { type: 'select', default: 999, options: [1, 2] },
    '5.11 a select default outside its options is caught',
    /would render blank/,
  )

  // The knob half of the guard.
  const pot = PART_LIBRARY.potentiometer
  const realKnob = pot.knob
  pot.knob = { ...realKnob!, key: 'nonexistent' }
  check('5.12 a knob on a prop that does not exist is caught', propDeclarationProblems().some((p) => /not one of its props/.test(p)))
  pot.knob = { ...realKnob!, fromDeg: 90, toDeg: 90 }
  check('5.13 a zero-degree sweep is caught', propDeclarationProblems().some((p) => /zero-degree sweep/.test(p)))
  pot.knob = realKnob
  eq('5.14 ... and the library is left exactly as it was found', propDeclarationProblems(), [])
}

{
  /** The single shared constant the brief calls out. It must feed BOTH readers. */
  const el = PART_LIBRARY.resistor.electrical
  check(
    '5.15 RESISTOR_DEFAULT_OHMS feeds the electrical default',
    el.kind === 'resistor' && el.defaultOhms === RESISTOR_DEFAULT_OHMS,
  )
  eq('5.16 ... and the prop default, from the same constant', OHMS.default, RESISTOR_DEFAULT_OHMS)
  eq('5.17 the resistor is now free-entry, not a fixed list', OHMS.type, 'number')
  eq('5.18 the capacitor too', FARADS.type, 'number')
  check(
    '5.19 the common values survive as suggestions, including 0 Ω',
    (OHMS.options ?? []).includes(0) && (OHMS.options ?? []).includes(RESISTOR_DEFAULT_OHMS),
    JSON.stringify(OHMS.options),
  )
  check('5.20 and the "0 = none (wire)" affordance is still reachable', (OHMS.min ?? 1) === 0)
  check(
    '5.21 the LED declares a colour prop, so it is per-instance',
    (PART_LIBRARY.led.props ?? []).some((p) => p.key === 'color' && p.type === 'choice'),
  )
}

console.log('\n' + '='.repeat(60))
console.log(`${passed}/${passed + failed} passed`)
if (failed > 0) console.log(`${failed} FAILED`)
console.log('='.repeat(60))
process.exit(failed ? 1 : 0)
