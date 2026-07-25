/**
 * Drawing a wire: click a pin, click to lay down turns, click a pin to finish.
 *
 * This is Tinkercad's creation gesture, and it is the one the owner described:
 * "First click to start a connection, then successive clicks to introduce turns
 * and points in the empty space, then these turns continue until a click
 * connects it to the other end device." The bends are made WHILE routing, not
 * added to a finished wire afterwards — which is the part we had wrong. We
 * shipped drag-a-pin-to-a-pin to create, and drag-the-body to bend, and no
 * amount of polish on those two makes the gesture a student was taught the
 * shape of.
 *
 * Press-and-drag still creates a wire, because it costs nothing to keep and a
 * student who tries it should not be told no. The two are told apart the way
 * every editor tells them apart: the opening press becomes a DRAG the moment it
 * travels past the slop, and stays a CLICK if it is released before that.
 *
 * A state machine rather than a tangle of handlers, and in the model layer
 * rather than in the canvas, because the last bug here was a lifecycle bug —
 * `endGesture` cleared the draft on every pointerup, so a click-to-start died a
 * few milliseconds after it began — and a lifecycle bug is exactly what a
 * component full of pointer handlers hides and a reducer cannot.
 *
 * Nothing here is electrical. The points it collects become a wire's
 * `waypoints`, which compile() never reads.
 */

import { samePin, snap, type PinRef, type Point } from './document'

/**
 * How far the opening press may wander before it is a drag rather than a click.
 *
 * In WORLD units. It has to be small enough that a deliberate drag is
 * recognised immediately and large enough that a shaky click on a touchscreen
 * is not promoted into one — a click that is misread as a drag ends as an
 * abandoned wire, which is the failure a student cannot diagnose.
 */
export const DRAG_SLOP = 4

/** A wire being drawn: where it started, the turns so far, and the live end. */
export interface WireDraft {
  from: PinRef
  /** Turns committed so far, snapped to the grid, in order. */
  points: Point[]
  /** The live end — the cursor — in world units. */
  x: number
  y: number
  /** Where the opening press landed. The click/drag discriminator. */
  startX: number
  startY: number
  /** The opening press has travelled past the slop, so this is a drag. */
  moved: boolean
  /**
   * We are still inside the opening press — the button has not come up yet.
   *
   * This is the flag that separates the two gestures, and it is why the draft
   * survives a pointerup: once it is false the draft is in ROUTING mode and
   * belongs to the clicks that follow, not to the press that started it.
   */
  pressing: boolean
}

/** What a step did: the draft that follows it, and a wire to create if it ended. */
export interface DraftStep {
  draft: WireDraft | null
  commit?: { from: PinRef; to: PinRef; waypoints: Point[] }
}

/** Open a draft at `ref`, with the pointer down on it. */
export function beginDraft(from: PinRef, at: Point): WireDraft {
  return {
    from,
    points: [],
    x: at.x,
    y: at.y,
    startX: at.x,
    startY: at.y,
    moved: false,
    pressing: true,
  }
}

/**
 * A press landed on a pin.
 *
 * Three outcomes, in the order they are tested:
 *  - nothing in flight → this pin starts a wire;
 *  - the pin the wire started from → CANCEL, which is the escape hatch a
 *    student finds without being told: click back where you began;
 *  - any other pin → the wire is finished here, with its turns.
 *
 * Finishing on the PRESS rather than the release is deliberate: a click is a
 * press and a release, and making the release do it would mean a student who
 * finished a wire and held the button for a moment saw nothing happen.
 */
export function pressPin(draft: WireDraft | null, ref: PinRef, at: Point): DraftStep {
  if (!draft) return { draft: beginDraft(ref, at) }
  if (samePin(draft.from, ref)) return { draft: null }
  return { draft: null, commit: { from: draft.from, to: ref, waypoints: draft.points } }
}

/** The pointer moved: the live end follows it, and the slop is watched. */
export function trackCursor(draft: WireDraft, at: Point): WireDraft {
  const moved =
    draft.moved ||
    (draft.pressing && Math.hypot(at.x - draft.startX, at.y - draft.startY) > DRAG_SLOP)
  if (draft.x === at.x && draft.y === at.y && moved === draft.moved) return draft
  return { ...draft, x: at.x, y: at.y, moved }
}

/**
 * The opening press came up. This is where the two gestures part company.
 *
 * A press that travelled is a DRAG: it ends here, either on the pin under it or
 * abandoned. A press that did not is a CLICK: the draft stays alive and the
 * wire now follows the cursor until the next click, which is the whole point.
 *
 * Releases after the opening press are not this function's business — in
 * routing mode the press already did the work — and it says so by returning the
 * draft untouched.
 */
export function releasePress(draft: WireDraft, overPin?: PinRef): DraftStep {
  if (!draft.pressing) return { draft }
  if (!draft.moved) return { draft: { ...draft, pressing: false } }
  if (overPin && !samePin(draft.from, overPin)) {
    return { draft: null, commit: { from: draft.from, to: overPin, waypoints: draft.points } }
  }
  // A dragged wire let go over empty space is abandoned rather than left
  // dangling — the behaviour this editor already had, kept.
  return { draft: null }
}

/**
 * A press landed on the canvas rather than on a pin: lay down a turn.
 *
 * Snapped, like every other bend point, so a routed wire lands on the same grid
 * the parts do. A point on top of the previous one is dropped: it would be a
 * corner with no turn in it, and `wirePath` would have to discard it anyway.
 */
export function pressCanvas(draft: WireDraft, at: Point): WireDraft {
  const point = { x: snap(at.x), y: snap(at.y) }
  const last = draft.points[draft.points.length - 1]
  if (last && last.x === point.x && last.y === point.y) return draft
  return { ...draft, points: [...draft.points, point], x: at.x, y: at.y }
}
