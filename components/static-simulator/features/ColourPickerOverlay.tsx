'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  pinPosition,
  WIRE_PALETTE,
  type CircuitDoc,
  type PlacedPart,
} from '@/lib/simulator/model/document'
import { getPart, LED_COLOURS } from '@/lib/simulator/model/parts'
import { wirePath } from '@/lib/simulator/model/wire-path'
import { fitView, partBoxWorld } from './fit'

/**
 * PART 2 OF THE "REALISTIC FAKERY" ADD — COLOUR PICKERS FOR LEDS AND WIRES.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ A CLICK-CATCHING LAYER ABOVE THE CANVAS, NOT INSIDE IT.                 │
 * │                                                                         │
 * │ The read-only canvas is `pointer-events: none` at the drawing layer —   │
 * │ that IS the mechanism the whole panel's "nothing editable" guarantee    │
 * │ rests on (see CircuitCanvas.tsx's `readOnly` doc comment and            │
 * │ StaticCircuit.tsx's). This file never touches that: it renders as a     │
 * │ SIBLING, absolutely positioned over the same box, with its own          │
 * │ transparent hit-shapes. CircuitCanvas.tsx and lib/simulator/ are        │
 * │ read-only imports here (geometry helpers, the palettes) — nothing in    │
 * │ them changes behaviour because of this file.                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * GEOMETRY, NOT A SECOND MODEL. Every hit-shape is built from the SAME
 * functions the real interactive editor's own canvas uses: `wirePath()`
 * (lib/simulator/model/wire-path.ts) for a wire's drawn route, and
 * `partBounds`-derived boxes (./fit.ts's `partBoxWorld`, built on
 * document.ts's exported `partBounds`) for a part's footprint. The fit
 * transform that places both in the panel's pixels is ./fit.ts's — see that
 * file's header for why duplicating it is safe here and nowhere else.
 *
 * WHAT PICKING A COLOUR ACTUALLY CHANGES. `onPickPart`/`onPickWire` report an
 * id and a value; StaticSimulator.tsx is the one place that turns that into a
 * CLONED `CircuitDoc` with just that one part's `props.color` or that one
 * wire's `color` replaced, in local component state. This file never mutates
 * `circuits.ts`'s exported documents and never decides what a colour DOES —
 * it only decides which shape a click landed on.
 *
 * TOPOLOGY IS UNTOUCHED. There is no way to reach this overlay's callbacks
 * except by clicking an existing LED or an existing wire's drawn route; there
 * is no add, no delete, no move and no rewire anywhere in this file.
 *
 * NOTHING PERSISTS. The colour maps live in StaticSimulator.tsx's own
 * `useState`, gone on reload — see that file for the "nothing to save"
 * accounting that already governs the rest of this panel.
 *
 * KEYBOARD SCOPE, STATED RATHER THAN HIDDEN. The trigger shapes (an LED's
 * box, a wire's drawn route) are pointer-only, matching Tinkercad's own
 * canvas interaction model — a student clicks or drags on the artwork there
 * too, not tabs to it. Making every one of a dozen circuits' several dozen
 * wires its own keyboard-reachable stop would add that many tab stops before
 * a keyboard user ever reaches the code panel, which is a worse trade than
 * the one being made. The POPOVER that opens once a shape is clicked is a
 * normal focusable, labelled set of `<button>`s, and Escape closes it.
 */

const POPOVER_W = 176
const POPOVER_H = 108

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max))
}

/** Both palettes, normalised to one shape a swatch grid can render either from. */
const LED_OPTIONS = LED_COLOURS.map((c) => ({ value: c.value, label: c.label, swatch: c.body }))
const WIRE_OPTIONS = WIRE_PALETTE.map((c) => ({
  value: c.name,
  label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
  swatch: c.core,
}))

type Picker =
  | { kind: 'part'; id: string; label: string; x: number; y: number; current: string }
  | { kind: 'wire'; id: string; label: string; x: number; y: number; current: string }

interface LedTarget {
  id: string
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  color: string
  label: string
}

interface WireTarget {
  id: string
  d: string
  color: string
  anchor: { x: number; y: number }
}

/** The point a wire's popover anchors to: its middle bend, or its midpoint. */
function wireAnchor(a: { x: number; y: number }, b: { x: number; y: number }, waypoints?: { x: number; y: number }[]) {
  if (waypoints && waypoints.length > 0) return waypoints[Math.floor(waypoints.length / 2)]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function ColourPickerOverlay({
  doc,
  partColors,
  wireColors,
  onPickPart,
  onPickWire,
}: {
  /** The UNCOLOURED reference document — geometry only, never mutated. */
  doc: CircuitDoc
  /** Current overrides, read back so a reopened popover highlights the live choice. */
  partColors: Readonly<Record<string, string>>
  wireColors: Readonly<Record<string, string>>
  onPickPart: (partId: string, color: string) => void
  onPickWire: (wireId: string, color: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [picker, setPicker] = useState<Picker | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setBox({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!picker) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicker(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picker])

  const v = useMemo(() => fitView(doc, box.width, box.height), [doc, box.width, box.height])

  const partsById = useMemo(() => new Map(doc.parts.map((p) => [p.id, p] as [string, PlacedPart])), [doc])

  const ledTargets = useMemo<LedTarget[]>(
    () =>
      doc.parts
        .filter((p) => getPart(p.type).electrical.kind === 'led')
        .map((p) => {
          const box = partBoxWorld(p)
          return {
            id: p.id,
            ...box,
            cx: box.x + box.w / 2,
            cy: box.y + box.h / 2,
            color: String(p.props.color ?? 'red'),
            label: getPart(p.type).label,
          }
        }),
    [doc],
  )

  const wireTargets = useMemo<WireTarget[]>(() => {
    const out: WireTarget[] = []
    for (const wire of doc.wires) {
      const fromPart = partsById.get(wire.from.partId)
      const toPart = partsById.get(wire.to.partId)
      const a = fromPart && pinPosition(fromPart, wire.from.pinId)
      const b = toPart && pinPosition(toPart, wire.to.pinId)
      if (!a || !b) continue
      out.push({ id: wire.id, d: wirePath(a, b, wire.waypoints), color: wire.color, anchor: wireAnchor(a, b, wire.waypoints) })
    }
    return out
  }, [doc, partsById])

  function toScreen(worldX: number, worldY: number) {
    return { x: worldX * v.z + v.x, y: worldY * v.z + v.y }
  }

  function openPartPicker(t: LedTarget) {
    const at = toScreen(t.cx, t.y)
    setPicker({ kind: 'part', id: t.id, label: `${t.label} colour`, x: at.x, y: at.y, current: partColors[t.id] ?? t.color })
  }

  function openWirePicker(t: WireTarget) {
    const at = toScreen(t.anchor.x, t.anchor.y)
    setPicker({ kind: 'wire', id: t.id, label: 'Wire colour', x: at.x, y: at.y, current: wireColors[t.id] ?? t.color })
  }

  const options = picker?.kind === 'part' ? LED_OPTIONS : WIRE_OPTIONS
  const popoverLeft = picker ? clamp(picker.x - POPOVER_W / 2, 4, box.width - POPOVER_W - 4) : 0
  const popoverTop = picker ? clamp(picker.y - POPOVER_H - 10, 4, box.height - POPOVER_H - 4) : 0

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0">
      <svg className="h-full w-full" aria-hidden="true">
        <g transform={`translate(${v.x} ${v.y}) scale(${v.z})`}>
          {/* Wires first, LEDs after: an LED's own box should win a click over
              a leg drawn underneath it, and later-painted SVG shapes win
              pointer hit-tests over earlier ones, same as the real canvas. */}
          {wireTargets.map((t) => (
            <path
              key={t.id}
              d={t.d}
              fill="none"
              stroke="transparent"
              strokeWidth={7}
              strokeLinecap="round"
              className="cursor-pointer"
              style={{ pointerEvents: 'stroke' }}
              onClick={(e) => {
                e.stopPropagation()
                openWirePicker(t)
              }}
            >
              <title>Click to change this wire&rsquo;s colour</title>
            </path>
          ))}
          {ledTargets.map((t) => (
            <rect
              key={t.id}
              x={t.x}
              y={t.y}
              width={t.w}
              height={t.h}
              fill="transparent"
              className="cursor-pointer"
              style={{ pointerEvents: 'fill' }}
              onClick={(e) => {
                e.stopPropagation()
                openPartPicker(t)
              }}
            >
              <title>Click to change this LED&rsquo;s colour</title>
            </rect>
          ))}
        </g>
      </svg>

      {picker && (
        <>
          {/* Outside-click dismiss. `pointer-events-auto` re-enables clicks on
              just this element and the popover below — the wrapper and the
              empty SVG background stay click-through. */}
          <div className="pointer-events-auto fixed inset-0 z-40" onClick={() => setPicker(null)} />
          <div
            role="menu"
            aria-label={picker.label}
            className="pointer-events-auto absolute z-50 rounded-[6px] border border-[#dfe3e8] bg-white p-2 shadow-lg"
            style={{ left: popoverLeft, top: popoverTop, width: POPOVER_W }}
          >
            <div className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9aa3ab]">
              {picker.label}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {options.map((opt) => {
                const isCurrent = opt.value === picker.current
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isCurrent}
                    title={opt.label}
                    onClick={() => {
                      if (picker.kind === 'part') onPickPart(picker.id, opt.value)
                      else onPickWire(picker.id, opt.value)
                      setPicker(null)
                    }}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] ${
                      isCurrent ? 'border-[#1477d1]' : 'border-transparent hover:border-[#dfe3e8]'
                    }`}
                  >
                    <span
                      className="h-5 w-5 rounded-full border border-black/10"
                      style={{ background: opt.swatch }}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
