'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CircuitCanvas } from './CircuitCanvas'
import { compile } from '@/lib/simulator/model/compile'
import { PALETTE, PART_LIBRARY, getPart, type PartDefinition } from '@/lib/simulator/model/parts'
import { useSimulator } from '@/lib/simulator/worker/useSimulator'
import {
  adoptIds,
  docReducer,
  newId,
  partBounds,
  snap,
  type CircuitDoc,
  type DocAction,
} from '@/lib/simulator/model/document'
import { useAutosave, type RemoteTarget } from '@/lib/simulator/useAutosave'
import { EXAMPLES, EXPERIMENT_01 } from '@/lib/simulator/model/examples'

const FIRMWARE = [
  { url: '/sim/blink.hex', label: 'Blink', note: 'D13 on/off, 1 s' },
  { url: '/sim/dht11.hex', label: 'DHT11', note: 'Experiment 01 sketch' },
  { url: '/sim/pot.hex', label: 'Pot', note: 'analogRead(A0) → PWM on D9' },
]

/** Shared chrome for the toolbar strip and the rail's secondary buttons. */
const BTN =
  'h-8 shrink-0 px-2.5 rounded-[3px] text-xs border border-[#dfe3e8] bg-white text-[#34495e] ' +
  'transition-colors hover:border-[#1477d1] disabled:opacity-40 disabled:hover:border-[#dfe3e8]'

const SECTION_LABEL = 'text-[10px] uppercase tracking-wider text-[#6b7c8d]'

/**
 * Where a newly picked part lands.
 *
 * The old rule stepped by the part count, which stacked new parts on top of
 * whatever was already there (a buzzer landed inside the ATmega328). This scans
 * a coarse grid row-major from the top-left of the default view and takes the
 * first slot whose bounding box — plus a little breathing room — touches
 * nothing, so the part appears in empty space the student can already see.
 */
function freeSpot(doc: CircuitDoc, def: PartDefinition): { x: number; y: number } {
  const GAP = 20
  const boxes = doc.parts.map((p) => ({ x: p.x, y: p.y, ...partBounds(p) }))
  const clear = (x: number, y: number) =>
    !boxes.some(
      (b) =>
        x - GAP < b.x + b.w &&
        x + def.width + GAP > b.x &&
        y - GAP < b.y + b.h &&
        y + def.height + GAP > b.y,
    )

  for (let y = 20; y <= 1400; y += 20) {
    for (let x = 20; x <= 1800; x += 20) {
      if (clear(x, y)) return { x: snap(x), y: snap(y) }
    }
  }
  return { x: snap(20), y: snap(1420) }
}

/**
 * Parts palette — picture cards, not a word list.
 *
 * Every part definition already carries its own artwork, so the tile draws the
 * real thing scaled into a fixed box. A student who has never seen a
 * photoresistor cannot pick one out of a list of labels.
 */
function PartsPalette({
  doc,
  dispatch,
  onSelect,
}: {
  doc: CircuitDoc
  dispatch: (a: DocAction) => void
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return PALETTE
    return PALETTE.filter((type) => PART_LIBRARY[type].label.toLowerCase().includes(q))
  }, [query])

  function add(type: string) {
    const def = PART_LIBRARY[type]
    const id = newId(type.slice(0, 3) + '_')
    const { x, y } = freeSpot(doc, def)
    dispatch({
      type: 'addPart',
      part: {
        id,
        type,
        x,
        y,
        rotation: 0,
        props: def.electrical.kind === 'resistor' ? { ohms: def.electrical.defaultOhms } : {},
      },
    })
    onSelect(id)
  }

  return (
    <div className="px-4 py-4 border-b border-[#dfe3e8]">
      <div className={`${SECTION_LABEL} mb-2`}>Components</div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search parts"
        aria-label="Search parts"
        data-testid="palette-search"
        className="w-full h-[37px] mb-3 px-2.5 rounded-none bg-white border-[0.8px] border-[#dfe3e8] text-[15px] text-[#34495e] placeholder:text-[#6b7c8d] outline-none focus:border-[#1477d1]"
      />

      {shown.length === 0 ? (
        <p className="text-xs text-[#6b7c8d]" data-testid="palette-empty">
          No parts match that search.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 w-[241px] mx-auto" data-testid="palette-grid">
          {shown.map((type) => {
            const def = PART_LIBRARY[type]
            return (
              <button
                key={type}
                type="button"
                data-testid={`palette-${type}`}
                title={def.label}
                onClick={() => add(type)}
                className="h-[99px] w-[75px] flex flex-col items-center justify-center gap-1.5 px-1.5 rounded-[5px] bg-[#f1f1f3] border-[1.6px] border-transparent transition-colors hover:border-[#1477d1] focus:outline-none focus-visible:border-[#1477d1]"
              >
                {/* The part's own artwork, letterboxed into a fixed box so a
                    325-unit breadboard and a 30-unit LED read at one scale. */}
                <svg
                  width={64}
                  height={56}
                  viewBox={`0 0 ${def.width} ${def.height}`}
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                  className="pointer-events-none overflow-visible"
                  dangerouslySetInnerHTML={{ __html: def.svg }}
                />
                <span className="w-full truncate text-center text-[10.7px] font-normal leading-none text-[#34495e]">
                  {def.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function CircuitEditor({
  initial,
  remote,
}: {
  initial?: CircuitDoc
  /** Omitted in the dev harness, where there is no class or simulation. */
  remote?: RemoteTarget
}) {
  // The lazy initialiser (rather than a plain initial value) so the starting
  // document's ids are claimed too — it never passes through the 'load' action.
  const [state, dispatch] = useReducer(docReducer, initial ?? EXPERIMENT_01, (doc) => {
    adoptIds(doc)
    return { doc, past: [], future: [] }
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [hexUrl, setHexUrl] = useState(FIRMWARE[0].url)

  const doc = state.doc

  // Local-first autosave. Restores previous work before the student notices
  // they lost anything.
  const { state: saveState, restored, restoreChecked } = useAutosave(doc, remote)
  const appliedRestore = useRef(false)
  useEffect(() => {
    if (!restoreChecked || appliedRestore.current) return
    appliedRestore.current = true
    if (restored && (restored.parts?.length ?? 0) > 0) {
      dispatch({ type: 'load', doc: restored })
    }
  }, [restoreChecked, restored])

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
    <div className="flex flex-col h-[100dvh] bg-[#f4f5f6] text-[#34495e]">
      {/* Top bar */}
      <header className="h-12 shrink-0 flex items-center justify-between gap-3 px-4 bg-white border-b border-[#dfe3e8]">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-sm font-semibold text-[#34495e] shrink-0">Circuit editor</h1>
          <p className="text-[11px] text-[#6b7c8d] truncate">
            {doc.parts.length} parts · {doc.wires.length} wires · {snapshot.unknowns} unknowns
          </p>
        </div>
        <span
          data-testid="save-state"
          className={`text-[11px] shrink-0 ${
            saveState === 'offline'
              ? 'text-amber-600'
              : saveState === 'saved'
                ? 'text-green-700'
                : 'text-[#6b7c8d]'
          }`}
        >
          {saveState === 'saving'
            ? 'saving…'
            : saveState === 'saved'
              ? 'saved'
              : saveState === 'offline'
                ? 'saved locally (offline)'
                : saveState === 'local'
                  ? 'saved locally'
                  : 'no changes'}
        </span>
      </header>

      {/* Toolbar strip. Below md it wraps onto as many rows as it needs so every
          control — the Start/Stop button above all — stays on-screen and
          tappable at 390px. From md up it is the original single fixed-height
          row (content fits, so the overflow only ever acts as a safety net). */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 bg-[#f4f5f6] border-b border-[#dfe3e8] md:h-12 md:py-0 md:flex-nowrap md:overflow-x-auto md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => dispatch({ type: 'undo' })}
          disabled={state.past.length === 0}
          data-testid="undo"
          className={BTN}
        >
          Undo
        </button>
        <button
          onClick={() => dispatch({ type: 'redo' })}
          disabled={state.future.length === 0}
          data-testid="redo"
          className={BTN}
        >
          Redo
        </button>

        <div className="hidden md:block w-px h-6 shrink-0 bg-[#dfe3e8]" />

        <span className="text-[11px] text-[#6b7c8d] shrink-0">Firmware</span>
        <div className="flex shrink-0">
          {FIRMWARE.map((f, i) => (
            <button
              key={f.url}
              data-testid={`fw-${f.label}`}
              onClick={() => setHexUrl(f.url)}
              title={f.note}
              className={`h-8 px-2.5 text-xs border transition-colors ${
                i === 0 ? 'rounded-l-[3px]' : '-ml-px'
              } ${i === FIRMWARE.length - 1 ? 'rounded-r-[3px]' : ''} ${
                hexUrl === f.url
                  ? 'z-10 border-[#1477d1] bg-[#1477d1]/10 text-[#1477d1]'
                  : 'border-[#dfe3e8] bg-white text-[#6b7c8d] hover:border-[#1477d1]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="hidden md:block w-px h-6 shrink-0 bg-[#dfe3e8]" />

        <button
          onClick={running ? stop : start}
          disabled={!ready}
          data-testid="run-toggle"
          className={`h-8 shrink-0 px-4 rounded-[3px] text-xs font-semibold text-white transition-colors disabled:opacity-40 ${
            running ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {ready ? (running ? 'Stop' : 'Start Simulation') : 'Loading firmware…'}
        </button>
        <button onClick={reset} data-testid="reset" className={BTN}>
          Reset MCU
        </button>

        <div className="flex items-center gap-3 text-[11px] text-[#6b7c8d] shrink-0 md:ml-auto md:pl-3">
          <span data-testid="speed">{speedRatio.toFixed(2)}× real time</span>
          <span data-testid="simtime">{snapshot.simSeconds.toFixed(1)} s</span>
          <span className="hidden lg:inline">
            {snapshot.solves} solves / {snapshot.cacheHits} hits
          </span>
        </div>
      </div>

      {/* Canvas + rail. Stacked on phones, side by side from md up — a
          side-by-side rail at 390px left the canvas 70px wide. */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <div className="flex-1 relative min-w-0 min-h-0">
          <CircuitCanvas
            doc={doc}
            dispatch={dispatch}
            ledBrightness={ledBrightness}
            netOf={netOf}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        <aside className="w-full h-[45dvh] shrink-0 border-t border-[#dfe3e8] md:h-auto md:w-80 md:border-t-0 md:border-l bg-white overflow-y-auto text-sm">
          {error && (
            <div className="px-4 py-3 bg-red-50 text-red-700 text-xs" data-testid="error">
              {error}
            </div>
          )}

          {/* Selected part */}
          {selectedPart && selectedDef && (
            <div className="px-4 py-4 border-b border-[#dfe3e8]">
              <div className={`${SECTION_LABEL} mb-2`}>Selected</div>
              <div className="text-[#34495e] font-semibold mb-3">{selectedDef.label}</div>

              {selectedDef.props?.map((prop) =>
                prop.type === 'range' ? (
                  <div key={prop.key} className="mb-3">
                    <label className="flex justify-between text-[10px] text-[#6b7c8d] mb-1">
                      <span>{prop.label}</span>
                      <span className="text-[#34495e] tabular-nums">
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
                      className="w-full accent-[#1477d1]"
                    />
                  </div>
                ) : (
                  <div key={prop.key} className="mb-3">
                    <label className="block text-[10px] text-[#6b7c8d] mb-1">{prop.label}</label>
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
                      className="w-full h-[37px] bg-white border-[0.8px] border-[#dfe3e8] rounded-none px-2 text-xs text-[#34495e] outline-none focus:border-[#1477d1]"
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
                  className={`${BTN} flex-1`}
                >
                  Rotate
                </button>
                <button
                  onClick={() => {
                    dispatch({ type: 'removePart', id: selectedPart.id })
                    setSelected(null)
                  }}
                  data-testid="delete-part"
                  className="h-8 flex-1 px-2.5 rounded-[3px] text-xs border border-red-200 bg-white text-red-600 transition-colors hover:border-red-500"
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          <PartsPalette doc={doc} dispatch={dispatch} onSelect={setSelected} />

          {/* Starter circuits */}
          <div className="px-4 py-4 border-b border-[#dfe3e8]">
            <div className={`${SECTION_LABEL} mb-2`}>Starter circuits</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(EXAMPLES).map(([key, ex]) => (
                <button
                  key={key}
                  data-testid={`load-${key}`}
                  onClick={() => dispatch({ type: 'loadInto', doc: ex.doc })}
                  title={ex.label}
                  className={BTN}
                >
                  {key === 'exp01'
                    ? 'LED'
                    : key === 'dht'
                      ? 'Exp 01'
                      : key === 'pot'
                        ? 'Pot'
                        : 'Blank'}
                </button>
              ))}
            </div>
          </div>

          {/* Live pins */}
          <div className="px-4 py-4 border-b border-[#dfe3e8]">
            <div className={`${SECTION_LABEL} mb-2`}>Pins driven high</div>
            {highPins.length === 0 ? (
              <p className="text-xs text-[#6b7c8d]">none</p>
            ) : (
              <div className="flex flex-wrap gap-1" data-testid="high-pins">
                {highPins.map(([name]) => (
                  <span
                    key={name}
                    className="px-1.5 py-0.5 rounded bg-green-100 text-green-800 text-[10px]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Analog inputs */}
          {Object.keys(snapshot.adc).length > 0 && (
            <div className="px-4 py-4 border-b border-[#dfe3e8]">
              <div className={`${SECTION_LABEL} mb-2`}>analogRead</div>
              <div className="grid grid-cols-3 gap-1.5" data-testid="adc">
                {Object.entries(snapshot.adc).map(([name, counts]) => (
                  <div key={name} className="text-[10px]">
                    <span className="text-[#6b7c8d]">{name}</span>{' '}
                    <span className="text-[#34495e] tabular-nums">{counts}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Measurements */}
          <div className="px-4 py-4 border-b border-[#dfe3e8]">
            <div className={`${SECTION_LABEL} mb-2`}>Measurements</div>
            {readings.length === 0 ? (
              <p className="text-xs text-[#6b7c8d]">No components to measure yet.</p>
            ) : (
              readings.map(([partId, current]) => (
                <div key={partId} className="flex justify-between items-baseline mb-1">
                  <span className="text-xs text-[#6b7c8d]">{partId}</span>
                  <span className="text-[#34495e] tabular-nums" data-testid={`reading-${partId}`}>
                    {(current * 1000).toFixed(2)} mA
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Serial monitor */}
          <div className="px-4 py-4 border-b border-[#dfe3e8]">
            <div className={`${SECTION_LABEL} mb-2`}>Serial</div>
            <pre
              data-testid="serial"
              className="text-[10px] font-mono text-[#34495e] bg-[#f1f1f3] border border-[#dfe3e8] p-2 h-28 overflow-y-auto whitespace-pre-wrap break-all"
            >
              {snapshot.serial || '(no output)'}
            </pre>
          </div>

          {/* Checks */}
          <div className="px-4 py-4">
            <div className={`${SECTION_LABEL} mb-2`}>Checks</div>
            {snapshot.solveError && (
              <p className="text-xs text-red-600 mb-2">Solver: {snapshot.solveError}</p>
            )}
            {snapshot.limitations.length > 0 && (
              <ul className="space-y-2 mb-3" data-testid="limitations">
                {snapshot.limitations.map((l, i) => (
                  <li
                    key={i}
                    className="text-xs text-amber-900 leading-snug border border-amber-200 bg-amber-50 px-2.5 py-2"
                  >
                    <span className="font-bold uppercase text-[9px] tracking-wider text-amber-700 block mb-0.5">
                      not simulated
                    </span>
                    {l}
                  </li>
                ))}
              </ul>
            )}
            {snapshot.faults.length > 0 && (
              <ul className="space-y-2 mb-3" data-testid="faults">
                {snapshot.faults.map((f, i) => (
                  <li
                    key={i}
                    className="text-xs text-red-800 leading-snug border border-red-200 bg-red-50 px-2.5 py-2"
                  >
                    <span className="font-bold uppercase text-[9px] tracking-wider text-red-600 block mb-0.5">
                      {f.kind.replace('_', ' ')}
                    </span>
                    {f.message}
                  </li>
                ))}
              </ul>
            )}
            {snapshot.problems.length === 0 &&
            !snapshot.solveError &&
            snapshot.faults.length === 0 &&
            snapshot.limitations.length === 0 ? (
              <p className="text-xs text-green-700">No problems detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {snapshot.problems.map((p, i) => (
                  <li key={i} className="text-xs text-amber-700 leading-snug">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-4 pb-6 text-[10px] text-[#6b7c8d] leading-relaxed">
            Drag from any pin to another to wire them. Click a wire to delete it. The firmware keeps
            running while you rewire — the MCU is not reset.
          </div>
        </aside>
      </div>
    </div>
  )
}
