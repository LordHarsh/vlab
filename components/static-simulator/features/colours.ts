import { WIRE_PALETTE } from '@/lib/simulator/model/document'
import { LED_COLOURS } from '@/lib/simulator/model/parts'

/**
 * The two palettes the toolbar's colour control offers, and the shape of a
 * selection it can act on.
 *
 * Both lists are OUR OWN — `LED_COLOURS` from the part library and
 * `WIRE_PALETTE` from the document model, the same ones the lab editor offers
 * — normalised to one shape so a single swatch grid can render either. A
 * separate hard-coded list here would be a second opinion about what colours a
 * wire may be, and the first thing to drift.
 *
 * This used to live in features/ColourPickerOverlay.tsx, alongside a
 * click-catching layer that duplicated the canvas's fit transform to put
 * invisible hit shapes over the artwork. That layer existed only because the
 * canvas was mounted `readOnly` and could not be clicked; with `lockTopology`
 * it can, so the overlay is deleted and only the data it carried remains.
 */
export const LED_OPTIONS = LED_COLOURS.map((c) => ({ value: c.value, label: c.label, swatch: c.body }))

export const WIRE_OPTIONS = WIRE_PALETTE.map((c) => ({
  value: c.name,
  label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
  swatch: c.core,
}))

export type ColourSelection =
  | { kind: 'part'; id: string; label: string; current: string }
  | { kind: 'wire'; id: string; label: string; current: string }
