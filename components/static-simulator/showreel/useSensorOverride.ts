'use client'

import { useCallback, useMemo, useState } from 'react'
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
 * THE OTHER HALF OF THE SAME FIX: a field with a slider no longer shows the
 * timeline's own live sweep of that field EVER, dragged or not — it shows
 * `overrides[field] ?? restingSensors(doc)[field]`. Without this, removing
 * the pause-on-drag would have made the "why is the slider moving on its
 * own" complaint WORSE, not better: the thumb would drift continuously in
 * the background instead of only between drags. See sensorOverrides.ts's
 * own header on `applySensorOverrides` for the full reasoning.
 */
export function useSensorOverride(experimentId: number | undefined, frame: ShowreelFrame, doc: CircuitDoc | undefined) {
  const controls = controlsFor(experimentId)
  const [overrides, setOverrides] = useState<Partial<Record<SensorField, number | boolean>>>({})
  const resting = useMemo(() => restingSensors(doc, experimentId), [doc, experimentId])

  const setValue = useCallback((field: SensorField, value: number | boolean) => {
    setOverrides((prev) => ({ ...prev, [field]: value }))
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

  return { frame: overriddenFrame, controls, overrides, setValue, liveSerial }
}

export type { ShowreelSensors }
