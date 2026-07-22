'use client'

/**
 * PIR motion alarm with a 3 second armed window.
 * Ported from `triggerPIR` in the reference lab HTML.
 */

import { useEffect, useRef, useState } from 'react'
import { CtrlButton, CtrlRow, LedStack, SimLog, SimPanel, SimStage, useSimLog } from './shared'
import type { SimProps } from './types'

export function PirAlarmSim({ platform }: SimProps) {
  const [alarm, setAlarm] = useState(false)
  const { lines, log } = useSimLog()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A student navigating away mid-alarm must not leave the timer running.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  function trigger() {
    if (timer.current) clearTimeout(timer.current)
    setAlarm(true)
    log('⚠ MOTION DETECTED — ALARM ACTIVE! Buzzer beeping...')
    timer.current = setTimeout(() => {
      setAlarm(false)
      log('✓ Motion cleared — System back to READY state')
      timer.current = null
    }, 3000)
  }

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        PIR + buzzer{platform ? ` · ${platform}` : ''}. The alarm holds for 3 seconds, then rearms.
      </p>

      <CtrlRow>
        <CtrlButton active={alarm} onClick={trigger}>
          👋 TRIGGER MOTION
        </CtrlButton>
      </CtrlRow>

      <SimStage>
        <div className="flex items-start justify-center gap-8">
          <LedStack on={!alarm} color="#22c55e" caption="Ready" size={26} />
          <LedStack on={alarm} color="#ef4444" caption="Alarm" size={26} />
        </div>
      </SimStage>

      <SimLog lines={lines} />
    </SimPanel>
  )
}
