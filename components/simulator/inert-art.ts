import type { PartDefinition } from '@/lib/simulator/model/parts'

/**
 * A part's artwork with every focus stop taken out of it.
 *
 * WHY THIS EXISTS. `def.svg` is harvested markup — @wokwi/elements, verbatim,
 * injected with `dangerouslySetInnerHTML` — and some of it was authored for a
 * component that really is interactive. The Arduino Uno's is the case that
 * matters: it carries
 *
 *     <circle id="reset-button" … tabindex="0"/>
 *
 * so every Uno on the page contributes a keyboard-focusable element that no
 * handler in this codebase listens to. In the editor that is a pre-existing
 * dead focus stop and out of scope here. On a page of READ-ONLY reference
 * figures it is worse than dead: measured on /dev/static-sim it took the
 * page from 12 interactive elements to 26 — fourteen tab stops (seven Unos,
 * each drawn twice, once on the canvas and once in the components rail) on
 * pictures that cannot be operated at all.
 *
 * SO IT IS STRIPPED AT THE INJECTION SITE, and only where the drawing is
 * read-only. Doing it in `lib/simulator/model/parts.ts` would have been the
 * tidier-looking fix and is the wrong one twice over: that module is shared
 * with the live editor, where changing what the artwork exposes is a behaviour
 * change nobody asked for, and the harvested art is regenerated from upstream
 * into `wokwi-art.generated.json`, so an edit there is an edit that comes back.
 *
 * ONLY `tabindex` IS TOUCHED. Not `role`, not `id`, not `aria-*` — a blanket
 * scrub of "anything accessibility-shaped" would silently strip the labelling
 * off a future part that legitimately carries some, and the defect being fixed
 * is specifically "this picture is in the tab order".
 *
 * Memoised on the part TYPE, because the markup is a per-type constant and this
 * runs inside the render of every part on every canvas.
 */
const cache = new Map<string, string>()

/** Matches a `tabindex` attribute in either case, quoted either way. */
const TABINDEX = /\stabindex\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi

export function inertPartArt(def: PartDefinition): string {
  const hit = cache.get(def.type)
  if (hit !== undefined) return hit
  const out = def.svg.replace(TABINDEX, '')
  cache.set(def.type, out)
  return out
}
