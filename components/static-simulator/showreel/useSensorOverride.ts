'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ShowreelFrame } from './useShowreel'
import type { ShowreelSensors } from './timelines'
import { applySensorOverrides, controlsFor, type SensorField } from './sensorOverrides'

/**
 * Local, in-memory state for the sliders and toggles in the status strip.
 *
 * NOTHING PERSISTS. `overrides` is a plain `useState` that starts empty on
 * every mount and is thrown away with the component — no `sim_attempts` row,
 * no localStorage, no cookie. Reloading the page resets a dragged slider to
 * whatever the timeline's own default frame is, the same as everything else
 * in this panel.
 *
 * ONE CLOCK, STILL. This hook adds no timer of its own: `pause` is the SAME
 * `manualPause` flag useShowreel's existing effect already reads, so dragging
 * a slider freezes the showreel exactly the way pressing Stop does, and the
 * override is applied ON TOP of that one frozen frame — see
 * `applySensorOverrides` in ./sensorOverrides.ts for the merge.
 */
export function useSensorOverride(
  experimentId: number | undefined,
  frame: ShowreelFrame,
  isRunning: boolean,
  pause: () => void,
) {
  const controls = controlsFor(experimentId)
  const [overrides, setOverrides] = useState<Partial<Record<SensorField, number | boolean>>>({})

  /**
   * Resuming playback drops every override.
   *
   * "Releasing the Start/Stop button... resumes scripted playback" — the
   * owner's brief — means a value the student dialled in stops being
   * authoritative the instant the script is running again. Restarting from
   * t = 0 with a stale override still applied would show a number the
   * timeline never wrote, which is exactly the kind of disagreement this
   * whole panel exists to avoid.
   */
  useEffect(() => {
    if (isRunning) setOverrides({})
  }, [isRunning])

  const setValue = useCallback(
    (field: SensorField, value: number | boolean) => {
      pause()
      setOverrides((prev) => ({ ...prev, [field]: value }))
    },
    [pause],
  )

  const overriddenFrame = useMemo(
    () => applySensorOverrides(frame, experimentId, overrides),
    [frame, experimentId, overrides],
  )

  return { frame: overriddenFrame, controls, overrides, setValue }
}

export type { ShowreelSensors }
