'use client'

/**
 * YF-S201 water flow sensor.
 * Ported from `simFlow` in the reference lab HTML: 7.5 Hz per L/min.
 */

import { useCallback, useEffect, useState } from 'react'
import { SimLog, SimPanel, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

const FLOW_0 = 8

export function FlowSim({ platform }: SimProps) {
  const [flow, setFlow] = useState(FLOW_0)
  const { lines, log } = useSimLog()

  const read = useCallback(
    (f: number) => {
      const pulses = Math.round(f * 7.5)
      log(
        `Flow: ${f} L/min  |  Pulses/s: ${pulses}  |  Vol: ${(f / 60).toFixed(4)} L this second`
      )
    },
    [log]
  )

  // The reference auto-runs simFlow() shortly after the experiment opens. Run the
  // real function against the initial slider value so the first line can never
  // drift from the slider beside it.
  useEffect(() => {
    read(FLOW_0)
  }, [read])

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        YF-S201 hall-effect flow sensor on an interrupt pin
        {platform ? ` · ${platform}` : ''}. Flow rate (L/min) = pulse frequency ÷ 7.5, so 7.5 Hz
        per L/min.
      </p>

      <SliderRow
        label="Flow Rate (L/min)"
        value={flow}
        display={`${flow} L/min`}
        min={0}
        max={30}
        step={0.5}
        onChange={(v) => {
          setFlow(v)
          read(v)
        }}
      />

      <SimLog lines={lines} />
    </SimPanel>
  )
}
