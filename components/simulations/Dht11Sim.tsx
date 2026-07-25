'use client'

/**
 * DHT11 temperature / humidity + alert LED.
 * Ported from `simDHT` in the reference lab HTML.
 *
 * Shared by two experiments (Arduino #1 and Raspberry Pi #7). The reference
 * uses the identical simulation for both — only the caption differs.
 */

import { useCallback, useEffect, useState } from 'react'
import { LedRow, SimLog, SimPanel, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

const TEMP_0 = 28
const HUM_0 = 55

export function Dht11Sim({ platform }: SimProps) {
  const [temp, setTemp] = useState(TEMP_0)
  const [hum, setHum] = useState(HUM_0)
  const { lines, log } = useSimLog()

  const hot = temp > 30

  const read = useCallback(
    (t: number, h: number) => {
      log(`Humidity: ${h}%  Temperature: ${t}°C${t > 30 ? ' ⚠ ALERT' : ''}`)
    },
    [log]
  )

  // The reference auto-runs simDHT() shortly after the experiment opens. Run the
  // real function against the initial slider values so the first line can never
  // drift from the sliders beside it.
  useEffect(() => {
    read(TEMP_0, HUM_0)
  }, [read])

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        DHT11 on a single-wire data pin{platform ? ` · ${platform}` : ''}. LED turns on above 30°C.
      </p>

      <SliderRow
        label="Temperature (°C)"
        value={temp}
        display={`${temp}°C`}
        min={15}
        max={50}
        onChange={(v) => {
          setTemp(v)
          read(v, hum)
        }}
      />
      <SliderRow
        label="Humidity (%)"
        value={hum}
        display={`${hum}%`}
        min={20}
        max={90}
        onChange={(v) => {
          setHum(v)
          read(temp, v)
        }}
      />

      <LedRow on={hot} color="#ef4444" label={hot ? 'LED ON (High Temp!)' : 'LED OFF'} />

      <SimLog lines={lines} />
    </SimPanel>
  )
}
