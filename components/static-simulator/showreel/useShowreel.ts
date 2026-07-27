'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeviceState } from '@/lib/simulator/behavioural'
import { SHOWREEL_TIMELINES, type ShowreelSensors, type ShowreelStep } from './timelines'

/**
 * ONE CLOCK FOR THE WHOLE PANEL.
 *
 * Everything that has to look like it is simulating — the LEDs, the sensor
 * readouts, the serial log, the elapsed timer, the running dot — is a view of
 * the single index this hook publishes. Nothing downstream is allowed its own
 * timer, because two timers is how the serial monitor ends up reporting 31 °C
 * while the artwork still shows 28 and the whole illusion falls over.
 *
 * It plays timelines.ts, which is hand-written stage direction and not a
 * model of anything. Read that file's header before touching this one.
 *
 * COST
 *
 * One `requestAnimationFrame` loop per mounted panel. The per-frame work is a
 * modulo and a comparison; React re-renders only when the step index actually
 * changes, which for these twelve is at most a few times a second. The
 * elapsed readout would have forced a render ten times a second, so it is
 * written straight into its own text node through `clockRef` instead — same
 * clock, same frame, no reconciliation.
 *
 * REDUCED MOTION
 *
 * `prefers-reduced-motion: reduce` stops the loop and holds the timeline's
 * `stillStep`, chosen per experiment to be the frame worth seeing. The serial
 * log is filled once, up to that step, so the panel still reads as a run that
 * happened rather than an empty box. Stopping this loop now stops the DRAWING
 * outright — the canvas has no self-running CSS animation of its own, unlike
 * the ported artwork it replaced — so the only rule left under that query in
 * static-simulator.css is the toolbar's running dot.
 */

/** How many serial lines are kept. Matches components/simulations/shared.tsx. */
const MAX_SERIAL_LINES = 40

/**
 * The most a single frame is allowed to advance the sequence, in ms.
 *
 * Time comes from summing clamped frame deltas rather than from
 * `now - startedAt`, and the difference matters: a backgrounded tab stops
 * getting frames while `performance.now()` keeps running, so the subtraction
 * would jump the sequence forward by however long the user was away — landing
 * mid-cycle with a stack of steps, and their serial lines, silently skipped.
 * Clamping makes an interruption a pause instead of a fast-forward, and the
 * log stays a record of what was actually shown.
 *
 * Under 100 ms of jank the loop simply runs at real speed; over it, the
 * sequence slows rather than tears. For a canned loop that is the right trade.
 */
const MAX_FRAME_ADVANCE_MS = 100

export interface SerialLine {
  id: number
  /** Wall-clock stamp, formatted as the rest of the app formats them. */
  ts: string
  msg: string
}

/**
 * One instant of the playback, in the shape the CANVAS wants.
 *
 * The first two fields are `CircuitCanvas`'s own `ledBrightness` and
 * `deviceStates` props, unchanged and un-adapted — the same seam the live
 * editor feeds from a running simulation (see CircuitEditor.tsx, which builds
 * exactly this pair out of an engine snapshot). That is the whole reason no new
 * rendering code was needed to move this panel onto our artwork.
 *
 * `props` is the third: overrides layered onto the DOCUMENT before it is drawn,
 * for the things a simulation does not report because they are properties of
 * the circuit — where a sensor's target is standing, whether a button's cap is
 * held down.
 */
export interface ShowreelFrame {
  /** partId → 0..1. Straight into `CircuitCanvas`'s `ledBrightness`. */
  leds: Map<string, number>
  /** partId → reported state. Straight into `CircuitCanvas`'s `deviceStates`. */
  devices: Record<string, DeviceState>
  /** partId → document property overrides for this instant. */
  props: Record<string, Record<string, number | string>>
  sensors: ShowreelSensors
}

const NO_STEP: ShowreelStep = { ms: 0 }

/** An inert frame — every lamp dark, every readout absent, the document as authored. */
export const IDLE_FRAME: ShowreelFrame = {
  leds: new Map(),
  devices: {},
  props: {},
  sensors: {},
}

/**
 * `HH:MM:SS.mmm` — the shape Tinkercad's `Simulator time:` readout uses, since
 * that is the workbench the panel around this is imitating.
 *
 * Milliseconds rather than tenths, and they are the point: the clock is written
 * straight into its text node on every animation frame, so the last digits blur
 * exactly the way a running instrument's do. A readout that ticks once a second
 * is the one that looks like a screenshot.
 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, ms)
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = Math.floor(total % 1000)
  return (
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
  )
}

function stamp(at: Date): string {
  return at.toLocaleTimeString()
}

export function useShowreel(experimentId: number | undefined) {
  const timeline = experimentId === undefined ? undefined : SHOWREEL_TIMELINES[experimentId]
  const stillStep = timeline?.stillStep ?? 0

  /**
   * The first render — including the server's — is the still frame, so the
   * markup Next sends and the markup React hydrates are identical. The loop
   * only ever starts from an effect.
   */
  const [stepIndex, setStepIndex] = useState(stillStep)
  const [serialLines, setSerialLines] = useState<SerialLine[]>([])
  const [isRunning, setIsRunning] = useState(false)

  const clockRef = useRef<HTMLSpanElement>(null)

  /**
   * The Start/Stop button's own intent, separate from `isRunning` (which is
   * the EFFECT of that intent after `prefers-reduced-motion` has also had a
   * say). Read inside the effect below through `pausedRef` rather than being
   * a dependency of it — depending on it would tear the whole loop down and
   * rebuild it on every click, which is also where `elapsed`/`serialLines`
   * live, and a rebuild for a pause would show as a jump back to t = 0.
   */
  const [manualPause, setManualPause] = useState(false)
  const pausedRef = useRef(manualPause)
  pausedRef.current = manualPause
  /** Holds the main effect's current `apply`, so the click handler below can
   *  ask it to re-decide play-vs-freeze without being one of its deps. */
  const applyRef = useRef<(() => void) | null>(null)

  /** Cumulative end offset of each step, and the length of one pass. */
  const { ends, cycleMs } = useMemo(() => {
    const acc: number[] = []
    let total = 0
    for (const step of timeline?.steps ?? []) {
      total += Math.max(1, step.ms)
      acc.push(total)
    }
    return { ends: acc, cycleMs: total }
  }, [timeline])

  useEffect(() => {
    if (!timeline || cycleMs <= 0) return

    const steps = timeline.steps
    const linesRef: { current: SerialLine[] } = { current: [] }
    let seq = 0
    let rafId = 0
    let elapsed = 0
    let lastFrameAt = 0
    let lastIndex = -1

    const push = (messages: string[] | undefined, at: Date) => {
      if (!messages?.length) return false
      const added = messages.map((msg) => ({ id: seq++, ts: stamp(at), msg }))
      linesRef.current = [...linesRef.current, ...added].slice(-MAX_SERIAL_LINES)
      return true
    }

    /**
     * Print everything between the step we were on and the step we are on now,
     * so a dropped frame cannot swallow a line. Walks at most one full pass —
     * anything longer ago has already scrolled out of a 40-line buffer.
     */
    const emitThrough = (index: number) => {
      const at = new Date()
      let wrote = false

      if (lastIndex < 0) {
        wrote = push(steps[index].serial, at)
      } else {
        let cursor = lastIndex
        for (let n = 0; n < steps.length; n += 1) {
          cursor = (cursor + 1) % steps.length
          if (push(steps[cursor].serial, at)) wrote = true
          if (cursor === index) break
        }
      }

      if (wrote) setSerialLines(linesRef.current)
    }

    const writeClock = (elapsed: number) => {
      const node = clockRef.current
      if (!node) return
      const text = formatElapsed(elapsed)
      if (node.textContent !== text) node.textContent = text
    }

    const tick = (now: number) => {
      if (lastFrameAt) {
        elapsed = (elapsed + Math.min(now - lastFrameAt, MAX_FRAME_ADVANCE_MS)) % cycleMs
      }
      lastFrameAt = now

      writeClock(elapsed)

      let index = ends.length - 1
      for (let i = 0; i < ends.length; i += 1) {
        if (elapsed < ends[i]) {
          index = i
          break
        }
      }

      if (index !== lastIndex) {
        emitThrough(index)
        lastIndex = index
        setStepIndex(index)
      }

      rafId = requestAnimationFrame(tick)
    }

    const stop = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
    }

    const play = () => {
      if (rafId) return
      elapsed = 0
      lastFrameAt = 0
      lastIndex = -1
      linesRef.current = []
      setIsRunning(true)
      rafId = requestAnimationFrame(tick)
    }

    /**
     * Hold one frame, and show the log as far as that frame.
     *
     * `target` defaults to `stillStep` — the reduced-motion case, which can
     * fire before `play()` has ever run and has no "current position" to
     * hold. A manual pause passes the step actually on screen, so pressing
     * Stop reads as a pause rather than a jump to a canonical frame.
     *
     * `heldClock` is the elapsed time to leave written on the clock, for the
     * same reason: a Stop that snaps the readout back to `00:00:00.000`
     * reads as a reset, not a pause, on a control whose whole job right now
     * is to look like an instrument someone paused mid-run.
     */
    const freeze = (target: number = stillStep, heldClock = 0) => {
      stop()
      setIsRunning(false)
      setStepIndex(target)
      writeClock(heldClock)
      const at = new Date()
      const upTo: SerialLine[] = []
      for (let i = 0; i <= target && i < steps.length; i += 1) {
        for (const msg of steps[i].serial ?? []) upTo.push({ id: seq++, ts: stamp(at), msg })
      }
      linesRef.current = upTo.slice(-MAX_SERIAL_LINES)
      setSerialLines(linesRef.current)
    }

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null

    /**
     * Re-decide play vs. freeze. Called on mount, on every OS-level
     * `prefers-reduced-motion` change, and — via `applyRef` below — every time
     * the Start/Stop button flips `manualPause`. Reduced motion always wins:
     * an explicit click on a button this session added should not override an
     * accessibility setting the student turned on for a reason.
     */
    const apply = () => {
      if (media?.matches) freeze()
      else if (pausedRef.current) freeze(lastIndex >= 0 ? lastIndex : stillStep, elapsed)
      else play()
    }
    applyRef.current = apply

    apply()
    media?.addEventListener('change', apply)

    return () => {
      stop()
      media?.removeEventListener('change', apply)
      applyRef.current = null
    }
  }, [timeline, ends, cycleMs, stillStep])

  /**
   * Re-run the SAME `apply()` the effect above already uses, on every
   * Start/Stop click — without tearing the effect down and losing `elapsed`
   * and the serial buffer, which depending on `manualPause` there would do.
   */
  useEffect(() => {
    applyRef.current?.()
  }, [manualPause])

  const toggleRunning = useCallback(() => setManualPause((paused) => !paused), [])

  const step = timeline?.steps[stepIndex] ?? NO_STEP

  /**
   * The step, restated as canvas props.
   *
   * Nothing is derived here and nothing is defaulted except "absent means off":
   * a step names the lamps that are lit, the modules that are reporting and the
   * properties that differ from the authored document, and everything it does
   * not name is in its resting state. Keeping the transformation this thin is
   * deliberate — the moment this function starts INFERRING what the artwork
   * should show, timelines.ts stops being readable as stage direction.
   */
  const frame = useMemo<ShowreelFrame>(() => {
    if (!timeline) return IDLE_FRAME
    return {
      leds: new Map(Object.entries(step.leds ?? {})),
      devices: step.devices ?? {},
      props: step.props ?? {},
      sensors: step.sensors ?? {},
    }
  }, [timeline, step])

  const initialClock = useMemo(() => formatElapsed(0), [])

  return {
    frame,
    /** False for an experiment with no timeline, and while motion is reduced. */
    isRunning,
    hasTimeline: Boolean(timeline),
    serialLines,
    /** Attach to the elapsed-time text node; the loop writes it directly. */
    clockRef,
    initialClock,
    /** One pass of the timeline, in ms. Exposed for the harness. */
    cycleMs,
    /** The Start/Stop button's own state and the handler it calls. */
    manualPause,
    toggleRunning,
  }
}

/** Scrolls a serial log to its newest line whenever one arrives. */
export function useStickToBottom(lineCount: number) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = useCallback(() => {
    const node = ref.current
    if (node) node.scrollTop = node.scrollHeight
  }, [])
  useEffect(scroll, [lineCount, scroll])
  return ref
}
