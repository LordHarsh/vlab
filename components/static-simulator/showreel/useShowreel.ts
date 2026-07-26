'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
 * happened rather than an empty box. The CSS keyframes in the ported artwork
 * are switched off for the same query in static-simulator.css.
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
 * What the artwork is shown. `componentId` is separate from `pinId` because
 * ComponentSVGs asks about its own pins by their bare id ('anode', 'out1'),
 * with no idea which instance it is drawing.
 */
export interface ShowreelFrame {
  isPinHigh: (componentId: string, pinId: string) => boolean
  pinVoltage: (componentId: string, pinId: string) => number
  sensors: ShowreelSensors
  propertiesFor: (componentId: string) => Record<string, unknown> | undefined
  /**
   * Bare pin ids at 5 V, in the shape the ported relay and lamp expect. Those
   * two are the only parts that read the raw bag rather than their own pins.
   */
  rawPinStates: Record<string, number>
}

const NO_STEP: ShowreelStep = { ms: 0 }

/** An inert frame — every pin low, every readout absent. */
export const IDLE_FRAME: ShowreelFrame = {
  isPinHigh: () => false,
  pinVoltage: () => 0,
  sensors: {},
  propertiesFor: () => undefined,
  rawPinStates: {},
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

    /** Hold one frame, and show the log as far as that frame. */
    const freeze = () => {
      stop()
      setIsRunning(false)
      setStepIndex(stillStep)
      writeClock(0)
      const at = new Date()
      const upTo: SerialLine[] = []
      for (let i = 0; i <= stillStep && i < steps.length; i += 1) {
        for (const msg of steps[i].serial ?? []) upTo.push({ id: seq++, ts: stamp(at), msg })
      }
      linesRef.current = upTo.slice(-MAX_SERIAL_LINES)
      setSerialLines(linesRef.current)
    }

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null

    const apply = () => {
      if (media?.matches) freeze()
      else play()
    }

    apply()
    media?.addEventListener('change', apply)

    return () => {
      stop()
      media?.removeEventListener('change', apply)
    }
  }, [timeline, ends, cycleMs, stillStep])

  const step = timeline?.steps[stepIndex] ?? NO_STEP

  const frame = useMemo<ShowreelFrame>(() => {
    if (!timeline) return IDLE_FRAME

    const high = new Set(step.high ?? [])

    // The relay and the lamp were ported reading a flat bag of board pins
    // rather than their own terminals, so hand them one built from the same
    // set. 'rpi_1/GP15' becomes GP15.
    const rawPinStates: Record<string, number> = {}
    for (const key of high) {
      const slash = key.indexOf('/')
      if (slash >= 0) rawPinStates[key.slice(slash + 1)] = 1
    }

    const isPinHigh = (componentId: string, pinId: string) => high.has(`${componentId}/${pinId}`)

    return {
      isPinHigh,
      pinVoltage: (componentId, pinId) => (isPinHigh(componentId, pinId) ? 5 : 0),
      sensors: step.sensors ?? {},
      propertiesFor: (componentId: string) => step.props?.[componentId],
      rawPinStates,
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
