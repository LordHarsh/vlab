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
  partBounds,
  pinPosition,
  samePin,
  snap,
  type CircuitDoc,
  type DocAction,
  type PinRef,
  type PlacedPart,
} from '@/lib/simulator/model/document'

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
    if (drag) {
      dispatch({
        type: 'movePart',
        id: drag.id,
        x: snap(w.x - drag.offsetX),
        y: snap(w.y - drag.offsetY),
      })
    }
  }

  function onPointerUp() {
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

  const wirePath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    // Gentle S-curve: reads as a flexible jumper lead rather than a PCB trace.
    const dx = Math.abs(b.x - a.x)
    const sag = Math.min(40, dx * 0.35 + 10)
    return `M ${a.x} ${a.y} C ${a.x} ${a.y + sag}, ${b.x} ${b.y + sag}, ${b.x} ${b.y}`
  }

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
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
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

          {/* Wires under parts, so pins stay clickable */}
          {doc.wires.map((w) => {
            const a = partById.get(w.from.partId)
            const b = partById.get(w.to.partId)
            if (!a || !b) return null
            const pa = pinPosition(a, w.from.pinId)
            const pb = pinPosition(b, w.to.pinId)
            if (!pa || !pb) return null
            const net = netOf?.get(`${w.from.partId} ${w.from.pinId}`)
            const lit = hoverNet != null && net === hoverNet
            return (
              <path
                key={w.id}
                d={wirePath(pa, pb)}
                fill="none"
                stroke={lit ? '#1477d1' : w.color}
                strokeWidth={lit ? 3.5 : 2.5}
                strokeLinecap="round"
                className="cursor-pointer"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'removeWire', id: w.id })
                }}
              />
            )
          })}

          {/* Parts */}
          {doc.parts.map((part) => {
            const def = getPart(part.type)
            const bounds = partBounds(part)
            const isSel = selected === part.id
            const brightness = ledBrightness?.get(part.id) ?? 0
            const ledFill =
              def.electrical.kind === 'led'
                ? `rgb(${Math.round(70 + brightness * 185)},${Math.round(25 + brightness * 45)},${Math.round(25 + brightness * 35)})`
                : undefined

            return (
              <g
                key={part.id}
                transform={`translate(${part.x} ${part.y}) rotate(${part.rotation} ${def.width / 2} ${def.height / 2})`}
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
                    stroke="#1477d1"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    pointerEvents="none"
                  />
                )}

                {/* Pins last, so they sit above the body art. Breadboard tie
                    points are hidden below 0.55x, where a 0.1in hole is under
                    3px and cannot be aimed at anyway. */}
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
                    onDown={(e) => (wire ? finishWire(e, { partId: part.id, pinId: pin.id }) : startWire(e, { partId: part.id, pinId: pin.id }))}
                    onUp={(e) => finishWire(e, { partId: part.id, pinId: pin.id })}
                  />
                  ))}
                {void bounds}
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
                  stroke="#1477d1"
                  strokeWidth={2.5}
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
          fill="#1477d1"
          opacity={0.28}
          pointerEvents="none"
        />
      )}
      <circle
        cx={pin.x}
        cy={pin.y}
        r={lit ? 4 : pin.subtle ? 1.8 : 2.8}
        fill={lit ? '#1477d1' : color}
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
