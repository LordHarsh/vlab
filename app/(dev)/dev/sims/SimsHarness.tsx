'use client'

import { useState } from 'react'
import { SimulationSection } from '@/components/sections/SimulationSection'
import { SIM_KEYS, SIM_LABELS } from '@/components/simulations'

/**
 * Every registered built-in simulation, plus the two non-happy paths, rendered
 * through the real `SimulationSection` dispatcher so the harness exercises the
 * same code the student route does.
 */
export function SimsHarness() {
  // Unmounting every simulation at once is how the timer-cleanup requirement
  // gets checked: nothing may keep ticking after this flips off.
  const [mounted, setMounted] = useState(true)

  return (
    <div className="min-h-[100dvh] bg-[#f4f5f6] text-[#34495e]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dfe3e8] bg-white px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold">Built-in simulations — dev harness</h1>
          <p className="mt-0.5 text-[12px] text-[#6b7c8d]">
            {SIM_KEYS.length} registered sim_type keys. Development only.
          </p>
        </div>
        <button
          type="button"
          data-testid="mount-toggle"
          onClick={() => setMounted((m) => !m)}
          className="h-8 shrink-0 rounded-[3px] border border-[#dfe3e8] bg-white px-3 font-mono text-[11px] text-[#34495e] transition-colors hover:border-[#1477d1]"
        >
          {mounted ? 'Unmount all' : 'Mount all'}
        </button>
      </header>

      {mounted ? (
        <main className="mx-auto w-full max-w-3xl space-y-6 px-3 py-4 sm:px-4 sm:py-6">
          {SIM_KEYS.map((key) => (
            <section key={key} data-sim={key}>
              <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b7c8d]">
                {key}
              </h2>
              <SimulationSection
                type="builtin"
                simType={key}
                designId={null}
                title={SIM_LABELS[key] ?? key}
                platform={key.includes('rpi') ? 'Raspberry Pi' : 'Arduino'}
              />
            </section>
          ))}

          <section data-sim="__unknown">
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b7c8d]">
              unknown key
            </h2>
            <SimulationSection type="builtin" simType="does_not_exist" designId={null} />
          </section>

          <section data-sim="__native">
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b7c8d]">
              native
            </h2>
            <SimulationSection type="native" designId={null} title="Native circuit" />
          </section>
        </main>
      ) : (
        <p className="px-4 py-6 font-mono text-[12px] text-[#6b7c8d]">
          All simulations unmounted — nothing should still be ticking.
        </p>
      )}
    </div>
  )
}
