'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * The measured inline size of an element, for layout decisions that Tailwind's
 * breakpoints get wrong here.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS PANEL CANNOT USE `lg:` / `xl:` FOR ITS OWN LAYOUT.             │
 * │                                                                         │
 * │ Tailwind's breakpoints are VIEWPORT queries. This panel is mounted      │
 * │ inside a lesson page's content column, which is ~720 px wide on a       │
 * │ 1536 px screen — so every viewport breakpoint up to `xl` fires while    │
 * │ the panel itself has less room than a tablet.                          │
 * │                                                                         │
 * │ The consequence was not cosmetic. With `xl:w-[420px]` on the code side  │
 * │ panel, the canvas was left 298 px; the circuit's fit then hit           │
 * │ CircuitCanvas's `FIT_MIN_Z` floor of 0.45 and the drawing was CLIPPED   │
 * │ at the canvas edge rather than merely small. Measuring the container is │
 * │ the fix: the split is decided by the space the panel actually has.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Tailwind 3 has no `@container` support (that is v4) and this project does
 * not carry the container-queries plugin, so this is a `ResizeObserver` rather
 * than a CSS container query. It is the same mechanism ColourPickerOverlay.tsx
 * already uses to track the canvas box.
 *
 * Returns 0 until the first observation, which is the pre-measure state every
 * caller has to handle anyway (server render has no box either). Callers pick
 * their narrow layout for 0 so the first paint is the safe one — a stacked
 * panel that then widens reflows once; a side-by-side panel that turns out not
 * to fit clips the drawing, which is the failure this hook exists to prevent.
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}
