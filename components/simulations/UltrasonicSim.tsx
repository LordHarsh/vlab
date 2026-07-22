'use client'

/**
 * HC-SR04 ultrasonic distance + PIR motion, driving one LED.
 * Ported from `simUltrasonic` / `togglePIR` in the reference lab HTML.
 */

import { useCallback, useEffect, useState } from 'react'
import { CtrlButton, CtrlRow, LedRow, SimLog, SimPanel, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

const DIST_0 = 150
const PIR_0 = false

export function UltrasonicSim({ platform }: SimProps) {
  const [dist, setDist] = useState(DIST_0)
  const [pir, setPir] = useState(PIR_0)
  const { lines, log } = useSimLog()

  const alert = pir || dist < 20

  const read = useCallback(
    (d: number, motion: boolean) => {
      const on = motion || d < 20
      log(
        `Distance: ${d} cm  |  Motion: ${motion ? 'DETECTED' : 'None'}  |  LED: ${on ? 'ON' : 'OFF'}`
      )
    },
    [log]
  )

  // The reference auto-runs simUltrasonic() shortly after the experiment opens.
  // Run the real function against the initial state so the first line can never
  // drift from the controls beside it.
  useEffect(() => {
    read(DIST_0, PIR_0)
  }, [read])

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        HC-SR04 + PIR{platform ? ` · ${platform}` : ''}. LED lights below 20 cm or on motion.
      </p>

      <SliderRow
        label="Object Distance (cm)"
        value={dist}
        display={`${dist}cm`}
        min={2}
        max={400}
        onChange={(v) => {
          setDist(v)
          read(v, pir)
        }}
      />

      <CtrlRow>
        <CtrlButton
          active={pir}
          onClick={() => {
            const next = !pir
            setPir(next)
            read(dist, next)
          }}
        >
          PIR: {pir ? 'DETECTED' : 'OFF'}
        </CtrlButton>
        <CtrlButton onClick={() => read(dist, pir)}>READ SENSORS</CtrlButton>
      </CtrlRow>

      <LedRow on={alert} color="#00d4ff" label={alert ? 'LED ON' : 'LED OFF'} />

      <SimLog lines={lines} />
    </SimPanel>
  )
}
