'use client'

/**
 * Smart health monitor — body temperature + heart rate pushed to ThingSpeak.
 * Ported from `simHealth` in the reference lab HTML.
 * Normal ranges: 36.1–37.2°C and 60–100 BPM.
 */

import { useCallback, useEffect, useState } from 'react'
import { SimLog, SimPanel, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

const TEMP_0 = 36.8
const BPM_0 = 72

function evaluate(t: number, b: number) {
  const tempOk = t >= 36.1 && t <= 37.2
  const bpmOk = b >= 60 && b <= 100
  const status = tempOk && bpmOk ? '✅ NORMAL' : '⚠ ALERT'
  let detail = ''
  if (!tempOk) detail += ` Temp ${t < 36.1 ? 'LOW' : 'HIGH'}`
  if (!bpmOk) detail += ` BPM ${b < 60 ? 'LOW (Bradycardia)' : 'HIGH (Tachycardia)'}`
  return { status, detail }
}

export function HealthSim({ platform }: SimProps) {
  const [temp, setTemp] = useState(TEMP_0)
  const [bpm, setBpm] = useState(BPM_0)
  const { lines, log } = useSimLog()

  const read = useCallback(
    (t: number, b: number) => {
      const { status, detail } = evaluate(t, b)
      log(`Temp: ${t}°C  BPM: ${b}  Status: ${status}${detail} → ThingSpeak updated`)
    },
    [log]
  )

  // The reference auto-runs simHealth() shortly after the experiment opens. Run
  // the real function against the initial slider values so the first line can
  // never drift from the sliders beside it.
  useEffect(() => {
    read(TEMP_0, BPM_0)
  }, [read])

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        Pulse + temperature sensor{platform ? ` · ${platform}` : ''}. Readings are pushed to
        ThingSpeak.
      </p>

      <SliderRow
        label="Body Temp (°C)"
        value={temp}
        display={`${temp}°C`}
        min={34}
        max={42}
        step={0.1}
        onChange={(v) => {
          setTemp(v)
          read(v, bpm)
        }}
      />
      <SliderRow
        label="Heart Rate (BPM)"
        value={bpm}
        display={`${bpm} BPM`}
        min={40}
        max={180}
        onChange={(v) => {
          setBpm(v)
          read(temp, v)
        }}
      />

      <SimLog lines={lines} />
    </SimPanel>
  )
}
