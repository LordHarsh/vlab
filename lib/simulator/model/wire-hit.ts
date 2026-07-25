/**
 * Which wire a pointer is on.
 *
 * SVG hit-testing hands an event to the TOPMOST shape. A student aims at the
 * NEAREST one. Everywhere a wire crosses a part those two disagree, and the
 * canvas used to take the browser's answer — so this module exists to take the
 * student's instead.
 *
 * What that cost, measured on the shipped `ultrasonic-pir` starter before this
 * existed: pins are painted after wires (deliberately, so a pin buried under a
 * wire stays clickable) and a breadboard's tie points carry invisible 5-unit
 * targets on a 10-unit pitch, which is about 78% areal cover. Sampling 59
 * points along each wire, one was reachable at 27 of them, one at NONE — its
 * whole length lay under either a tie point or a second wire drawn after it.
 * A press that missed went to the pin, which quietly began a wire draft that
 * was thrown away on release. The student pressed a wire, dragged, and watched
 * nothing happen. That is the bug this file is the fix for.
 *
 * Nothing here is electrical, and nothing here mutates. Bend points are
 * cosmetic: compile() unions a wire's `from`/`to` pins and never looks at its
 * geometry, so no answer this module gives can change what is connected to
 * what — it only decides which wire a gesture belongs to.
 */

import type { Point } from './document'

/** One wire's drawn route, with its endpoints already resolved to world units. */
export interface WireRoute {
  id: string
  a: Point
  b: Point
  waypoints?: Point[]
}

/** A pin that may outrank a wire lying across it. */
export interface PinTarget {
  at: Point
  /**
   * Breadboard tie points. They yield to a wire ENTIRELY — see `pinOutranks`.
   */
  subtle?: boolean
}

/** All three catchments, in WORLD units, resolved by the caller for the zoom. */
export interface GrabTolerance {
  /** Half-width of a wire's grab band. */
  body: number
  /** Radius that counts as landing on a bend handle. */
  handle: number
  /** Radius within which a non-subtle pin keeps priority over a wire. */
  pinCore: number
}

/**
 * What the pointer is on.
 *
 * `index` means different things for the two kinds, and both are the slot the
 * caller needs: for a handle it is the waypoint being dragged, and for a body
 * it is the segment that was grabbed — which, since segment i of
 * [from, ...waypoints, to] runs from waypoint i-1 to waypoint i, is also the
 * slot a new bend belongs in.
 */
export interface WireTarget {
  wireId: string
  index: number
  kind: 'body' | 'handle'
}

/** Distance from `p` to the segment `a`–`b`. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

/**
 * Whether a pin's core covers `p`, in which case no wire may claim it.
 *
 * A pin's invisible target is generous — 7 to 12 units, because a 0.1in hole is
 * ~4 px at 1x and cannot be aimed at. That generosity is a FALLBACK for when
 * nothing more specific is under the pointer; only the pin's core outranks a
 * wire. The core is sized to cover the drawn dot with a margin and to sit well
 * inside the smallest target, so a wire ending on a header pin never makes that
 * pin unreachable — fanning several wires off one 5V pin still works.
 *
 * Subtle pins are skipped entirely, and that asymmetry is the point. At 0.1in
 * pitch a 4-unit core would black out 8 of every 10 units of a wire lying along
 * a strip, which is the defect rather than the fix. A tie point is one of five
 * interchangeable holes in its strip, so the one with a wire across it is never
 * the only way into that net; a header pin or a component lead is unique and
 * keeps its core.
 */
export function pinOutranks(
  pins: readonly PinTarget[],
  p: Point,
  pinCore: number,
): boolean {
  for (const pin of pins) {
    if (pin.subtle) continue
    // Cheap box reject before the hypot — this runs over every pin on the board.
    if (Math.abs(p.x - pin.at.x) > pinCore || Math.abs(p.y - pin.at.y) > pinCore) continue
    if (Math.hypot(p.x - pin.at.x, p.y - pin.at.y) <= pinCore) return true
  }
  return false
}

/**
 * The wire target under `p`: the nearest bend handle, else the nearest wire
 * body, else nothing. Paint order is not consulted.
 *
 * Handles outrank bodies whatever the distances, because a handle is something
 * the student deliberately put there and pressing it must move that bend rather
 * than mint a second one beside it.
 *
 * Among bodies the nearest centreline wins. That is the other half of the fix:
 * the two power leads in the shipped starters run 2.57 units apart at their
 * midpoints, well inside a 3.5-unit band, so the one drawn later was taking
 * every press aimed at the one drawn first — a bend appeared, on the wrong
 * wire, and the wire the student was pointing at was byte-identical afterwards.
 *
 * Ties go to the earlier route, so a document containing two exactly collinear
 * wires still resolves deterministically instead of always favouring whichever
 * happens to paint last.
 */
export function wireTargetAt(
  routes: readonly WireRoute[],
  p: Point,
  tol: GrabTolerance,
): WireTarget | null {
  let best: WireTarget | null = null
  let bestD = Infinity

  for (const route of routes) {
    const pts = route.waypoints ?? []
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(p.x - pts[i].x, p.y - pts[i].y)
      if (d <= tol.handle && d < bestD) {
        bestD = d
        best = { wireId: route.id, index: i, kind: 'handle' }
      }
    }
  }
  if (best) return best

  for (const route of routes) {
    const pts = [route.a, ...(route.waypoints ?? []), route.b]
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSegment(p, pts[i], pts[i + 1])
      if (d <= tol.body && d < bestD) {
        bestD = d
        best = { wireId: route.id, index: i, kind: 'body' }
      }
    }
  }
  return best
}

/**
 * The whole rule in one call: a pin core beats a wire, and otherwise the
 * nearest wire wins.
 *
 * This is what the canvas asks on every press, before any other handler gets a
 * look. `null` means "not a wire" and hands the press back to whatever else
 * wants it — a pin, a part, or the background pan.
 */
export function resolveGrab(
  routes: readonly WireRoute[],
  pins: readonly PinTarget[],
  p: Point,
  tol: GrabTolerance,
): WireTarget | null {
  if (pinOutranks(pins, p, tol.pinCore)) return null
  return wireTargetAt(routes, p, tol)
}
