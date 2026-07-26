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
 * NOTHING HERE IS INTERACTIVE. `readOnly` on the canvas is a real flag on the
 * real component (defaulting to interactive, so the editor is untouched): it
 * attaches no handler, exposes no focusable control, offers no pointer cursor
 * and drops the pan/zoom hint. See the prop's own note for why a wrapper with
 * `pointer-events: none` would not have been enough — it would have left four
 * keyboard-operable `role="slider"` controls per sensor sitting on a picture.
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
 * `CircuitCanvas` still asks for these three, because in the editor they are
 * how a selection is owned by the component above it. In read-only there is no
 * selection to own: nothing can be clicked, so `onSelect` is never called and
 * `selected` is never anything but null.
 *
 * Module constants rather than inline literals so the props are referentially
 * stable across renders and the canvas's memoised work is not thrown away four
 * times a second by the playback.
 */
const NO_SELECTION = null
const NO_OP = () => {}

export function StaticCircuit({
  doc,
  title,
  className = '',
  frame = IDLE_FRAME,
}: {
  doc: CircuitDoc
  /** For the image's accessible name. */
  title: string
  className?: string
  /** The current instant of the scripted playback. Defaults to everything off. */
  frame?: ShowreelFrame
}) {
  const drawn = useMemo(() => withOverrides(doc, frame.props), [doc, frame.props])

  return (
    <div className={`h-full w-full ${className}`} role="img" aria-label={`Circuit diagram: ${title}`}>
      <CircuitCanvas
        doc={drawn}
        readOnly
        dispatch={NO_OP}
        selected={NO_SELECTION}
        onSelect={NO_OP}
        ledBrightness={frame.leds}
        deviceStates={frame.devices}
      />
    </div>
  )
}
