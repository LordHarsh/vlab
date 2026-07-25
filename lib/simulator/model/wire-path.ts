/**
 * The drawn route of a wire.
 *
 * A wire is a POLYLINE through its bend points at whatever angle those points
 * imply — no elbows are invented, no axis is forced — with every interior
 * corner replaced by a circular arc fillet tangent to both adjoining segments.
 * That is the shape Tinkercad draws, measured from a live circuit's DOM:
 *
 *   M-1283.54,-207.19 L-1283.54,-141.44
 *   A10,10 45 0,0 -1273.54,-131.44
 *   L-912.03,-131.44
 *
 * Read that sample back through the maths below: the corner is at
 * (-1283.54,-131.44), the arc starts 10 units back along the incoming segment
 * and ends 10 units along the outgoing one, and its sweep flag is 0 because
 * heading down and turning to head right is a counter-clockwise turn in
 * SVG's y-down space. Both fall out of `fillet()` exactly.
 *
 * Nothing here is electrical. Bend points are cosmetic: the netlist unions a
 * wire's `from`/`to` pins and never looks at its geometry.
 */

import type { Point } from './document'
import { PITCH } from './parts'

/**
 * Corner radius, in canvas units.
 *
 * One grid pitch. Bend points are snapped with `snap()`, so a pitch is the
 * shortest run a wire can have and the smallest offset a corner can express —
 * rounding by exactly that reads as a bent lead rather than a fillet applied
 * on top of one. It also lands on Tinkercad's literal r=10, which is the same
 * number in a coordinate system where a wire crossing a breadboard measures a
 * few hundred units, as ours does.
 *
 * It is only a ceiling: `fillet()` shrinks it whenever a segment is too short
 * or a turn too sharp to carry it.
 */
export const BEND_RADIUS = PITCH

/**
 * Fraction of the shorter adjoining segment a single corner may consume.
 *
 * A half, and not a hair more. Two consecutive corners eat into the segment
 * between them from opposite ends; at a half each they can meet but never
 * cross, so the tangent points stay ordered along the path and no arc is ever
 * emitted backwards.
 */
const MAX_TRIM = 0.5

/** Below this the arc is thinner than the stroke — draw the sharp corner. */
const MIN_RADIUS = 0.2

/** Two decimals is under a tenth of a pixel and keeps the DOM readable. */
const f = (n: number): string => String(Math.round(n * 100) / 100)

export interface Fillet {
  /** Tangent point on the incoming segment. */
  start: Point
  /** Tangent point on the outgoing segment. */
  end: Point
  /** Radius actually used, after clamping. */
  r: number
  /** SVG sweep flag: 1 clockwise on screen, 0 counter-clockwise. */
  sweep: 0 | 1
}

/**
 * The arc that rounds the corner `prev → v → next`, or null for a corner that
 * cannot take one.
 *
 * The tangent length is exact, not approximated: for an interior angle θ
 * between the two segments, a circle of radius r tangent to both touches them
 * at distance `r / tan(θ/2)` from the vertex. So the trim GROWS as the turn
 * sharpens, and vanishes as the corner straightens out.
 *
 * Clamping runs the identity backwards. Given the longest trim the two
 * segments can afford, `t·tan(θ/2)` is the largest radius that fits — which
 * is what makes both degenerate directions safe. A hairpin (θ → 0) would
 * otherwise demand an unbounded trim and draw an arc looping back over the
 * wire; here the radius collapses instead and the corner stays sharp. A
 * nearly straight run (θ → π) needs a trim near zero, so a long-radius arc
 * costs it nothing.
 *
 * Returns null when the points are collinear — including a dead reversal,
 * where the two segments are parallel and no tangent circle exists.
 */
export function fillet(prev: Point, v: Point, next: Point, radius = BEND_RADIUS): Fillet | null {
  const inLen = Math.hypot(v.x - prev.x, v.y - prev.y)
  const outLen = Math.hypot(next.x - v.x, next.y - v.y)
  if (inLen === 0 || outLen === 0) return null

  // Unit direction ALONG each segment, in travel order.
  const ix = (v.x - prev.x) / inLen
  const iy = (v.y - prev.y) / inLen
  const ox = (next.x - v.x) / outLen
  const oy = (next.y - v.y) / outLen

  // sin of the turn. Its sign is the turn direction, which is the sweep flag;
  // its magnitude vanishing means collinear, in either direction.
  const cross = ix * oy - iy * ox
  if (Math.abs(cross) < 1e-9) return null

  // Interior angle at the vertex: between the two rays pointing AWAY from it,
  // so a straight run is π and a hairpin is 0.
  const cos = Math.min(1, Math.max(-1, -(ix * ox + iy * oy)))
  const half = Math.tan(Math.acos(cos) / 2)

  const maxTrim = MAX_TRIM * Math.min(inLen, outLen)
  const r = Math.min(radius, maxTrim * half)
  if (r < MIN_RADIUS) return null
  const trim = r / half

  return {
    start: { x: v.x - ix * trim, y: v.y - iy * trim },
    end: { x: v.x + ox * trim, y: v.y + oy * trim },
    r,
    sweep: cross > 0 ? 1 : 0,
  }
}

/** Drop points that repeat the one before them; they cannot form a corner. */
function compact(pts: Point[]): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    out.push(p)
  }
  return out
}

/**
 * A polyline through `pts` with every interior corner filleted.
 *
 * Straight `L` runs at whatever angle the points imply, one `A` per corner
 * that can carry one, and a plain `L` through any corner that cannot.
 */
export function filletPath(pts: Point[], radius = BEND_RADIUS): string {
  const p = compact(pts)
  if (p.length === 0) return ''
  // A wire whose ends coincide still deserves a mark: a lone moveto draws
  // nothing at all, while a zero-length lineto draws the round cap.
  if (p.length === 1) return `M ${f(p[0].x)} ${f(p[0].y)} L ${f(p[0].x)} ${f(p[0].y)}`

  let d = `M ${f(p[0].x)} ${f(p[0].y)}`
  for (let i = 1; i < p.length - 1; i++) {
    const arc = fillet(p[i - 1], p[i], p[i + 1], radius)
    if (!arc) {
      d += ` L ${f(p[i].x)} ${f(p[i].y)}`
      continue
    }
    // The x-axis-rotation is meaningless for a circular arc (rx === ry);
    // Tinkercad emits 45 there, we emit 0. The large-arc flag is always 0:
    // a fillet is by construction the minor arc.
    d += ` L ${f(arc.start.x)} ${f(arc.start.y)}`
    d += ` A ${f(arc.r)} ${f(arc.r)} 0 0 ${arc.sweep} ${f(arc.end.x)} ${f(arc.end.y)}`
  }
  const last = p[p.length - 1]
  return `${d} L ${f(last.x)} ${f(last.y)}`
}

/**
 * The route of one wire, from pin to pin, through its bend points.
 *
 * A wire with no bend points is the straight line between its pins — no sag,
 * no curve. Documents authored before bend points existed have no
 * `waypoints`, and render as exactly that.
 */
export function wirePath(a: Point, b: Point, waypoints?: Point[], radius = BEND_RADIUS): string {
  return filletPath(waypoints && waypoints.length > 0 ? [a, ...waypoints, b] : [a, b], radius)
}
