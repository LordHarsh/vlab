'use client'

/**
 * Smartphone-controlled home automation — four relays over Flask/GPIO.
 * Ported from `haToggle` in the reference lab HTML.
 */

import { useState } from 'react'
import { CtrlButton, SimLog, SimPanel, useSimLog } from './shared'
import type { SimProps } from './types'

const APPLIANCES: ReadonlyArray<{ name: string; icon: string; pin: string }> = [
  { name: 'Light', icon: '💡', pin: '17' },
  { name: 'Fan', icon: '🌀', pin: '27' },
  { name: 'AC', icon: '❄', pin: '22' },
  { name: 'TV', icon: '📺', pin: '23' },
]

export function HomeAutoSim({ platform }: SimProps) {
  const [state, setState] = useState<Record<string, boolean>>({})
  const { lines, log } = useSimLog()

  function toggle(name: string, pin: string) {
    const next = !state[name]
    setState((s) => ({ ...s, [name]: next }))
    log(
      `GPIO${pin} (${name}): ${next ? 'HIGH — ON' : 'LOW — OFF'}  | HTTP GET /toggle/${name}`
    )
  }

  return (
    <SimPanel>
      <p className="mb-3 font-mono text-[11px] text-[#6b7c8d]">
        Flask endpoints drive four relays{platform ? ` · ${platform}` : ''}.
      </p>

      <div className="mb-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
        {APPLIANCES.map(({ name, icon, pin }) => {
          const on = !!state[name]
          return (
            <div
              key={name}
              className="flex min-w-0 items-center justify-between gap-2 rounded-[5px] border border-[#dfe3e8] bg-[#f1f1f3] px-2.5 py-2"
            >
              <span className="min-w-0 truncate font-mono text-[12px] text-[#34495e]">
                {icon} {name}
              </span>
              <CtrlButton active={on} onClick={() => toggle(name, pin)}>
                {on ? 'ON' : 'OFF'}
              </CtrlButton>
            </div>
          )
        })}
      </div>

      <SimLog lines={lines} />
    </SimPanel>
  )
}
