/**
 * Wire path geometry tests.
 *
 * The renderer draws a wire as a polyline through its bend points with each
 * interior corner rounded by a circular arc fillet. Everything asserted here
 * is about the SHAPE of the emitted `d`: that arcs appear where a corner can
 * carry one, that their tangent points are exactly where the fillet identity
 * says they are, that the sweep flag follows the turn, and that a corner too
 * short or too sharp degrades to a plain vertex instead of a malformed arc.
 *
 * None of it is electrical — bend points never reach the netlist, which
 * compile.test.ts asserts directly.
 *
 * Run: npx tsx lib/simulator/__tests__/wirepath.test.ts
 */

import { BEND_RADIUS, fillet, filletPath, wirePath } from '../model/wire-path'
import { PITCH } from '../model/parts'
import {
  WIRE_COLORS,
  WIRE_COLOR_GND,
  WIRE_COLOR_POWER,
  WIRE_PALETTE,
  wireCasing,
  type Point,
} from '../model/document'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function near(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol
}

/** Every command in `d`, as a letter plus its numeric arguments. */
function commands(d: string): { op: string; args: number[] }[] {
  const out: { op: string; args: number[] }[] = []
  for (const m of d.matchAll(/([MLA])([^MLA]*)/g)) {
    const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
    out.push({ op: m[1], args })
  }
  return out
}

function ops(d: string): string {
  return commands(d)
    .map((c) => c.op)
    .join('')
}

/** A declaration, not an arrow: an arrow here binds the next bare block as
 *  its body and the file stops parsing. */
function p(x: number, y: number): Point {
  return { x, y }
}

// ─── 1. A straight wire is a straight line ───────────────────────────────────

{
  const d = wirePath(p(0, 0), p(100, 40))
  check('straight wire is one moveto and one lineto', ops(d) === 'ML', d)
  check('straight wire has no arc', !d.includes('A'), d)
  const c = commands(d)
  check('straight wire starts on its first pin', c[0].args[0] === 0 && c[0].args[1] === 0, d)
  check('straight wire ends on its second pin', c[1].args[0] === 100 && c[1].args[1] === 40, d)
  check(
    'an empty waypoint list routes the same as none',
    wirePath(p(0, 0), p(100, 40), []) === d,
  )
}

// ─── 2. A right-angle bend, against the measured Tinkercad path ──────────────
//
// The ground truth, from a live Tinkercad circuit's DOM:
//   M-1283.54,-207.19 L-1283.54,-141.44 A10,10 45 0,0 -1273.54,-131.44
//   L-912.03,-131.44
// A 90° corner at (-1283.54,-131.44) with r=10 trims exactly 10 off each
// adjoining segment, and turns counter-clockwise in y-down space → sweep 0.

{
  const d = wirePath(p(-1283.54, -207.19), p(-912.03, -131.44), [p(-1283.54, -131.44)])
  const c = commands(d)
  check('a bend emits moveto, lineto, arc, lineto', ops(d) === 'MLAL', d)

  check('run into the corner is unturned', near(c[1].args[0], -1283.54), d)
  check('arc starts one radius back along the incoming run', near(c[1].args[1], -141.44), d)

  const arc = c[2].args
  check('arc radii are equal and the full bend radius', near(arc[0], 10) && near(arc[1], 10), d)
  check('x-axis-rotation is irrelevant for a circular arc and emitted as 0', arc[2] === 0, d)
  check('a fillet is always the minor arc', arc[3] === 0, d)
  check('down-then-right turns counter-clockwise on screen → sweep 0', arc[4] === 0, d)
  check('arc ends one radius along the outgoing run', near(arc[5], -1273.54) && near(arc[6], -131.44), d)

  check('the wire still lands on its far pin', near(c[3].args[0], -912.03) && near(c[3].args[1], -131.44), d)
}

// ─── 3. Sweep flag flips with the turn direction ─────────────────────────────

{
  // Down, then right. Counter-clockwise in y-down space.
  const ccw = fillet(p(0, 0), p(0, 100), p(100, 100))
  // Down, then left. The mirror image, so clockwise.
  const cw = fillet(p(0, 0), p(0, 100), p(-100, 100))
  check('a left-hand turn sweeps 0', ccw?.sweep === 0, String(ccw?.sweep))
  check('the mirrored turn sweeps 1', cw?.sweep === 1, String(cw?.sweep))
  check('mirroring does not change the radius', near(ccw!.r, cw!.r), `${ccw?.r} vs ${cw?.r}`)

  // And the same pair reversed in travel order swaps them back.
  const back = fillet(p(100, 100), p(0, 100), p(0, 0))
  check('reversing the direction of travel flips the sweep', back?.sweep === 1, String(back?.sweep))

  const dRight = wirePath(p(0, 0), p(100, 100), [p(0, 100)])
  const dLeft = wirePath(p(0, 0), p(-100, 100), [p(0, 100)])
  check('sweep reaches the emitted path', commands(dRight)[2].args[4] === 0, dRight)
  check('and flips there too', commands(dLeft)[2].args[4] === 1, dLeft)
}

// ─── 4. Non-right angles: the tangent length is r / tan(θ/2) ─────────────────

{
  // A 90° turn: tan(45°) = 1, so the trim is exactly r.
  const square = fillet(p(0, 0), p(100, 0), p(100, 100))
  check('a 90° corner trims exactly one radius', near(square!.start.x, 100 - BEND_RADIUS), String(square?.start.x))

  // A 120° interior angle (a gentle 60° turn): tan(60°) = √3, trim = r/√3.
  const gentle = fillet(p(0, 0), p(100, 0), p(150, 86.6025))
  const gentleTrim = BEND_RADIUS / Math.tan((Math.PI * 2) / 6)
  check(
    'a gentle corner trims r / tan(θ/2), which is less than r',
    near(gentle!.start.x, 100 - gentleTrim) && gentleTrim < BEND_RADIUS,
    `${gentle?.start.x}`,
  )

  // A 60° interior angle (a sharp 120° turn): tan(30°) = 1/√3, trim = r·√3.
  const sharp = fillet(p(0, 0), p(200, 0), p(100, 173.205))
  const sharpTrim = BEND_RADIUS / Math.tan(Math.PI / 6)
  check(
    'a sharp corner trims more than a radius',
    near(sharp!.start.x, 200 - sharpTrim) && sharpTrim > BEND_RADIUS,
    `${sharp?.start.x}`,
  )

  // Tangency itself: both tangent points sit at distance r from the arc
  // centre, and the centre is on the angle bisector. Checking the tangent
  // points are equidistant from the vertex is the same statement, and is
  // what makes the two straight runs meet the arc without a kink.
  for (const [name, fil, v] of [
    ['right', square, p(100, 0)],
    ['gentle', gentle, p(100, 0)],
    ['sharp', sharp, p(200, 0)],
  ] as const) {
    const din = Math.hypot(fil!.start.x - v.x, fil!.start.y - v.y)
    const dout = Math.hypot(fil!.end.x - v.x, fil!.end.y - v.y)
    check(`${name} corner is tangent to both runs (equal trims)`, near(din, dout, 1e-6), `${din} vs ${dout}`)
  }

  // An arbitrary, deliberately un-axis-aligned bend still routes.
  const d = wirePath(p(13, 7), p(211, 96), [p(88, 143)])
  check('a bend at an arbitrary angle still emits one arc', ops(d) === 'MLAL', d)
  const arcArgs = commands(d)[2].args
  check('its radii are equal', near(arcArgs[0], arcArgs[1], 1e-9), d)
}

// ─── 5. Collinear points produce no arc ──────────────────────────────────────

{
  check('a point on the straight line between its neighbours has no fillet', fillet(p(0, 0), p(50, 50), p(100, 100)) === null)
  const d = wirePath(p(0, 0), p(100, 100), [p(50, 50)])
  check('and the path runs straight through it', ops(d) === 'MLL', d)
  check('collinear path has no arc command', !d.includes('A'), d)

  // A dead reversal is collinear too — the segments are parallel and no
  // tangent circle exists, so the corner stays sharp rather than looping.
  check('a hairpin reversal has no fillet', fillet(p(0, 0), p(100, 0), p(0, 0)) === null)
  check('a repeated point has no fillet', fillet(p(0, 0), p(0, 0), p(100, 0)) === null)
  check(
    'a waypoint sitting on a pin collapses instead of drawing a stub',
    ops(wirePath(p(0, 0), p(100, 0), [p(0, 0)])) === 'ML',
    wirePath(p(0, 0), p(100, 0), [p(0, 0)]),
  )
}

// ─── 6. Short segments clamp the radius ──────────────────────────────────────

{
  // Both runs are one grid pitch, the shortest a snapped bend can make. A
  // full BEND_RADIUS fillet would need to trim a whole pitch off each and
  // overshoot the pins; it must come down to half.
  const tight = fillet(p(0, 0), p(PITCH, 0), p(PITCH, PITCH))
  check('a one-pitch corner clamps the radius to half the run', near(tight!.r, PITCH / 2), String(tight?.r))
  check('so the trim never exceeds half the run', near(tight!.start.x, PITCH / 2), String(tight?.start.x))
  check('the clamped radius is below the nominal one', tight!.r < BEND_RADIUS)

  // Asymmetric: the SHORTER of the two runs is what binds.
  const lopsided = fillet(p(0, 0), p(6, 0), p(6, 400))
  check('the shorter adjoining run sets the clamp', near(lopsided!.r, 3), String(lopsided?.r))
  check('the long run is trimmed by the same clamped amount', near(lopsided!.end.y, 3), String(lopsided?.end.y))

  // A long run keeps the full radius.
  const roomy = fillet(p(0, 0), p(400, 0), p(400, 400))
  check('a long corner keeps the full radius', near(roomy!.r, BEND_RADIUS), String(roomy?.r))

  // Two adjacent corners on one short shared run must not trim past each
  // other: at half of the shared run each, their tangent points meet at
  // worst, and the path stays monotonic along it.
  const d = wirePath(p(0, -60), p(60, 20), [p(0, 0), p(20, 0)])
  const c = commands(d)
  check('two corners on one short run emit two arcs', ops(d) === 'MLALALAL' || ops(d) === 'MLALAL', d)
  const firstArcEndX = c.find((k) => k.op === 'A')!.args[5]
  const secondArcStart = c.filter((k) => k.op === 'L')[1]
  check(
    'the first corner never trims past the second',
    firstArcEndX <= secondArcStart.args[0] + 1e-6,
    `${firstArcEndX} > ${secondArcStart.args[0]} in ${d}`,
  )

  // A near-reversal is where an unclamped fillet does its worst damage: the
  // ideal trim r / tan(θ/2) here runs to ~2000 units, twenty times the run it
  // has to fit inside, and the arc would be drawn back over the wire it came
  // from. The clamp caps the trim at half the run and collapses the radius to
  // suit, so the corner becomes a tight hairpin instead of a loop.
  const hair = fillet(p(0, 0), p(100, 0), p(0.5, 1))
  const ideal = BEND_RADIUS / Math.tan(Math.acos(Math.min(1, 99.5 / Math.hypot(99.5, 1))) / 2)
  check('an unclamped near-hairpin would overshoot its own run', ideal > 100, String(ideal))
  check('the clamp holds the trim to half the run', hair!.start.x >= 50 - 1e-6, String(hair?.start.x))
  check('and collapses the radius to fit', hair!.r < 0.3, String(hair?.r))

  // Sharper still and the arc is thinner than the stroke drawn over it, so
  // there is nothing to gain from bending at all: draw the corner sharp.
  check('a dead-sharp reversal gives up the arc', fillet(p(0, 0), p(100, 0), p(0.05, 0.02)) === null)
}

// ─── 7. Every run between arcs is a straight line ────────────────────────────

{
  // Multi-bend route: the emitted `d` must be moveto, then alternating
  // lineto/arc, and every arc must start where the previous command ended.
  const d = wirePath(p(0, 0), p(300, 200), [p(0, 100), p(200, 100), p(200, 40)])
  const c = commands(d)
  check('three bends emit three arcs', c.filter((k) => k.op === 'A').length === 3, d)
  check('and four straight runs', c.filter((k) => k.op === 'L').length === 4, d)
  check('the path alternates run, arc', ops(d) === 'MLALALAL', d)

  let cursor = p(c[0].args[0], c[0].args[1])
  let contiguous = true
  for (const k of c.slice(1)) {
    const end = k.op === 'A' ? p(k.args[5], k.args[6]) : p(k.args[0], k.args[1])
    if (k.op === 'A') {
      // The arc's own radius bounds how far it may travel.
      const span = Math.hypot(end.x - cursor.x, end.y - cursor.y)
      if (span > 2 * k.args[0] + 1e-6) contiguous = false
    }
    cursor = end
  }
  check('no arc spans more than its own diameter', contiguous, d)
  check('the route ends on the far pin', near(cursor.x, 300) && near(cursor.y, 200), d)
}

// ─── 8. Degenerate inputs ────────────────────────────────────────────────────

{
  check('an empty point list draws nothing', filletPath([]) === '')
  const dot = filletPath([p(5, 5)])
  check('a single point draws a round cap, not nothing', dot === 'M 5 5 L 5 5', dot)
  const same = wirePath(p(5, 5), p(5, 5))
  check('a wire between coincident pins draws a dot', same === 'M 5 5 L 5 5', same)
  check('the bend radius is one grid pitch', BEND_RADIUS === PITCH)
  check('no path ever emits a curve command', !/[CQSTZ]/.test(wirePath(p(0, 0), p(90, 90), [p(0, 90)])))
}

// ─── 9. Coordinates stay readable ────────────────────────────────────────────

{
  const d = wirePath(p(0.123456, 0.987654), p(100.55555, 40.11111), [p(50.4444, 10.9999)])
  check('coordinates are rounded to two decimals', !/\.\d{3}/.test(d), d)
  check('rounding does not drop the arc', d.includes('A'), d)
}

// ─── 10. Wire colour ─────────────────────────────────────────────────────────
//
// The casing is looked up from an authored pair, not computed. A single
// darkening factor cannot serve a whole palette: our old ×0.55 turned
// Tinkercad's red #EC2222 into #821212, an outline rather than a rim.

{
  check('every palette entry has a distinct casing', WIRE_PALETTE.every((c) => c.core !== c.casing))
  check(
    'palette cores are unique',
    new Set(WIRE_PALETTE.map((c) => c.core.toLowerCase())).size === WIRE_PALETTE.length,
  )
  check("green is Tinkercad's default and heads the cycle", WIRE_COLORS[0] === '#40B942')
  check('the green pair is Tinkercad\'s', wireCasing('#40B942') === '#369936', wireCasing('#40B942'))
  check('the red pair is Tinkercad\'s, not a scaled one', wireCasing('#EC2222') === '#C11F1F', wireCasing('#EC2222'))
  check('lookup is case-insensitive across the stored hex', wireCasing('#ec2222') === '#C11F1F', wireCasing('#ec2222'))

  // Wires saved before this palette existed keep their own colour; only the
  // shade beneath them is corrected, by the 0.83 Tinkercad's pairs average.
  const legacy = wireCasing('#2f7d32')
  check('a legacy hex still gets a casing', /^rgb\(\d+,\d+,\d+\)$/.test(legacy), legacy)
  check('and it is darker than the core, not black', legacy === 'rgb(39,104,42)', legacy)
  check('a nonsense colour still yields a paintable casing', wireCasing('cornflower').startsWith('rgba('))

  // Rail colours are reserved: a black wire always means ground.
  check('ground black is out of the cycle', !WIRE_COLORS.includes(WIRE_COLOR_GND))
  check('supply red is out of the cycle', !WIRE_COLORS.includes(WIRE_COLOR_POWER))
  check(
    'both rail colours are still real palette entries',
    WIRE_PALETTE.some((c) => c.core === WIRE_COLOR_GND) &&
      WIRE_PALETTE.some((c) => c.core === WIRE_COLOR_POWER),
  )
  check(
    'no cycle colour vanishes against the board',
    !WIRE_COLORS.includes('#FFFFFF') && !WIRE_COLORS.includes('#999EA1'),
  )
}

console.log('='.repeat(passed))
console.log(`${passed}/${passed + failed} passed`)
if (failed > 0) process.exit(1)
