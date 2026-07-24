/**
 * Adapter for harvested @wokwi/elements component art.
 *
 * Source: @wokwi/elements 1.9.2, MIT, Copyright (c) 2020 Uri Shaked.
 * The harvested data lives in wokwi-art.generated.json and is produced by the
 * dev-only route /api/dev/harvest — see SIMULATOR_ARCHITECTURE.md §3, which
 * calls for taking the SVG and pinInfo at BUILD time rather than mounting the
 * Lit components at runtime.
 *
 * ── Units ────────────────────────────────────────────────────────────────────
 * Two coordinate systems have to be reconciled:
 *
 *   - the SVG viewBox is in MILLIMETRES
 *   - pinInfo is in CSS PIXELS at 96 dpi, relative to the element's box
 *     (verified: the resistor's far pin is at 58.8 px and its width is
 *     15.645 mm, and 15.645 x 3.7795 = 59.1)
 *   - our grid is 10 units per 0.1 inch
 *
 * 1 inch = 25.4 mm = 100 units, so 1 mm = 3.937 units and 1 px = 1.0417 units.
 *
 * Wokwi is not perfectly consistent about pitch — the DHT22 and resistor use
 * 9.6 px per 0.1 inch (true 96 dpi) while the potentiometer and HC-SR04 use a
 * round 10 px. That is under half a unit of drift across a part, which does not
 * matter here because wiring is pin-to-pin rather than position-based.
 */

import raw from './wokwi-art.generated.json'
import type { PartDefinition, PinGeometry, PinType } from './parts'

const UNITS_PER_MM = 100 / 25.4 // 3.937
const UNITS_PER_PX = UNITS_PER_MM / 3.7795 // 1.0417

interface WokwiSignal {
  type?: string
  signal?: string
  channel?: number
}

interface WokwiPin {
  name: string
  x: number
  y: number
  signals?: WokwiSignal[]
}

interface WokwiPart {
  pinInfo?: WokwiPin[]
  width?: string | null
  height?: string | null
  viewBox?: string | null
  inner?: string
  /** The component's shadow-DOM CSS. Carries font sizing the markup relies on. */
  css?: string
  error?: string
}

/**
 * Scope harvested shadow-DOM CSS to one part.
 *
 * These rules were written for a shadow root, where `text { font-size: 2px }`
 * only affects that component. Inlined into the page they are global and would
 * restyle every <text> in the editor, so each selector is prefixed with the
 * part's own class. Without the CSS at all, the Uno's silkscreen renders at the
 * browser default 16px inside a millimetre viewBox and swamps the board.
 */
function scopeCss(css: string, scope: string): string {
  if (!css.trim()) return ''
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((chunk) => {
      const i = chunk.indexOf('{')
      if (i === -1) return ''
      const selectors = chunk.slice(0, i).trim()
      const body = chunk.slice(i + 1).trim()
      if (!selectors || !body) return ''
      const scoped = selectors
        .split(',')
        .map((sel) => {
          const s = sel.trim()
          if (!s) return ''
          // :host refers to the component root, which is our scoping group.
          if (s.startsWith(':host')) return `.${scope}${s.slice(5)}`
          return `.${scope} ${s}`
        })
        .filter(Boolean)
        .join(', ')
      return `${scoped}{${body}}`
    })
    .filter(Boolean)
    .join('\n')
}

const PARTS = (raw as { parts: Record<string, WokwiPart> }).parts

/** "72.58mm" | "40" -> millimetres. Bare numbers are already px. */
function toMm(v: string | null | undefined): number {
  if (!v) return 0
  if (v.endsWith('mm')) return parseFloat(v)
  return parseFloat(v) / 3.7795
}

/**
 * Derive an electrical role from wokwi's own signal metadata rather than
 * hand-listing it. Their pinInfo carries entries like
 * {type:'power', signal:'GND'} and {type:'analog', channel:5}.
 */
function pinTypeOf(pin: WokwiPin): PinType {
  for (const s of pin.signals ?? []) {
    if (s.type === 'power') return s.signal === 'GND' ? 'gnd' : 'power'
    if (s.type === 'analog') return 'analog'
  }
  if (/^\d+$/.test(pin.name)) return 'digital'
  if (/^GND/i.test(pin.name)) return 'gnd'
  if (/^(VCC|5V|3\.3V|VIN|IOREF)$/i.test(pin.name)) return 'power'
  return 'passive'
}

export interface WokwiOptions {
  /** Rename wokwi pin ids to ours. Unlisted pins keep their wokwi name. */
  rename?: Record<string, string>
  /** Drop pins entirely (duplicated headers, NC legs). */
  omit?: string[]
  /** Force a pin's type where the metadata is absent or wrong. */
  types?: Record<string, PinType>
  /** Render these pins small and semi-transparent. */
  subtle?: string[]
}

export function hasWokwiArt(key: string): boolean {
  const p = PARTS[key]
  return !!p && !p.error && !!p.inner
}

/**
 * Build the geometry half of a PartDefinition from harvested art.
 * The caller supplies the electrical half, which wokwi has no opinion about.
 */
export function wokwiGeometry(
  key: string,
  opts: WokwiOptions = {},
): Pick<PartDefinition, 'width' | 'height' | 'pins' | 'svg'> {
  const part = PARTS[key]
  if (!part || part.error || !part.inner) {
    throw new Error(`No harvested art for "${key}". Re-run /vendor/harvest.html.`)
  }

  const widthMm = toMm(part.width)
  const heightMm = toMm(part.height)
  const width = widthMm * UNITS_PER_MM
  const height = heightMm * UNITS_PER_MM

  const [vbX, vbY, vbW] = (part.viewBox ?? `0 0 ${widthMm} ${heightMm}`)
    .trim()
    .split(/\s+/)
    .map(Number)

  // A NESTED <svg>, not a <g transform>.
  //
  // wokwi's own outer <svg> clips its content to the viewBox, and several parts
  // rely on that: the Uno's art actually extends to 187 mm against a declared
  // 72.58 mm box, so re-parenting the inner markup under a plain transformed
  // group let all of that overflow escape and drew the board 2.6x oversized.
  // A nested svg restores the clip and performs the viewBox mapping natively.
  void vbX
  void vbY
  void vbW

  const scope = `wk-${key.replace(/[^a-z0-9]+/gi, '-')}`
  const style = scopeCss(part.css ?? '', scope)
  const svg =
    `<svg class="${scope}" x="0" y="0" width="${width.toFixed(3)}" height="${height.toFixed(3)}" ` +
    `viewBox="${part.viewBox ?? `0 0 ${widthMm} ${heightMm}`}" ` +
    `preserveAspectRatio="xMidYMid meet" overflow="hidden">` +
    (style ? `<style>${style}</style>` : '') +
    `${part.inner}</svg>`

  const omit = new Set(opts.omit ?? [])
  const subtle = new Set(opts.subtle ?? [])
  const pins: PinGeometry[] = []
  for (const p of part.pinInfo ?? []) {
    if (omit.has(p.name)) continue
    const id = opts.rename?.[p.name] ?? p.name
    pins.push({
      id,
      name: id,
      x: p.x * UNITS_PER_PX,
      y: p.y * UNITS_PER_PX,
      type: opts.types?.[id] ?? pinTypeOf(p),
      ...(subtle.has(id) ? { subtle: true } : {}),
    })
  }

  return { width, height, pins, svg }
}

/** Uno silkscreen digits -> our D-prefixed ids, matching every saved document. */
export const UNO_RENAME: Record<string, string> = Object.fromEntries(
  Array.from({ length: 14 }, (_, i) => [String(i), `D${i}`]),
)

/**
 * The same for a Mega, whose digital header runs 0–53.
 *
 * Not `UNO_RENAME` widened: a saved document names pins by id, so the two maps
 * have to be able to diverge without one board silently renaming the other's
 * pins. They agree on 0–13 because the boards do.
 */
export const MEGA_RENAME: Record<string, string> = Object.fromEntries(
  Array.from({ length: 54 }, (_, i) => [String(i), `D${i}`]),
)
