'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CircuitDoc } from '@/lib/simulator/model/document'
import type { ShowreelFrame } from './useShowreel'
import type { ShowreelSensors } from './timelines'
import {
  applySensorOverrides,
  controlsFor,
  liveSerialFor,
  restingSensors,
  type SensorField,
} from './sensorOverrides'

/**
 * Local, in-memory state for the sliders and toggles in the status strip.
 *
 * NOTHING PERSISTS. `overrides` is a plain `useState` that starts empty on
 * every mount and is thrown away with the component — no `sim_attempts` row,
 * no localStorage, no cookie. Reloading the page resets a dragged slider to
 * whatever it was authored with, the same as everything else in this panel.
 *
 * DRAGGING DOES NOT TOUCH THE CLOCK, on the owner's explicit instruction.
 * This hook used to call `useShowreel`'s `pause()` on every drag — removed:
 * the showreel keeps running, keeps ticking its clock and its serial log,
 * exactly as if nobody had touched a slider at all. A dragged field's value
 * is layered on top of whatever frame is current, every frame, by
 * `applySensorOverrides` — not by freezing one frame and editing it.
 *
 * FOLLOW UNTIL TOUCHED, THEN PIN. A slider tracks the timeline's own sweep
 * until the student moves it, and holds their value from then on.
 *
 * This replaces an earlier attempt that pinned the slider to its authored
 * value from the start. That did stop the thumb drifting, but it left the
 * panel showing two different numbers for one sensor — the slider read 24 °C
 * while the serial log, whose lines are pre-baked, narrated the timeline's
 * sweep through 30, 27, 25. Following the sweep makes the two agree by
 * construction before first touch; `frozenAt` below makes them agree after it,
 * by stopping the log where the student took over.
 */
export function useSensorOverride(
  experimentId: number | undefined,
  frame: ShowreelFrame,
  doc: CircuitDoc | undefined,
  /** How many scripted lines the log has printed so far — see `frozenAt`. */
  serialCount = 0,
) {
  const controls = controlsFor(experimentId)
  const [overrides, setOverrides] = useState<Partial<Record<SensorField, number | boolean>>>({})
  const resting = useMemo(() => restingSensors(doc, experimentId), [doc, experimentId])
  /**
   * How long the scripted log was when the student first took manual control,
   * or null while they have not.
   *
   * THE LOG STOPS THERE. The timeline's serial lines are pre-baked strings
   * narrating its own sensor sweep, so the moment a student pins a slider the
   * script starts printing readings that contradict the control they are
   * holding — 30.00 °C in the log against 24 °C on the slider was the bug this
   * closes. Lines printed BEFORE that moment are kept: they are a true record
   * of the run up to the point it was taken over, and deleting them would
   * throw away the demo the student just watched.
   *
   * STATE, not a ref, because the render reads it — the panel slices its log
   * with it. A ref would be the natural reach here (it is written once, from
   * an event handler) but `react-hooks/refs` correctly rejects reading one
   * during render: the value a render sees would be whatever the PREVIOUS
   * render left behind.
   */
  const [frozenAt, setFrozenAt] = useState<number | null>(null)
  /**
   * Synced in an effect rather than assigned during render — `react-hooks/refs`
   * rejects the latter, and rightly: a ref written while rendering is invisible
   * to the render that wrote it. An effect is exactly right here anyway, since
   * the only reader is the event handler below, which cannot run before the
   * effect has flushed.
   */
  const liveCount = useRef(serialCount)
  useEffect(() => {
    liveCount.current = serialCount
  }, [serialCount])

  const setValue = useCallback((field: SensorField, value: number | boolean) => {
    // `?? current` rather than an if: only the FIRST touch marks the cut, and
    // the functional form makes that true even under batched updates.
    setFrozenAt((prev) => prev ?? liveCount.current)
    setOverrides((prev) => ({ ...prev, [field]: value }))
  }, [])

  /** Hand the sweep back — the panel resumes its scripted run. */
  const release = useCallback(() => {
    setFrozenAt(null)
    setOverrides({})
  }, [])

  const overriddenFrame = useMemo(
    () => applySensorOverrides(frame, experimentId, overrides, resting),
    [frame, experimentId, overrides, resting],
  )

  /**
   * The lines the sketch would print for the reading now on the controls.
   *
   * Only once a student has actually MOVED something. Before that the panel is
   * showing its own scripted run and has nothing of the student's to report;
   * offering a live line for the resting value would duplicate whatever the
   * timeline is printing anyway and make the log read as though it had run
   * twice.
   */
  const touched = Object.keys(overrides).length > 0
  const liveSerial = useMemo(
    () => (touched ? liveSerialFor(experimentId, overriddenFrame.sensors) : []),
    [touched, experimentId, overriddenFrame.sensors],
  )

  return {
    frame: overriddenFrame,
    controls,
    overrides,
    setValue,
    liveSerial,
    /** Truncate the scripted log here, or show all of it when null. */
    frozenAt: touched ? frozenAt : null,
    manual: touched,
    release,
  }
}

export type { ShowreelSensors }
