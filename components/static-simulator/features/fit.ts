/**
 * A deliberate, narrow duplicate of CircuitCanvas's private fit algorithm.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS EXISTS INSTEAD OF IMPORTING IT.                                │
 * │                                                                         │
 * │ components/simulator/CircuitCanvas.tsx computes its own pan/zoom (its   │
 * │ `docBounds`/`fitView`) and never exposes the result — there is no prop, │
 * │ no ref, no callback that hands the current view back out. ColourPicker  │
 * │ Overlay.tsx needs that exact transform to draw invisible, click-catching│
 * │ shapes in the same pixels the canvas painted its parts and wires in.    │
 * │                                                                         │
 * │ Duplicating it is safe ONLY because of what a READ-ONLY canvas          │
 * │ guarantees about itself (see that file's own `readOnly` doc comment and │
 * │ its "keep a read-only figure framed to its box" effect): it never pans  │
 * │ or zooms, so its view is ALWAYS exactly `fitView(doc, width, height)` — │
 * │ a pure function of the document and the measured box, with no drag      │
 * │ history to also reproduce. Feed this the SAME box (the overlay is an    │
 * │ absolutely-positioned sibling filling the identical parent) and it      │
 * │ lands on the exact transform the canvas used.                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The constants below are transcribed verbatim from CircuitCanvas.tsx
 * (`FIT_PADDING`, `FIT_MAX_Z`, `FIT_MIN_Z`, `DEFAULT_VIEW`) and MUST stay
 * numerically identical to it. If that file's fit algorithm ever changes,
 * this one has to change with it — there is no way around that coupling
 * short of CircuitCanvas exposing its own computed view, which it does not
 * do today and which `readOnly`'s whole contract argues against (see its
 * doc comment on why a wrapper cannot do this job either).
 *
 * Nothing here is behavioural: it is read geometry, not a control, and it
 * never touches `lib/simulator/` or CircuitCanvas.tsx itself.
 */

import { getPart } from '@/lib/simulator/model/parts'
import { partBounds, type CircuitDoc, type PlacedPart } from '@/lib/simulator/model/document'

/** Verbatim from CircuitCanvas.tsx. */
const FIT_PADDING = 24
const FIT_MAX_Z = 1.1
const FIT_MIN_Z = 0.45
const DEFAULT_VIEW = { x: 40, y: 30, z: 1.1 }

export interface FitView {
  x: number
  y: number
  z: number
}

/** The world-space box a placed part occupies, rotation included. */
export function partBoxWorld(part: PlacedPart): { x: number; y: number; w: number; h: number } {
  const def = getPart(part.type)
  const { w, h } = partBounds(part)
  const cx = part.x + def.width / 2
  const cy = part.y + def.height / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/** Verbatim from CircuitCanvas.tsx's `docBounds`, built on the exported `partBounds`. */
function docBounds(doc: CircuitDoc): { x: number; y: number; w: number; h: number } | null {
  if (doc.parts.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const part of doc.parts) {
    const box = partBoxWorld(part)
    x0 = Math.min(x0, box.x)
    y0 = Math.min(y0, box.y)
    x1 = Math.max(x1, box.x + box.w)
    y1 = Math.max(y1, box.y + box.h)
  }
  for (const wire of doc.wires) {
    for (const p of wire.waypoints ?? []) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Verbatim from CircuitCanvas.tsx's `fitView`. */
export function fitView(doc: CircuitDoc, width: number, height: number): FitView {
  const b = docBounds(doc)
  if (!b || b.w <= 0 || b.h <= 0 || width <= 0 || height <= 0) return DEFAULT_VIEW
  const z = Math.min(
    FIT_MAX_Z,
    Math.max(FIT_MIN_Z, Math.min((width - FIT_PADDING * 2) / b.w, (height - FIT_PADDING * 2) / b.h)),
  )
  return { x: (width - b.w * z) / 2 - b.x * z, y: (height - b.h * z) / 2 - b.y * z, z }
}
