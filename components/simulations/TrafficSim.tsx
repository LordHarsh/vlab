'use client'

/**
 * Three-aspect traffic light on a timer.
 * Ported from `trafficStep` / `toggleTraffic` + the PHASES table in the
 * reference lab HTML. GREEN 5s → YELLOW 2s → RED 5s, repeating.
 */

import { useEffect, useRef, useState } from 'react'
import { CtrlButton, CtrlRow, LedStack, SimLog, SimPanel, SimStage, useSimLog } from './shared'
import type { SimProps } from './types'

const PHASES = [
  { l: 'GREEN', t: 5 },
  { l: 'YELLOW', t: 2 },
  { l: 'RED', t: 5 },
] as const

const MESSAGE: Record<string, string> = {
  GREEN: 'Go!',
  YELLOW: 'Slow down',
  RED: 'Stop!',
}

export function TrafficSim({ platform }: SimProps) {
  const [running, setRunning] = useState(true)
  const [phase, setPhase] = useState(0)
  const { lines, log } = useSimLog()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const current = PHASES[phase % 3].l

  useEffect(() => {
    if (!running) return
    const p = PHASES[phase % 3]
    log(`${p.l} — ${MESSAGE[p.l]}`)
    timer.current = setTimeout(() => setPhase((x) => x + 1), p.t * 1000)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [running, phase, log])

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        Timed signal sequence{platform ? ` · ${platform}` : ''}. Green 5s, yellow 2s, red 5s.
      </p>

      <SimStage>
        <div className="flex items-start justify-center gap-6 sm:gap-10">
          <LedStack on={current === 'RED'} color="#ef4444" caption="Red" size={44} />
          <LedStack on={current === 'YELLOW'} color="#eab308" caption="Yellow" size={44} />
          <LedStack on={current === 'GREEN'} color="#22c55e" caption="Green" size={44} />
        </div>
      </SimStage>

      <div className="mt-3">
        <CtrlRow>
          <CtrlButton active={running} onClick={() => setRunning((r) => !r)}>
            {running ? '▶ RUNNING' : '⏸ PAUSED'}
          </CtrlButton>
        </CtrlRow>
      </div>

      <SimLog lines={lines} />
    </SimPanel>
  )
}
