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
  /** Port of the reference's `tPhase`: the phase the NEXT step will show. */
  const nextPhase = useRef(0)

  const current = PHASES[phase % 3].l

  useEffect(() => {
    if (!running) return
    // Port of trafficStep(): show and log a phase, then advance the counter
    // *before* arming the timer. Because the counter moves inside the step,
    // resuming after a pause continues with the next phase — the reference's
    // toggleTraffic() calls trafficStep() directly — instead of repeating the
    // phase already on screen.
    const step = () => {
      const i = nextPhase.current
      const p = PHASES[i % 3]
      setPhase(i)
      log(`${p.l} — ${MESSAGE[p.l]}`)
      nextPhase.current = i + 1
      timer.current = setTimeout(step, p.t * 1000)
    }
    step()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [running, log])

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
