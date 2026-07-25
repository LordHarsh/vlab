'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { DeviceState } from '@/lib/simulator/behavioural'
import {
  LCD_GLYPH_COLS,
  LCD_GLYPH_ROWS,
  lcdGlyph,
  unpackLcdRow,
} from '@/lib/simulator/lcd-font'
import {
  DC_MOTOR_READOUT,
  LCD1602_SCREEN,
  PITCH,
  getPart,
  knobAngleFor,
  knobValueFor,
  ledBodyFill,
  ledColour,
  ledGlowFill,
  sliderPointFor,
  sliderValueFor,
  targetConeEdges,
  targetPointFor,
  targetValuesFor,
  type KnobControl,
  type MomentaryControl,
  type PartDefinition,
  type PinGeometry,
  type PropSpec,
  type SliderControl,
  type TargetControl,
} from '@/lib/simulator/model/parts'
import {
  WIRE_COLORS,
  WIRE_COLOR_GND,
  WIRE_COLOR_POWER,
  newId,
  pinPosition,
  snap,
  wireCasing,
  type CircuitDoc,
  type DocAction,
  type DocWire,
  type PinRef,
  type PlacedPart,
  type Point,
} from '@/lib/simulator/model/document'
import { wirePath } from '@/lib/simulator/model/wire-path'
import {
  resolveGrab,
  type GrabTolerance,
  type PinTarget,
  type WireRoute,
  type WireTarget,
} from '@/lib/simulator/model/wire-hit'
import {
  DRAG_SLOP,
  pressCanvas,
  pressPin,
  releasePress,
  trackCursor,
  type WireDraft,
} from '@/lib/simulator/model/wire-draft'

const ACCENT = '#1477d1'

interface Props {
  doc: CircuitDoc
  dispatch: (a: DocAction) => void
  /** partId → 0..1 LED brightness, from the running simulation. */
  ledBrightness?: Map<string, number>
  /**
   * partId → whatever that part's behavioural model last reported.
   *
   * Only the display reads this today, and it reads it because it has to: a
   * character LCD's whole output IS its reported state, so a canvas that could
   * not see the snapshot would be drawing an empty screen next to a Checks panel
   * that knew exactly what was written on it.
   */
  deviceStates?: Record<string, DeviceState>
  /** pinKey → net id, for highlighting connected nets. */
  netOf?: Map<string, number>
  selected: string | null
  onSelect: (id: string | null) => void
  /**
   * The selected WIRE, which is a separate id from the selected part.
   *
   * Two ids rather than one tagged union because they are answered by different
   * questions — `doc.parts.find` against `doc.wires.find` — and because the
   * inspector, the rotate key and the copy buffer all only ever mean a part. The
   * rule that at most one of the two is set lives in CircuitEditor, in ONE place:
   * two things highlighted at once with Delete guessing between them is worse
   * than either.
   */
  selectedWire?: string | null
  /**
   * Report a click on a wire, or `null` where the canvas knows the selection is
   * gone (the wire was deleted under it).
   */
  onSelectWire?: (id: string | null) => void
}

interface Drag {
  kind: 'part'
  id: string
  offsetX: number
  offsetY: number
}

/**
 * A pointer gesture turning a knob on a part's artwork.
 *
 * Held in state rather than a ref (unlike `WireGesture`) because the knob draws
 * itself differently while it is being turned, and the value it writes is
 * derived from the pointer's absolute position each frame rather than from a
 * delta — so there is no stale-closure hazard to avoid.
 */
interface KnobDrag {
  partId: string
  knob: KnobControl
  prop: PropSpec
  /** Knob centre in WORLD units, resolved once at pointerdown. */
  cx: number
  cy: number
  /** The part's own rotation, subtracted so a rotated pot still tracks. */
  rotation: number
  /** Set once this gesture has landed its one undo entry. */
  pushed: boolean
}

/**
 * A pointer gesture dragging a handle along a track on a part's artwork.
 *
 * The same shape as `KnobDrag` and for the same reasons — held in state because
 * the handle draws itself differently while it is moving, and the value comes
 * from the pointer's absolute position rather than an accumulated delta.
 *
 * What differs is the frame: a knob resolves ONE world point (its centre) at
 * pointerdown and works in offsets from it, but a track has two endpoints and a
 * direction, so the pointer is taken all the way back into PART-LOCAL units
 * instead. `ox`/`oy` is the part's origin in world units and `rotation` undoes
 * its turn, which together are the inverse of `partTransform`.
 */
interface SliderDrag {
  partId: string
  slider: SliderControl
  prop: PropSpec
  /** The part's origin in WORLD units, resolved once at pointerdown. */
  ox: number
  oy: number
  /** Half the part's bounding box — `partTransform`'s rotation pivot. */
  px: number
  py: number
  rotation: number
  /** Set once this gesture has landed its one undo entry. */
  pushed: boolean
}

/**
 * A pointer gesture moving a sensor's target about in front of it.
 *
 * The same frame as `SliderDrag`, and for the same reason: the pointer has to
 * come all the way back into PART-LOCAL units before `targetValuesFor` can
 * measure a distance and a bearing from the sensor's face, and doing that in
 * world units would only work for an unrotated part. `ox`/`oy` is the part's
 * origin in world units and `rotation` undoes its turn, which together are the
 * inverse of `partTransform`.
 *
 * Two props move at once here where the slider moves one, so `pushed` guards
 * both: the FIRST write of the gesture — whichever of the two it turns out to be
 * — carries the undo entry and everything after it rides on that one.
 */
interface TargetDrag {
  partId: string
  target: TargetControl
  prop: PropSpec
  /** The bearing's prop, on a target with two degrees of freedom. */
  bearingProp?: PropSpec
  /** The part's origin in WORLD units, resolved once at pointerdown. */
  ox: number
  oy: number
  /** Half the part's bounding box — `partTransform`'s rotation pivot. */
  px: number
  py: number
  rotation: number
  /** Set once this gesture has landed its one undo entry. */
  pushed: boolean
}


/**
 * A pointer gesture that is shaping a wire.
 *
 * Held in a ref rather than state: it is read and written inside pointermove,
 * where a stale closure over a state value would compare against the position
 * from a frame ago.
 */
interface WireGesture {
  wireId: string
  /** Slot in the wire's waypoint list this gesture drives. */
  index: number
  /** 'body' grabbed the wire itself — the bend is born on the first move. */
  kind: 'body' | 'handle'
  /** Where the pointer went down, world units. The click/drag discriminator. */
  startX: number
  startY: number
  moved: boolean
  /** Set once this gesture has landed its one undo entry. */
  pushed: boolean
  /** The pointer the canvas captured for this gesture, so it can release it. */
  pointerId: number
}

// DRAG_SLOP — how far a press may wander before it is a drag rather than a
// click — is imported from wire-draft.ts, so the two gestures that have to tell
// those apart (drawing a wire, bending one) cannot drift to different numbers.

/**
 * Blue halo, darker casing, coloured core, invisible grab band — bottom to top.
 *
 * Every number is Tinkercad's, taken from its shipped `drawBendableWire` and
 * `BreadboardWire.prototype.draw` (WIRE_RENDERING_SPEC.md §3, §7). They
 * transfer one-for-one because our units and theirs are the same size: their
 * corner radius is 10 and so is our grid pitch.
 *
 * A 1.8 core inside a 2.5 casing leaves the casing showing as a 0.35-unit rim
 * on each side — a keyline, not the 1.2-unit dark halo our old 2.6-in-5 drew.
 * That restraint is most of why their wires look clean and ours did not.
 */
const WIRE_CORE = 1.8
const WIRE_CASING = 2.5

/**
 * Hover, selection and net highlighting all draw the same soft blue glow
 * UNDER the wire, and never touch the wire's own colour. The old highlight
 * repainted the core blue, which lied about the wire at the exact moment a
 * student was trying to trace it.
 */
const WIRE_HALO = 5
const WIRE_HALO_COLOR = '#3b8ed7'
const WIRE_HALO_OPACITY = 0.5

/**
 * Width of the invisible band that takes the pointer.
 *
 * Tinkercad uses 4.5 plus a 2-unit select margin. Ours is wider because this
 * audience is phone-first and an accessibility pass already flagged small
 * touch targets — a 1.8-unit stroke is not a target on a finger-driven screen.
 * But 7 is the ceiling, not a free parameter: the band reaches 3.5 units to
 * each side, so two wires running parallel one 10-unit pitch apart still have
 * a clear 3 units between their bands and neither can steal the other's grab.
 * The previous 9 overlapped the neighbouring row.
 */
const WIRE_HIT = 7

/**
 * The grab band's minimum half-width in SCREEN pixels, whatever the zoom.
 *
 * WIRE_HIT is in world units, so it shrinks with the canvas: at the fit floor
 * of 0.45x a 7-unit band is 3.2 px wide and cannot be hit by a finger. The
 * world-space tolerance is therefore floored at this many pixels' worth, which
 * changes nothing at 1x or above and only widens the band where it had already
 * become unusable. It is safe to widen because the resolver below picks the
 * NEAREST wire rather than the topmost, so overlapping tolerances no longer
 * mean one wire stealing another's grab.
 */
const WIRE_GRAB_PX = 4

/**
 * How close to a bend handle counts as grabbing it. The handle draws at r=5.
 *
 * Floored in SCREEN pixels for the same reason the grab band is, and it earns
 * that floor twice over: at 0.73x — the zoom the editor opens a starter at — a
 * 6-unit radius is a 4-px target, and a double-click that misses a handle by
 * 4 px does not remove the bend, it removes the WHOLE WIRE. Those two outcomes
 * are nothing like each other in cost, so the handle's catchment has to be big
 * enough that a near miss lands on the forgiving one. Measured, not guessed: an
 * automated double-click aimed at a handle landed 11 units away and destroyed
 * the wire.
 */
const WAYPOINT_HIT = 6
const WAYPOINT_GRAB_PX = 8

/**
 * How close to a pin's centre the pin keeps priority over a wire lying across it.
 *
 * THIS IS THE NUMBER THE WHOLE FIX TURNS ON, so it is worth saying what it
 * balances. Pins are painted after wires — deliberately, so a pin buried under
 * a wire is still clickable — and SVG hit-testing takes the TOPMOST shape, not
 * the nearest. The result was that a pin's generous invisible target (7–12
 * units) swallowed every press on any wire crossing it: measured on the dev
 * editor's own starter, one wire was reachable on 27 of 59 sampled points and
 * another on none at all. The press went to the pin, which quietly started a
 * new wire draft that was thrown away on release — so the student pressed a
 * wire, dragged, and saw nothing happen.
 *
 * So a pin's generous target is now a FALLBACK that applies when nothing more
 * specific is under the pointer, and only its core outranks a wire. Four units
 * covers the drawn dot (r=2.8) with a margin, and is comfortably inside the
 * smallest pin target (7), so a wire ending on a header pin never makes that
 * pin unreachable — fanning several wires off one 5V pin still works.
 *
 * Breadboard tie points (`subtle`) yield to a wire ENTIRELY, with no core:
 * at 0.1in pitch a 4-unit core would black out 8 of every 10 units of a wire
 * lying along a strip, and a tie point is one of five interchangeable holes in
 * its strip — the one with a wire across it is never the only way into that
 * net. A header pin or a component lead is unique and keeps its core.
 */
const PIN_CORE = 4

/**
 * The view used for one frame, before the fit lands and for an empty document.
 *
 * The historic literal, kept exactly: a blank board is two parts near the origin
 * and there is nothing to fit to, so this is still the right answer for it.
 */
const DEFAULT_VIEW = { x: 40, y: 30, z: 1.1 }

/** Breathing room around a fitted document, in SCREEN pixels. */
const FIT_PADDING = 24

/**
 * Zoom bounds for the initial fit.
 *
 * The ceiling is 1.1 — the historic zoom — because fitting UP is not wanted: a
 * two-part blank board would otherwise open at 4x with an Uno filling the
 * screen. The floor is 0.45 rather than the wheel's 0.3 because below about
 * 0.45 a 0.1-inch pin is under 4 px and cannot be aimed at, so a document too
 * big to fit is better left slightly cropped and pannable than shown whole and
 * unusable.
 */
const FIT_MAX_Z = 1.1
const FIT_MIN_Z = 0.45

/**
 * The bounding box of everything in the document, in world units.
 *
 * Parts only, not wires: a wire's waypoints are always between two pins, so the
 * parts' boxes already contain them. Returns null for an empty document, which
 * is what tells the caller there is nothing to fit to.
 */
function docBounds(doc: CircuitDoc): { x: number; y: number; w: number; h: number } | null {
  if (doc.parts.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const part of doc.parts) {
    const def = getPart(part.type)
    /**
     * The ROTATED box, not the declared one. A rotated part still occupies its
     * own bounding box about its centre — `partTransform` rotates about
     * (width/2, height/2) — so a 90°-turned breadboard is 170 wide and 325 tall
     * where its declaration says the opposite, and fitting to the declaration
     * would crop exactly the parts a student turned to make room.
     */
    const turned = Math.abs(part.rotation % 180) === 90
    const w = turned ? def.height : def.width
    const h = turned ? def.width : def.height
    const cx = part.x + def.width / 2
    const cy = part.y + def.height / 2
    x0 = Math.min(x0, cx - w / 2)
    y0 = Math.min(y0, cy - h / 2)
    x1 = Math.max(x1, cx + w / 2)
    y1 = Math.max(y1, cy + h / 2)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Pan/zoom state, plus the identity of the document it was fitted to.
 *
 * `view: null` means "never fitted". `fitted` is a fingerprint of the parts the
 * current view was framed around — see the `fit` case for what it is FOR.
 */
type ViewState = { view: { x: number; y: number; z: number } | null; fitted: string }

/**
 * Which parts a view was fitted to, as a comparable string.
 *
 * IDs only, and sorted: moving a part, drawing a wire or turning a knob must
 * not read as a different document, because refitting under a student mid-edit
 * is the thing this fingerprint exists to prevent.
 */
function partSignature(doc: CircuitDoc): string {
  return doc.parts.map((p) => p.id).sort().join(',')
}

/**
 * Whether every part is fully inside the viewport at this view.
 *
 * THIS IS THE ACTUAL RULE, and it took two goes to get right. The first version
 * refitted only when the document was "a different circuit", judged by whether
 * it shared any part id with the old one — which never fired, because every
 * starter contains a breadboard called `bb`. The second temptation is a
 * proportion-of-parts-changed heuristic, which is a number nobody can defend.
 *
 * So: refit exactly when something the student is supposed to see is off the
 * screen. That is the defect in one sentence, it needs no threshold, and it has
 * the right behaviour in every case — loading a starter refits, adding a part
 * that lands out of view refits, and an edit that leaves everything visible
 * (which is all of them, since a drag cannot move a part off-screen without the
 * student watching it go) does not move the canvas at all.
 */
function allVisible(
  doc: CircuitDoc,
  view: { x: number; y: number; z: number },
  width: number,
  height: number,
): boolean {
  const b = docBounds(doc)
  if (!b) return true
  const left = b.x * view.z + view.x
  const top = b.y * view.z + view.y
  return left >= 0 && top >= 0 && left + b.w * view.z <= width && top + b.h * view.z <= height
}

type ViewAction =
  /** First paint, once the canvas has a size. Ignored if a view already exists. */
  | { type: 'fit'; doc: CircuitDoc; width: number; height: number }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; factor: number; cx: number; cy: number }

/**
 * A REDUCER rather than a `useState` setter, for one concrete reason: the fit
 * has to happen in a layout effect (it needs the measured canvas, and it must
 * land before the browser paints or the student sees the un-fitted view flash),
 * and `dispatch` is the only way to move state from an effect without the
 * cascading re-render that react-hooks/set-state-in-effect correctly rejects.
 * The document beside it is already a reducer for exactly the same reason.
 *
 * The "only fit once" guard lives HERE, in the `fit` case, rather than in the
 * effect — so the effect can dispatch unconditionally and there is exactly one
 * place that decides whether an existing view may be replaced. It may not: a
 * student who has panned somewhere deliberately must never have the canvas
 * yanked back under them, and `doc` changes on every wire they draw.
 */
function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'fit': {
      /**
       * Fit on first paint, and again whenever the set of parts has changed and
       * some part is no longer on screen. See allVisible() for why that is the
       * rule rather than "the document was replaced".
       */
      const sig = partSignature(action.doc)
      if (
        state.view !== null &&
        (sig === state.fitted || allVisible(action.doc, state.view, action.width, action.height))
      ) {
        // Keep the view. Record the signature anyway, so the next document is
        // compared against what is actually on screen rather than against a
        // stale one.
        return sig === state.fitted ? state : { ...state, fitted: sig }
      }
      return {
        view: fitView(action.doc, action.width, action.height),
        fitted: partSignature(action.doc),
      }
    }
    case 'pan': {
      const cur = state.view ?? DEFAULT_VIEW
      return { ...state, view: { ...cur, x: cur.x + action.dx, y: cur.y + action.dy } }
    }
    case 'zoom': {
      const cur = state.view ?? DEFAULT_VIEW
      const z = Math.min(4, Math.max(0.3, cur.z * action.factor))
      // Keep the point under the cursor fixed while zooming.
      return {
        ...state,
        view: {
          z,
          x: action.cx - ((action.cx - cur.x) * z) / cur.z,
          y: action.cy - ((action.cy - cur.y) * z) / cur.z,
        },
      }
    }
  }
}

/**
 * The view that frames the whole document inside a canvas of this size.
 *
 * Falls back to the historic fixed view when there is nothing to fit to, which
 * is the right answer for a blank board rather than a special case.
 */
function fitView(doc: CircuitDoc, width: number, height: number): { x: number; y: number; z: number } {
  const b = docBounds(doc)
  if (!b || b.w <= 0 || b.h <= 0) return DEFAULT_VIEW
  const z = Math.min(
    FIT_MAX_Z,
    Math.max(
      FIT_MIN_Z,
      Math.min((width - FIT_PADDING * 2) / b.w, (height - FIT_PADDING * 2) / b.h),
    ),
  )
  // Centre what fits. When the document is bigger than the viewport at the zoom
  // floor this puts the overflow equally on both sides rather than all of it off
  // one edge, which is the kinder half to have to pan across.
  return { x: (width - b.w * z) / 2 - b.x * z, y: (height - b.h * z) / 2 - b.y * z, z }
}

export function CircuitCanvas({
  doc,
  dispatch,
  ledBrightness,
  deviceStates,
  netOf,
  selected,
  onSelect,
  selectedWire,
  onSelectWire,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  /**
   * The view, which starts UNSET and is fitted to the document on first paint.
   *
   * It used to be the literal `{ x: 40, y: 30, z: 1.1 }` — a view that happens
   * to frame experiment 01 and silently crops everything laid out below it. A
   * QA sweep measured parts off-screen on open in six experiments
   * (ultrasonic-pir, pir-alarm, motor-control, home-automation, health-monitoring
   * and smart-traffic), and in every one the missing parts were the COMPONENT
   * TRAY: the unwired components the student has to reach for. Opening a lab and
   * not being able to see the parts you are told to wire is the worst possible
   * first impression, and there is nothing on screen to suggest scrolling down.
   */
  const [viewState, dispatchView] = useReducer(viewReducer, { view: null, fitted: '' })
  /**
   * What the readers below use. The fallback covers the single frame between
   * mount and the layout effect, so nothing ever renders at the origin.
   */
  const v = viewState.view ?? DEFAULT_VIEW
  const [drag, setDrag] = useState<Drag | null>(null)
  const [wire, setWire] = useState<WireDraft | null>(null)
  const [hoverNet, setHoverNet] = useState<number | null>(null)
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null)
  const gesture = useRef<WireGesture | null>(null)
  /** Which wire a gesture is on, purely so its handles stay visible. */
  const [shaping, setShaping] = useState<string | null>(null)
  /**
   * Which wire the pointer is over, resolved by PROXIMITY here rather than by
   * each wire's own pointerenter.
   *
   * It used to live in `Wire`, so that moving over one wire did not re-render
   * the other twenty. That was cheaper and wrong: boundary events go to the
   * topmost shape, so a wire crossing a breadboard never received a
   * pointerenter at all — the pins above it did — and neither its halo nor its
   * bend handles ever appeared. Handles a student cannot see are handles that
   * do not exist. This state changes only when the pointer crosses onto or off
   * a wire, not on every frame, so the cost is a re-render per transition.
   */
  const [hoverWire, setHoverWire] = useState<string | null>(null)
  const [knobDrag, setKnobDrag] = useState<KnobDrag | null>(null)
  const [sliderDrag, setSliderDrag] = useState<SliderDrag | null>(null)
  const [targetDrag, setTargetDrag] = useState<TargetDrag | null>(null)
  /** The part whose momentary control is being held down, if any. */
  const [holding, setHolding] = useState<string | null>(null)
  /**
   * The part whose target is being moved, if any — the PIR's `motion`.
   *
   * Separate from `holding` rather than folded into it because the two are
   * released from different declarations (`momentary.key` against
   * `target.movingKey`), and one part could legitimately have both.
   */
  const [moving, setMoving] = useState<string | null>(null)

  /**
   * Frame the whole document the first time the canvas has a size.
   *
   * A LAYOUT effect, not an ordinary one: it runs before the browser paints, so
   * the un-fitted view is never visible. An ordinary effect would paint the old
   * fixed view for one frame and then jump.
   *
   * Dispatched unconditionally — the reducer's `fit` case is the one place that
   * decides whether an existing view may be replaced, so this cannot disagree
   * with it.
   */
  useLayoutEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    dispatchView({ type: 'fit', doc, width: rect.width, height: rect.height })
  }, [doc])

  /**
   * Escape abandons a wire being routed.
   *
   * A half-drawn wire a student cannot put down is worse than no bends at all,
   * and click-routing has no natural "let go" the way a drag does — so there
   * has to be a key, and Escape is the one everybody tries first.
   *
   * CAPTURE phase, and it stops the event when it consumes it. The fullscreen
   * gate also listens for Escape on `window` to leave its maximised mode, and a
   * student cancelling a wire must not be thrown out of the editor at the same
   * time. A capture listener on `window` runs before that bubble listener, so
   * stopping propagation there is what keeps the two apart — but ONLY when
   * there is a draft to cancel, so Escape still leaves fullscreen otherwise.
   */
  useEffect(() => {
    if (!wire) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setWire(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [wire])

  /** Client coords → world coords. All interaction maths happens in world space. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - v.x) / v.z,
        y: (clientY - rect.top - v.y) / v.z,
      }
    },
    [v],
  )

  const partById = useMemo(() => new Map(doc.parts.map((p) => [p.id, p])), [doc.parts])

  /** from/to endpoints of every drawable wire, resolved once per render. */
  const routes = useMemo(() => {
    const out: { wire: DocWire; a: Point; b: Point }[] = []
    for (const w of doc.wires) {
      const pa = partById.get(w.from.partId)
      const pb = partById.get(w.to.partId)
      if (!pa || !pb) continue
      const a = pinPosition(pa, w.from.pinId)
      const b = pinPosition(pb, w.to.pinId)
      if (!a || !b) continue
      out.push({ wire: w, a, b })
    }
    return out
  }, [doc.wires, partById])

  // ─── Hit resolution ─────────────────────────────────────────────────────────
  //
  // ONE PLACE decides what a pointer is on. Every other candidate handler in
  // this file — the pin's, the part's, the background pan — runs only if this
  // declines, because it is wired to the svg's CAPTURE phase and stops the
  // event when it claims one. That inversion is the fix: SVG hit-testing hands
  // an event to the topmost shape, but a student aims at the NEAREST one, and
  // the two disagree everywhere a wire crosses a part.

  /**
   * The three catchments in world units at the current zoom.
   *
   * The zoom is folded in HERE and not inside the rule, so `wire-hit.ts` never
   * has to know what a pixel is.
   */
  const tolerance: GrabTolerance = useMemo(
    () => ({
      body: Math.max(WIRE_HIT / 2, WIRE_GRAB_PX / v.z),
      handle: Math.max(WAYPOINT_HIT, WAYPOINT_GRAB_PX / v.z),
      pinCore: PIN_CORE,
    }),
    [v.z],
  )

  /** Every wire's route, in the shape the rule wants. */
  const hitRoutes = useMemo<WireRoute[]>(
    () => routes.map(({ wire: w, a, b }) => ({ id: w.id, a, b, waypoints: w.waypoints })),
    [routes],
  )

  /**
   * Every pin on the board, in world units.
   *
   * Built without `pinPosition`, deliberately: that resolves a pin by id with a
   * linear scan, which on a breadboard's 300-odd tie points would be quadratic
   * and this list is rebuilt on every frame of a part drag. Walking `def.pins`
   * once and rotating each in place is the same arithmetic, linear.
   */
  const pinTargets = useMemo<PinTarget[]>(() => {
    const out: PinTarget[] = []
    for (const part of doc.parts) {
      const def = getPart(part.type)
      const { width: w, height: h } = def
      for (const pin of def.pins) {
        let { x, y } = pin
        switch (part.rotation) {
          case 90:
            ;[x, y] = [h - y, x]
            break
          case 180:
            ;[x, y] = [w - x, h - y]
            break
          case 270:
            ;[x, y] = [y, w - x]
            break
        }
        out.push({ at: { x: part.x + x, y: part.y + y }, subtle: pin.subtle })
      }
    }
    return out
  }, [doc.parts])

  /** The whole rule, in one place: a pin core beats a wire, else nearest wins. */
  const grabAt = useCallback(
    (p: Point): WireTarget | null => resolveGrab(hitRoutes, pinTargets, p, tolerance),
    [hitRoutes, pinTargets, tolerance],
  )

  /**
   * Every sensor target marker on the board, as a world-space circle.
   *
   * Needed because a target floats OUT IN FRONT of its part, over ground the
   * wiring is free to cross, and the canvas's capture-phase handler claims any
   * press within grab range of a wire before a child ever sees it. Without this
   * a jumper draped past an ultrasonic module would make its target undraggable
   * — the press would bend the wire instead — and the student would have no way
   * to tell why.
   */
  const targetMarkers = useMemo(() => {
    const out: { at: Point; r: number }[] = []
    for (const part of doc.parts) {
      const def = getPart(part.type)
      const t = def.target
      const prop = t ? def.props?.find((p) => p.key === t.key) : undefined
      if (!t || !prop) continue
      const bearingProp = t.bearingKey ? def.props?.find((p) => p.key === t.bearingKey) : undefined
      const at = targetPointFor(
        t,
        Number(part.props[t.key] ?? prop.default ?? 0),
        t.bearingKey && bearingProp
          ? Number(part.props[t.bearingKey] ?? bearingProp.default ?? 0)
          : 0,
      )
      out.push({ at: localToWorld(part, def, at.x, at.y), r: t.r })
    }
    return out
  }, [doc.parts])

  /** Is this press on a sensor target? Then it belongs to the target, not a wire. */
  const onTargetMarker = useCallback(
    (p: Point): boolean =>
      targetMarkers.some((m) => Math.hypot(p.x - m.at.x, p.y - m.at.y) <= m.r),
    [targetMarkers],
  )

  // ─── Pointer handling ───────────────────────────────────────────────────────

  function onPointerMove(e: React.PointerEvent) {
    const w = toWorld(e.clientX, e.clientY)

    /**
     * Turning a knob outranks everything else: the gesture began on the knob,
     * so nothing else can legitimately claim these moves.
     *
     * The value comes from the pointer's ABSOLUTE angle about the shaft rather
     * than from an accumulated delta, which is what makes it feel like a real
     * knob — the tick ends up pointing at the finger, and a drag that leaves the
     * knob and comes back does not have to retrace its path.
     */
    if (knobDrag) {
      const dx = w.x - knobDrag.cx
      const dy = w.y - knobDrag.cy
      // Undo the PART's rotation, so a pot dropped sideways still follows the
      // pointer instead of tracking 90° out.
      const t = (-knobDrag.rotation * Math.PI) / 180
      const lx = dx * Math.cos(t) - dy * Math.sin(t)
      const ly = dx * Math.sin(t) + dy * Math.cos(t)
      const next = knobValueFor(knobDrag.knob, knobDrag.prop, lx, ly)

      const current = Number(
        partById.get(knobDrag.partId)?.props[knobDrag.knob.key] ?? knobDrag.prop.default ?? 0,
      )
      // A frame that lands on the value we already hold is dropped, so a shaky
      // pointer inside one step neither re-renders nor burns the undo entry.
      if (next === current) return

      dispatch({
        type: 'setProp',
        id: knobDrag.partId,
        key: knobDrag.knob.key,
        value: next,
        transient: knobDrag.pushed,
      })
      if (!knobDrag.pushed) setKnobDrag({ ...knobDrag, pushed: true })
      return
    }

    /**
     * Dragging a handle along a track, and it outranks everything below for the
     * same reason turning a knob does.
     *
     * The pointer is taken all the way back into PART-LOCAL units — undo the
     * translate, undo the rotation about the bounding box's centre — because a
     * track has a direction and `sliderValueFor` projects onto it. Doing the
     * projection in world units would work only for an unrotated part.
     */
    if (sliderDrag) {
      const t = (-sliderDrag.rotation * Math.PI) / 180
      const dx = w.x - sliderDrag.ox - sliderDrag.px
      const dy = w.y - sliderDrag.oy - sliderDrag.py
      const lx = dx * Math.cos(t) - dy * Math.sin(t) + sliderDrag.px
      const ly = dx * Math.sin(t) + dy * Math.cos(t) + sliderDrag.py
      const next = sliderValueFor(sliderDrag.slider, sliderDrag.prop, lx, ly)

      const current = Number(
        partById.get(sliderDrag.partId)?.props[sliderDrag.slider.key] ??
          sliderDrag.prop.default ??
          0,
      )
      if (next === current) return

      dispatch({
        type: 'setProp',
        id: sliderDrag.partId,
        key: sliderDrag.slider.key,
        value: next,
        transient: sliderDrag.pushed,
      })
      if (!sliderDrag.pushed) setSliderDrag({ ...sliderDrag, pushed: true })
      return
    }

    /**
     * Moving a sensor's target, and it outranks everything below for the reason
     * the other two do: the gesture began on the marker.
     *
     * TWO WRITES, ONE UNDO ENTRY. Distance and bearing are separate props, so a
     * diagonal drag dispatches twice per frame; `pushed` starts false, the first
     * dispatch of the whole gesture goes in non-transient and every one after it
     * — including the second half of that same frame — is marked transient and
     * rides on it. Without that, one flick of the wrist would cost forty presses
     * of undo instead of one.
     */
    if (targetDrag) {
      const t = (-targetDrag.rotation * Math.PI) / 180
      const dx = w.x - targetDrag.ox - targetDrag.px
      const dy = w.y - targetDrag.oy - targetDrag.py
      const lx = dx * Math.cos(t) - dy * Math.sin(t) + targetDrag.px
      const ly = dx * Math.sin(t) + dy * Math.cos(t) + targetDrag.py
      const next = targetValuesFor(
        targetDrag.target,
        targetDrag.prop,
        targetDrag.bearingProp,
        lx,
        ly,
      )

      const part = partById.get(targetDrag.partId)
      const currentDistance = Number(
        part?.props[targetDrag.target.key] ?? targetDrag.prop.default ?? 0,
      )
      const bearingKey = targetDrag.target.bearingKey
      const currentBearing =
        targetDrag.bearingProp && bearingKey
          ? Number(part?.props[bearingKey] ?? targetDrag.bearingProp.default ?? 0)
          : next.bearing

      // A frame that lands on both values we already hold is dropped, so a shaky
      // pointer inside one step neither re-renders nor burns the undo entry.
      if (next.distance === currentDistance && next.bearing === currentBearing) return

      let pushed = targetDrag.pushed
      if (next.distance !== currentDistance) {
        dispatch({
          type: 'setProp',
          id: targetDrag.partId,
          key: targetDrag.target.key,
          value: next.distance,
          transient: pushed,
        })
        pushed = true
      }
      if (bearingKey && next.bearing !== currentBearing) {
        dispatch({
          type: 'setProp',
          id: targetDrag.partId,
          key: bearingKey,
          value: next.bearing,
          transient: pushed,
        })
        pushed = true
      }
      if (!targetDrag.pushed) setTargetDrag({ ...targetDrag, pushed: true })
      return
    }

    if (panning) {
      dispatchView({ type: 'pan', dx: e.clientX - panning.x, dy: e.clientY - panning.y })
      setPanning({ x: e.clientX, y: e.clientY })
      return
    }
    // A wire being drawn follows the cursor, whether it is being dragged out of
    // a pin or routed click by click. `trackCursor` also decides, once, whether
    // the opening press has become a drag.
    if (wire) {
      const next = trackCursor(wire, w)
      if (next !== wire) setWire(next)
      return
    }

    const g = gesture.current
    if (g) {
      if (!g.moved) {
        if (Math.hypot(w.x - g.startX, w.y - g.startY) < DRAG_SLOP) return
        g.moved = true
        if (g.kind === 'body') {
          // Grab the wire, it bends. The waypoint is created here rather than
          // on pointerdown so that a plain click still reads as a click, and
          // this one action is the whole gesture's undo entry.
          dispatch({
            type: 'addWaypoint',
            id: g.wireId,
            index: g.index,
            point: { x: snap(w.x), y: snap(w.y) },
          })
          g.pushed = true
          return
        }
      }

      const x = snap(w.x)
      const y = snap(w.y)
      if (!g.pushed) {
        // The first move carries the undo entry, so it must be a real move:
        // a frame that snaps back onto the waypoint's own cell would be
        // dropped by the reducer and take the entry with it.
        const at = doc.wires.find((it) => it.id === g.wireId)?.waypoints?.[g.index]
        if (at && at.x === x && at.y === y) return
      }
      dispatch({ type: 'moveWaypoint', id: g.wireId, index: g.index, x, y, transient: g.pushed })
      g.pushed = true
      return
    }

    if (drag) {
      dispatch({
        type: 'movePart',
        id: drag.id,
        x: snap(w.x - drag.offsetX),
        y: snap(w.y - drag.offsetY),
      })
      return
    }

    // Nothing in flight: this is a plain hover, so light the wire under the
    // pointer and show its handles. Only a TRANSITION sets state.
    const over = grabAt(w)?.wireId ?? null
    if (over !== hoverWire) setHoverWire(over)
  }

  /**
   * End every in-flight gesture.
   *
   * A single click on a wire body used to delete it. That was already a sharp
   * edge and became a hostile one once the same gesture, moved four units,
   * bends the wire instead: a student aiming to shape a lead who slipped under
   * the threshold destroyed it. Deleting now takes a double-click on the body
   * (see `Wire`), which nothing else in the canvas can be mistaken for.
   */
  function endGesture() {
    if (gesture.current) {
      const { pointerId, wireId, moved } = gesture.current
      gesture.current = null
      setShaping(null)
      const svg = svgRef.current
      if (svg?.hasPointerCapture?.(pointerId)) svg.releasePointerCapture(pointerId)
      /**
       * A PRESS THAT NEVER MOVED WAS A CLICK, AND A CLICK ON A WIRE SELECTS IT.
       *
       * Decided here rather than on pointerdown, and that ordering is the whole
       * reason a wire can be both selected and shaped: the same press starts a
       * bend, so committing to "this was a selection" before knowing whether the
       * pointer travelled would light a wire up every time a student grabbed one
       * to drape it, and leave it lit afterwards.
       *
       * `moved` is `DRAG_SLOP`'s answer, the same one the bend uses — so the
       * threshold between "I clicked this wire" and "I bent this wire" is one
       * number in one place, and there is no gap or overlap between them.
       */
      if (!moved) onSelectWire?.(wireId)
    }
    setDrag(null)
    setPanning(null)
    setKnobDrag(null)
    setSliderDrag(null)
    setTargetDrag(null)
    /**
     * LETTING GO OF A TARGET IS THE MOMENT THE MOVEMENT STOPS.
     *
     * A PIR detects movement, not presence, so `motion` is held at 1 only while
     * the target is under the pointer — the same shape as a held button, and
     * released here for the same reason it is: a drag that ended off the canvas
     * would otherwise leave the sensor believing somebody is still walking about
     * in front of it forever.
     *
     * This is what finally puts the datasheet's hold time on screen. Let go and
     * OUT stays high for `hold` seconds more, then falls — which is the whole
     * behaviour experiment 6's alarm is built on and which nothing in the UI
     * used to show.
     */
    if (moving) {
      const part = partById.get(moving)
      const key = part && getPart(part.type).target?.movingKey
      if (key) dispatch({ type: 'setProp', id: moving, key, value: 0 })
      setMoving(null)
    }
    /**
     * RELEASING A HELD BUTTON IS PART OF ENDING EVERY GESTURE, not just of
     * lifting the pointer over the button itself.
     *
     * This runs on pointerup AND on the pointer leaving the canvas. A press
     * whose release landed outside — the pointer dragged off the board, the
     * window lost focus mid-press — would otherwise leave the contacts closed
     * with nothing on screen holding them, which is a button stuck down that
     * only a second click could free.
     */
    if (holding) {
      const part = partById.get(holding)
      const key = part && getPart(part.type).momentary?.key
      if (key) dispatch({ type: 'setProp', id: holding, key, value: 0 })
      setHolding(null)
    }
    /**
     * THE DRAFT IS NOT A GESTURE, and this line is where that used to be got
     * wrong: `setWire(null)` sat here unconditionally, so a click on a pin
     * opened a draft and the pointerup a few milliseconds later threw it away.
     * Click-to-start could not have worked, whatever else was right.
     *
     * `releasePress` owns the decision now. It ends a DRAG — committing on the
     * pin under the pointer, abandoning over empty space — and leaves a CLICK
     * alive to be routed.
     */
    if (wire) {
      const step = releasePress(wire)
      setWire(step.draft)
      if (step.commit) commitWire(step.commit)
    }
  }

  /**
   * Grab a knob. The centre is resolved to WORLD units once, here, because the
   * part can be dragged out from under a live gesture and re-deriving it every
   * frame would make the knob track the part rather than the finger.
   */
  function startKnobDrag(
    e: React.PointerEvent,
    part: PlacedPart,
    def: PartDefinition,
    knob: KnobControl,
    prop: PropSpec,
  ) {
    if (wire) return
    e.stopPropagation()
    const centre = localToWorld(part, def, knob.cx, knob.cy)
    onSelect(part.id)
    setKnobDrag({
      partId: part.id,
      knob,
      prop,
      cx: centre.x,
      cy: centre.y,
      rotation: part.rotation,
      pushed: false,
    })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  /**
   * Grab a slider handle. The part's ORIGIN is resolved to world units once,
   * here, for the reason the knob's centre is: the part can be dragged out from
   * under a live gesture, and re-deriving the frame every frame would make the
   * handle track the part rather than the finger.
   */
  function startSliderDrag(
    e: React.PointerEvent,
    part: PlacedPart,
    def: PartDefinition,
    slider: SliderControl,
    prop: PropSpec,
  ) {
    if (wire) return
    e.stopPropagation()
    onSelect(part.id)
    setSliderDrag({
      partId: part.id,
      slider,
      prop,
      ox: part.x,
      oy: part.y,
      px: def.width / 2,
      py: def.height / 2,
      rotation: part.rotation,
      pushed: false,
    })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  /**
   * Grab a sensor's target. Same frame resolution as the slider, plus the one
   * thing a target does that no other canvas control does: it announces that
   * something in front of the sensor has started MOVING.
   */
  function startTargetDrag(
    e: React.PointerEvent,
    part: PlacedPart,
    def: PartDefinition,
    target: TargetControl,
    prop: PropSpec,
    bearingProp?: PropSpec,
  ) {
    if (wire) return
    e.stopPropagation()
    onSelect(part.id)
    setTargetDrag({
      partId: part.id,
      target,
      prop,
      bearingProp,
      ox: part.x,
      oy: part.y,
      px: def.width / 2,
      py: def.height / 2,
      rotation: part.rotation,
      pushed: false,
    })
    if (target.movingKey) {
      setMoving(part.id)
      // Non-transient, exactly as the momentary press is: this is a thing that
      // HAPPENED to the circuit, and a student should be able to undo back
      // through the moment the movement started.
      dispatch({ type: 'setProp', id: part.id, key: target.movingKey, value: 1 })
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  /**
   * Press a momentary control. Writes 1 now; `endGesture` writes the 0.
   *
   * Both edges are ordinary undoable prop changes rather than a transient pair,
   * deliberately: a press and a release are two things that HAPPENED to the
   * circuit, and a student who presses a button to see what their sketch does
   * should be able to undo back through it.
   */
  function pressMomentary(
    e: React.PointerEvent,
    part: PlacedPart,
    momentary: MomentaryControl,
  ) {
    if (wire) return
    e.stopPropagation()
    onSelect(part.id)
    setHolding(part.id)
    dispatch({ type: 'setProp', id: part.id, key: momentary.key, value: 1 })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  function startPartDrag(e: React.PointerEvent, part: PlacedPart) {
    // Routing outranks every other press on the artwork. A student laying a
    // turn over a breadboard must not drag the breadboard instead, and the
    // alternative — refusing the click because a part is under it — would make
    // most of the board unroutable. Falling through with no stopPropagation is
    // what lets the canvas below take it as a turn.
    if (wire) return
    e.stopPropagation()
    const w = toWorld(e.clientX, e.clientY)
    onSelect(part.id)
    setDrag({ kind: 'part', id: part.id, offsetX: w.x - part.x, offsetY: w.y - part.y })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  /**
   * Take over the pointer to shape a wire — a bend on the body, or a handle.
   *
   * It CAPTURES the pointer, on the svg. An earlier version deliberately did
   * not, because capture suppresses the boundary events that turned the wire's
   * hover off and the handles stayed on screen after the drag ended. That
   * reasoning no longer holds: hover is resolved from the pointer's position by
   * `grabAt` rather than from pointerenter/pointerleave, so capture
   * cannot strand it. What capture buys is the case that matters on a phone —
   * a finger that leaves the canvas mid-drag still delivers its moves and its
   * release here, instead of the gesture dying on the svg's pointerleave with
   * a half-placed bend left behind.
   */
  function startWireGesture(e: React.PointerEvent, target: WireTarget) {
    e.stopPropagation()
    const at = toWorld(e.clientX, e.clientY)
    gesture.current = {
      ...target,
      startX: at.x,
      startY: at.y,
      moved: false,
      pushed: false,
      pointerId: e.pointerId,
    }
    setShaping(target.wireId)
    // Capture is an optimisation, never a precondition: the svg's own
    // pointermove drives the drag whether or not it lands. It throws when the
    // pointer is no longer active — a race a slow frame can genuinely lose —
    // and a gesture that is already recorded must not be undone by that.
    try {
      svgRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* the drag still works without it */
    }
  }

  /**
   * The canvas's first look at every press, before any child handler.
   *
   * CAPTURE PHASE, and that is the point. React dispatches capture handlers
   * from the root down, so this runs before the pin circle, the part artwork
   * and the background pan handler that would otherwise claim the press by
   * being on top of — or under — the wire. When it claims one it stops the
   * event, and none of them run.
   *
   * It declines in four cases, each of which belongs to something else: a
   * wire being routed (every press then belongs to that route — a turn, or the
   * pin that ends it), a non-primary button, a sensor's target marker, and a pin
   * core (see PIN_CORE).
   */
  function onCanvasPointerDownCapture(e: React.PointerEvent) {
    if (wire || e.button > 0) return
    const p = toWorld(e.clientX, e.clientY)
    if (onTargetMarker(p)) return
    const target = grabAt(p)
    if (!target) return
    startWireGesture(e, target)
  }

  /**
   * Double-click: remove the bend under the pointer, or the whole wire.
   *
   * On the canvas rather than on each wire, for the reason the press is: the
   * shape that receives a dblclick is the topmost one, which over a breadboard
   * is a tie point and not the wire the student is aiming at. Resolving it here
   * means the same rule decides what a press grabs and what a double-click
   * removes, so they can never disagree about which wire is under the pointer.
   */
  function onCanvasDoubleClick(e: React.MouseEvent) {
    const at = toWorld(e.clientX, e.clientY)
    const target = grabAt(at)
    if (!target) return
    e.stopPropagation()
    if (target.kind === 'handle') {
      dispatch({ type: 'removeWaypoint', id: target.wireId, index: target.index })
    } else {
      /**
       * ADD a bend here — it used to delete the whole wire.
       *
       * Two reasons the old behaviour had to go, and the second is the real one.
       * A double-click is a click twice, and the FIRST of the two now selects
       * the wire, so "select it and then destroy it" is an unpleasant thing for
       * one gesture to mean. And deleting a lead was reachable by accident from
       * a gesture a student makes while aiming at a bend; Delete on a selected
       * wire is deliberate in a way that a stray double-click is not.
       *
       * `target.index` IS the insertion slot and nothing here recomputes it.
       * Segment i of [from, ...waypoints, to] runs from waypoint i−1 to waypoint
       * i, so the bend that lands on it belongs at i — which is the same number
       * `startWireGesture`'s drag-the-body path already passes to the same
       * action. Recomputing it from the pointer would be a second opinion about
       * a question `wireTargetAt` has already answered, and the way a wire ends
       * up doubling back on itself.
       */
      dispatch({
        type: 'addWaypoint',
        id: target.wireId,
        index: target.index,
        point: { x: snap(at.x), y: snap(at.y) },
      })
    }
  }

  /** Turn a finished route into a wire. The turns ride along as `waypoints`. */
  function commitWire(c: { from: PinRef; to: PinRef; waypoints: Point[] }) {
    dispatch({
      type: 'addWire',
      wire: {
        id: newId('w'),
        from: c.from,
        to: c.to,
        color: wireColorFor(doc, c.from, c.to),
        // Never an empty array: a wire routed straight from pin to pin must be
        // indistinguishable from one authored before waypoints existed.
        ...(c.waypoints.length > 0 ? { waypoints: c.waypoints } : {}),
      },
    })
  }

  /**
   * A press on a pin: start a wire here, finish one here, or cancel.
   *
   * All three are `pressPin`'s to decide — see it for the rules. The canvas's
   * only job is to stop the press reaching the pan handler underneath.
   */
  function onPinDown(e: React.PointerEvent, ref: PinRef) {
    e.stopPropagation()
    const step = pressPin(wire, ref, toWorld(e.clientX, e.clientY))
    setWire(step.draft)
    if (step.commit) commitWire(step.commit)
  }

  /**
   * A release on a pin, which only matters for a DRAGGED wire — a click's
   * release is `endGesture`'s, and a routing click has already been dealt with
   * by the press.
   */
  function onPinUp(e: React.PointerEvent, ref: PinRef) {
    if (!wire || !wire.pressing) return
    e.stopPropagation()
    const step = releasePress(wire, ref)
    setWire(step.draft)
    if (step.commit) commitWire(step.commit)
  }

  function onWheel(e: React.WheelEvent) {
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    dispatchView({ type: 'zoom', factor, cx, cy })
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full bg-[#f4f5f6] overflow-hidden">
      {/* Zoom readout. The parts palette now lives in the right rail — floating
          it over the artwork hid the very circuit it was there to build. */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-[#566573] font-mono">
        {Math.round(v.z * 100)}% · scroll to zoom · drag background to pan
      </div>

      <svg
        ref={svgRef}
        className="w-full h-full touch-none"
        data-testid="canvas"
        onPointerMove={onPointerMove}
        onPointerUp={() => endGesture()}
        onPointerLeave={() => {
          setHoverWire(null)
          endGesture()
        }}
        onWheel={onWheel}
        onPointerDownCapture={onCanvasPointerDownCapture}
        onDoubleClick={onCanvasDoubleClick}
        onPointerDown={(e) => {
          /**
           * While a wire is being ROUTED, every press that got this far — one
           * that no pin claimed — lays down a turn.
           *
           * Which means panning is suspended for the length of a route, and
           * that is the right trade: a press has to mean exactly one thing, and
           * during routing the useful thing it can mean is "the wire goes
           * through here". The wheel still zooms, and Escape still gets out.
           *
           * `pressing` guards the opening press of a DRAG: the pointer is still
           * down from the pin, and its travel across the canvas must not litter
           * the route with turns.
           */
          if (wire) {
            if (!wire.pressing) setWire(pressCanvas(wire, toWorld(e.clientX, e.clientY)))
            return
          }
          onSelect(null)
          setPanning({ x: e.clientX, y: e.clientY })
        }}
      >
        <defs>
          <pattern id="grid" width={PITCH} height={PITCH} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={0.6} fill="#d3d8dd" />
          </pattern>
        </defs>

        <g transform={`translate(${v.x} ${v.y}) scale(${v.z})`}>
          <rect x={-400} y={-300} width={2600} height={1800} fill="url(#grid)" />

          {/* Part bodies. Painted first: a jumper lies ON the board, and a wire
              hidden under a breadboard is a circuit the student cannot read. */}
          {doc.parts.map((part) => {
            const def = getPart(part.type)
            const isSel = selected === part.id
            const brightness = ledBrightness?.get(part.id) ?? 0
            const isLed = def.electrical.kind === 'led'
            const colour = isLed ? ledColour(part.props.color) : null

            /**
             * Per-instance artwork, as CSS custom properties on the group.
             *
             * The harvested SVG is shared by every instance and injected as raw
             * markup, so it cannot be parameterised any other way — but a custom
             * property INHERITS, so setting it here reaches the one attribute in
             * that markup that reads it (`fill="var(--led-body, …)"`). The pot's
             * `--knob-angle` is wokwi's own variable, already wired to a
             * `rotate()` on its indicator, so the real tick turns.
             */
            const vars: Record<string, string> = {}
            if (colour) vars['--led-body'] = ledBodyFill(colour, brightness)
            const knobProp = def.knob
              ? def.props?.find((p) => p.key === def.knob!.key)
              : undefined
            if (def.knob?.angleVar && knobProp) {
              const value = Number(part.props[def.knob.key] ?? knobProp.default ?? 0)
              vars[def.knob.angleVar] = `${knobAngleFor(def.knob, knobProp, value)}deg`
            }
            const sliderProp = def.slider
              ? def.props?.find((p) => p.key === def.slider!.key)
              : undefined
            const momentaryProp = def.momentary
              ? def.props?.find((p) => p.key === def.momentary!.key)
              : undefined
            /**
             * The pressed cap, from the DOCUMENT rather than from `holding`.
             *
             * So the artwork follows the value however it was set — the panel
             * checkbox, an undo, a starter that ships a button already held —
             * and not just a pointer that happens to be down on this canvas.
             */
            if (def.momentary?.pressedVar && momentaryProp) {
              const down = Number(part.props[def.momentary.key] ?? momentaryProp.default ?? 0) >= 0.5
              vars[def.momentary.pressedVar] = down ? '1' : '0'
            }

            return (
              <g
                key={part.id}
                transform={partTransform(part, def)}
                data-testid={`part-${part.id}`}
              >
                {colour && brightness > 0.02 && (
                  <circle
                    cx={15}
                    cy={20}
                    r={14 + brightness * 26}
                    data-testid={`led-glow-${part.id}`}
                    fill={ledGlowFill(colour, brightness)}
                    pointerEvents="none"
                  />
                )}

                <g
                  style={vars as React.CSSProperties}
                  onPointerDown={(e) => startPartDrag(e, part)}
                  className="cursor-move"
                  dangerouslySetInnerHTML={{ __html: def.svg }}
                />

                {/* The glass, painted over the artwork's own dark window. It is
                    NOT part of `def.svg` because it is the only thing on this
                    canvas whose content changes every frame from the running
                    simulation — the static markup draws the module, this draws
                    what the module is showing. */}
                {def.electrical.kind === 'character_lcd' && deviceStates?.[part.id] && (
                  <LcdScreen
                    state={deviceStates[part.id]}
                    backlight={ledBrightness?.get(`${part.id}.backlight`) ?? 0}
                  />
                )}

                {/* The shaft speed, on the case. Same rule as the glass above
                    it: only while a simulation is reporting one. A motor with a
                    permanent `0 rpm` on it would be claiming a measurement it
                    has not got, and a stopped motor and an un-run circuit are
                    not the same thing. */}
                {def.electrical.kind === 'motor' && deviceStates?.[part.id] && (
                  <MotorReadout
                    partId={part.id}
                    state={deviceStates[part.id]}
                    rotation={part.rotation}
                  />
                )}

                {def.knob && knobProp && (
                  <Knob
                    part={part}
                    def={def}
                    knob={def.knob}
                    prop={knobProp}
                    turning={knobDrag?.partId === part.id}
                    onGrab={(e) => startKnobDrag(e, part, def, def.knob!, knobProp)}
                    onSet={(value) =>
                      dispatch({ type: 'setProp', id: part.id, key: def.knob!.key, value })
                    }
                    onFocus={() => onSelect(part.id)}
                  />
                )}

                {def.slider && sliderProp && (
                  <Slider
                    part={part}
                    def={def}
                    slider={def.slider}
                    prop={sliderProp}
                    sliding={sliderDrag?.partId === part.id}
                    onGrab={(e) => startSliderDrag(e, part, def, def.slider!, sliderProp)}
                    onSet={(value) =>
                      dispatch({ type: 'setProp', id: part.id, key: def.slider!.key, value })
                    }
                    onFocus={() => onSelect(part.id)}
                  />
                )}

                {def.momentary && momentaryProp && (
                  <Momentary
                    part={part}
                    def={def}
                    momentary={def.momentary}
                    prop={momentaryProp}
                    onPress={(e) => pressMomentary(e, part, def.momentary!)}
                    onSet={(value) =>
                      dispatch({ type: 'setProp', id: part.id, key: def.momentary!.key, value })
                    }
                    onFocus={() => onSelect(part.id)}
                  />
                )}

                {isSel && (
                  <rect
                    x={-4}
                    y={-4}
                    width={def.width + 8}
                    height={def.height + 8}
                    rx={4}
                    fill="none"
                    stroke={ACCENT}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    pointerEvents="none"
                  />
                )}
              </g>
            )
          })}

          {/* Wires, over the parts they run across. */}
          <g data-testid="wire-layer">
            {routes.map(({ wire: w, a, b }) => (
              <Wire
                key={w.id}
                wire={w}
                a={a}
                b={b}
                lit={hoverNet != null && netOf?.get(`${w.from.partId} ${w.from.pinId}`) === hoverNet}
                shaping={shaping === w.id}
                hovered={hoverWire === w.id}
                selected={selectedWire === w.id}
              />
            ))}
          </g>

          {/* Pins last, so they outrank both the body art below them and any
              wire crossing over them — SVG hit-testing takes the TOPMOST shape,
              so a pin buried under a wire would otherwise be unclickable.
              Breadboard tie points stay hidden below 0.55x, where a 0.1in hole
              is under 3px and cannot be aimed at anyway. */}
          {doc.parts.map((part) => {
            const def = getPart(part.type)
            return (
              <g
                key={part.id}
                transform={partTransform(part, def)}
                data-testid={`pins-${part.id}`}
              >
                {def.pins
                  .filter((pin) => !pin.subtle || v.z > 0.55)
                  .map((pin) => (
                    <Pin
                      key={pin.id}
                      pin={pin}
                      hitR={hitRadius(def)}
                      partId={part.id}
                      netOf={netOf}
                      hoverNet={hoverNet}
                      wiring={wire != null}
                      onEnter={() => {
                        const n = netOf?.get(`${part.id} ${pin.id}`)
                        setHoverNet(n ?? null)
                      }}
                      onLeave={() => setHoverNet(null)}
                      onDown={(e) => onPinDown(e, { partId: part.id, pinId: pin.id })}
                      onUp={(e) => onPinUp(e, { partId: part.id, pinId: pin.id })}
                    />
                  ))}
              </g>
            )
          })}

          {/* Sensor targets, LAST of the persistent layers and therefore on top
              of the wiring.
              A target is not part of the board — it is the thing the board is
              pointed at, standing off in front of the module — so a jumper
              draped across the space it occupies must not bury it. The cone and
              the readout take no pointer at all; only the marker does, and
              `onTargetMarker` keeps the canvas's own capture handler off it. */}
          {doc.parts.map((part) => {
            const def = getPart(part.type)
            const t = def.target
            const prop = t ? def.props?.find((p) => p.key === t.key) : undefined
            if (!t || !prop) return null
            const bearingProp = t.bearingKey
              ? def.props?.find((p) => p.key === t.bearingKey)
              : undefined
            return (
              <g
                key={part.id}
                transform={partTransform(part, def)}
                data-testid={`target-layer-${part.id}`}
              >
                <SensorTarget
                  part={part}
                  def={def}
                  target={t}
                  prop={prop}
                  bearingProp={bearingProp}
                  state={deviceStates?.[part.id]}
                  dragging={targetDrag?.partId === part.id}
                  onGrab={(e) => startTargetDrag(e, part, def, t, prop, bearingProp)}
                  onSet={(key, value) => dispatch({ type: 'setProp', id: part.id, key, value })}
                  onFocus={() => onSelect(part.id)}
                />
              </g>
            )
          })}

          {/* The wire being drawn: everything committed so far, plus a rubber
              band from the last turn to the cursor. Routing without this is
              routing blind — the student cannot see where the turn they are
              about to lay would put the wire. Drawn through the SAME wirePath
              as a real wire, so the fillets they are previewing are the
              fillets they will get. */}
          {wire &&
            (() => {
              const p = partById.get(wire.from.partId)
              const from = p && pinPosition(p, wire.from.pinId)
              if (!from) return null
              return (
                <g data-testid="wire-draft" pointerEvents="none">
                  <path
                    d={wirePath(from, { x: wire.x, y: wire.y }, wire.points)}
                    data-testid="wire-draft-path"
                    fill="none"
                    stroke={ACCENT}
                    strokeWidth={WIRE_CASING}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="5 4"
                  />
                  {/* A pip on every committed turn, so the student can count
                      what they have laid down and see that a click landed. */}
                  {wire.points.map((pt, i) => (
                    <circle
                      key={i}
                      cx={pt.x}
                      cy={pt.y}
                      r={3}
                      fill="#fff"
                      stroke={ACCENT}
                      strokeWidth={1.6}
                      data-testid={`wire-draft-point-${i}`}
                    />
                  ))}
                </g>
              )
            })()}
        </g>
      </svg>
    </div>
  )
}

function partTransform(part: PlacedPart, def: PartDefinition): string {
  return `translate(${part.x} ${part.y}) rotate(${part.rotation} ${def.width / 2} ${def.height / 2})`
}

/**
 * A point in part-local units, in world units — `partTransform` done in numbers.
 *
 * It has to agree with that string exactly, including the rotation being about
 * the bounding box's CENTRE rather than the origin. A knob whose centre is
 * computed about the wrong pivot tracks the pointer with a constant offset,
 * which reads as "the knob is slippery" rather than as an outright bug.
 */
function localToWorld(part: PlacedPart, def: PartDefinition, lx: number, ly: number): Point {
  const ox = def.width / 2
  const oy = def.height / 2
  const t = (part.rotation * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const dx = lx - ox
  const dy = ly - oy
  return { x: part.x + ox + dx * cos - dy * sin, y: part.y + oy + dx * sin + dy * cos }
}

// ─── Character LCD ────────────────────────────────────────────────────────────

/**
 * One CGROM glyph as a single SVG path, in dot units.
 *
 * ONE PATH PER CELL rather than one rect per dot, and the arithmetic says why:
 * 16 x 2 cells of 5 x 8 dots is 1280 rectangles, re-created on every snapshot at
 * 20 frames a second, per display on the canvas. As paths it is 32 nodes, and
 * the string for each is memoised on the character code — so a screen that is
 * not changing costs one `d` attribute comparison per cell.
 *
 * Drawn in DOT UNITS (a dot is 1 x 1 at integer coordinates) and scaled by the
 * caller, so the same string serves any zoom and any module geometry.
 */
/**
 * A dot's size and inset inside its own pitch, as fractions of one pitch.
 *
 * Derived from LCD1602_SCREEN rather than chosen here, so the gap between the
 * dots is the module's declared geometry and not a second opinion about it.
 */
const DOT_W = LCD1602_SCREEN.dotW / LCD1602_SCREEN.dotPitchX
const DOT_H = LCD1602_SCREEN.dotH / LCD1602_SCREEN.dotPitchY
const DOT_INSET_X = (1 - DOT_W) / 2
const DOT_INSET_Y = (1 - DOT_H) / 2

function dotRect(c: number, r: number): string {
  const x = (c + DOT_INSET_X).toFixed(3)
  const y = (r + DOT_INSET_Y).toFixed(3)
  return `M${x} ${y}h${DOT_W.toFixed(3)}v${DOT_H.toFixed(3)}h-${DOT_W.toFixed(3)}z`
}

const glyphPathCache = new Map<number, string>()

function glyphPath(code: number): string {
  const hit = glyphPathCache.get(code)
  if (hit !== undefined) return hit
  const cols = lcdGlyph(code)
  let d = ''
  for (let c = 0; c < LCD_GLYPH_COLS; c++) {
    for (let r = 0; r < LCD_GLYPH_ROWS; r++) {
      if ((cols[c] >> r) & 1) d += dotRect(c, r)
    }
  }
  glyphPathCache.set(code, d)
  return d
}

/** Every dot of a cell, for the un-driven segments an over-biased panel shows. */
const ALL_DOTS = (() => {
  let d = ''
  for (let c = 0; c < LCD_GLYPH_COLS; c++) {
    for (let r = 0; r < LCD_GLYPH_ROWS; r++) d += dotRect(c, r)
  }
  return d
})()

/** The cursor line: row 7 of the cell, all five columns. */
const CURSOR_LINE = (() => {
  let d = ''
  for (let c = 0; c < LCD_GLYPH_COLS; c++) d += dotRect(c, LCD_GLYPH_ROWS - 1)
  return d
})()

/**
 * The glass of a character LCD, painted from the decoded display memory.
 *
 * NOTHING HERE INVENTS ANYTHING. Every code it draws came out of the HD44780
 * decoder in behavioural.ts, which got it off the data pins on an E falling
 * edge; the contrast it draws at is `VDD − V0` as the solver found it; the
 * backlight wash is the backlight LED's own solved current, arriving through the
 * same brightness map every other LED on the canvas uses. If the sketch did not
 * write it, it is not on the glass.
 *
 * THE TWO CONTRAST FAILURES ARE DRAWN, not just reported, because they are what
 * a student is looking at when they ask why the display is wrong:
 *
 *   `contrast` fades the lit dots out as VDD − V0 falls — wind the trimmer to
 *   VDD and the screen goes blank with the text still in memory.
 *   `blocks` fades the UN-lit dots IN as it rises past what the panel can
 *   reject — tie V0 to ground and every cell becomes a solid block, which is
 *   the first thing most people ever see a 1602 do.
 */
function LcdScreen({
  state,
  backlight,
}: {
  state: DeviceState
  /** 0..1 from the engine's LED brightness map, or 0 when A/K are not wired. */
  backlight: number
}) {
  const s = LCD1602_SCREEN
  const num = (k: string): number => {
    const v = state[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const powered = state.powered === true
  const lit = state.on === true
  const contrast = powered ? num('contrast') : 0
  const blocks = powered ? num('blocks') : 0
  const rows = [unpackLcdRow(String(state.row0 ?? '')), unpackLcdRow(String(state.row1 ?? ''))]
  const cursorRow = num('cursorRow')
  const cursorCol = num('cursorCol')
  const onGlass = cursorCol >= 0 && cursorRow >= 0
  const showCursor = lit && state.cursor === true && onGlass
  /**
   * The BLINKING cursor is a separate control bit from the underline one, and a
   * real HD44780 draws it as the whole 5x8 cell alternating with the character
   * at about 2.5 Hz. It is drawn here rather than merely reported for the same
   * reason the contrast is: a student who called `lcd.blink()` is looking for it
   * on the screen, not in a panel.
   */
  const showBlink = lit && state.blink === true && onGlass

  /**
   * The panel colour, from the backlight's own current.
   *
   * A yellow-green module is READABLE with its backlight off — it is a
   * reflective panel and the dots are still there in ambient light — so this
   * lightens the glass rather than gating the text on it. Gating would be the
   * blue/white module's behaviour, and this part is drawn as the green one.
   */
  const glass =
    backlight > 0.02
      ? `rgb(${Math.round(118 + backlight * 60)} ${Math.round(168 + backlight * 62)} ` +
        `${Math.round(60 + backlight * 34)})`
      : '#4d6b34'

  return (
    <g pointerEvents="none" data-testid="lcd-screen">
      {/* The blink is a wall-clock animation, not a simulated one: the HD44780
          generates it internally from its own oscillator, so it is the one thing
          on this part that does NOT come from the sketch. `steps(1, end)` keeps
          it square, as the controller's is. */}
      {showBlink && (
        <style>{`@keyframes vlab-lcd-blink{0%,49.9%{opacity:1}50%,100%{opacity:0}}`}</style>
      )}
      <rect x={s.bezel.x} y={s.bezel.y} width={s.bezel.w} height={s.bezel.h} rx={1} fill={glass} />
      {rows.map((codes, row) =>
        codes.slice(0, s.cols).map((code, col) => {
          const x = s.x + col * s.cellW
          const y = s.y + row * s.cellH
          // Dots are 1x1 in the path's own units, so the cell scales by the dot
          // PITCH and each dot is then inset to leave the gap between them.
          const t = `translate(${x} ${y}) scale(${s.dotPitchX} ${s.dotPitchY})`
          const isCursor = showCursor && row === cursorRow && col === cursorCol
          return (
            <g key={`${row}-${col}`} transform={t}>
              {blocks > 0.01 && (
                <path d={ALL_DOTS} fill="#0d2a12" opacity={blocks * 0.85} />
              )}
              {lit && contrast > 0.01 && (
                <path
                  d={glyphPath(code)}
                  fill="#0b2b0b"
                  opacity={contrast}
                 
                />
              )}
              {isCursor && (
                <path d={CURSOR_LINE} fill="#0b2b0b" opacity={Math.max(contrast, 0.6)} />
              )}
              {showBlink && row === cursorRow && col === cursorCol && (
                <path
                  d={ALL_DOTS}
                  fill="#0b2b0b"
                  opacity={Math.max(contrast, 0.6)}
                  style={{ animation: 'vlab-lcd-blink 0.8s steps(1, end) infinite' }}
                />
              )}
            </g>
          )
        }),
      )}
      {/* The bezel outline, drawn LAST so the dots never spill over its edge
          when the glass is tinted by a bright backlight. */}
      <rect
        x={s.bezel.x}
        y={s.bezel.y}
        width={s.bezel.w}
        height={s.bezel.h}
        rx={1}
        fill="none"
        stroke="#0a2b1b"
        strokeWidth={0.6}
      />
    </g>
  )
}

// ─── DC motor ─────────────────────────────────────────────────────────────────

/**
 * The shaft speed, painted on the motor's case while a simulation is running.
 *
 * NOTHING HERE INVENTS ANYTHING, and this part has a specific reason to say so.
 * The rpm is not a property of the motor and not a number the canvas computes:
 * `SimulationEngine.states()` takes the TIME-AVERAGED armature current — the
 * average, because a PWM-driven motor sits at two DC operating points and a
 * snapshot of either is a speed the shaft never runs at — and converts it
 * through `DCMotor.rpmFor`, which is the datasheet's own no-load-to-stall line.
 * What is drawn here is that number, rounded, and nothing else.
 *
 * The direction and the stall go in the tooltip rather than on the case: a
 * 50 x 40 part has room for one line, and the number is the one a student is
 * looking for. A stall is still visible at a glance, because a stalled motor
 * reads `0 rpm` while drawing current — which is exactly what a stall is.
 */
function MotorReadout({
  partId,
  state,
  rotation,
}: {
  partId: string
  state: DeviceState
  /** The part's own rotation, undone so the number is never read sideways. */
  rotation: number
}) {
  const r = DC_MOTOR_READOUT
  const rpm =
    typeof state.rpm === 'number' && Number.isFinite(state.rpm) ? Math.round(state.rpm) : 0
  const amps = typeof state.amps === 'number' && Number.isFinite(state.amps) ? state.amps : 0
  const direction = typeof state.direction === 'string' ? state.direction : 'stopped'
  const note =
    state.stalled === true
      ? `stalled — ${(Math.abs(amps) * 1000).toFixed(0)} mA and not turning`
      : rpm === 0
        ? 'stopped'
        : direction

  return (
    <g
      data-testid={`motor-readout-${partId}`}
      pointerEvents="none"
      /* Counter-rotated about the plate's own centre, so a motor dropped
         sideways still reads left to right. The pins and the case turn; a
         number that turned with them would be upside down at 180°. */
      transform={`rotate(${-rotation} ${r.x} ${r.y - r.fontSize / 3})`}
    >
      <rect
        x={r.plate.x}
        y={r.plate.y}
        width={r.plate.w}
        height={r.plate.h}
        rx={r.plate.rx}
        fill="#f4f6f8"
        stroke={state.stalled === true ? '#c0392b' : '#6d757e'}
        strokeWidth={0.6}
        opacity={0.95}
      />
      <text
        x={r.x}
        y={r.y}
        data-testid={`motor-rpm-${partId}`}
        textAnchor="middle"
        fontSize={r.fontSize}
        fontFamily="ui-monospace, monospace"
        fill={state.stalled === true ? '#c0392b' : '#1f2933'}
      >
        {`${rpm} rpm`}
      </text>
      <title>{`${rpm} rpm — ${note}`}</title>
    </g>
  )
}

// ─── Sensor target ────────────────────────────────────────────────────────────

/**
 * The line above the marker: what the sensor is actually reporting.
 *
 * READ OFF THE DEVICE STATE WHENEVER THERE IS ONE, and off the document only
 * when there is not. That order is the whole point of the control. The document
 * says where the student PUT the target; the report says what the module MADE OF
 * it, and they are not always the same sentence — an HC-SR04 target at 420 cm is
 * past the datasheet's 400 cm window, so the module answers with its 38 ms
 * timeout pulse and the honest readout is `no echo`, not `420 cm`. A label
 * rendered from the prop would cheerfully print a distance the sketch will never
 * receive.
 */
function targetReadout(
  def: PartDefinition,
  state: DeviceState | undefined,
  distance: number,
): string {
  const el = def.electrical
  const num = (k: string, fallback: number): number => {
    const v = state?.[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }

  if (el.kind === 'sensor' && el.protocol === 'hc_sr04') {
    const cm = num('distanceCm', distance)
    // Both units, as Tinkercad's readout gives them, because a lab sheet that
    // says "hold it 18 inches away" and a sketch that prints centimetres are
    // both things a student is holding in their head at the same time.
    const both = `${round1(cm)} cm · ${round1(cm / 2.54)} in`
    return state && state.inRange === false ? `${both} · no echo` : both
  }

  if (el.kind === 'sensor' && el.protocol === 'pir') {
    const metres = `${round1(num('distanceCm', distance) / 100)} m`
    if (!state) return metres
    if (state.warming === true) return `${metres} · warming up`
    if (state.powered === false) return `${metres} · unpowered`
    return `${metres} · ${state.motion === true ? 'motion' : 'clear'}`
  }

  return String(distance)
}

/** One decimal place, with a trailing `.0` trimmed — 113.4, 44.6, 3, 7.5. */
function round1(v: number): string {
  const s = (Math.round(v * 10) / 10).toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/**
 * A draggable object out in front of a sensor, with the field it is or is not
 * inside, and a live readout of what the module makes of it.
 *
 * THE COLOUR OF THE CONE COMES FROM THE SOLVED STATE AND FROM NOWHERE ELSE, and
 * that is the assertion the test file exists to defend. Ticking `motion` in the
 * inspector does not light this cone; the HC-SR501 model reporting `motion:
 * true` lights it. The two are different by a hold time, a 2.5 s block window
 * and a warm-up — every one of which is a real datasheet behaviour that was
 * previously invisible, and all three of which a cone painted from the document
 * would flatly contradict.
 *
 * Everything the knob and the slider do about accessibility applies here
 * unchanged: a pointer drag on a 7-unit marker is unavailable to a keyboard,
 * switch or screen-reader user, so this is a real `role="slider"` with a name, a
 * range, a live value and arrow keys — up and down for distance, left and right
 * for bearing — and the panel sliders stay, writing the same document values.
 */
function SensorTarget({
  part,
  def,
  target,
  prop,
  bearingProp,
  state,
  dragging,
  onGrab,
  onSet,
  onFocus,
}: {
  part: PlacedPart
  def: PartDefinition
  target: TargetControl
  prop: PropSpec
  bearingProp?: PropSpec
  state: DeviceState | undefined
  dragging: boolean
  onGrab: (e: React.PointerEvent) => void
  onSet: (key: string, value: number) => void
  onFocus: () => void
}) {
  const [focused, setFocused] = useState(false)
  const min = prop.min ?? 0
  const max = prop.max ?? 100
  const step = prop.step ?? 1
  const distance = Number(part.props[target.key] ?? prop.default ?? 0)
  const bearing =
    target.bearingKey && bearingProp
      ? Number(part.props[target.bearingKey] ?? bearingProp.default ?? 0)
      : 0
  const at = targetPointFor(target, distance, bearing)
  const reading = targetReadout(def, state, distance)
  const label = `${def.label} target`

  /** The sensor is reporting a detection right now. NOT the document's opinion. */
  const detecting = state?.motion === true
  const warming = state?.warming === true

  function onKeyDown(e: React.KeyboardEvent) {
    const big = Math.max(step, (max - min) / 10)
    // Left/right swing the target across the field; up/down push it out and
    // pull it in. On a target with one degree of freedom all four move the
    // distance, so an arrow key is never inert.
    const bearingStep = bearingProp?.step ?? 5
    let key = target.key
    let next: number | null = null
    if (e.key === 'ArrowUp') next = distance + step
    else if (e.key === 'ArrowDown') next = distance - step
    else if (e.key === 'PageUp') next = distance + big
    else if (e.key === 'PageDown') next = distance - big
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const delta = e.key === 'ArrowRight' ? bearingStep : -bearingStep
      if (bearingProp && target.bearingKey) {
        key = target.bearingKey
        next = Math.min(
          bearingProp.max ?? 90,
          Math.max(bearingProp.min ?? -90, bearing + delta),
        )
      } else {
        next = distance + (e.key === 'ArrowRight' ? step : -step)
      }
    }
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    onSet(key, key === target.key ? Math.min(max, Math.max(min, next)) : next)
  }

  return (
    <g
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={distance}
      aria-valuetext={reading}
      data-testid={`target-${part.id}`}
      onPointerDown={onGrab}
      onKeyDown={onKeyDown}
      onFocus={() => {
        setFocused(true)
        onFocus()
      }}
      onBlur={() => setFocused(false)}
      className={dragging ? 'cursor-grabbing outline-none' : 'cursor-grab outline-none'}
    >
      {target.cone && (
        <path
          d={conePath(target, target.cone, bearing)}
          data-testid={`target-cone-${part.id}`}
          fill={detecting ? CONE_DETECTING : CONE_IDLE}
          fillOpacity={detecting ? 0.3 : 0.11}
          stroke={detecting ? CONE_DETECTING_EDGE : CONE_IDLE}
          strokeWidth={0.8}
          strokeDasharray={warming ? '3 3' : undefined}
          opacity={0.95}
          pointerEvents="none"
        />
      )}

      {/* The sight line. On the ultrasonic, which has no cone, this IS the
          beam — and it is why the marker never looks like it is floating
          unattached to the module that is measuring it. */}
      <line
        x1={target.cx}
        y1={target.cy}
        x2={at.x}
        y2={at.y}
        stroke={detecting ? CONE_DETECTING_EDGE : '#8f959c'}
        strokeWidth={0.9}
        strokeDasharray="3 2.5"
        pointerEvents="none"
      />

      {/* The marker: a reticle, deliberately unlike the slider's plain handle,
          because this one is an OBJECT in the world rather than a position on a
          track. Filled `transparent` under the artwork so the whole disc takes
          the pointer — an unfilled shape takes none at all. */}
      <circle cx={at.x} cy={at.y} r={target.r} fill="transparent" />
      <circle
        cx={at.x}
        cy={at.y}
        r={target.r * 0.72}
        data-testid={`target-marker-${part.id}`}
        fill="#ffffff"
        stroke={dragging || focused ? ACCENT : '#5a6672'}
        strokeWidth={focused && !dragging ? 1.8 : 1.2}
      />
      <circle cx={at.x} cy={at.y} r={target.r * 0.22} fill={dragging || focused ? ACCENT : '#5a6672'} />
      {(dragging || focused) && (
        <circle
          cx={at.x}
          cy={at.y}
          r={target.r + 2.5}
          data-testid={`target-ring-${part.id}`}
          fill="none"
          stroke={ACCENT}
          strokeWidth={focused && !dragging ? 1.2 : 1}
          strokeDasharray={focused && !dragging ? '2 2' : undefined}
          opacity={0.85}
          pointerEvents="none"
        />
      )}

      {/* The readout, counter-rotated for the reason the motor's is: the target
          turns with the part it belongs to, and a reading printed upside down on
          a module rotated 180° is a reading nobody can use. */}
      <g transform={`rotate(${-part.rotation} ${at.x} ${at.y - target.r - 4})`}>
        <text
          x={at.x}
          y={at.y - target.r - 4}
          data-testid={`target-readout-${part.id}`}
          textAnchor="middle"
          fontSize={7}
          fontFamily="ui-monospace, monospace"
          fill={detecting ? '#8a5a00' : '#34495e'}
          paintOrder="stroke"
          stroke="#ffffff"
          strokeWidth={2.4}
          strokeLinejoin="round"
        >
          {reading}
        </text>
      </g>
      <title>
        {`${label}: ${reading} — drag it, or use the arrow keys`}
      </title>
    </g>
  )
}

/** Detection amber, its edge, and the neutral a field that sees nothing takes. */
const CONE_DETECTING = '#f0b429'
const CONE_DETECTING_EDGE = '#b57d0a'
const CONE_IDLE = '#8f959c'

/**
 * The wedge, in part-local units.
 *
 * The arc's sweep flag is 1 — clockwise on screen — because our angles run
 * clockwise from twelve o'clock and SVG's y axis points down, so increasing the
 * angle really does sweep that way. `largeArc` is computed rather than fixed at
 * 0: a part could legitimately declare a field wider than 180°, and a 0 there
 * would silently draw the complement of it.
 */
function conePath(target: TargetControl, cone: { halfAngleDeg: number; range: number }, bearing: number): string {
  const { fromDeg, toDeg } = targetConeEdges(cone, bearing)
  const radius = cone.range * target.scale
  const point = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return {
      x: target.cx + radius * Math.sin(a),
      y: target.cy - radius * Math.cos(a),
    }
  }
  const a = point(fromDeg)
  const b = point(toDeg)
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
  return (
    `M${target.cx.toFixed(2)} ${target.cy.toFixed(2)} ` +
    `L${a.x.toFixed(2)} ${a.y.toFixed(2)} ` +
    `A${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`
  )
}

// ─── Knob ─────────────────────────────────────────────────────────────────────

/**
 * A knob on a part's artwork: drag to turn, or focus it and use the arrow keys.
 *
 * Tinkercad has NO slider in its inspector — continuous values are canvas
 * interactions (DEVICE_CONTROLS_AUDIT.md §2) — and our inert potentiometer knob
 * was reported by a tester as a broken control. This is the fix, but not by
 * moving the value onto the canvas and off the panel: the panel slider stays,
 * both write the same document value, and either one alone would exclude
 * somebody.
 *
 * KEYBOARD IS NOT AN AFTERTHOUGHT HERE. A pointer drag on a 30-unit circle is
 * unavailable to a keyboard, switch or screen-reader user, so the knob is a
 * real `role="slider"` with a name, a range, a live value and arrow-key
 * handling. Its `<title>` gives a pointer user the same reading on hover.
 */
function Knob({
  part,
  def,
  knob,
  prop,
  turning,
  onGrab,
  onSet,
  onFocus,
}: {
  part: PlacedPart
  def: PartDefinition
  knob: KnobControl
  prop: PropSpec
  turning: boolean
  onGrab: (e: React.PointerEvent) => void
  onSet: (value: number) => void
  onFocus: () => void
}) {
  const [focused, setFocused] = useState(false)
  const min = prop.min ?? 0
  const max = prop.max ?? 100
  const step = prop.step ?? 1
  const value = Number(part.props[knob.key] ?? prop.default ?? 0)
  const label = `${def.label} ${prop.label.toLowerCase()}`
  const reading = `${value}${prop.unit ?? ''}`

  function onKeyDown(e: React.KeyboardEvent) {
    // Big steps on PageUp/PageDown, ends on Home/End — the standard slider
    // keyboard contract, which is what `role="slider"` promises a screen reader.
    const big = Math.max(step, (max - min) / 10)
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? value + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? value - step
          : e.key === 'PageUp'
            ? value + big
            : e.key === 'PageDown'
              ? value - big
              : e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? max
                  : null
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    onSet(Math.min(max, Math.max(min, next)))
  }

  return (
    <g
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={reading}
      data-testid={`knob-${part.id}`}
      onPointerDown={onGrab}
      onKeyDown={onKeyDown}
      onFocus={() => {
        setFocused(true)
        onFocus()
      }}
      onBlur={() => setFocused(false)}
      className={turning ? 'cursor-grabbing outline-none' : 'cursor-grab outline-none'}
    >
      {/* Invisible grab target over the cap. Painted `transparent` rather than
          left fill-less, because an unfilled shape takes no pointer at all. */}
      <circle cx={knob.cx} cy={knob.cy} r={knob.r} fill="transparent" />
      {/* A ring, only while turning or focused. The artwork already looks like a
          knob; a permanent overlay would just obscure it. The focus ring is
          drawn rather than left to `outline`, because an SVG <g> gets no usable
          focus outline in Safari or Firefox — the one browser that does draw it
          is not enough to call a control keyboard-operable. */}
      {(turning || focused) && (
        <circle
          cx={knob.cx}
          cy={knob.cy}
          r={knob.r}
          data-testid={`knob-ring-${part.id}`}
          fill="none"
          stroke={ACCENT}
          strokeWidth={focused && !turning ? 2 : 1.5}
          strokeDasharray={focused && !turning ? '4 3' : undefined}
          opacity={0.85}
          pointerEvents="none"
        />
      )}
      <title>{`${label}: ${reading} — drag to turn, or use the arrow keys`}</title>
    </g>
  )
}

// ─── Slider ───────────────────────────────────────────────────────────────────

/**
 * A handle on a track drawn on a part's artwork: drag it, or use the arrow keys.
 *
 * The photoresistor's light level is the case this exists for. Tinkercad has no
 * slider in its INSPECTOR (DEVICE_CONTROLS_AUDIT.md §2) because a continuously
 * variable physical thing is adjusted where it lives — but an LDR has no shaft
 * to turn, so the affordance is a track rather than a knob.
 *
 * Everything the knob does about accessibility applies here unchanged, and for
 * the same reason: a pointer drag on a 3.6-unit handle is unavailable to a
 * keyboard, switch or screen-reader user, so this is a real `role="slider"` with
 * a name, a range, a live value and arrow-key handling — and the panel slider
 * stays, writing the same document value.
 */
function Slider({
  part,
  def,
  slider,
  prop,
  sliding,
  onGrab,
  onSet,
  onFocus,
}: {
  part: PlacedPart
  def: PartDefinition
  slider: SliderControl
  prop: PropSpec
  sliding: boolean
  onGrab: (e: React.PointerEvent) => void
  onSet: (value: number) => void
  onFocus: () => void
}) {
  const [focused, setFocused] = useState(false)
  const min = prop.min ?? 0
  const max = prop.max ?? 100
  const step = prop.step ?? 1
  const value = Number(part.props[slider.key] ?? prop.default ?? 0)
  const label = `${def.label} ${prop.label.toLowerCase()}`
  const reading = `${value}${prop.unit ?? ''}`
  const at = sliderPointFor(slider, prop, value)

  function onKeyDown(e: React.KeyboardEvent) {
    const big = Math.max(step, (max - min) / 10)
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? value + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? value - step
          : e.key === 'PageUp'
            ? value + big
            : e.key === 'PageDown'
              ? value - big
              : e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? max
                  : null
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    onSet(Math.min(max, Math.max(min, next)))
  }

  return (
    <g
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={reading}
      data-testid={`slider-${part.id}`}
      onPointerDown={onGrab}
      onKeyDown={onKeyDown}
      onFocus={() => {
        setFocused(true)
        onFocus()
      }}
      onBlur={() => setFocused(false)}
      className={sliding ? 'cursor-grabbing outline-none' : 'cursor-grab outline-none'}
    >
      {/* The whole track takes the pointer, not just the handle: clicking the
          track jumps the handle there, which is what every slider does and is
          the only way to reach an end on a 26-unit run without a careful drag.
          A wide transparent band under the visible line is the hit area. */}
      <line
        x1={slider.x1}
        y1={slider.y1}
        x2={slider.x2}
        y2={slider.y2}
        stroke="transparent"
        strokeWidth={slider.r * 2.4}
        strokeLinecap="round"
      />
      <line
        x1={slider.x1}
        y1={slider.y1}
        x2={slider.x2}
        y2={slider.y2}
        stroke="#b8bec5"
        strokeWidth={1.4}
        strokeLinecap="round"
        pointerEvents="none"
      />
      {/* The travelled part of the track, so the value reads at a glance
          without a number beside it. */}
      <line
        x1={slider.x1}
        y1={slider.y1}
        x2={at.x}
        y2={at.y}
        stroke={ACCENT}
        strokeWidth={1.4}
        strokeLinecap="round"
        pointerEvents="none"
      />
      <circle
        cx={at.x}
        cy={at.y}
        r={slider.r}
        data-testid={`slider-handle-${part.id}`}
        fill="#ffffff"
        stroke={sliding || focused ? ACCENT : '#8f959c'}
        strokeWidth={focused && !sliding ? 1.6 : 1}
        pointerEvents="none"
      />
      {(sliding || focused) && (
        <circle
          cx={at.x}
          cy={at.y}
          r={slider.r + 2.5}
          data-testid={`slider-ring-${part.id}`}
          fill="none"
          stroke={ACCENT}
          strokeWidth={focused && !sliding ? 1.2 : 1}
          strokeDasharray={focused && !sliding ? '2 2' : undefined}
          opacity={0.85}
          pointerEvents="none"
        />
      )}
      <title>{`${label}: ${reading} — drag it, or use the arrow keys`}</title>
    </g>
  )
}

// ─── Momentary ────────────────────────────────────────────────────────────────

/**
 * A press-and-hold control on a part's artwork.
 *
 * `role="button"` and not `role="switch"`, deliberately: a switch has a state
 * the user sets, and this has an action they perform. A screen reader announcing
 * "switch, off" over a momentary pushbutton would be describing the panel
 * checkbox, not this.
 *
 * KEYBOARD IS THE HARD CASE and it is why this cannot be a pointer-only control.
 * A keyboard has no "held" — key-repeat fires press events at the OS's repeat
 * rate with no reliable release — so Space and Enter TOGGLE instead, which is
 * the honest equivalent and is what the panel checkbox does too. The tooltip and
 * the accessible description both say which gesture does what, rather than
 * leaving a keyboard user to discover that holding a key does nothing.
 */
function Momentary({
  part,
  def,
  momentary,
  prop,
  onPress,
  onSet,
  onFocus,
}: {
  part: PlacedPart
  def: PartDefinition
  momentary: MomentaryControl
  prop: PropSpec
  onPress: (e: React.PointerEvent) => void
  onSet: (value: number) => void
  onFocus: () => void
}) {
  const [focused, setFocused] = useState(false)
  const down = Number(part.props[momentary.key] ?? prop.default ?? 0) >= 0.5
  const label = `${def.label} ${prop.label.replace(/\s*\(latched\)\s*/i, '').toLowerCase()}`

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    // Only on the FIRST press, not on every repeat — holding Space down would
    // otherwise chatter the contacts at the key-repeat rate.
    if (e.repeat) return
    onSet(down ? 0 : 1)
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={down}
      data-testid={`momentary-${part.id}`}
      onPointerDown={onPress}
      onKeyDown={onKeyDown}
      onFocus={() => {
        setFocused(true)
        onFocus()
      }}
      onBlur={() => setFocused(false)}
      className="cursor-pointer outline-none"
    >
      {/* Invisible grab target over the cap — `transparent`, not fill-less, or
          it would take no pointer at all. */}
      <circle cx={momentary.cx} cy={momentary.cy} r={momentary.r} fill="transparent" />
      {focused && (
        <circle
          cx={momentary.cx}
          cy={momentary.cy}
          r={momentary.r + 2}
          data-testid={`momentary-ring-${part.id}`}
          fill="none"
          stroke={ACCENT}
          strokeWidth={2}
          strokeDasharray="4 3"
          opacity={0.85}
          pointerEvents="none"
        />
      )}
      <title>
        {`${label}: ${down ? 'pressed' : 'released'} — hold to press, or Space to toggle`}
      </title>
    </g>
  )
}

// ─── Wire geometry ────────────────────────────────────────────────────────────
//
// The path lives in lib/simulator/model/wire-path.ts and the hit rule in
// lib/simulator/model/wire-hit.ts, both so they can be asserted on without
// mounting React. What stays here is the wire's COLOUR at birth, which needs
// the part catalogue.

/**
 * The colour a new wire between these two pins is born with.
 *
 * Tinkercad hands out whichever colour the student last picked. We have no
 * picker, so colour is the one thing left to carry meaning: a wire touching a
 * ground pin is black and a wire touching a supply pin is red, the way a bench
 * is wired, and everything else cycles so that two signal wires crossing are
 * still tellable apart. The cycle counts only the wires already using it, so
 * reserving a rail colour does not punch a hole in the sequence.
 */
function wireColorFor(doc: CircuitDoc, a: PinRef, b: PinRef): string {
  const kinds = [a, b].map((ref) => {
    const part = doc.parts.find((p) => p.id === ref.partId)
    if (!part) return undefined
    return getPart(part.type).pins.find((pin) => pin.id === ref.pinId)?.type
  })
  if (kinds.includes('gnd')) return WIRE_COLOR_GND
  if (kinds.includes('power')) return WIRE_COLOR_POWER
  const used = doc.wires.filter((w) => WIRE_COLORS.includes(w.color)).length
  return WIRE_COLORS[used % WIRE_COLORS.length]
}

// ─── Wire ─────────────────────────────────────────────────────────────────────

/**
 * One drawn wire: casing, core, an invisible grab band, and — only while the
 * pointer is on it — a handle per waypoint.
 *
 * PURELY PRESENTATIONAL. Every pointer decision about this wire is taken in
 * the canvas, by `grabAt`, because the shape that receives an event is
 * the topmost one and the wire a student is pointing at very often is not it.
 * `hovered` and `shaping` arrive already resolved.
 */
function Wire({
  wire,
  a,
  b,
  lit,
  shaping,
  hovered,
  selected,
}: {
  wire: DocWire
  a: Point
  b: Point
  lit: boolean
  /** A gesture is shaping this wire, so its handles stay out. */
  shaping: boolean
  /** The pointer is over this wire — resolved by proximity, in the canvas. */
  hovered: boolean
  /** This wire is the one Delete would remove. */
  selected: boolean
}) {
  const points = wire.waypoints ?? []
  const d = wirePath(a, b, wire.waypoints)
  const show = hovered || shaping || selected

  return (
    <g data-testid={`wire-${wire.id}`}>
      {/* Halo, under everything. One state for hover, shaping and net
          highlighting: all three mean "this wire", and none of them is a
          reason to repaint it a colour it is not. */}
      {(lit || show) && (
        <path
          d={d}
          data-testid={`wire-halo-${wire.id}`}
          fill="none"
          stroke={WIRE_HALO_COLOR}
          strokeWidth={WIRE_HALO}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={WIRE_HALO_OPACITY}
          pointerEvents="none"
        />
      )}
      {/* The selection, drawn as a dashed accent OVER the halo and UNDER the
          wire's own colours — the same marching outline a selected part gets,
          for the same reason: a student has to be able to see which of the two
          Delete is about to take. Never a recolour of the core, because a wire's
          colour is information (black is ground, red is supply) and a selection
          that repainted it would be lying about the circuit while it was lit. */}
      {selected && (
        <path
          d={d}
          data-testid={`wire-selected-${wire.id}`}
          fill="none"
          stroke={ACCENT}
          strokeWidth={WIRE_CASING + 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="5 4"
          pointerEvents="none"
        />
      )}
      {/* Casing under core, so wires crossing each other stay legible. */}
      <path
        d={d}
        fill="none"
        stroke={wireCasing(wire.color)}
        strokeWidth={WIRE_CASING}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      <path
        d={d}
        data-testid={`wire-core-${wire.id}`}
        fill="none"
        stroke={wire.color}
        strokeWidth={WIRE_CORE}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      {/* A band along the stroke. It no longer carries the handlers — the
          canvas resolves the press — but it still earns its place: it is what
          gives the wire a pointer cursor and a tooltip, and `pointer-events`
          on the STROKE rather than the fill matters because a bent wire
          encloses the area between its bends and filling it would put a
          transparent sheet over the board underneath. */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={WIRE_HIT}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
        className="cursor-pointer"
      >
        <title>Click to select · drag to bend · double-click to add a bend</title>
      </path>

      {show &&
        points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill="#fff"
            stroke={wire.color}
            strokeWidth={1.6}
            className="cursor-grab"
            data-testid={`waypoint-${wire.id}-${i}`}
          >
            <title>Drag to shape · double-click to remove</title>
          </circle>
        ))}
    </g>
  )
}

// ─── Pins ─────────────────────────────────────────────────────────────────────

/**
 * How wide a pin's invisible hit target may grow.
 *
 * Bigger is better up to a point — a 0.1in hole is ~4px at 1x zoom, far below
 * any usable pointer target — but SVG hit-testing picks the TOPMOST shape, not
 * the nearest. A radius larger than the pin pitch would park a neighbour's
 * circle over this pin's centre and make it unpickable, so the target widens to
 * 12 units on sparse parts (discretes, sensors) and holds at the previous flat
 * 7 on dense 0.1in headers, where 7 was already the practical ceiling. The
 * floor is 7, not the derived value, so no pin ends up SMALLER than it was.
 */
const hitRadiusCache = new Map<string, number>()
function hitRadius(def: PartDefinition): number {
  const cached = hitRadiusCache.get(def.type)
  if (cached !== undefined) return cached

  const pins = def.pins.filter((p) => !p.subtle)
  let min = Infinity
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      min = Math.min(min, Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y))
    }
  }
  const r = pins.length < 2 ? 12 : Math.max(7, Math.min(12, min - 3))
  hitRadiusCache.set(def.type, r)
  return r
}

function Pin({
  pin,
  hitR,
  partId,
  netOf,
  hoverNet,
  wiring,
  onEnter,
  onLeave,
  onDown,
  onUp,
}: {
  pin: PinGeometry
  /** Radius of the invisible pointer target, in world units. */
  hitR: number
  partId: string
  netOf?: Map<string, number>
  hoverNet: number | null
  wiring: boolean
  onEnter: () => void
  onLeave: () => void
  onDown: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}) {
  const [hover, setHover] = useState(false)
  const net = netOf?.get(`${partId} ${pin.id}`)
  const lit = hoverNet != null && net === hoverNet
  const color =
    pin.type === 'gnd' ? '#111827' : pin.type === 'power' ? '#e04a4a' : '#f0b429'

  return (
    <g
      onPointerEnter={() => {
        setHover(true)
        onEnter()
      }}
      onPointerLeave={() => {
        setHover(false)
        onLeave()
      }}
      onPointerDown={onDown}
      onPointerUp={onUp}
      className="cursor-crosshair"
    >
      {/* Generous invisible hit target — see hitRadius() above. */}
      <circle cx={pin.x} cy={pin.y} r={pin.subtle ? 5 : hitR} fill="transparent" />
      {/* Hover halo: the only thing that told a student a pin was live used to
          be the cursor, which they cannot see until they are already on it. */}
      {hover && (
        <circle
          cx={pin.x}
          cy={pin.y}
          r={pin.subtle ? 4.5 : 7}
          fill={ACCENT}
          opacity={0.28}
          pointerEvents="none"
        />
      )}
      <circle
        cx={pin.x}
        cy={pin.y}
        r={lit ? 4 : pin.subtle ? 1.8 : 2.8}
        fill={lit ? ACCENT : color}
        opacity={pin.subtle && !lit && !wiring && !hover ? 0.25 : 1}
        pointerEvents="none"
      />
      {/* Template string, not two children: a browser treats <title> as a single
          text node, so React refuses to serialise an array into it. */}
      {!pin.subtle && (
        <title>{`${pin.name}${net !== undefined ? ` — net ${net}` : ''}`}</title>
      )}
    </g>
  )
}
