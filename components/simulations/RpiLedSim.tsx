'use client'

/**
 * Raspberry Pi push button toggling an LED on GPIO17.
 * Ported from `toggleRPiLED` in the reference lab HTML.
 */

import { useState } from 'react'
import { CtrlButton, CtrlRow, LedRow, SimLog, SimPanel, useSimLog } from './shared'
import type { SimProps } from './types'

export function RpiLedSim({ platform }: SimProps) {
  const { lines, log } = useSimLog()
  const [on, setOn] = useState(false)

  function press() {
    const next = !on
    setOn(next)
    log(`Button pressed → LED ${next ? 'ON' : 'OFF'}  (GPIO17 = ${next ? 1 : 0})`)
  }

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        Button on GPIO27 toggles the LED on GPIO17{platform ? ` · ${platform}` : ''}.
      </p>

      <CtrlRow>
        {/* Reference: the push button is a plain control — it never latches. */}
        <CtrlButton onClick={press}>
          🔘 PRESS BUTTON
        </CtrlButton>
      </CtrlRow>

      <LedRow on={on} color="#f59e0b" label={`GPIO17: ${on ? 'ON' : 'OFF'}`} />

      <SimLog lines={lines} />
    </SimPanel>
  )
}
