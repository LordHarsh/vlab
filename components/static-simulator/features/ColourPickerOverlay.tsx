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
 * CLICKING SELECTS; IT DOES NOT OPEN A POPOVER HERE. This used to render its
 * own floating swatch grid next to the click point. On the owner's explicit
 * instruction it now does the Tinkercad thing instead: clicking a wire or an
 * LED reports a `ColourSelection` up to StaticSimulator.tsx, which is what
 * shows the real swatch-and-palette control — in the toolbar, via
 * WorkspaceChrome's `WorkspaceToolbar`, not floating over the drawing. This
 * file's only remaining opinions are which shape a click landed on and how to
 * draw a highlight ring around whichever one is currently selected.
 *
 * WHAT PICKING A COLOUR ACTUALLY CHANGES. The toolbar's swatch control calls
 * back into StaticSimulator.tsx, which turns a selection and a chosen value
 * into a CLONED `CircuitDoc` with just that one part's `props.color` or that
 * one wire's `color` replaced, in local component state. This file never
 * mutates `circuits.ts`'s exported documents and never decides what a colour
 * DOES — it only decides which shape a click landed on.
 *
 * TOPOLOGY IS UNTOUCHED. There is no way to reach `onSelect` except by
 * clicking an existing LED or an existing wire's drawn route; there is no
 * add, no delete, no move and no rewire anywhere in this file.
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
 * the one being made. The toolbar control a selection opens IS a normal
 * focusable, labelled set of `<button>`s, and Escape clears the selection
 * from anywhere.
 */

/** Both palettes, normalised to one shape a swatch grid can render either from. */
export const LED_OPTIONS = LED_COLOURS.map((c) => ({ value: c.value, label: c.label, swatch: c.body }))
export const WIRE_OPTIONS = WIRE_PALETTE.map((c) => ({
  value: c.name,
  label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
  swatch: c.core,
}))

export type ColourSelection =
  | { kind: 'part'; id: string; label: string; current: string }
  | { kind: 'wire'; id: string; label: string; current: string }

interface LedTarget {
  id: string
  x: number
  y: number
  w: number
  h: number
  color: string
  label: string
}

interface WireTarget {
  id: string
  d: string
  color: string
}

export function ColourPickerOverlay({
  doc,
  partColors,
  wireColors,
  selection,
  onSelect,
  onClear,
}: {
  /** The UNCOLOURED reference document — geometry only, never mutated. */
  doc: CircuitDoc
  /** Current overrides, read back so a re-selected shape reports the live choice. */
  partColors: Readonly<Record<string, string>>
  wireColors: Readonly<Record<string, string>>
  /** Which shape is selected right now, if any — lifted so the toolbar can render its swatch. */
  selection: ColourSelection | null
  onSelect: (selection: ColourSelection) => void
  onClear: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

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
    if (!selection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, onClear])

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
      out.push({ id: wire.id, d: wirePath(a, b, wire.waypoints), color: wire.color })
    }
    return out
  }, [doc, partsById])

  function selectPart(t: LedTarget) {
    if (selection?.kind === 'part' && selection.id === t.id) {
      onClear()
      return
    }
    onSelect({ kind: 'part', id: t.id, label: `${t.label} colour`, current: partColors[t.id] ?? t.color })
  }

  function selectWire(t: WireTarget) {
    if (selection?.kind === 'wire' && selection.id === t.id) {
      onClear()
      return
    }
    onSelect({ kind: 'wire', id: t.id, label: 'Wire colour', current: wireColors[t.id] ?? t.color })
  }

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0">
      {/* Clicking blank canvas clears the current selection. Only listens once
          there IS a selection to clear — with nothing selected this stays
          click-through, same as the rest of this overlay's empty space. */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: selection ? 'auto' : 'none' }}
        onClick={onClear}
      />
      <svg className="h-full w-full" aria-hidden="true">
        <g transform={`translate(${v.x} ${v.y}) scale(${v.z})`}>
          {/* Wires first, LEDs after: an LED's own box should win a click over
              a leg drawn underneath it, and later-painted SVG shapes win
              pointer hit-tests over earlier ones, same as the real canvas. */}
          {wireTargets.map((t) => {
            const selected = selection?.kind === 'wire' && selection.id === t.id
            return (
              <g key={t.id}>
                {selected && (
                  <path
                    d={t.d}
                    fill="none"
                    stroke="#1477d1"
                    strokeWidth={6}
                    strokeLinecap="round"
                    opacity={0.35}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                <path
                  d={t.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={7}
                  strokeLinecap="round"
                  className="cursor-pointer"
                  style={{ pointerEvents: 'stroke' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectWire(t)
                  }}
                >
                  <title>Click to change this wire&rsquo;s colour</title>
                </path>
              </g>
            )
          })}
          {ledTargets.map((t) => {
            const selected = selection?.kind === 'part' && selection.id === t.id
            return (
              <g key={t.id}>
                {selected && (
                  <rect
                    x={t.x - 3}
                    y={t.y - 3}
                    width={t.w + 6}
                    height={t.h + 6}
                    rx={4}
                    fill="none"
                    stroke="#1477d1"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                <rect
                  x={t.x}
                  y={t.y}
                  width={t.w}
                  height={t.h}
                  fill="transparent"
                  className="cursor-pointer"
                  style={{ pointerEvents: 'fill' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectPart(t)
                  }}
                >
                  <title>Click to change this LED&rsquo;s colour</title>
                </rect>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
