'use client'

/**
 * YF-S201 water flow sensor.
 * Ported from `simFlow` in the reference lab HTML: 7.5 pulses per L/min.
 */

import { useEffect, useState } from 'react'
import { SimLog, SimPanel, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

export function FlowSim({ platform }: SimProps) {
  const [flow, setFlow] = useState(8)
  const { lines, log } = useSimLog()

  function read(f: number) {
    const pulses = Math.round(f * 7.5)
    log(
      `Flow: ${f} L/min  |  Pulses/s: ${pulses}  |  Vol: ${(f / 60).toFixed(4)} L this second`
    )
  }

  // The reference auto-runs simFlow() shortly after the experiment opens.
  useEffect(() => {
    log('Flow: 8 L/min  |  Pulses/s: 60  |  Vol: 0.1333 L this second')
  }, [log])

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        YF-S201 hall-effect flow sensor on an interrupt pin
        {platform ? ` · ${platform}` : ''}. 7.5 pulses per L/min.
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
