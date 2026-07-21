'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArduinoSimulation, parseIntelHex } from '@/lib/simulator/arduino'

const RESISTORS = [
  { ohms: 220, label: '220 Ω', note: 'correct' },
  { ohms: 1000, label: '1 kΩ', note: 'dim' },
  { ohms: 10000, label: '10 kΩ', note: 'barely lit' },
  { ohms: 0, label: 'none', note: 'destroys the LED' },
]

interface Readout {
  current: number
  brightness: number
  overCurrent: boolean
  anodeVolts: number
  pin: string
  speed: number
  solves: number
  hits: number
  edges: number
  simSeconds: number
}

export function SimulatorHarness() {
  const simRef = useRef<ArduinoSimulation | null>(null)
  const rafRef = useRef<number>(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [ohms, setOhms] = useState(220)
  const [r, setR] = useState<Readout>({
    current: 0,
    brightness: 0,
    overCurrent: false,
    anodeVolts: 0,
    pin: 'output_low',
    speed: 0,
    solves: 0,
    hits: 0,
    edges: 0,
    simSeconds: 0,
  })

  // Load the real avr-gcc-compiled Blink firmware.
  useEffect(() => {
    let cancelled = false
    fetch('/sim/blink.hex')
      .then((res) => {
        if (!res.ok) throw new Error(`hex fetch failed: ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (cancelled) return
        const program = parseIntelHex(text)
        simRef.current = new ArduinoSimulation(program, 220)
        setReady(true)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const tick = useCallback(() => {
    const sim = simRef.current
    if (!sim) return
    // Advance 16 ms of simulated time per frame — one frame's worth at 60fps,
    // so the sim tracks wall clock when the host can keep up.
    const t0 = performance.now()
    sim.run(16_000)
    const wall = performance.now() - t0
    const led = sim.led1
    const s = sim.stats
    setR({
      current: led.current,
      brightness: led.brightness,
      overCurrent: led.overCurrent,
      anodeVolts: sim.anodeVoltage,
      pin: sim.d13,
      speed: wall > 0 ? 16 / wall : 99,
      solves: s.solves,
      hits: s.cacheHits,
      edges: s.pinEdges,
      simSeconds: s.simMicros / 1e6,
    })
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (running) rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [running, tick])

  function changeResistor(next: number) {
    setOhms(next)
    simRef.current?.setSeriesResistance(next)
  }

  const mA = r.current * 1000

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-8 font-mono">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-white">VLab Simulator — Phase 0 harness</h1>
          <p className="text-sm text-[#8b949e] mt-1">
            Real <code>avr-gcc</code> Blink firmware on avr8js, coupled to the MNA DC solver.
            Unauthenticated dev route.
          </p>
        </header>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 p-4 mb-6 text-red-300">
            {error}
          </div>
        )}

        {!ready && !error && <p className="text-[#8b949e]">Loading firmware…</p>}

        {ready && (
          <>
            <div className="flex gap-3 mb-8">
              <button
                onClick={() => setRunning((v) => !v)}
                data-testid="run-toggle"
                className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                  running
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-green-600 hover:bg-green-500 text-white'
                }`}
              >
                {running ? 'Stop' : 'Start simulation'}
              </button>
              <div className="flex items-center gap-2 text-sm text-[#8b949e]">
                <span
                  className={`w-2 h-2 rounded-full ${running ? 'bg-green-400 animate-pulse' : 'bg-[#30363d]'}`}
                />
                {running ? 'running' : 'idle'}
              </div>
            </div>

            {/* Series resistor — the whole fidelity thesis in one control */}
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

            {/* The LED */}
            <section className="mb-8">
              <div className="flex items-center gap-8 rounded-xl border border-[#30363d] bg-[#161b22] p-8">
                <div className="relative">
                  <div
                    data-testid="led"
                    className="w-20 h-20 rounded-full transition-all duration-75"
                    style={{
                      background: r.overCurrent
                        ? '#f85149'
                        : `rgb(${Math.round(60 + r.brightness * 195)}, ${Math.round(20 + r.brightness * 40)}, ${Math.round(20 + r.brightness * 30)})`,
                      boxShadow: r.overCurrent
                        ? '0 0 60px 20px rgba(248,81,73,0.8)'
                        : `0 0 ${r.brightness * 50}px ${r.brightness * 16}px rgba(255,60,40,${r.brightness * 0.75})`,
                    }}
                  />
                  {r.overCurrent && (
                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-red-400 whitespace-nowrap font-bold">
                      DESTROYED
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm">
                  <Metric label="LED current" value={`${mA.toFixed(2)} mA`} testid="current" />
                  <Metric label="anode voltage" value={`${r.anodeVolts.toFixed(3)} V`} />
                  <Metric label="D13" value={r.pin.replace('output_', '')} testid="pin" />
                  <Metric
                    label="power"
                    value={`${(r.current * r.anodeVolts * 1000).toFixed(1)} mW`}
                  />
                </div>
              </div>
              {r.overCurrent && (
                <p className="mt-8 text-sm text-red-400">
                  {mA.toFixed(0)} mA through a 20 mA part. On real hardware this LED is gone.
                </p>
              )}
            </section>

            {/* Engine telemetry — evidence the architecture behaves as designed */}
            <section>
              <h2 className="text-xs uppercase tracking-wider text-[#8b949e] mb-3">Engine</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Metric
                  label="speed"
                  value={`${r.speed.toFixed(2)}x`}
                  testid="speed"
                  hint="vs real 16 MHz"
                />
                <Metric label="sim time" value={`${r.simSeconds.toFixed(1)} s`} />
                <Metric label="pin edges" value={String(r.edges)} testid="edges" />
                <Metric label="DC solves" value={String(r.solves)} testid="solves" />
                <Metric label="cache hits" value={String(r.hits)} testid="hits" />
              </div>
              <p className="text-xs text-[#8b949e] mt-4 leading-relaxed">
                Solves should stay in single digits no matter how long this runs — the DC solution
                is memoised on pin state, so a blinking pin only ever needs two. That is the
                claim spike P0-2 was written to test.
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
