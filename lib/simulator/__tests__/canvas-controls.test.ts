/**
 * The three sim-time controls that moved from the inspector onto the artwork,
 * proved from the pointer to the pixels and back to the sketch.
 *
 * WHAT WOULD MAKE THIS FILE WORTHLESS, stated first because this project has
 * shipped exactly that shape of green tick three times. A canvas control is
 * unusually easy to test in a way that proves nothing: assert that `parts.ts`
 * declares a cone, assert that the geometry function returns the angles you
 * already worked out, and never once check that a single pixel of it reaches a
 * screen or that the number it draws is the number the firmware receives. The
 * LED colour table passed exactly that shape of test for months while compile.ts
 * never read it and every LED in every document solved red.
 *
 * So the load-bearing assertions here are DIFFERENTIALS through the real
 * `CircuitCanvas`, server-rendered, with the numbers read back out of the emitted
 * SVG:
 *
 *   1. THE ULTRASONIC READOUT IS THE SKETCH'S NUMBER. Group D compiles a real
 *      pulseIn() sketch with the WebAssembly toolchain, runs it on avr8js
 *      against the solved circuit, reads the centimetres off the Serial stream,
 *      and requires them to be the centimetres painted above the target. Then it
 *      moves the target and requires BOTH to move together. A readout wired to a
 *      constant passes nothing; one wired to the document instead of to the
 *      report passes until the module runs out of range and starts answering
 *      with its 38 ms timeout, which group D also requires.
 *
 *   2. THE PIR CONE IS COLOURED BY THE SOLVED STATE. Group E renders the SAME
 *      document — `motion: 1` in its props throughout — with the sensor
 *      reporting a detection and then not reporting one, and requires the fill
 *      to differ. It then renders it with no report at all and requires the idle
 *      colour, which is the assertion a cone painted from the document cannot
 *      pass: the prop says motion the whole time.
 *
 *   3. THE MOTOR'S LABEL IS THE SOLVED SPEED. Group F runs three real circuits
 *      whose speeds are worked out below from the datasheet — 5000 rpm at 5 V
 *      unloaded, 2500 rpm at half load, and a genuine stall at full load where
 *      the terminal resistance falls to the locked-rotor value — and reads the
 *      number back off the motor's painted case.
 *
 * Group H is a fourth of the same kind, arriving with the wire-editing change:
 * a wire the student has selected must LOOK selected, because Delete is now the
 * only thing that removes one and "which wire is this aimed at" has to be
 * answerable by looking. Its counterpart — that the key really is wired to the
 * removal, and that double-click now inserts a bend at the right index — lives
 * in wirehit.test.ts §6, next to the hit rule it depends on.
 *
 * EVERY EXPECTED NUMBER IS DERIVED IN A COMMENT BESIDE IT. Nothing here was
 * captured from a previous run; where a tolerance appears it is because a named
 * mechanism (Arduino's own pulseIn granularity, the Uno's 5 V rail drooping
 * under load) makes an exact figure wrong, and the mechanism is named.
 *
 * Run: npx tsx lib/simulator/__tests__/canvas-controls.test.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CircuitCanvas } from '../../../components/simulator/CircuitCanvas'
import type { DeviceState } from '../behavioural'
import { compileSketch } from '../avr/build'
import { HOBBY_MOTOR_6V } from '../devices'
import { SimulationEngine, parseIntelHex } from '../engine'
import {
  docReducer,
  initialDocState,
  type CircuitDoc,
  type DocAction,
  type DocWire,
  type PlacedPart,
} from '../model/document'
import {
  HC_SR501_FIELD,
  getPart,
  propDeclarationProblems,
  targetConeEdges,
  targetInField,
  targetPointFor,
  targetValuesFor,
  type TargetControl,
} from '../model/parts'

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
/**
 * How a value is written into the table AND compared.
 *
 * JSON for anything that is not a primitive, and that is not cosmetic: a plain
 * `String(x)` on two different objects yields `[object Object]` for both, so an
 * `eq` over two cone-edge records would pass whatever they contained. Five
 * assertions in group B did exactly that until the empty-looking table column
 * gave it away.
 */
function show(v: unknown): string {
  return v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)
}
function eq(name: string, actual: unknown, expected: unknown): void {
  truth(name, show(actual) === show(expected), show(expected), show(actual))
}
function near(name: string, actual: number, expected: number, tol: number, unit = ''): void {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol
  truth(name, pass, `${expected}${unit} ±${tol}`, `${actual}${unit}`)
}

// ─── Reading the rendered SVG ─────────────────────────────────────────────────
//
// Deliberately string-scraping rather than parsing to a DOM: the point of these
// assertions is that a specific attribute of a specific element carries a
// specific value in the markup a browser would receive, and a regex over that
// markup cannot be satisfied by anything except the markup being right.

/** One attribute of the element carrying `data-testid`, or null if absent. */
function attr(html: string, testId: string, name: string): string | null {
  const el = new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)
  if (!el) return null
  const m = new RegExp(`${name}="([^"]*)"`).exec(el[0])
  return m ? m[1] : null
}

/** The text content of the element carrying `data-testid`, or null if absent. */
function textOf(html: string, testId: string): string | null {
  const m = new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(html)
  return m ? m[1] : null
}

function has(html: string, testId: string): boolean {
  return html.includes(`data-testid="${testId}"`)
}

/** The whole canvas, exactly as the editor mounts it. */
function paint(
  doc: CircuitDoc,
  deviceStates?: Record<string, DeviceState>,
  selectedWire: string | null = null,
): string {
  return renderToStaticMarkup(
    createElement(CircuitCanvas, {
      doc,
      dispatch: () => {},
      deviceStates,
      selected: null,
      onSelect: () => {},
      selectedWire,
      onSelectWire: () => {},
    }),
  )
}

// ─── Circuits ─────────────────────────────────────────────────────────────────

function wire(id: string, a: string, ap: string, b: string, bp: string): DocWire {
  return { id, from: { partId: a, pinId: ap }, to: { partId: b, pinId: bp }, color: '#40B942' }
}

/** Experiment 2's wiring: VCC→5V, GND→GND, TRIG→D9, ECHO→D10. */
function ultrasonicDoc(props: Record<string, number>): CircuitDoc {
  return {
    parts: [
      { id: 'uno', type: 'arduino_uno', x: 0, y: 260, rotation: 0, props: {} },
      { id: 'us', type: 'hc_sr04', x: 340, y: 0, rotation: 0, props },
    ],
    wires: [
      wire('w1', 'us', 'VCC', 'uno', '5V'),
      wire('w2', 'us', 'GND', 'uno', 'GND.1'),
      wire('w3', 'us', 'TRIG', 'uno', 'D9'),
      wire('w4', 'us', 'ECHO', 'uno', 'D10'),
    ],
  }
}

/** Experiment 6's wiring: VCC→5V, GND→GND, OUT→D2. */
function pirDoc(props: Record<string, number>): CircuitDoc {
  return {
    parts: [
      { id: 'uno', type: 'arduino_uno', x: 0, y: 260, rotation: 0, props: {} },
      { id: 'pir', type: 'pir_motion', x: 340, y: 0, rotation: 0, props },
    ],
    wires: [
      wire('w1', 'pir', 'VCC', 'uno', '5V'),
      wire('w2', 'pir', 'GND', 'uno', 'GND.1'),
      wire('w3', 'pir', 'OUT', 'uno', 'D2'),
    ],
  }
}

/**
 * A motor straight across the rail. Not how anybody should drive one — that is
 * what the L298N is for — but it is the circuit whose speed can be worked out on
 * paper, which is the only kind this file is allowed to assert on.
 */
function motorDoc(load: number, { shorted = false } = {}): CircuitDoc {
  return {
    parts: [
      { id: 'uno', type: 'arduino_uno', x: 0, y: 260, rotation: 0, props: {} },
      { id: 'm', type: 'dc_motor', x: 340, y: 0, rotation: 0, props: { load } },
    ],
    wires: [
      wire('w1', 'm', '1', 'uno', shorted ? 'GND.2' : '5V'),
      wire('w2', 'm', '2', 'uno', 'GND.1'),
    ],
  }
}

// ─── The sketches ─────────────────────────────────────────────────────────────

/**
 * The HC-SR04 sketch every tutorial prints, unchanged: a 10 µs trigger, a
 * pulseIn() on ECHO, and the datasheet's own "uS / 58 = centimeter".
 *
 * Both numbers go to Serial. The microseconds are what pulseIn MEASURED, which
 * is the honest quantity to compare against the module's declared pulse width;
 * the centimetres are what the student sees, which is the quantity the canvas
 * has to agree with.
 */
const SKETCH_ULTRASONIC = `
const int TRIG = 9;
const int ECHO = 10;

void setup() {
  Serial.begin(9600);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

void loop() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(4);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long us = pulseIn(ECHO, HIGH, 60000UL);
  Serial.print("us=");
  Serial.print(us);
  Serial.print(" cm=");
  Serial.println(us / 58);
  delay(40);
}
`

/** Experiment 6's alarm loop, cut down to the one line that matters. */
const SKETCH_PIR = `
void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT);
}

void loop() {
  Serial.println(digitalRead(2));
  delay(50);
}
`

/** A motor needs no firmware at all; the CPU only has to be running. */
const SKETCH_IDLE = `
void setup() {}
void loop() {}
`

async function build(source: string): Promise<string | null> {
  const r = await compileSketch(source, 'arduino_uno')
  if (r.ok) return r.hex
  console.error(r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n'))
  return null
}

/** The last `key=value` the sketch printed, as a number, or NaN. */
function lastSerial(serial: string, key: string): number {
  const all = [...serial.matchAll(new RegExp(`${key}=(-?\\d+)`, 'g'))]
  const hit = all[all.length - 1]
  return hit ? Number(hit[1]) : NaN
}

/** The last bare integer the sketch printed on a line of its own. */
function lastLine(serial: string): string {
  const lines = serial.split(/\r?\n/).filter((l) => l.length > 0)
  return lines[lines.length - 1] ?? ''
}

/** Run a circuit for `micros` of simulated time and return its snapshot. */
function run(hex: string, doc: CircuitDoc, micros: number) {
  const e = new SimulationEngine(parseIntelHex(hex), doc)
  e.run(micros)
  return e.snapshot()
}

// ─── The datasheet arithmetic, done once, by hand ─────────────────────────────

/** "uS / 58 = centimeter" — the ECHO width for one cm, from the HC-SR04 sheet. */
const MICROS_PER_CM = 58
/** "if no obstacle is detected, the output pin will give a 38 ms high level". */
const NO_ECHO_MICROS = 38_000

/**
 * The three motor constants, worked out here from HOBBY_MOTOR_6V rather than
 * read out of DCMotor, so this file and the device cannot agree by construction.
 *
 *   Ra = Vn / Is           = 6 / 0.8            = 7.5 Ω        (locked rotor)
 *   Ke = (Vn − I0·Ra) / n0 = (6 − 0.525) / 6000 = 9.125e-4 V/rpm
 *   G(L) = (I0 + L·(Is − I0)) / Vn                             (terminal, at load L)
 *   rpm  = i · (1/G − Ra) / Ke
 */
const MOTOR = HOBBY_MOTOR_6V
const RA = MOTOR.ratedVolts / MOTOR.stallAmps
const KE = (MOTOR.ratedVolts - MOTOR.noLoadAmps * RA) / MOTOR.noLoadRpm
function motorOhms(load: number): number {
  return MOTOR.ratedVolts / (MOTOR.noLoadAmps + load * (MOTOR.stallAmps - MOTOR.noLoadAmps))
}
function motorRpm(load: number, volts: number): number {
  const reff = motorOhms(load)
  return ((volts / reff) * (reff - RA)) / KE
}

async function main() {
  // ════════════════════════════════════════════════════════════════════════════
  group('A. The three parts declare what the canvas needs')
  // ════════════════════════════════════════════════════════════════════════════
  {
    eq('the whole library still declares nothing unrenderable', propDeclarationProblems(), [])

    const us = getPart('hc_sr04')
    const pir = getPart('pir_motion')

    truth('the ultrasonic has a target', us.target !== undefined, 'declared', String(!!us.target))
    truth('the PIR has a target', pir.target !== undefined, 'declared', String(!!pir.target))

    /**
     * ONE DEGREE OF FREEDOM ON THE ULTRASONIC, TWO ON THE PIR, and the datasheets
     * are the reason: an HC-SR04's measuring angle is 15°, so an off-axis target
     * would answer "no echo" almost everywhere; an HC-SR501 sees a 100° cone.
     * A bearing the model does not read would be a control that moves nothing.
     */
    eq('the ultrasonic target has no bearing axis', us.target?.bearingKey, undefined)
    eq('the PIR target has one', pir.target?.bearingKey, 'bearing')
    eq('...and holds `motion` while it is dragged', pir.target?.movingKey, 'motion')

    // Both targets are measured from the front face at mid-width — up, away from
    // the pin row — so the drawn distance is the distance the datasheet means.
    near('the ultrasonic face is at mid-width', us.target?.cx ?? -1, us.width / 2, 1e-9)
    eq('...on the front edge', us.target?.cy, 0)
    near('the PIR face is at mid-width', pir.target?.cx ?? -1, pir.width / 2, 1e-9)

    /** The cone's two numbers are the HC-SR501's, not the renderer's opinion. */
    eq('the cone half-angle is the datasheet 100° cone, halved', pir.target?.cone?.halfAngleDeg, 50)
    eq('the cone reaches the datasheet 7 m', pir.target?.cone?.range, 700)
    eq('...which is one declaration, shared', HC_SR501_FIELD.HALF_ANGLE_DEG, 50)
    eq('...and so is the range', HC_SR501_FIELD.RANGE_CM, 700)

    /**
     * The field has to be somewhere the target can actually be put, and PAST it
     * — a boundary a student can never cross is a boundary they can never learn.
     */
    const distance = pir.props?.find((p) => p.key === 'distance')
    truth(
      'the PIR target can be dragged beyond its own field',
      (distance?.max ?? 0) > (pir.target?.cone?.range ?? Infinity),
      '> 700 cm',
      `${distance?.max} cm`,
    )
    const bearing = pir.props?.find((p) => p.key === 'bearing')
    truth(
      '...and swung outside it',
      (bearing?.max ?? 0) > (pir.target?.cone?.halfAngleDeg ?? Infinity),
      '> 50°',
      `${bearing?.max}°`,
    )

    /**
     * THE PANEL CONTROL DID NOT GO AWAY. Tinkercad has no inspector slider at
     * all; we deliberately keep one, because the canvas is pointer-only and a
     * keyboard user would otherwise have no way to reach these values.
     */
    for (const [type, keys] of [
      ['hc_sr04', ['distance']],
      ['pir_motion', ['motion', 'distance', 'bearing']],
    ] as const) {
      for (const key of keys) {
        const prop = getPart(type).props?.find((p) => p.key === key)
        truth(
          `${type}.${key} still has an inspector control of its own`,
          prop?.type === 'range',
          'range',
          String(prop?.type),
        )
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('B. Target geometry, by hand')
  // ════════════════════════════════════════════════════════════════════════════
  {
    const us = getPart('hc_sr04')
    const usT = us.target as TargetControl
    const usProp = us.props!.find((p) => p.key === 'distance')!

    /**
     * The ultrasonic scale is 1/3 of a unit per centimetre, so 100 cm is 33⅓
     * units straight up from the face, and 420 cm — the top of the prop — is 140.
     */
    const at100 = targetPointFor(usT, 100, 0)
    near('100 cm sits 33.33 units in front of the face', at100.y - usT.cy, -100 / 3, 1e-9)
    eq('...dead ahead, so no sideways offset', Number((at100.x - usT.cx).toFixed(9)), 0)
    near('420 cm sits 140 units out', targetPointFor(usT, 420, 0).y - usT.cy, -140, 1e-9)

    /**
     * And back the other way. A pointer 50 units in front of the face asks for
     * 50 ÷ (1/3) = 150 cm. A pointer 30 across and 40 out is 50 units away by
     * Pythagoras, so it asks for the same 150 — the distance is the RANGE to the
     * target, which is what a rangefinder measures.
     */
    eq(
      '50 units in front reads 150 cm',
      targetValuesFor(usT, usProp, undefined, usT.cx, usT.cy - 50).distance,
      150,
    )
    eq(
      '3-4-5: 30 across and 40 out also reads 150 cm',
      targetValuesFor(usT, usProp, undefined, usT.cx + 30, usT.cy - 40).distance,
      150,
    )

    /**
     * THE ENDS ARE THE PROP'S ENDS. Dragging 500 units out is 1500 cm, which the
     * datasheet's own window has no room for; the control must hold at 420 rather
     * than widen the range under the panel slider's feet.
     */
    eq(
      'dragged to 1500 cm the prop still stops at its declared 420',
      targetValuesFor(usT, usProp, undefined, usT.cx, usT.cy - 500).distance,
      420,
    )
    eq(
      'and dragged onto the face it stops at 1 cm, not 0',
      targetValuesFor(usT, usProp, undefined, usT.cx, usT.cy).distance,
      1,
    )

    const pir = getPart('pir_motion')
    const pirT = pir.target as TargetControl
    const pirD = pir.props!.find((p) => p.key === 'distance')!
    const pirB = pir.props!.find((p) => p.key === 'bearing')!

    /**
     * The PIR scale is 0.15 units per centimetre, so 300 cm is 45 units. At 20°
     * clockwise from the facing axis that is 45·sin20° = 15.391 across and
     * 45·cos20° = 42.286 out.
     */
    const at300 = targetPointFor(pirT, 300, 20)
    near('300 cm at 20° is 15.39 across', at300.x - pirT.cx, 45 * Math.sin((20 * Math.PI) / 180), 1e-9)
    near('...and 42.29 in front', at300.y - pirT.cy, -45 * Math.cos((20 * Math.PI) / 180), 1e-9)

    /** Round trip, on a point that is on both props' step grids. */
    const back = targetValuesFor(pirT, pirD, pirB, at300.x, at300.y)
    eq('and the pointer there asks for 300 cm again', back.distance, 300)
    eq('...at 20° again', back.bearing, 20)

    /** Bearing is signed: anticlockwise of the axis is negative. */
    eq(
      'a target to the left of the axis reads a negative bearing',
      targetValuesFor(pirT, pirD, pirB, pirT.cx - 45, pirT.cy).bearing,
      -90,
    )
    eq(
      '...and one dead ahead reads zero',
      targetValuesFor(pirT, pirD, pirB, pirT.cx, pirT.cy - 45).bearing,
      0,
    )

    /**
     * THE CONE RE-AIMS AND NEVER LEAVES THE FIELD.
     *
     * Dead ahead the wedge is the whole ±50° field. At 20° the axis follows, so
     * the near edge swings to 20 − 50 = −30 while the far edge would want 70 and
     * is held at the field's own 50 — the wedge narrows as it swings rather than
     * promising coverage the lens has not got. Past the edge the aim itself
     * clamps, so the wedge stops at 0…50 and the target is outside the picture,
     * which is the same instant the model stops detecting.
     */
    const cone = pirT.cone!
    eq('dead ahead the wedge is the whole field', targetConeEdges(cone, 0), {
      fromDeg: -50,
      toDeg: 50,
    })
    eq('at 20° it swings to −30…50', targetConeEdges(cone, 20), { fromDeg: -30, toDeg: 50 })
    eq('at −20° it swings to −50…30', targetConeEdges(cone, -20), { fromDeg: -50, toDeg: 30 })
    eq('at the 50° edge it is 0…50', targetConeEdges(cone, 50), { fromDeg: 0, toDeg: 50 })
    eq('at 80° it has stopped at that same edge', targetConeEdges(cone, 80), {
      fromDeg: 0,
      toDeg: 50,
    })

    /** The field's own boundary is inclusive, at both limits. */
    truth('700 cm dead ahead is inside the field', targetInField(cone, 700, 0), 'true', String(targetInField(cone, 700, 0)))
    truth('710 cm is not', !targetInField(cone, 710, 0), 'true', String(!targetInField(cone, 710, 0)))
    truth('50° at 100 cm is inside', targetInField(cone, 100, 50), 'true', String(targetInField(cone, 100, 50)))
    truth('55° at 100 cm is not', !targetInField(cone, 100, 55), 'true', String(!targetInField(cone, 100, 55)))
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('C. The drag writes the document, once per gesture')
  // ════════════════════════════════════════════════════════════════════════════
  {
    /**
     * WHY THIS GROUP EXISTS. The canvas could have held the target's position in
     * component state, which would have looked identical on screen and lost the
     * value on every recompile, every reload and every save. It writes the prop
     * instead — which is also what lets the inspector slider and the drag be two
     * views of one number.
     *
     * The gesture is replayed here through the SAME two pure functions and the
     * SAME reducer the canvas uses: `targetValuesFor` turns each pointer position
     * into a value, and `setProp` carries `transient` on every frame but the
     * first. What that flag is worth is the last assertion: twenty frames, one
     * press of undo.
     */
    const pir = getPart('pir_motion')
    const t = pir.target as TargetControl
    const prop = pir.props!.find((p) => p.key === 'distance')!
    const start: PlacedPart = {
      id: 'pir',
      type: 'pir_motion',
      x: 0,
      y: 0,
      rotation: 0,
      props: { motion: 0, distance: 300, bearing: 0 },
    }
    let state = docReducer(initialDocState, { type: 'load', doc: { parts: [start], wires: [] } })
    const dispatch = (a: DocAction) => {
      state = docReducer(state, a)
    }
    const at = () => state.doc.parts[0].props

    // Grab: movement starts. Undoable in its own right, as a button press is.
    dispatch({ type: 'setProp', id: 'pir', key: t.movingKey!, value: 1 })
    eq('grabbing the target says something is moving', at().motion, 1)

    // Twenty frames, walking the target from 45 units out (300 cm) in to 15
    // units (100 cm). Each frame writes what `targetValuesFor` read.
    let pushed = false
    for (let i = 1; i <= 20; i++) {
      const units = 45 - (30 * i) / 20
      const next = targetValuesFor(t, prop, undefined, t.cx, t.cy - units)
      dispatch({
        type: 'setProp',
        id: 'pir',
        key: t.key,
        value: next.distance,
        transient: pushed,
      })
      pushed = true
    }
    eq('twenty frames later the document holds 100 cm', at().distance, 100)

    // Release: the movement stops, which is what makes the hold time visible.
    dispatch({ type: 'setProp', id: 'pir', key: t.movingKey!, value: 0 })
    eq('letting go says the movement stopped', at().motion, 0)

    /**
     * THE WHOLE POINT OF `transient`. Three undoable things happened — the grab,
     * the drag, the release — so three presses must take the document all the way
     * back. Without the flag it would be twenty-two.
     */
    eq('the whole gesture is three undo entries, not twenty-two', state.past.length, 3)
    dispatch({ type: 'undo' })
    eq('one undo puts the movement back', at().motion, 1)
    dispatch({ type: 'undo' })
    eq('the second undoes the entire drag in one go', at().distance, 300)
    dispatch({ type: 'undo' })
    eq('the third undoes the grab', at().motion, 0)

    /**
     * AND THE DOCUMENT IS WHAT THE CANVAS DRAWS FROM. A marker at 100 cm has to
     * be painted 15 units in front of the face (100 × 0.15); a marker rendered
     * from anything else would not move when the document did.
     */
    const near100 = paint({
      parts: [{ ...start, props: { motion: 0, distance: 100, bearing: 0 } }],
      wires: [],
    })
    const far700 = paint({
      parts: [{ ...start, props: { motion: 0, distance: 700, bearing: 0 } }],
      wires: [],
    })
    near('a 100 cm target is painted 15 units out', Number(attr(near100, 'target-marker-pir', 'cy')), t.cy - 15, 1e-6)
    near('a 700 cm target is painted 105 units out', Number(attr(far700, 'target-marker-pir', 'cy')), t.cy - 105, 1e-6)

    /**
     * THE ONE LINK THE ASSERTIONS ABOVE CANNOT REACH, closed at the source level.
     *
     * Everything above runs the gesture through the two pure functions and the
     * reducer the canvas uses — but a `renderToStaticMarkup` drops every event
     * handler, so nothing here can prove the canvas CALLS them. That is precisely
     * the shape of the failure this project keeps shipping: wire bending had 71
     * passing geometry assertions over `wire-hit.ts` while the interaction that
     * would have called them was never wired up at all.
     *
     * Weaker than the differentials, and stated as such: a literal in the file is
     * not proof the line executes. It still catches the failure that actually
     * happens, which is the line not being there.
     */
    const canvas = fs.readFileSync(
      path.join(process.cwd(), 'components/simulator/CircuitCanvas.tsx'),
      'utf8',
    )
    const dragBranch = canvas.slice(canvas.indexOf('if (targetDrag) {'))
    truth('the canvas turns the pointer into values with the same function tested here',
      dragBranch.includes('targetValuesFor('), 'targetValuesFor(…)',
      dragBranch.includes('targetValuesFor(') ? 'found' : 'NOT CALLED')
    truth('...writes them to the document with setProp',
      /type: 'setProp'[\s\S]{0,300}?transient: pushed/.test(dragBranch), "setProp … transient",
      /type: 'setProp'[\s\S]{0,300}?transient: pushed/.test(dragBranch) ? 'found' : 'NOT DISPATCHED')
    truth('...raises the moving prop when the target is grabbed',
      /setMoving\(part\.id\)[\s\S]{0,400}?key: target\.movingKey/.test(canvas), 'movingKey ← 1',
      /setMoving\(part\.id\)[\s\S]{0,400}?key: target\.movingKey/.test(canvas) ? 'found' : 'NOT WRITTEN')
    truth('...and drops it again when every gesture ends',
      /if \(moving\) \{[\s\S]{0,400}?target\?\.movingKey[\s\S]{0,200}?value: 0/.test(canvas),
      'movingKey ← 0',
      /if \(moving\) \{[\s\S]{0,400}?target\?\.movingKey[\s\S]{0,200}?value: 0/.test(canvas)
        ? 'found' : 'NEVER RELEASED')
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('D. The ultrasonic readout IS what the sketch measures')
  // ════════════════════════════════════════════════════════════════════════════
  const ultrasonicHex = await build(SKETCH_ULTRASONIC)
  truth('the pulseIn sketch compiles', ultrasonicHex !== null, 'ok', ultrasonicHex ? 'ok' : 'FAILED')
  if (!ultrasonicHex) {
    report()
    return
  }
  {
    /**
     * Two targets, both inside the datasheet's 2–400 cm window, both chosen so
     * that the module's pulse is a whole number of microseconds AND divides by 58
     * exactly: 100 × 58 = 5800 µs, 250 × 58 = 14 500 µs.
     */
    const readings = [100, 250].map((cm) => {
      const snap = run(ultrasonicHex, ultrasonicDoc({ distance: cm }), 400_000)
      const html = paint(ultrasonicDoc({ distance: cm }), { us: snap.deviceStates.us })
      return {
        cm,
        state: snap.deviceStates.us,
        measuredMicros: lastSerial(snap.serial, 'us'),
        sketchCm: lastSerial(snap.serial, 'cm'),
        readout: textOf(html, 'target-readout-us') ?? '',
      }
    })

    for (const r of readings) {
      /** The module's own pulse, exactly: the datasheet's 58 µs per centimetre. */
      eq(`${r.cm} cm → the module emits ${r.cm * MICROS_PER_CM} µs of ECHO`,
        r.state.echoMicros, r.cm * MICROS_PER_CM)

      /**
       * What the SKETCH measured, on real firmware. Arduino's pulseIn() counts
       * iterations of a calibrated assembly loop rather than reading a timer, so
       * it under-reads by a fraction of a percent — a property of the Arduino
       * core, not of this simulator, and the reason this is a band rather than an
       * equality. Half a percent of 58 µs is a third of a centimetre.
       */
      near(`   and pulseIn measures that width to within 1 %`,
        r.measuredMicros, r.cm * MICROS_PER_CM, r.cm * MICROS_PER_CM * 0.01, ' µs')

      /**
       * `us / 58` is the line in the sketch, and it is INTEGER division on a
       * width that is already a fraction of a percent low — so the Serial
       * Monitor reads at most 1 % under the target and can never read over it.
       * Both halves of that are properties of the Arduino core (a calibrated
       * counting loop, and C++ truncation), not of anything here, and stating
       * the direction as well as the size is what stops this being a band wide
       * enough to hide a real error.
       */
      truth(
        `   so the student's Serial Monitor reads ${r.cm} cm to within 1 %, never over`,
        r.sketchCm <= r.cm && r.sketchCm >= Math.floor(r.cm * 0.99),
        `${Math.floor(r.cm * 0.99)}…${r.cm} cm`,
        `${r.sketchCm} cm`,
      )

      /**
       * AND THE CANVAS PAINTS THE SAME NUMBER. This is the assertion the whole
       * file is for: the label above the target is the module's report, so it is
       * the same quantity the firmware just received, in the same units.
       */
      eq(`   and the canvas paints "${r.cm} cm · ${(r.cm / 2.54).toFixed(1)} in"`,
        r.readout, `${r.cm} cm · ${(Math.round((r.cm / 2.54) * 10) / 10).toFixed(1)} in`)
      const paintedCm = Number(/^(-?[\d.]+) cm/.exec(r.readout)?.[1] ?? NaN)
      truth(
        `   the painted figure and the sketch's are the same measurement`,
        paintedCm === r.cm && r.sketchCm <= paintedCm && r.sketchCm >= Math.floor(paintedCm * 0.99),
        `painted ${r.cm}, sketch within 1 %`,
        `painted ${paintedCm}, sketch ${r.sketchCm}`,
      )
    }

    /**
     * THE DIFFERENTIAL. Moving the target moved BOTH numbers, and by the same
     * amount. A readout painted from a constant cannot move at all; one painted
     * from a stale or unrelated field cannot move in step with the firmware.
     */
    const [a, b] = readings
    eq('moving the target 100 → 250 cm moves the painted number 150',
      Number(/^(-?[\d.]+)/.exec(b.readout)![1]) - Number(/^(-?[\d.]+)/.exec(a.readout)![1]), 150)
    near('...and moves the sketch\'s number by the same 150', b.sketchCm - a.sketchCm, 150, 1, ' cm')

    /**
     * THE HONEST OUT-OF-RANGE CASE, which is where a readout wired to the
     * DOCUMENT rather than to the report comes apart. 420 cm is past the
     * datasheet's 400 cm ceiling, so the module answers with its 38 ms timeout
     * pulse and there is no distance in it at all — 37 778 µs ÷ 58 is 651, a
     * number the student must not be told is centimetres.
     */
    const far = run(ultrasonicHex, ultrasonicDoc({ distance: 420 }), 400_000)
    eq('past 400 cm the module emits its 38 ms no-echo pulse',
      far.deviceStates.us.echoMicros, NO_ECHO_MICROS)
    eq('...and says so', far.deviceStates.us.inRange, false)
    const farReadout = textOf(paint(ultrasonicDoc({ distance: 420 }), { us: far.deviceStates.us }), 'target-readout-us')
    truth('...and the canvas says "no echo" rather than a distance',
      (farReadout ?? '').includes('no echo'), 'no echo', String(farReadout))
    truth('   while the sketch is being handed the 38 ms marker, not 420 cm',
      lastSerial(far.serial, 'cm') > 600,
      '> 600 (38000/58)',
      String(lastSerial(far.serial, 'cm')))

    /**
     * AND THE NEGATIVE HALF: identical document, a report that says something
     * else, and the label follows the REPORT. Nothing but a label wired to the
     * device state can pass both this and the four assertions above.
     */
    const doc100 = ultrasonicDoc({ distance: 100 })
    const lying = textOf(
      paint(doc100, { us: { distanceCm: 250, inRange: true, powered: true, echoMicros: 14500 } }),
      'target-readout-us',
    )
    eq('a 100 cm document reporting 250 cm paints 250', lying, '250 cm · 98.4 in')
    const unrun = textOf(paint(doc100), 'target-readout-us')
    eq('...and with nothing running at all it falls back to the document', unrun, '100 cm · 39.4 in')
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('E. The PIR cone is coloured by the solved state')
  // ════════════════════════════════════════════════════════════════════════════
  const pirHex = await build(SKETCH_PIR)
  truth('the digitalRead sketch compiles', pirHex !== null, 'ok', pirHex ? 'ok' : 'FAILED')
  if (!pirHex) {
    report()
    return
  }
  {
    /**
     * THE FIELD IS SIMULATED, not merely drawn. Four circuits, identical but for
     * where the target stands, and every one of them read back off D2 by real
     * firmware. The boundary cases are the datasheet's own numbers and are
     * inclusive: 700 cm and 50° are the last places the sensor still sees you.
     */
    const inCone = run(pirHex, pirDoc({ motion: 1, distance: 300, bearing: 0 }), 400_000)
    const tooFar = run(pirHex, pirDoc({ motion: 1, distance: 900, bearing: 0 }), 400_000)
    const offAxis = run(pirHex, pirDoc({ motion: 1, distance: 300, bearing: 70 }), 400_000)
    const onEdge = run(pirHex, pirDoc({ motion: 1, distance: 700, bearing: 50 }), 400_000)

    eq('3 m dead ahead: the sketch reads OUT high', lastLine(inCone.serial), '1')
    eq('9 m — past the 7 m the sensitivity pot reaches: low', lastLine(tooFar.serial), '0')
    eq('70° — outside the 100° cone: low', lastLine(offAxis.serial), '0')
    eq('7 m at 50°, the exact corner of the field: still high', lastLine(onEdge.serial), '1')
    eq('...and the model says why it went low', tooFar.deviceStates.pir.inField, false)
    eq('...and why the corner did not', onEdge.deviceStates.pir.inField, true)

    /**
     * THE DIFFERENTIAL, and the reason this group is not just four Serial reads.
     *
     * ONE document — `motion: 1`, target at 3 m dead ahead, unchanged across all
     * three paints — rendered with three different reports. The cone's fill must
     * follow the REPORT. A cone painted from `part.props.motion` would come out
     * identical all three times, because that prop never changes here.
     */
    const doc = pirDoc({ motion: 1, distance: 300, bearing: 0 })
    const detecting = paint(doc, { pir: inCone.deviceStates.pir })
    const clear = paint(doc, { pir: { ...inCone.deviceStates.pir, motion: false } })
    const idle = paint(doc)

    truth('the cone reaches the SVG at all', has(detecting, 'target-cone-pir'), 'present',
      String(has(detecting, 'target-cone-pir')))
    const litFill = attr(detecting, 'target-cone-pir', 'fill')
    const clearFill = attr(clear, 'target-cone-pir', 'fill')
    truth('a detection paints the cone a different colour from a clear field',
      litFill !== null && litFill !== clearFill, 'two colours', `${litFill} vs ${clearFill}`)
    truth('...and it is the warmer of the two, not merely a different grey',
      litFill === '#f0b429', '#f0b429', String(litFill))
    truth('...and it is more opaque, so it reads at a glance',
      Number(attr(detecting, 'target-cone-pir', 'fill-opacity')) >
        Number(attr(clear, 'target-cone-pir', 'fill-opacity')),
      'detecting > clear',
      `${attr(detecting, 'target-cone-pir', 'fill-opacity')} vs ${attr(clear, 'target-cone-pir', 'fill-opacity')}`)

    /**
     * THE ASSERTION A PROP-DRIVEN CONE CANNOT PASS. Same document, `motion: 1`
     * still sitting in its props, and nothing running: the cone must be dark,
     * because nothing has reported a detection.
     */
    /**
     * Stated against the LIT colour and not only against the clear one. A cone
     * wired to `part.props.motion` makes "clear" and "detecting" the same
     * colour, at which point an assertion that idle merely MATCHES clear passes
     * on a broken renderer — which is exactly what happened when this was first
     * written, and the mutation that found it is the one this line now catches.
     */
    const idleFill = attr(idle, 'target-cone-pir', 'fill')
    truth('with no simulation running the same motion:1 document paints an idle cone',
      idleFill !== litFill && idleFill === clearFill, `not ${litFill}`, String(idleFill))
    eq('...and the readout says so too', textOf(idle, 'target-readout-pir'), '3 m')
    eq('...where a running detection says "motion"', textOf(detecting, 'target-readout-pir'),
      '3 m · motion')
    eq('...and a running clear field says "clear"', textOf(clear, 'target-readout-pir'), '3 m · clear')

    /**
     * THE HOLD TIME, which is the behaviour the drag-to-move-the-target control
     * exists to make visible and which nothing in the UI used to show. Movement
     * stops — the pointer is released, so `motion` goes back to 0 — and OUT stays
     * high for the datasheet's Tx before falling.
     */
    const held = new SimulationEngine(parseIntelHex(pirHex), pirDoc({ motion: 1, distance: 300, bearing: 0, hold: 2 }))
    held.run(500_000)
    eq('while the target is being moved, OUT is high', lastLine(held.snapshot().serial), '1')
    const letGo = new SimulationEngine(parseIntelHex(pirHex), pirDoc({ motion: 0, distance: 300, bearing: 0, hold: 2 }))
    letGo.run(500_000)
    eq('...and with no movement at all it never rose', lastLine(letGo.snapshot().serial), '0')

    /**
     * The cone's GEOMETRY comes from the same declaration the model gates on:
     * the wedge is drawn out to 700 cm × 0.15 = 105 units, so its arc radius is
     * 105 and no other number.
     */
    const d = attr(detecting, 'target-cone-pir', 'd') ?? ''
    const radius = /A([\d.]+) ([\d.]+)/.exec(d)
    near('the wedge is drawn to the declared 7 m', Number(radius?.[1]), 105, 1e-6)
    truth('...as a circular arc, not an ellipse', radius?.[1] === radius?.[2], 'equal radii',
      `${radius?.[1]} / ${radius?.[2]}`)
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('F. The motor wears its solved speed')
  // ════════════════════════════════════════════════════════════════════════════
  const idleHex = await build(SKETCH_IDLE)
  truth('the empty sketch compiles', idleHex !== null, 'ok', idleHex ? 'ok' : 'FAILED')
  if (!idleHex) {
    report()
    return
  }
  {
    /**
     * THE ARITHMETIC, DONE HERE, FROM THE DATASHEET.
     *
     * Unloaded the motor's terminal resistance is Vn/I0 = 6/0.07 = 85.714 Ω, so
     * 5.000 V puts 58.33 mA through it; the speed is i·(1/G − Ra)/Ke =
     * 0.058333 × 78.214 / 9.125e-4, which is 5000 rpm exactly. At half load
     * 1/G falls to 6/0.435 = 13.793 Ω, the current rises to 362.5 mA, and the
     * same line gives exactly 2500.
     *
     * The engine's answer must come out a whisker BELOW each, and for a stated
     * reason: an Uno's 5 V pin is not an ideal source, so a motor drawing tens of
     * milliamps pulls the rail down a little. 0.1 % is the band that allows for
     * that and nothing else.
     */
    // `near` and not `eq` on the last three, at a tolerance a thousand times
    // smaller than a single rpm: (6 − 0.07 × 7.5) is not representable in binary
    // and lands one ulp out, which is a fact about IEEE 754 rather than about
    // this motor. Asserting exact equality on it would be asserting the wrong
    // thing and would break on any re-association of the same arithmetic.
    eq('the datasheet locked-rotor resistance is 7.5 Ω', RA, 7.5)
    near('the back-EMF constant is 9.125e-4 V/rpm', KE, 9.125e-4, 1e-16)
    near('unloaded, 5.000 V is exactly 5000 rpm', motorRpm(0, 5), 5000, 1e-9, ' rpm')
    near('at half load, exactly 2500 rpm', motorRpm(0.5, 5), 2500, 1e-9, ' rpm')

    const free = run(idleHex, motorDoc(0), 200_000)
    const half = run(idleHex, motorDoc(50), 200_000)
    const stalled = run(idleHex, motorDoc(100), 200_000)
    const stopped = run(idleHex, motorDoc(0, { shorted: true }), 200_000)

    const painted = (doc: CircuitDoc, states: Record<string, DeviceState>): string =>
      textOf(paint(doc, states), 'motor-rpm-m') ?? ''

    near('the engine solves the unloaded motor just under 5000 rpm',
      Number(free.deviceStates.m.rpm), 5000, 5, ' rpm')
    eq('...and the case reads that number, rounded', painted(motorDoc(0), { m: free.deviceStates.m }),
      `${Math.round(Number(free.deviceStates.m.rpm))} rpm`)

    near('half load halves it, to just under 2500',
      Number(half.deviceStates.m.rpm), 2500, 5, ' rpm')
    eq('...and the case follows', painted(motorDoc(50), { m: half.deviceStates.m }),
      `${Math.round(Number(half.deviceStates.m.rpm))} rpm`)

    /**
     * THE DIFFERENTIAL: the label moved because the SPEED moved, and by half.
     * A label painted from a constant, or from the `load` prop, cannot do this.
     */
    const freeRpm = Number(/^(\d+)/.exec(painted(motorDoc(0), { m: free.deviceStates.m }))![1])
    const halfRpm = Number(/^(\d+)/.exec(painted(motorDoc(50), { m: half.deviceStates.m }))![1])
    near('doubling the load halves the painted number', freeRpm / halfRpm, 2, 0.01)

    /**
     * ZERO WHEN STOPPED, both ways it can happen, and they are not the same
     * thing. At full load the terminal resistance falls to 6/0.8 = 7.5 Ω, which
     * is exactly Ra — so (1/G − Ra) is zero and the shaft cannot turn however
     * much current flows. That is a stall: 0 rpm with two thirds of an amp in the
     * winding. Both terminals on ground is the other zero: no current at all.
     */
    eq('at full load 1/G falls to the locked-rotor 7.5 Ω', motorOhms(1), RA)
    eq('...so the shaft speed is zero at any current', motorRpm(1, 5), 0)
    eq('the engine agrees the motor is stalled', stalled.deviceStates.m.stalled, true)
    truth('...with real current in the winding',
      Number(stalled.deviceStates.m.amps) > 0.6, '> 0.6 A',
      `${Number(stalled.deviceStates.m.amps).toFixed(3)} A`)
    eq('...and the case reads 0 rpm', painted(motorDoc(100), { m: stalled.deviceStates.m }), '0 rpm')

    eq('a motor with both leads on ground draws nothing', Number(stopped.deviceStates.m.amps), 0)
    eq('...and reads 0 rpm too', painted(motorDoc(0, { shorted: true }), { m: stopped.deviceStates.m }), '0 rpm')

    /**
     * BUT THE TWO ZEROES ARE TOLD APART, in the tooltip, because "stopped" and
     * "stalled and cooking" are the two things a student most needs separated.
     */
    const stallHtml = paint(motorDoc(100), { m: stalled.deviceStates.m })
    truth('a stall says so on hover', /<title>0 rpm — stalled[^<]*<\/title>/.test(stallHtml),
      'stalled', String(/<title>([^<]*)<\/title>/.exec(stallHtml.slice(stallHtml.indexOf('motor-readout-m')))?.[1]))
    const stopHtml = paint(motorDoc(0, { shorted: true }), { m: stopped.deviceStates.m })
    truth('...and a motor that is merely stopped does not', stopHtml.includes('0 rpm — stopped'),
      'stopped', String(/0 rpm — (\w+)/.exec(stopHtml)?.[1]))

    /**
     * AND THE NEGATIVE HALF, the same one the display has: no simulation, no
     * reading. A motor permanently wearing `0 rpm` would be claiming a
     * measurement it has not taken, and an un-run circuit is not a stopped motor.
     */
    truth('an un-run motor wears no label at all', !has(paint(motorDoc(0)), 'motor-rpm-m'),
      'absent', String(has(paint(motorDoc(0)), 'motor-rpm-m')))
    truth('...while a run one does', has(paint(motorDoc(0), { m: free.deviceStates.m }), 'motor-rpm-m'),
      'present', String(has(paint(motorDoc(0), { m: free.deviceStates.m }), 'motor-rpm-m')))
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('G. Rotation, which is where a cone gets drawn backwards')
  // ════════════════════════════════════════════════════════════════════════════
  {
    /**
     * A target and a cone are drawn INSIDE the part's own transform group, so a
     * rotated module carries them round exactly as it carries its pins. That is
     * the whole mechanism, and this is what proves it: the part-local geometry is
     * identical at every rotation — same `d`, same `cy` — while `pinPosition`
     * and `partTransform` move the group.
     *
     * A cone that pointed the wrong way after a rotate would be worse than no
     * cone, so both directions are checked: the drawn wedge must not change, and
     * the group carrying it must.
     */
    const props = { motion: 1, distance: 300, bearing: 20 }
    const states = { pir: { motion: true, powered: true, distanceCm: 300, bearingDeg: 20 } }
    const upright = paint(pirDoc(props), states)
    const turned = paint(
      { ...pirDoc(props), parts: pirDoc(props).parts.map((p) => (p.id === 'pir' ? { ...p, rotation: 90 as const } : p)) },
      states,
    )

    eq('the wedge is the same shape whichever way the module faces',
      attr(turned, 'target-cone-pir', 'd'), attr(upright, 'target-cone-pir', 'd'))
    eq('...and the marker sits in the same place on the part',
      attr(turned, 'target-marker-pir', 'cy'), attr(upright, 'target-marker-pir', 'cy'))

    const transformOf = (html: string) =>
      new RegExp(`<g transform="([^"]*)" data-testid="target-layer-pir"`).exec(html)?.[1]
    truth('while the group carrying them really did turn',
      transformOf(turned) !== transformOf(upright) && (transformOf(turned) ?? '').includes('rotate(90'),
      'rotate(90 …)', String(transformOf(turned)))

    /**
     * THE READOUT IS COUNTER-ROTATED, though, and on purpose: a distance printed
     * upside down on a module dropped at 180° is a distance nobody can read.
     */
    const upsideDown = paint(
      { ...pirDoc(props), parts: pirDoc(props).parts.map((p) => (p.id === 'pir' ? { ...p, rotation: 180 as const } : p)) },
      states,
    )
    truth('the readout counter-rotates so it always reads left to right',
      /rotate\(-180 /.test(upsideDown), 'rotate(-180 …)',
      String(/rotate\((-?\d+) [\d.]+ [-\d.]+\)"><text[^>]*target-readout-pir/.exec(upsideDown)?.[1]))
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('H. A selected wire looks selected')
  // ════════════════════════════════════════════════════════════════════════════
  {
    /**
     * Delete became the only way to remove a wire when double-click started
     * adding a bend instead — which makes "which wire is Delete about to take"
     * a question the canvas now has to answer visibly. wirehit.test.ts §6b
     * proves the key is wired to the removal; this proves the student can SEE
     * what it is aimed at, which is the half that turns a keystroke from a
     * gamble into a decision.
     *
     * The differential is the same document painted twice. Nothing about the
     * wires changes between the two renders except which id is handed in.
     */
    const doc = ultrasonicDoc({ distance: 100 })
    const none = paint(doc, undefined, null)
    const picked = paint(doc, undefined, 'w3')

    truth('with nothing selected no wire is outlined',
      !none.includes('data-testid="wire-selected-'), 'no outline',
      none.includes('data-testid="wire-selected-') ? 'OUTLINED ANYWAY' : 'none')
    truth('selecting a wire outlines exactly that one',
      has(picked, 'wire-selected-w3'), 'wire-selected-w3', String(has(picked, 'wire-selected-w3')))
    eq('...and only that one, out of the four on the board',
      (picked.match(/data-testid="wire-selected-/g) ?? []).length, 1)

    /**
     * THE OUTLINE IS AN OUTLINE, NOT A RECOLOUR. A wire's colour carries
     * meaning — black is ground and red is supply, by `wireColorFor` — so a
     * selection that repainted the core would be lying about the circuit for as
     * long as it was lit. The core must be untouched and the marching dashes
     * drawn over the halo instead.
     */
    eq('the wire keeps its own colour while selected',
      attr(picked, 'wire-core-w3', 'stroke'), attr(none, 'wire-core-w3', 'stroke'))
    eq('...and the outline is the accent, dashed', attr(picked, 'wire-selected-w3', 'stroke-dasharray'), '5 4')

    /**
     * And it brings out the bend handles, so the wire a student is about to
     * delete is also the wire they can immediately reshape instead.
     */
    truth('a selected wire shows its halo', has(picked, 'wire-halo-w3'), 'halo', String(has(picked, 'wire-halo-w3')))
    truth('...where an unselected one does not', !has(none, 'wire-halo-w3'), 'no halo',
      String(!has(none, 'wire-halo-w3')))
  }

  report()
}

function report(): void {
  const nameW = Math.min(72, Math.max(30, ...rows.map((r) => r.name.length)))
  const expW = Math.min(26, Math.max(10, ...rows.map((r) => r.expected.length)))
  const actW = Math.min(30, Math.max(10, ...rows.map((r) => r.actual.length)))

  let lastGroup = ''
  for (const r of rows) {
    if (r.group !== lastGroup) {
      lastGroup = r.group
      console.log('\n' + r.group)
      console.log('-'.repeat(Math.min(200, nameW + expW + actW + 14)))
    }
    console.log(
      `${r.name.slice(0, nameW).padEnd(nameW)}  ${r.expected.slice(0, expW).padEnd(expW)}  ` +
        `${r.actual.slice(0, actW).padEnd(actW)}  ` +
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
}

void main()
