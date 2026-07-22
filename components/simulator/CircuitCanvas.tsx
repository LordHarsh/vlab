'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  PITCH,
  getPart,
  type PartDefinition,
  type PinGeometry,
} from '@/lib/simulator/model/parts'
import {
  WIRE_COLORS,
  newId,
  pinPosition,
  samePin,
  snap,
  type CircuitDoc,
  type DocAction,
  type DocWire,
  type PinRef,
  type PlacedPart,
  type Point,
} from '@/lib/simulator/model/document'

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

/** Coloured core, darker casing beneath it, invisible grab band over both. */
const WIRE_CORE = 2.6
const WIRE_CASING = 5
const WIRE_HIT = 9

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
   * `released` separates a real pointerup from the pointer simply leaving the
   * canvas: only the former may fire click-to-delete, and only when the
   * pointer never travelled far enough to count as a drag.
   */
  function endGesture(released: boolean) {
    const g = gesture.current
    if (g) {
      gesture.current = null
      setShaping(null)
      if (released && !g.moved && g.kind === 'body') {
        dispatch({ type: 'removeWire', id: g.wireId })
      }
    }
    setDrag(null)
    setPanning(null)
    // A wire released over empty space is abandoned, not left dangling.
    setWire(null)
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
          color: WIRE_COLORS[doc.wires.length % WIRE_COLORS.length],
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
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-[#6b7c8d] font-mono">
        {Math.round(view.z * 100)}% · scroll to zoom · drag background to pan
      </div>

      <svg
        ref={svgRef}
        className="w-full h-full touch-none"
        data-testid="canvas"
        onPointerMove={onPointerMove}
        onPointerUp={() => endGesture(true)}
        onPointerLeave={() => endGesture(false)}
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
            const ledFill =
              def.electrical.kind === 'led'
                ? `rgb(${Math.round(70 + brightness * 185)},${Math.round(25 + brightness * 45)},${Math.round(25 + brightness * 35)})`
                : undefined

            return (
              <g
                key={part.id}
                transform={partTransform(part, def)}
                data-testid={`part-${part.id}`}
              >
                {def.electrical.kind === 'led' && brightness > 0.02 && (
                  <circle
                    cx={15}
                    cy={20}
                    r={14 + brightness * 26}
                    fill={`rgba(255,70,50,${brightness * 0.32})`}
                    pointerEvents="none"
                  />
                )}

                <g
                  style={ledFill ? ({ '--led-fill': ledFill } as React.CSSProperties) : undefined}
                  onPointerDown={(e) => startPartDrag(e, part)}
                  className="cursor-move"
                  dangerouslySetInnerHTML={{ __html: def.svg }}
                />

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
                  strokeWidth={2.5}
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

// ─── Wire geometry ────────────────────────────────────────────────────────────

/** Two decimals is under a tenth of a pixel and keeps the DOM readable. */
const f = (n: number) => Math.round(n * 100) / 100

/**
 * A slack lead between two pins.
 *
 * Both control points sit a third of the way along the chord and sag
 * downwards, so the curve bows roughly 0.75 × sag below its middle while still
 * arriving dead on each pin: a jumper hanging under its own weight rather than
 * a PCB trace. The cap stops a long lead drooping over whatever is beneath it.
 */
function droopPath(a: Point, b: Point): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const sag = Math.min(26, Math.hypot(dx, dy) * 0.15 + 3)
  return (
    `M ${f(a.x)} ${f(a.y)} ` +
    `C ${f(a.x + dx / 3)} ${f(a.y + dy / 3 + sag)}, ` +
    `${f(a.x + (dx * 2) / 3)} ${f(a.y + (dy * 2) / 3 + sag)}, ` +
    `${f(b.x)} ${f(b.y)}`
  )
}

/**
 * Uniform Catmull-Rom through every point, emitted as cubic béziers.
 *
 * Each segment begins and ends ON its own two points and only borrows the
 * neighbours for tangents, so the curve passes EXACTLY through every waypoint
 * — the handle a student is dragging is always on the wire, never beside it.
 * The two end tangents duplicate their endpoint, which stops the first and
 * last segments overshooting the pins they terminate on.
 */
function splinePath(pts: Point[]): string {
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    d +=
      ` C ${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)},` +
      ` ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)},` +
      ` ${f(p2.x)} ${f(p2.y)}`
  }
  return d
}

/**
 * The drawn route of a wire.
 *
 * No waypoints — every document authored before they existed — falls through
 * to the plain slack curve, so an old circuit renders exactly as it always did.
 */
export function wirePath(a: Point, b: Point, waypoints?: Point[]): string {
  return waypoints && waypoints.length > 0 ? splinePath([a, ...waypoints, b]) : droopPath(a, b)
}

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
 * so the index of the nearest segment IS the insertion index. Measured against
 * the straight chords rather than the drawn curve: the two differ by a few
 * units at most, and never by enough to pick the wrong segment.
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

/** The wire's own colour, darkened, for the casing drawn under the core. */
const shadeCache = new Map<string, string>()
function shade(hex: string): string {
  const hit = shadeCache.get(hex)
  if (hit) return hit
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : null
  const out =
    n === null
      ? 'rgba(17,24,39,0.55)'
      : `rgb(${Math.round(((n >> 16) & 255) * 0.55)},${Math.round(((n >> 8) & 255) * 0.55)},${Math.round((n & 255) * 0.55)})`
  shadeCache.set(hex, out)
  return out
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
      {/* Casing under core, so wires crossing each other stay legible. */}
      <path
        d={d}
        fill="none"
        stroke={shade(wire.color)}
        strokeWidth={lit ? WIRE_CASING + 1 : WIRE_CASING}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      <path
        d={d}
        data-testid={`wire-core-${wire.id}`}
        fill="none"
        stroke={lit ? ACCENT : wire.color}
        strokeWidth={lit ? 3.5 : WIRE_CORE}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      {/* The only part of a wire that takes a pointer: a band along the stroke.
          `fill="none"` plus pointer-events on the stroke matters — a drooping
          wire encloses a large area, and filling it would swallow every click
          on the board underneath. */}
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
      />

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
