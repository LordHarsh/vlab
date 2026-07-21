'use client'

import { useMemo, useReducer, useState } from 'react'
import { CircuitCanvas } from './CircuitCanvas'
import { compile } from '@/lib/simulator/model/compile'
import { getPart } from '@/lib/simulator/model/parts'
import { useSimulator } from '@/lib/simulator/worker/useSimulator'
import { docReducer, type CircuitDoc } from '@/lib/simulator/model/document'
import { EXAMPLES, EXPERIMENT_01 } from '@/lib/simulator/model/examples'

const FIRMWARE = [
  { url: '/sim/blink.hex', label: 'Blink', note: 'D13 on/off, 1 s' },
  { url: '/sim/dht11.hex', label: 'DHT11', note: 'Experiment 01 sketch' },
  { url: '/sim/pot.hex', label: 'Pot', note: 'analogRead(A0) → PWM on D9' },
]

export function CircuitEditor({ initial }: { initial?: CircuitDoc }) {
  const [state, dispatch] = useReducer(docReducer, {
    doc: initial ?? EXPERIMENT_01,
    past: [],
    future: [],
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [hexUrl, setHexUrl] = useState(FIRMWARE[0].url)

  const doc = state.doc
  const { ready, running, error, snapshot, speedRatio, start, stop, reset } = useSimulator(
    hexUrl,
    doc,
  )

  /**
   * Nets are recomputed on the main thread purely for the canvas (pin hover
   * highlighting). The authoritative electrical solve happens in the worker.
   */
  const netOf = useMemo(() => compile(doc).netOf, [doc])

  const ledBrightness = useMemo(
    () => new Map(Object.entries(snapshot.ledBrightness)),
    [snapshot.ledBrightness],
  )

  const selectedPart = doc.parts.find((p) => p.id === selected) ?? null
  const selectedDef = selectedPart ? getPart(selectedPart.type) : null

  const readings = Object.entries(snapshot.currents)
  const highPins = Object.entries(snapshot.pins).filter(([, d]) => d === 'high')

  return (
    <div className="flex h-screen bg-[#0d1117] text-[#e6edf3]">
      <div className="flex-1 relative">
        <CircuitCanvas
          doc={doc}
          dispatch={dispatch}
          ledBrightness={ledBrightness}
          netOf={netOf}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      <aside className="w-80 shrink-0 border-l border-[#30363d] bg-[#0d1117] overflow-y-auto font-mono text-sm">
        <div className="px-4 py-3 border-b border-[#30363d]">
          <h2 className="text-white font-semibold text-sm">Circuit</h2>
          <p className="text-[10px] text-[#6e7681] mt-0.5">
            {doc.parts.length} parts · {doc.wires.length} wires · {snapshot.unknowns} unknowns
          </p>
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-950/40 text-red-300 text-xs" data-testid="error">
            {error}
          </div>
        )}

        {/* Firmware + run controls */}
        <div className="px-4 py-4 border-b border-[#30363d] space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-[#8b949e]">Firmware</div>
          <div className="flex gap-2">
            {FIRMWARE.map((f) => (
              <button
                key={f.url}
                data-testid={`fw-${f.label}`}
                onClick={() => setHexUrl(f.url)}
                title={f.note}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] border transition-colors ${
                  hexUrl === f.url
                    ? 'border-[#58a6ff] bg-[#58a6ff]/10 text-[#58a6ff]'
                    : 'border-[#30363d] text-[#8b949e] hover:border-[#8b949e]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            onClick={running ? stop : start}
            disabled={!ready}
            data-testid="run-toggle"
            className={`w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
              running ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
            }`}
          >
            {ready ? (running ? 'Stop' : 'Run firmware') : 'Loading firmware…'}
          </button>

          <div className="flex gap-2">
            <button
              onClick={reset}
              data-testid="reset"
              className="flex-1 px-2 py-1.5 rounded-lg text-[10px] border border-[#30363d] hover:border-[#8b949e] text-[#8b949e]"
            >
              Reset MCU
            </button>
            {Object.entries(EXAMPLES).map(([key, ex]) => (
              <button
                key={key}
                data-testid={`load-${key}`}
                onClick={() => dispatch({ type: 'load', doc: ex.doc })}
                title={ex.label}
                className="flex-1 px-2 py-1.5 rounded-lg text-[10px] border border-[#30363d] hover:border-[#58a6ff] text-[#8b949e]"
              >
                {key === 'exp01' ? 'Exp 01' : key === 'pot' ? 'Pot' : 'Blank'}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => dispatch({ type: 'undo' })}
              disabled={state.past.length === 0}
              data-testid="undo"
              className="flex-1 px-3 py-1.5 rounded-lg text-[10px] border border-[#30363d] hover:border-[#8b949e] disabled:opacity-30"
            >
              Undo
            </button>
            <button
              onClick={() => dispatch({ type: 'redo' })}
              disabled={state.future.length === 0}
              data-testid="redo"
              className="flex-1 px-3 py-1.5 rounded-lg text-[10px] border border-[#30363d] hover:border-[#8b949e] disabled:opacity-30"
            >
              Redo
            </button>
          </div>

          <div className="flex justify-between text-[10px] text-[#6e7681] pt-1">
            <span data-testid="speed">{speedRatio.toFixed(2)}× real time</span>
            <span data-testid="simtime">{snapshot.simSeconds.toFixed(1)} s</span>
            <span>
              {snapshot.solves} solves / {snapshot.cacheHits} hits
            </span>
          </div>
        </div>

        {/* Selected part */}
        {selectedPart && selectedDef && (
          <div className="px-4 py-4 border-b border-[#30363d]">
            <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">Selected</div>
            <div className="text-white mb-3">{selectedDef.label}</div>

            {selectedDef.props?.map((prop) =>
              prop.type === 'range' ? (
                <div key={prop.key} className="mb-3">
                  <label className="flex justify-between text-[10px] text-[#8b949e] mb-1">
                    <span>{prop.label}</span>
                    <span className="text-white tabular-nums">
                      {Number(selectedPart.props[prop.key] ?? prop.default ?? 0)}
                      {prop.unit ?? ''}
                    </span>
                  </label>
                  <input
                    type="range"
                    data-testid={`prop-${prop.key}`}
                    min={prop.min}
                    max={prop.max}
                    step={prop.step}
                    value={Number(selectedPart.props[prop.key] ?? prop.default ?? 0)}
                    onChange={(e) =>
                      dispatch({
                        type: 'setProp',
                        id: selectedPart.id,
                        key: prop.key,
                        value: Number(e.target.value),
                      })
                    }
                    className="w-full accent-[#58a6ff]"
                  />
                </div>
              ) : (
              <div key={prop.key} className="mb-3">
                <label className="block text-[10px] text-[#8b949e] mb-1">{prop.label}</label>
                <select
                  data-testid={`prop-${prop.key}`}
                  value={String(selectedPart.props[prop.key] ?? '')}
                  onChange={(e) =>
                    dispatch({
                      type: 'setProp',
                      id: selectedPart.id,
                      key: prop.key,
                      value: Number(e.target.value),
                    })
                  }
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  {prop.options?.map((o) => (
                    <option key={o} value={o}>
                      {o === 0
                        ? 'none (wire)'
                        : o >= 1000
                          ? `${o / 1000} k${prop.unit}`
                          : `${o} ${prop.unit}`}
                    </option>
                  ))}
                </select>
              </div>
              ),
            )}

            <div className="flex gap-2">
              <button
                onClick={() => dispatch({ type: 'rotatePart', id: selectedPart.id })}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs border border-[#30363d] hover:border-[#8b949e]"
              >
                Rotate
              </button>
              <button
                onClick={() => {
                  dispatch({ type: 'removePart', id: selectedPart.id })
                  setSelected(null)
                }}
                data-testid="delete-part"
                className="flex-1 px-2 py-1.5 rounded-lg text-xs border border-red-900 text-red-400 hover:border-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {/* Live pins */}
        <div className="px-4 py-4 border-b border-[#30363d]">
          <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">
            Pins driven high
          </div>
          {highPins.length === 0 ? (
            <p className="text-xs text-[#6e7681]">none</p>
          ) : (
            <div className="flex flex-wrap gap-1" data-testid="high-pins">
              {highPins.map(([name]) => (
                <span
                  key={name}
                  className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 text-[10px]"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Analog inputs */}
        {Object.keys(snapshot.adc).length > 0 && (
          <div className="px-4 py-4 border-b border-[#30363d]">
            <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">
              analogRead
            </div>
            <div className="grid grid-cols-3 gap-1.5" data-testid="adc">
              {Object.entries(snapshot.adc).map(([name, counts]) => (
                <div key={name} className="text-[10px]">
                  <span className="text-[#8b949e]">{name}</span>{' '}
                  <span className="text-white tabular-nums">{counts}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Measurements */}
        <div className="px-4 py-4 border-b border-[#30363d]">
          <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">
            Measurements
          </div>
          {readings.length === 0 ? (
            <p className="text-xs text-[#6e7681]">No components to measure yet.</p>
          ) : (
            readings.map(([partId, current]) => (
              <div key={partId} className="flex justify-between items-baseline mb-1">
                <span className="text-xs text-[#8b949e]">{partId}</span>
                <span className="text-white tabular-nums" data-testid={`reading-${partId}`}>
                  {(current * 1000).toFixed(2)} mA
                </span>
              </div>
            ))
          )}
        </div>

        {/* Serial monitor */}
        <div className="px-4 py-4 border-b border-[#30363d]">
          <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">Serial</div>
          <pre
            data-testid="serial"
            className="text-[10px] text-green-300 bg-[#010409] rounded-lg p-2 h-28 overflow-y-auto whitespace-pre-wrap break-all"
          >
            {snapshot.serial || '(no output)'}
          </pre>
        </div>

        {/* Checks */}
        <div className="px-4 py-4">
          <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">Checks</div>
          {snapshot.solveError && (
            <p className="text-xs text-red-400 mb-2">Solver: {snapshot.solveError}</p>
          )}
          {snapshot.faults.length > 0 && (
            <ul className="space-y-2 mb-3" data-testid="faults">
              {snapshot.faults.map((f, i) => (
                <li
                  key={i}
                  className="text-xs text-red-300 leading-snug rounded-lg border border-red-900 bg-red-950/40 px-2.5 py-2"
                >
                  <span className="font-bold uppercase text-[9px] tracking-wider text-red-400 block mb-0.5">
                    {f.kind.replace('_', ' ')}
                  </span>
                  {f.message}
                </li>
              ))}
            </ul>
          )}
          {snapshot.problems.length === 0 &&
          !snapshot.solveError &&
          snapshot.faults.length === 0 ? (
            <p className="text-xs text-green-400">No problems detected.</p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.problems.map((p, i) => (
                <li key={i} className="text-xs text-amber-400 leading-snug">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 pb-6 text-[10px] text-[#6e7681] leading-relaxed">
          Drag from any pin to another to wire them. Click a wire to delete it. The firmware keeps
          running while you rewire — the MCU is not reset.
        </div>
      </aside>
    </div>
  )
}
