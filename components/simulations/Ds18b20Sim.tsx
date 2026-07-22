'use client'

/**
 * DS18B20 1-Wire temperature probe.
 * Ported from `simDS18` in the reference lab HTML.
 */

import { useCallback, useEffect, useState } from 'react'
import { SimLog, SimPanel, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

const TEMP_0 = 25

export function Ds18b20Sim({ platform }: SimProps) {
  const [temp, setTemp] = useState(TEMP_0)
  const { lines, log } = useSimLog()

  const read = useCallback(
    (t: number) => {
      const f = (t * 9) / 5 + 32
      log(`Temperature: ${t.toFixed(3)}°C  |  ${f.toFixed(3)}°F  |  Device: 28-abcdef012345`)
    },
    [log]
  )

  // The reference auto-runs simDS18() shortly after the experiment opens. Run the
  // real function against the initial slider value so the first line can never
  // drift from the slider beside it.
  useEffect(() => {
    read(TEMP_0)
  }, [read])

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        DS18B20 on the 1-Wire bus{platform ? ` · ${platform}` : ''}. Read from
        /sys/bus/w1/devices/28-abcdef012345.
      </p>

      <SliderRow
        label="Temperature (°C)"
        value={temp}
        display={`${temp}°C`}
        min={-10}
        max={85}
        onChange={(v) => {
          setTemp(v)
          read(v)
        }}
      />

      <SimLog lines={lines} />
    </SimPanel>
  )
}
