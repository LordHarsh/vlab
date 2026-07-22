'use client'

/**
 * HC-SR04 ultrasonic distance + PIR motion, driving one LED.
 * Ported from `simUltrasonic` / `togglePIR` in the reference lab HTML.
 */

import { useEffect, useState } from 'react'
import { CtrlButton, CtrlRow, LedRow, SimLog, SimPanel, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

export function UltrasonicSim({ platform }: SimProps) {
  const [dist, setDist] = useState(150)
  const [pir, setPir] = useState(false)
  const { lines, log } = useSimLog()

  const alert = pir || dist < 20

  function read(d: number, motion: boolean) {
    const on = motion || d < 20
    log(
      `Distance: ${d} cm  |  Motion: ${motion ? 'DETECTED' : 'None'}  |  LED: ${on ? 'ON' : 'OFF'}`
    )
  }

  // The reference auto-runs simUltrasonic() shortly after the experiment opens.
  useEffect(() => {
    log('Distance: 150 cm  |  Motion: None  |  LED: OFF')
  }, [log])

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

      <LedRow on={alert} color="#1477d1" label={alert ? 'LED ON' : 'LED OFF'} />

      <SimLog lines={lines} />
    </SimPanel>
  )
}
