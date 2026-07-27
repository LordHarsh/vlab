'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A plain "view this bigger" toggle for the read-only reference panel.
 *
 * DELIBERATELY NOT `components/simulator/FullscreenGate.tsx`. That component
 * BLOCKS the real editor until fullscreen is entered — correct there, because
 * a cramped canvas makes the editor genuinely unusable for editing. This panel
 * has nothing to edit: it is already fully visible at lesson-page width, and
 * fullscreen only makes a diagram a working student would rather read larger.
 * So there is no gate, no overlay-until-entered, no mounted-but-inert content
 * — just a button that is off until clicked. Two different jobs; two small
 * independent implementations rather than one component trying to do both.
 *
 * Same dual-mode shape as the gate, because the underlying browser reality is
 * the same one: the real Fullscreen API where it exists, and a CSS
 * fixed-inset-0 fallback where it does not (iOS Safari has no
 * `requestFullscreen` on a plain element).
 */
export function useFullscreenToggle<T extends HTMLElement>() {
  const containerRef = useRef<T | null>(null)
  const [native, setNative] = useState(false)
  const [maximised, setMaximised] = useState(false)
  const active = native || maximised

  // The DOM is the source of truth, so Escape / OS chrome / a tab switch can
  // never leave this button disagreeing with what the browser is actually
  // doing.
  useEffect(() => {
    const sync = () => {
      const el = document.fullscreenElement
      const container = containerRef.current
      const mine = !!el && !!container && (el === container || container.contains(el))
      setNative(mine)
      if (mine) setMaximised(false)
    }
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // The CSS fallback owns Escape and the page scrollbar itself; native
  // fullscreen already gets both from the browser for free.
  useEffect(() => {
    if (!maximised) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaximised(false)
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [maximised])

  const enter = useCallback(() => {
    const el = containerRef.current
    if (!el || document.fullscreenElement) return
    if (typeof el.requestFullscreen !== 'function') {
      setMaximised(true)
      return
    }
    // A rejected request (no user gesture, a permissions policy) falls back
    // rather than leaving the button looking like it did nothing.
    el.requestFullscreen().catch(() => setMaximised(true))
  }, [])

  const exit = useCallback(() => {
    setMaximised(false)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }, [])

  const toggle = useCallback(() => (active ? exit() : enter()), [active, enter, exit])

  /**
   * Returned as a TUPLE, ref first, rather than one object bundling the ref
   * with `active`/`toggle`.
   *
   * `react-hooks/refs` taints the whole object once it sees a `RefObject`
   * flow into it as a field, and then flags every OTHER property read on that
   * same object as "accessing a ref during render" — even though `active` is
   * plain state and was never the ref. Splitting them is what
   * `FullscreenGate.tsx` already does (its ref stays local to the component
   * that owns it; only `{ gated, active, supported, enter, exit }` — no ref —
   * crosses the `useFullscreenGate()` hook boundary). This is the same fix,
   * shaped for a hook that has to hand the ref back to its caller rather than
   * keep it.
   */
  return [containerRef, { active, toggle }] as const
}
