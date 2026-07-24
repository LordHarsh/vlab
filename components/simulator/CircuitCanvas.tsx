'use client'

import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  PITCH,
  getPart,
  knobAngleFor,
  knobValueFor,
  ledBodyFill,
  ledColour,
  ledGlowFill,
  sliderPointFor,
  sliderValueFor,
  type KnobControl,
  type MomentaryControl,
  type PartDefinition,
  type PinGeometry,
  type PropSpec,
  type SliderControl,
} from '@/lib/simulator/model/parts'
import {
  WIRE_COLORS,
  WIRE_COLOR_GND,
  WIRE_COLOR_POWER,
  newId,
  pinPosition,
  samePin,
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

const ACCENT = '#1477d1'

interface Props {
  doc: CircuitDoc
  dispatch: (a: DocAction) => void
  /** partId → 0..1 LED brightness, from the running simulation. */
  ledBrightness?: Map<string, number>
  /** pinKey → net id, for highlighting connected nets. */
  netOf?: Map<string, number>
  selected: string | null
  onSelect: (id: string | null) => void
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

interface WireDraft {
  from: PinRef
  x: number
  y: number
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
}

/**
 * How far a pointer may wander before a click becomes a drag.
 *
 * Clicking a wire deletes it, so a shaky click must not delete the wire the
 * student was trying to bend — nor must a bend leave a delete behind it.
 */
const DRAG_SLOP = 4

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
  netOf,
  selected,
  onSelect,
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
  const [knobDrag, setKnobDrag] = useState<KnobDrag | null>(null)
  const [sliderDrag, setSliderDrag] = useState<SliderDrag | null>(null)
  /** The part whose momentary control is being held down, if any. */
  const [holding, setHolding] = useState<string | null>(null)

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

    if (panning) {
      dispatchView({ type: 'pan', dx: e.clientX - panning.x, dy: e.clientY - panning.y })
      setPanning({ x: e.clientX, y: e.clientY })
      return
    }
    if (wire) {
      setWire({ ...wire, x: w.x, y: w.y })
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
    }
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
      gesture.current = null
      setShaping(null)
    }
    setDrag(null)
    setPanning(null)
    setKnobDrag(null)
    setSliderDrag(null)
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
    // A wire released over empty space is abandoned, not left dangling.
    setWire(null)
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
    e.stopPropagation()
    onSelect(part.id)
    setHolding(part.id)
    dispatch({ type: 'setProp', id: part.id, key: momentary.key, value: 1 })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  function startPartDrag(e: React.PointerEvent, part: PlacedPart) {
    e.stopPropagation()
    const w = toWorld(e.clientX, e.clientY)
    onSelect(part.id)
    setDrag({ kind: 'part', id: part.id, offsetX: w.x - part.x, offsetY: w.y - part.y })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  /**
   * Pointer down on a wire's own stroke, or on one of its handles.
   *
   * Deliberately does NOT capture the pointer. A drag leaves the 9-unit hit
   * band within a frame or two, and capture would suppress the boundary events
   * that turn the wire's hover off — the handles then stayed on screen after
   * the drag finished, which is exactly what "not permanently" rules out. The
   * svg's own pointermove drives the drag either way, and `shaping` is what
   * holds the handles visible while it runs.
   */
  function startWireGesture(e: React.PointerEvent, g: Omit<WireGesture, 'moved' | 'pushed'>) {
    e.stopPropagation()
    gesture.current = { ...g, moved: false, pushed: false }
    setShaping(g.wireId)
  }

  function startWire(e: React.PointerEvent, ref: PinRef) {
    e.stopPropagation()
    const w = toWorld(e.clientX, e.clientY)
    setWire({ from: ref, x: w.x, y: w.y })
  }

  function finishWire(e: React.PointerEvent, ref: PinRef) {
    e.stopPropagation()
    if (!wire) return
    if (!samePin(wire.from, ref)) {
      dispatch({
        type: 'addWire',
        wire: {
          id: newId('w'),
          from: wire.from,
          to: ref,
          color: wireColorFor(doc, wire.from, ref),
        },
      })
    }
    setWire(null)
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
        onPointerLeave={() => endGesture()}
        onWheel={onWheel}
        onPointerDown={(e) => {
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
                onGrabBody={(e, at, index) =>
                  startWireGesture(e, { wireId: w.id, index, kind: 'body', startX: at.x, startY: at.y })
                }
                onGrabHandle={(e, index, at) =>
                  startWireGesture(e, { wireId: w.id, index, kind: 'handle', startX: at.x, startY: at.y })
                }
                onRemoveHandle={(index) => dispatch({ type: 'removeWaypoint', id: w.id, index })}
                onRemove={() => dispatch({ type: 'removeWire', id: w.id })}
                toWorld={toWorld}
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
                      onDown={(e) =>
                        wire
                          ? finishWire(e, { partId: part.id, pinId: pin.id })
                          : startWire(e, { partId: part.id, pinId: pin.id })
                      }
                      onUp={(e) => finishWire(e, { partId: part.id, pinId: pin.id })}
                    />
                  ))}
              </g>
            )
          })}

          {/* In-flight wire */}
          {wire &&
            (() => {
              const p = partById.get(wire.from.partId)
              const from = p && pinPosition(p, wire.from.pinId)
              if (!from) return null
              return (
                <path
                  d={wirePath(from, { x: wire.x, y: wire.y })}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={WIRE_CASING}
                  strokeLinecap="round"
                  strokeDasharray="5 4"
                  pointerEvents="none"
                />
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
// The path itself lives in lib/simulator/model/wire-path.ts, so it can be
// asserted on without mounting React. What stays here is hit-testing: which
// part of a wire the pointer landed on.

function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

/**
 * Which slot a bend grabbed at `p` belongs in.
 *
 * Segment i of [from, ...waypoints, to] runs from waypoint i-1 to waypoint i,
 * so the index of the nearest segment IS the insertion index. The chords ARE
 * the drawn route now — the only place the two part company is inside a
 * corner fillet, where both adjoining segments are equally the right answer.
 */
function grabIndex(pts: Point[], p: Point): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

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
 * Hover lives here rather than in the canvas so that moving over one wire does
 * not re-render the other twenty, and sits on the GROUP rather than the grab
 * band: a handle is a sibling of the band, so leaving the band for a handle
 * would otherwise hide the very handle being reached for.
 */
function Wire({
  wire,
  a,
  b,
  lit,
  shaping,
  onGrabBody,
  onGrabHandle,
  onRemoveHandle,
  onRemove,
  toWorld,
}: {
  wire: DocWire
  a: Point
  b: Point
  lit: boolean
  /** A gesture is shaping this wire, so its handles stay out. */
  shaping: boolean
  onGrabBody: (e: React.PointerEvent, at: Point, index: number) => void
  onGrabHandle: (e: React.PointerEvent, index: number, at: Point) => void
  onRemoveHandle: (index: number) => void
  onRemove: () => void
  toWorld: (clientX: number, clientY: number) => Point
}) {
  const [hover, setHover] = useState(false)
  const points = wire.waypoints ?? []
  const d = wirePath(a, b, wire.waypoints)
  const show = hover || shaping

  return (
    <g
      data-testid={`wire-${wire.id}`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
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
      {/* The only part of a wire that takes a pointer: a band along the stroke.
          `fill="none"` plus pointer-events on the stroke matters — a bent wire
          encloses the area between its bends, and filling it would swallow
          every click on the board underneath. */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={WIRE_HIT}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
        className="cursor-pointer"
        onPointerDown={(e) => {
          const at = toWorld(e.clientX, e.clientY)
          onGrabBody(e, at, grabIndex([a, ...points, b], at))
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        <title>Drag to bend · double-click to remove</title>
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
            onPointerDown={(e) => onGrabHandle(e, i, toWorld(e.clientX, e.clientY))}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onRemoveHandle(i)
            }}
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
