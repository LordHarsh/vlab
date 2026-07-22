'use client'

/**
 * Density-adaptive traffic controller — the busiest lane gets green.
 * Ported from `simSmartTraffic` in the reference lab HTML.
 * Green time = (3000 + density * 70) ms.
 */

import { useEffect, useState } from 'react'
import { LedStack, SimLog, SimPanel, SimStage, SliderRow, useSimLog } from './shared'
import type { SimProps } from './types'

const LANES = [1, 2, 3, 4] as const

export function SmartTrafficSim({ platform }: SimProps) {
  const [density, setDensity] = useState<number[]>([20, 40, 60, 80])
  const { lines, log } = useSimLog()

  const max = Math.max(...density)
  const activeIdx = density.indexOf(max) + 1

  function evaluate(ds: number[]) {
    const m = Math.max(...ds)
    const lane = ds.indexOf(m) + 1
    const greenTime = (3000 + m * 70) / 1000
    log(`Lane ${lane} gets GREEN (density ${m}%) — Green time: ${greenTime.toFixed(1)}s`)
  }

  // The reference auto-runs simSmartTraffic() shortly after the experiment opens.
  useEffect(() => {
    log('Lane 4 gets GREEN (density 80%) — Green time: 8.6s')
  }, [log])

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        Adaptive junction{platform ? ` · ${platform}` : ''}. The densest lane holds green longer.
      </p>

      {LANES.map((i) => (
        <SliderRow
          key={i}
          label={`Lane ${i} Density`}
          value={density[i - 1]}
          display={`${density[i - 1]}%`}
          min={0}
          max={100}
          onChange={(v) => {
            const next = density.slice()
            next[i - 1] = v
            setDensity(next)
            evaluate(next)
          }}
        />
      ))}

      <div className="mt-3">
        <SimStage>
          <div className="flex items-start justify-center gap-5 sm:gap-8">
            {LANES.map((i) => (
              <LedStack
                key={i}
                on
                color={i === activeIdx ? '#22c55e' : '#ef4444'}
                caption={`L${i}`}
              />
            ))}
          </div>
        </SimStage>
      </div>

      <SimLog lines={lines} />
    </SimPanel>
  )
}
