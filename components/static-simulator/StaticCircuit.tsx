'use client'

import React, { useMemo } from 'react'
import { CircuitCanvas } from '@/components/simulator/CircuitCanvas'
import type { CircuitDoc } from '@/lib/simulator/model/document'
import { IDLE_FRAME, type ShowreelFrame } from './showreel/useShowreel'

/**
 * A read-only drawing of one experiment's circuit, rendered by OUR canvas.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE DRAWS NOTHING ITSELF, AND THAT IS THE POINT.                  │
 * │                                                                         │
 * │ Every pixel comes from components/simulator/CircuitCanvas over          │
 * │ lib/simulator/model — the same part library, the same wire path with    │
 * │ its arc fillets, the same two-tone jumper casing and the same LED       │
 * │ glow the live editor uses. The ported ComponentSVGs.tsx and its         │
 * │ features/Wire.tsx are gone; there is no second renderer to keep in      │
 * │ step with the first.                                                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * THE CIRCUIT CANNOT BE CHANGED; IT CAN BE LOOKED AROUND. `lockTopology` is a
 * real flag on the real component (defaulting off, so the editor is untouched).
 * Pan, wheel-zoom, picking a part or a wire, and the device inputs all work
 * exactly as they do in the lab editor — because they ARE the lab editor's.
 * What it refuses is the set of gestures that would rewire the board: dragging
 * a part to different pins, drawing a wire, reshaping or deleting one.
 *
 * IT USED TO BE `readOnly`, which is the stricter flag: `pointer-events: none`
 * over the whole surface. That made the figure genuinely inert, and also made
 * it impossible to scroll, zoom or click — so this panel grew a sibling layer
 * that redrew the fit transform and put its own invisible hit shapes over the
 * artwork, purely to get a click back. That layer is gone. A second geometry
 * implementation shadowing the first is exactly what the box above says this
 * file exists to avoid, and the canvas's own selection was there all along.
 *
 * IT DOES NOT HOLD A CLOCK. The `frame` prop is what makes the picture move —
 * which lamps are lit, what each module is reporting, where a sensor's target
 * is standing — and it is produced by useShowreel in the panel above, so that
 * the artwork, the status strip, the serial log and the elapsed timer are four
 * views of one index and cannot drift apart. Omit `frame` and the circuit draws
 * inert, exactly as the document was authored.
 *
 * `frame` is scripted playback, not simulation. See showreel/timelines.ts.
 */

/**
 * The document with this instant's property overrides layered on.
 *
 * A COPY, ALWAYS. `REFERENCE_CIRCUITS` is a module-level constant shared by
 * every render of every panel on the page; writing an override into it would
 * leak one experiment's playback into another's drawing and would not wash out
 * on remount. Parts with no override are passed through by reference, so a step
 * that moves one target does not rebuild seven other parts.
 */
function withOverrides(
  doc: CircuitDoc,
  overrides: Record<string, Record<string, number | string>>,
): CircuitDoc {
  if (Object.keys(overrides).length === 0) return doc
  return {
    ...doc,
    parts: doc.parts.map((part) => {
      const over = overrides[part.id]
      return over ? { ...part, props: { ...part.props, ...over } } : part
    }),
  }
}

/**
 * `dispatch` is the document writer, and nothing here may write one.
 *
 * `lockTopology` already refuses every gesture that would dispatch a change to
 * the circuit, so this is the belt to that flag's braces: if some future edit
 * lets an action through, it lands on a function that does nothing rather than
 * on `REFERENCE_CIRCUITS`.
 *
 * A module constant rather than an inline literal so the prop is referentially
 * stable across renders and the canvas's memoised work is not thrown away four
 * times a second by the playback.
 */
const NO_OP = () => {}

export function StaticCircuit({
  doc,
  title,
  className = '',
  frame = IDLE_FRAME,
  selectedPart = null,
  onSelectPart = NO_OP,
  selectedWire = null,
  onSelectWire = NO_OP,
}: {
  doc: CircuitDoc
  /** For the image's accessible name. */
  title: string
  className?: string
  /** The current instant of the scripted playback. Defaults to everything off. */
  frame?: ShowreelFrame
  /** Which part is picked, for the toolbar's colour control. */
  selectedPart?: string | null
  onSelectPart?: (id: string | null) => void
  /** Which wire is picked, same. */
  selectedWire?: string | null
  onSelectWire?: (id: string | null) => void
}) {
  const drawn = useMemo(() => withOverrides(doc, frame.props), [doc, frame.props])

  return (
    <div className={`h-full w-full ${className}`} aria-label={`Circuit diagram: ${title}`}>
      <CircuitCanvas
        doc={drawn}
        lockTopology
        dispatch={NO_OP}
        selected={selectedPart}
        onSelect={onSelectPart}
        selectedWire={selectedWire}
        onSelectWire={onSelectWire}
        ledBrightness={frame.leds}
        deviceStates={frame.devices}
      />
    </div>
  )
}
