'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  PITCH,
  getPart,
  knobAngleFor,
  knobValueFor,
  ledBodyFill,
  ledColour,
  ledGlowFill,
  type KnobControl,
  type PartDefinition,
  type PinGeometry,
  type PropSpec,
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

export function CircuitCanvas({
  doc,
  dispatch,
  ledBrightness,
  netOf,
  selected,
  onSelect,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 40, y: 30, z: 1.1 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [wire, setWire] = useState<WireDraft | null>(null)
  const [hoverNet, setHoverNet] = useState<number | null>(null)
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null)
  const gesture = useRef<WireGesture | null>(null)
  /** Which wire a gesture is on, purely so its handles stay visible. */
  const [shaping, setShaping] = useState<string | null>(null)
  const [knobDrag, setKnobDrag] = useState<KnobDrag | null>(null)

  /** Client coords → world coords. All interaction maths happens in world space. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - view.x) / view.z,
        y: (clientY - rect.top - view.y) / view.z,
      }
    },
    [view],
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

    if (panning) {
      setView((v) => ({ ...v, x: v.x + (e.clientX - panning.x), y: v.y + (e.clientY - panning.y) }))
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
    setView((v) => {
      const z = Math.min(4, Math.max(0.3, v.z * factor))
      // Keep the point under the cursor fixed while zooming.
      return { z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z }
    })
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full bg-[#f4f5f6] overflow-hidden">
      {/* Zoom readout. The parts palette now lives in the right rail — floating
          it over the artwork hid the very circuit it was there to build. */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-[#566573] font-mono">
        {Math.round(view.z * 100)}% · scroll to zoom · drag background to pan
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

        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
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
                  .filter((pin) => !pin.subtle || view.z > 0.55)
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
