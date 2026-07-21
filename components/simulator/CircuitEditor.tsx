'use client'

import { useMemo, useReducer, useState } from 'react'
import { CircuitCanvas } from './CircuitCanvas'
import { compile } from '@/lib/simulator/model/compile'
import { getPart } from '@/lib/simulator/model/parts'
import {
  docReducer,
  initialDocState,
  type CircuitDoc,
} from '@/lib/simulator/model/document'
import { EXAMPLES } from '@/lib/simulator/model/examples'

interface Reading {
  partId: string
  label: string
  current: number
  overCurrent: boolean
}

export function CircuitEditor({ initial }: { initial?: CircuitDoc }) {
  const [state, dispatch] = useReducer(
    docReducer,
    initial ? { doc: initial, past: [], future: [] } : initialDocState,
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [d13High, setD13High] = useState(true)

  const doc = state.doc

  /**
   * Recompile and re-solve on every edit. Measured at well under a millisecond
   * for circuits this size, so there is no reason to debounce it — and doing it
   * eagerly is what makes the readouts feel attached to the wiring.
   */
  const { ledBrightness, netOf, problems, unknowns, readings, solveError } = useMemo(() => {
    const res = compile(doc)

    const d13 = res.mcuPorts.get('D13')
    if (d13) d13.set(1 / 25, d13High ? 5 / 25 : 0)

    let solveError: string | null = null
    if (res.circuit.size > 0) {
      const solved = res.circuit.solve()
      if (!solved.ok) solveError = solved.error ?? 'circuit did not solve'
    }

    const brightness = new Map<string, number>()
    const readings: Reading[] = []
    for (const [partId, diode] of res.leds) {
      const i = Math.max(diode.current, 0)
      brightness.set(partId, Math.min(1, Math.pow(i / 0.02, 0.45)))
      readings.push({
        partId,
        label: getPart(doc.parts.find((p) => p.id === partId)!.type).label,
        current: diode.current,
        overCurrent: diode.current > 0.03,
      })
    }

    return {
      ledBrightness: brightness,
      netOf: res.netOf,
      problems: res.problems,
      unknowns: res.unknowns,
      readings,
      solveError,
    }
  }, [doc, d13High])

  const selectedPart = doc.parts.find((p) => p.id === selected) ?? null
  const selectedDef = selectedPart ? getPart(selectedPart.type) : null

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

      {/* Inspector */}
      <aside className="w-80 shrink-0 border-l border-[#30363d] bg-[#0d1117] overflow-y-auto font-mono text-sm">
        <div className="px-4 py-3 border-b border-[#30363d]">
          <h2 className="text-white font-semibold text-sm">Circuit</h2>
          <p className="text-[10px] text-[#6e7681] mt-0.5">
            {doc.parts.length} parts · {doc.wires.length} wires · {unknowns} unknowns
          </p>
        </div>

        {/* Controls */}
        <div className="px-4 py-4 border-b border-[#30363d] space-y-2">
          <button
            onClick={() => setD13High((v) => !v)}
            data-testid="toggle-d13"
            className={`w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              d13High ? 'bg-green-600 text-white' : 'bg-[#21262d] text-[#8b949e]'
            }`}
          >
            D13 = {d13High ? 'HIGH' : 'LOW'}
          </button>
          <div className="flex gap-2">
            {Object.entries(EXAMPLES).map(([key, ex]) => (
              <button
                key={key}
                data-testid={`load-${key}`}
                onClick={() => dispatch({ type: 'load', doc: ex.doc })}
                title={ex.label}
                className="flex-1 px-2 py-2 rounded-lg text-[10px] border border-[#30363d] hover:border-[#58a6ff] text-[#8b949e] transition-colors"
              >
                {key === 'exp01' ? 'Load Exp 01' : 'Blank'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => dispatch({ type: 'undo' })}
              disabled={state.past.length === 0}
              data-testid="undo"
              className="flex-1 px-3 py-2 rounded-lg text-xs border border-[#30363d] hover:border-[#8b949e] disabled:opacity-30 transition-colors"
            >
              Undo
            </button>
            <button
              onClick={() => dispatch({ type: 'redo' })}
              disabled={state.future.length === 0}
              data-testid="redo"
              className="flex-1 px-3 py-2 rounded-lg text-xs border border-[#30363d] hover:border-[#8b949e] disabled:opacity-30 transition-colors"
            >
              Redo
            </button>
          </div>
        </div>

        {/* Selected part */}
        {selectedPart && selectedDef && (
          <div className="px-4 py-4 border-b border-[#30363d]">
            <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">Selected</div>
            <div className="text-white mb-3">{selectedDef.label}</div>

            {selectedDef.props?.map((prop) => (
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
                      {o === 0 ? 'none (wire)' : o >= 1000 ? `${o / 1000} k${prop.unit}` : `${o} ${prop.unit}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}

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

        {/* Measurements */}
        <div className="px-4 py-4 border-b border-[#30363d]">
          <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">
            Measurements
          </div>
          {readings.length === 0 ? (
            <p className="text-xs text-[#6e7681]">No components to measure yet.</p>
          ) : (
            readings.map((r) => (
              <div key={r.partId} className="mb-2" data-testid={`reading-${r.partId}`}>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-[#8b949e]">{r.label}</span>
                  <span
                    className={`tabular-nums ${r.overCurrent ? 'text-red-400 font-bold' : 'text-white'}`}
                  >
                    {(r.current * 1000).toFixed(2)} mA
                  </span>
                </div>
                {r.overCurrent && (
                  <p className="text-[10px] text-red-400 mt-0.5">
                    Over its ~20 mA rating — on real hardware this part is destroyed.
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Problems */}
        <div className="px-4 py-4">
          <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">Checks</div>
          {solveError && (
            <p className="text-xs text-red-400 mb-2">Solver: {solveError}</p>
          )}
          {problems.length === 0 && !solveError ? (
            <p className="text-xs text-green-400">No problems detected.</p>
          ) : (
            <ul className="space-y-1.5">
              {problems.map((p, i) => (
                <li key={i} className="text-xs text-amber-400 leading-snug">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 pb-6 text-[10px] text-[#6e7681] leading-relaxed">
          Drag from any pin to another to wire them. Click a wire to delete it. Components plug
          into the breadboard; its internal strips do the connecting, exactly like the real thing.
        </div>
      </aside>
    </div>
  )
}
