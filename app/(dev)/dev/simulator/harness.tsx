'use client'

import { useState } from 'react'
import { useSimulator } from '@/lib/simulator/worker/useSimulator'

const RESISTORS = [
  { ohms: 220, label: '220 Ω', note: 'correct' },
  { ohms: 1000, label: '1 kΩ', note: 'dim' },
  { ohms: 10000, label: '10 kΩ', note: 'barely lit' },
  { ohms: 0, label: 'none', note: 'destroys the LED' },
]

export function SimulatorHarness() {
  const { ready, running, error, state, start, stop, setResistor, benchmark, bench } =
    useSimulator('/sim/blink.hex', 220)
  const [ohms, setOhms] = useState(220)

  function changeResistor(next: number) {
    setOhms(next)
    setResistor(next)
  }

  const mA = state.current * 1000

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-8 font-mono">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-white">VLab Simulator — Phase 0 harness</h1>
          <p className="text-sm text-[#8b949e] mt-1">
            Real <code>avr-gcc</code> Blink firmware on avr8js, coupled to the MNA DC solver,
            running in a Web Worker. Unauthenticated dev route.
          </p>
        </header>

        {error && (
          <div
            className="rounded-lg border border-red-800 bg-red-950/50 p-4 mb-6 text-red-300"
            data-testid="error"
          >
            {error}
          </div>
        )}

        {!ready && !error && <p className="text-[#8b949e]">Loading firmware…</p>}

        {ready && (
          <>
            <div className="flex gap-3 mb-8">
              <button
                onClick={running ? stop : start}
                data-testid="run-toggle"
                className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                  running
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-green-600 hover:bg-green-500 text-white'
                }`}
              >
                {running ? 'Stop' : 'Start simulation'}
              </button>
              <button
                onClick={benchmark}
                data-testid="benchmark"
                className="px-5 py-2.5 rounded-lg text-sm border border-[#30363d] hover:border-[#8b949e] text-[#c9d1d9]"
              >
                Benchmark raw throughput
              </button>
              <div className="flex items-center gap-2 text-sm text-[#8b949e]">
                <span
                  className={`w-2 h-2 rounded-full ${running ? 'bg-green-400 animate-pulse' : 'bg-[#30363d]'}`}
                />
                {running ? 'running' : 'idle'}
              </div>
              {bench && (
                <div className="flex items-center text-sm text-[#58a6ff]" data-testid="bench-result">
                  {bench.mcps.toFixed(1)} Mcycle/s &nbsp;·&nbsp; {bench.xRealtime.toFixed(2)}x realtime
                </div>
              )}
            </div>

            <section className="mb-8">
              <h2 className="text-xs uppercase tracking-wider text-[#8b949e] mb-3">
                Series resistor
              </h2>
              <div className="flex flex-wrap gap-2">
                {RESISTORS.map((opt) => (
                  <button
                    key={opt.ohms}
                    data-testid={`resistor-${opt.ohms}`}
                    onClick={() => changeResistor(opt.ohms)}
                    className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                      ohms === opt.ohms
                        ? 'border-[#58a6ff] bg-[#58a6ff]/10 text-[#58a6ff]'
                        : 'border-[#30363d] hover:border-[#8b949e] text-[#c9d1d9]'
                    }`}
                  >
                    {opt.label}
                    <span className="block text-[10px] text-[#8b949e] mt-0.5">{opt.note}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="mb-8">
              <div className="flex items-center gap-8 rounded-xl border border-[#30363d] bg-[#161b22] p-8">
                <div className="relative">
                  <div
                    data-testid="led"
                    className="w-20 h-20 rounded-full transition-all duration-75"
                    style={{
                      background: state.overCurrent
                        ? '#f85149'
                        : `rgb(${Math.round(60 + state.brightness * 195)}, ${Math.round(20 + state.brightness * 40)}, ${Math.round(20 + state.brightness * 30)})`,
                      boxShadow: state.overCurrent
                        ? '0 0 60px 20px rgba(248,81,73,0.8)'
                        : `0 0 ${state.brightness * 50}px ${state.brightness * 16}px rgba(255,60,40,${state.brightness * 0.75})`,
                    }}
                  />
                  {state.overCurrent && (
                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-red-400 whitespace-nowrap font-bold">
                      DESTROYED
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm">
                  <Metric label="LED current" value={`${mA.toFixed(2)} mA`} testid="current" />
                  <Metric label="anode voltage" value={`${state.anodeVolts.toFixed(3)} V`} />
                  <Metric label="D13" value={state.pin.replace('output_', '')} testid="pin" />
                  <Metric
                    label="power"
                    value={`${(state.current * state.anodeVolts * 1000).toFixed(1)} mW`}
                  />
                </div>
              </div>
              {state.overCurrent && (
                <p className="mt-8 text-sm text-red-400" data-testid="destroyed-msg">
                  {mA.toFixed(0)} mA through a 20 mA part. On real hardware this LED is gone.
                </p>
              )}
            </section>

            <section>
              <h2 className="text-xs uppercase tracking-wider text-[#8b949e] mb-3">Engine</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Metric
                  label="speed"
                  value={`${state.speedRatio.toFixed(2)}x`}
                  testid="speed"
                  hint="vs real 16 MHz"
                />
                <Metric label="sim time" value={`${state.simSeconds.toFixed(1)} s`} testid="simtime" />
                <Metric label="pin edges" value={String(state.pinEdges)} testid="edges" />
                <Metric label="DC solves" value={String(state.solves)} testid="solves" />
                <Metric label="cache hits" value={String(state.cacheHits)} testid="hits" />
              </div>
              <p className="text-xs text-[#8b949e] mt-4 leading-relaxed">
                Solves stay in single digits no matter how long this runs — the DC solution is
                memoised on pin state, so a blinking pin only ever needs two. The engine lives in
                a Web Worker; on the main thread React&apos;s commit, not the simulation, was the
                bottleneck.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  testid,
}: {
  label: string
  value: string
  hint?: string
  testid?: string
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#8b949e]">{label}</div>
      <div className="text-lg text-white tabular-nums" data-testid={testid}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-[#6e7681]">{hint}</div>}
    </div>
  )
}
