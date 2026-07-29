'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Maximize2 } from 'lucide-react'

/**
 * Fullscreen gate for the circuit editor.
 *
 * The editor is only usable when it owns the screen: at a lesson-page size the
 * canvas, the parts palette and the rail all fight for the same few hundred
 * pixels, and a student ends up dragging parts they cannot see. So the editor
 * is BLOCKED until it is fullscreen, and the block is a prompt rather than a
 * disabled-looking page.
 *
 * THE ONE RULE THIS COMPONENT EXISTS TO KEEP: the children stay MOUNTED the
 * whole time. Not keyed on the fullscreen state, not conditionally rendered,
 * not swapped for a placeholder. Unmounting the editor would throw away the
 * document reducer (the student's wiring, undo history, selection) and re-run
 * useAutosave's restore, which is exactly the "cleared simulation" this feature
 * is meant to prevent. The overlay sits OVER a live editor and makes it inert;
 * nothing below it is torn down.
 *
 * Two modes, because one of them has to exist:
 *
 *  - `native` — the real Fullscreen API on this container.
 *  - `maximised` — a CSS-only fixed-inset-0 fallback. iOS Safari refuses
 *    requestFullscreen on anything that is not a <video>, so on an iPhone the
 *    button would otherwise be a button that does nothing. The fallback is also
 *    where a rejected request lands (no user gesture, an iframe without
 *    allow="fullscreen", a policy block).
 *
 * State is read from the DOM (`document.fullscreenElement` plus the
 * `fullscreenchange` event) rather than tracked as our own boolean, so Escape,
 * the OS window chrome and a tab switch can never leave the UI disagreeing with
 * reality.
 */

/* ── Vendor-prefixed corners of the API ───────────────────────────────── */

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  webkitFullscreenEnabled?: boolean
}

/**
 * Can this environment fullscreen an arbitrary element?
 *
 * Checked against the real container, not a feature-flag guess: iOS Safari
 * exposes `webkitEnterFullscreen` on HTMLVideoElement only, so a <div> has
 * neither `requestFullscreen` nor `webkitRequestFullscreen` and this correctly
 * returns false. iPadOS Safari does expose the webkit method on any element and
 * correctly returns true.
 *
 * `fullscreenEnabled === false` is the other real case — an <iframe> embedding
 * us without allow="fullscreen" — where the method exists but always rejects.
 */
export function canFullscreenElement(el: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false
  const d = document as FsDocument
  if (d.fullscreenEnabled === false && d.webkitFullscreenEnabled !== true) return false
  const probe = (el ?? document.documentElement) as FsElement
  return (
    typeof probe.requestFullscreen === 'function' ||
    typeof probe.webkitRequestFullscreen === 'function'
  )
}

/* ── Context ──────────────────────────────────────────────────────────── */

export interface FullscreenGateState {
  /**
   * Whether there is a gate above this subtree at all.
   *
   * False in the default value below, which is what an editor rendered without
   * a gate reads. That editor is NOT blocked — `active` is true — so nothing
   * that consumes this hook has to care whether it was wrapped.
   */
  gated: boolean
  /** Whether the editor is usable right now: real fullscreen, or the fallback. */
  active: boolean
  /** False when the Fullscreen API cannot be used here — see the fallback above. */
  supported: boolean
  enter: () => void
  exit: () => void
}

const DEFAULT_STATE: FullscreenGateState = {
  gated: false,
  active: true,
  supported: false,
  enter: () => {},
  exit: () => {},
}

const FullscreenGateContext = createContext<FullscreenGateState>(DEFAULT_STATE)

/**
 * Read the gate from inside the editor.
 *
 * Ungated (the default) reports `active: true`, so an editor with no gate above
 * it behaves exactly as it did before this component existed.
 */
export function useFullscreenGate(): FullscreenGateState {
  return useContext(FullscreenGateContext)
}

/* ── The gate ─────────────────────────────────────────────────────────── */

export function FullscreenGate({
  children,
  /** Woven into the prompt's prose. */
  label = 'circuit simulator',
  className = '',
}: {
  children: ReactNode
  label?: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const enterButtonRef = useRef<HTMLButtonElement>(null)

  const [nativeActive, setNativeActive] = useState(false)
  const [maximised, setMaximised] = useState(false)
  /**
   * Starts optimistic and is corrected on mount.
   *
   * The lazy-initialiser alternative would have to answer `typeof document ===
   * 'undefined'` during SSR and then disagree with itself on the client, which
   * is a hydration mismatch. One post-mount correction is cheaper than that,
   * and it only ever changes the button's wording.
   */
  const [supported, setSupported] = useState(true)

  const active = nativeActive || maximised

  const headingId = useId()
  const bodyId = useId()

  useEffect(() => {
    setSupported(canFullscreenElement(containerRef.current))
  }, [])

  // ── The DOM is the source of truth ──────────────────────────────────────
  useEffect(() => {
    const sync = () => {
      const d = document as FsDocument
      const el = document.fullscreenElement ?? d.webkitFullscreenElement ?? null
      const container = containerRef.current
      const mine = !!el && !!container && (el === container || container.contains(el))
      setNativeActive(mine)
      // Real fullscreen supersedes the CSS fallback; they must never both be on
      // or exiting one would leave the other showing a maximised editor with no
      // way back.
      if (mine) setMaximised(false)
    }
    sync()
    const events = [
      'fullscreenchange',
      'webkitfullscreenchange',
      'fullscreenerror',
      'webkitfullscreenerror',
    ]
    for (const e of events) document.addEventListener(e, sync)
    return () => {
      for (const e of events) document.removeEventListener(e, sync)
    }
  }, [])

  // ── Fallback mode owns Escape and the page scrollbar itself ─────────────
  useEffect(() => {
    if (!maximised) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaximised(false)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [maximised])

  const enter = useCallback(() => {
    const el = containerRef.current as FsElement | null
    if (!el) return
    const d = document as FsDocument
    if (document.fullscreenElement ?? d.webkitFullscreenElement) return

    const request = el.requestFullscreen ?? el.webkitRequestFullscreen
    if (typeof request !== 'function') {
      setMaximised(true)
      return
    }
    try {
      // A rejected request — no user gesture, a permissions policy, a UA that
      // exposes the method and then refuses — falls back rather than leaving
      // the student pressing a dead button.
      const result = request.call(el) as Promise<void> | undefined
      if (result && typeof result.catch === 'function') result.catch(() => setMaximised(true))
    } catch {
      setMaximised(true)
    }
  }, [])

  const exit = useCallback(() => {
    setMaximised(false)
    const d = document as FsDocument
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      void document.exitFullscreen().catch(() => {})
    } else if (d.webkitFullscreenElement && typeof d.webkitExitFullscreen === 'function') {
      d.webkitExitFullscreen()
    }
  }, [])

  // ── Focus follows the gate, but only on a transition ────────────────────
  // Not on mount: focusing the prompt as a lesson page loads would yank the
  // page down to the simulator section before the student has read anything.
  const previousActive = useRef(active)
  useEffect(() => {
    if (previousActive.current === active) return
    previousActive.current = active
    if (active) containerRef.current?.focus({ preventScroll: true })
    else enterButtonRef.current?.focus({ preventScroll: true })
  }, [active])

  /**
   * Belt and braces for `inert`.
   *
   * `inert` already removes the subtree from the tab order everywhere it is
   * supported (Chrome 102+, Safari 15.5+, Firefox 112+). Older engines ignore
   * the attribute entirely, and a student tabbing into an editor they cannot
   * see would be worse than no gate at all — so anything that manages to land
   * in there is bounced back to the one control that is meant to be reachable.
   */
  useEffect(() => {
    if (active) return
    const container = containerRef.current
    if (!container) return
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null
      if (target && contentRef.current?.contains(target)) {
        enterButtonRef.current?.focus({ preventScroll: true })
      }
    }
    container.addEventListener('focusin', onFocusIn)
    return () => container.removeEventListener('focusin', onFocusIn)
  }, [active])

  const ctx = useMemo<FullscreenGateState>(
    () => ({ gated: true, active, supported, enter, exit }),
    [active, supported, enter, exit],
  )

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      data-testid="fullscreen-gate"
      data-fullscreen={active ? 'on' : 'off'}
      data-fullscreen-mode={nativeActive ? 'native' : maximised ? 'maximised' : 'off'}
      // `relative` and `fixed` are never both emitted: Tailwind orders
      // `.relative` after `.fixed` in the stylesheet, so listing both would
      // silently keep the element in flow.
      className={`bg-[#f4f5f6] outline-none ${
        maximised ? 'fixed inset-0 z-[100]' : 'relative'
      } ${className}`}
    >
      {/* The editor. Mounted at all times — see the file header. */}
      <div
        ref={contentRef}
        inert={!active}
        className={`h-full w-full ${active ? '' : 'pointer-events-none'}`}
      >
        <FullscreenGateContext.Provider value={ctx}>{children}</FullscreenGateContext.Provider>
      </div>

      {!active && (
        <div
          data-testid="fullscreen-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          aria-describedby={bodyId}
          className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-[#f4f5f6]/90 backdrop-blur-[2px]"
        >
          <div className="w-full max-w-md rounded-[5px] border border-[#dfe3e8] bg-white px-6 py-7 text-center shadow-[0_2px_10px_rgba(52,73,94,0.08)]">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6]">
              <Maximize2 className="h-5 w-5 text-[#337ab7]" aria-hidden="true" />
            </div>

            <h2 id={headingId} className="text-sm font-semibold text-[#34495e]">
              {supported ? `Open the ${label} in fullscreen` : `Open the ${label}`}
            </h2>

            <p
              id={bodyId}
              className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-[#566573]"
            >
              The editor needs the whole screen to be workable, so it stays locked at this size.
              Your circuit is still here — opening it{' '}
              {supported ? 'in fullscreen' : 'full-window'} picks up exactly where you left off, and
              leaving only pauses the simulation. Nothing is cleared.
            </p>

            <button
              ref={enterButtonRef}
              type="button"
              data-testid="enter-fullscreen"
              onClick={enter}
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-[3px] bg-[#337ab7] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1166b8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#337ab7] focus-visible:ring-offset-2"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
              {supported ? 'Open simulator in fullscreen' : 'Open simulator'}
            </button>

            <p className="mt-3 text-[12px] text-[#566573]">
              Press <kbd className="font-sans font-semibold text-[#34495e]">Esc</kbd> to come back to
              this page.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
