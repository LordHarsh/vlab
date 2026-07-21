'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  PALETTE,
  PART_LIBRARY,
  PITCH,
  getPart,
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
    <div className="relative w-full h-full bg-[#0d1117] overflow-hidden">
      {/* Palette */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 w-40">
        <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-0.5">Parts</div>
        {PALETTE.map((type) => (
          <button
            key={type}
            data-testid={`palette-${type}`}
            onClick={() => {
              const def = PART_LIBRARY[type]
              const id = newId(type.slice(0, 3) + '_')
              dispatch({
                type: 'addPart',
                part: {
                  id,
                  type,
                  x: snap(60 + doc.parts.length * 20),
                  y: snap(60 + doc.parts.length * 30),
                  rotation: 0,
                  props:
                    def.electrical.kind === 'resistor' ? { ohms: def.electrical.defaultOhms } : {},
                },
              })
              onSelect(id)
            }}
            className="text-left px-3 py-2 rounded-lg text-xs bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff] text-[#c9d1d9] transition-colors"
          >
            {PART_LIBRARY[type].label}
          </button>
        ))}
      </div>

      {/* Zoom readout */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-[#6e7681] font-mono">
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
            <circle cx={0} cy={0} r={0.6} fill="#21262d" />
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
                stroke={lit ? '#58a6ff' : w.color}
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
                    stroke="#58a6ff"
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
                  stroke="#58a6ff"
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

function Pin({
  pin,
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
  partId: string
  netOf?: Map<string, number>
  hoverNet: number | null
  wiring: boolean
  onEnter: () => void
  onLeave: () => void
  onDown: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}) {
  const net = netOf?.get(`${partId} ${pin.id}`)
  const lit = hoverNet != null && net === hoverNet
  const color =
    pin.type === 'gnd' ? '#111827' : pin.type === 'power' ? '#e04a4a' : '#f0b429'

  return (
    <g
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onDown}
      onPointerUp={onUp}
      className="cursor-crosshair"
    >
      {/* Generous invisible hit target — a 0.1in hole is ~4px at 1x zoom, far
          below any usable pointer target, let alone a 44px touch target. */}
      <circle cx={pin.x} cy={pin.y} r={pin.subtle ? 5 : 7} fill="transparent" />
      <circle
        cx={pin.x}
        cy={pin.y}
        r={lit ? 4 : pin.subtle ? 1.8 : 2.8}
        fill={lit ? '#58a6ff' : color}
        opacity={pin.subtle && !lit && !wiring ? 0.25 : 1}
        pointerEvents="none"
      />
      {!pin.subtle && (
        <title>
          {pin.name}
          {net !== undefined ? ` — net ${net}` : ''}
        </title>
      )}
    </g>
  )
}
