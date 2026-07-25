'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Blocks, Code2, Loader2, Minimize2, X } from 'lucide-react'
import { CircuitCanvas } from './CircuitCanvas'
import {
  CODE_OPEN_KEY,
  CodePanel,
  CodePanelResizer,
  RAIL_OPEN_KEY,
  useCodeWidth,
  useIsNarrow,
  usePanelOpen,
} from './CodePanel'
import { useFullscreenGate } from './FullscreenGate'
import { detectBoard } from '@/lib/simulator/model/boards'
import {
  EMPTY_CODE,
  fileNameFor,
  readCodeFile,
  writeCodeFile,
  type CodeLanguage,
} from '@/lib/simulator/model/code'
import { useSketchCompile } from './useSketchCompile'
import { compile } from '@/lib/simulator/model/compile'
import {
  FARAD_UNITS,
  HENRY_UNITS,
  OHM_UNITS,
  PALETTE,
  PART_LIBRARY,
  formatValueUnit,
  getPart,
  parseValueUnit,
  splitValueUnit,
  type BoardType,
  type PartDefinition,
  type PropSpec,
} from '@/lib/simulator/model/parts'
import type { DeviceState } from '@/lib/simulator/behavioural'
import { useBoardSimulator } from '@/lib/simulator/worker/useBoardSimulator'
import type { SolveFault } from '@/lib/simulator/types'
import { PICO_EXPERIMENTS } from '@/lib/simulator/pico/experiments'
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
import { BLANK, EXAMPLES, EXPERIMENT_01 } from '@/lib/simulator/model/examples'

/**
 * The prebuilt sketches, tagged with the board each was compiled FOR.
 *
 * The tag is load-bearing, not decoration. An ATmega328P image handed to a
 * Mega does not error — it runs, and moves whichever pads the 328P's register
 * addresses happen to name on an ATmega2560, which is silent nonsense. So the
 * selector below only ever offers a board its own firmware, and a board with
 * none gets an honest refusal instead of somebody else's binary.
 *
 * All three are rebuilt byte-identically by scripts/build-avr-hex.mjs; none is
 * an unreproducible blob any more.
 */
const FIRMWARE: ReadonlyArray<{
  url: string
  label: string
  note: string
  board: BoardType
}> = [
  { url: '/sim/blink.hex', label: 'Blink', note: 'D13 on/off, 1 s', board: 'arduino_uno' },
  { url: '/sim/dht11.hex', label: 'DHT11', note: 'Experiment 01 sketch', board: 'arduino_uno' },
  {
    url: '/sim/pot.hex',
    label: 'Pot',
    note: 'analogRead(A0) → PWM on D9',
    board: 'arduino_uno',
  },
  {
    url: '/sim/traffic-mega.hex',
    label: 'Traffic',
    note: 'Experiment 11 sketch — 12 lamps on pins 22–33, 4 pots on A0–A3',
    board: 'arduino_mega',
  },
]

/**
 * The fields BOTH tracks report, so every panel below can read one object.
 *
 * Not a merge of the two snapshot types and deliberately not one: the two
 * genuinely differ (an Uno has no REPL phase; a Pico's ADC is 12-bit on GP26–28
 * and its pins can be 'pulldown', which no AVR pin can be), and flattening them
 * would make half the fields optional and every reader a guess. The track-only
 * fields are read after `sim.track` has narrowed the union, which is the point
 * of the union.
 */
type SharedSnapshot = {
  ledBrightness: Record<string, number>
  currents: Record<string, number>
  adc: Record<string, number>
  faults: SolveFault[]
  problems: string[]
  serial: string
  pins: Record<string, string>
  simSeconds: number
  solves: number
  cacheHits: number
  pinEdges: number
  unknowns: number
  solveError: string | null
  limitations: string[]
  deviceStates: Record<string, DeviceState>
}

/** What the panels show when there is no board to run, so nothing has reported. */
const NO_SNAPSHOT: SharedSnapshot = {
  ledBrightness: {},
  currents: {},
  adc: {},
  faults: [],
  problems: [],
  serial: '',
  pins: {},
  simSeconds: 0,
  solves: 0,
  cacheHits: 0,
  pinEdges: 0,
  unknowns: 0,
  solveError: null,
  limitations: [],
  deviceStates: {},
}

/** Shared chrome for the toolbar strip and the rail's secondary buttons. */
const BTN =
  'h-8 shrink-0 px-2.5 rounded-[3px] text-xs border border-[#dfe3e8] bg-white text-[#34495e] ' +
  'transition-colors hover:border-[#1477d1] disabled:opacity-40 disabled:hover:border-[#dfe3e8]'

const SECTION_LABEL = 'text-[10px] uppercase tracking-wider text-[#566573]'

/**
 * One of the two toolbar switches that open and close a docked panel.
 *
 * ONE COMPONENT FOR BOTH, because the code toggle used to be written out twice
 * — once in the AVR branch, once in the Pico branch — with the same
 * `data-testid` and the same eleven classes copied between them. Only ever one
 * rendered, so nothing was visibly wrong; but the AVR copy sat inside
 * `!noFirmwareFor`, which meant a board with no PREBUILT .hex was refused the
 * editor it could perfectly well compile its own sketch into. Whether a fixture
 * image exists has nothing to do with whether there is a program to write.
 *
 * `aria-pressed`, not `aria-expanded`: this is a control that stays on screen
 * with a sticky on/off state, and the region it governs is a sibling layout
 * column rather than something it contains. `aria-controls` still names the
 * region so the relationship is announced.
 */
function PanelToggle({
  testId,
  label,
  controls,
  open,
  onToggle,
  buttonRef,
  children,
}: {
  testId: string
  label: string
  controls: string
  open: boolean
  onToggle: () => void
  buttonRef?: React.Ref<HTMLButtonElement>
  children: ReactNode
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid={testId}
      onClick={onToggle}
      aria-pressed={open}
      aria-controls={controls}
      title={`${open ? 'Hide' : 'Show'} the ${label.toLowerCase()} panel`}
      className={`h-8 shrink-0 inline-flex items-center gap-1.5 px-2.5 rounded-[3px] text-xs border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] focus-visible:ring-offset-1 ${
        open
          ? 'border-[#1477d1] bg-[#1477d1]/10 text-[#1477d1]'
          : 'border-[#dfe3e8] bg-white text-[#34495e] hover:border-[#1477d1]'
      }`}
    >
      {children}
      {label}
    </button>
  )
}

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

    /**
     * A new part carries every default its definition declares.
     *
     * It used to carry only the resistor's ohms, and everything else relied on
     * each model's own fallback for a missing prop. Those agreed for most parts
     * and did NOT for the flow sensor: the part declares 10 L/min, the model
     * falls back to 0, so the inspector read "10 L/min" over a sensor that was
     * reporting no flow at all. Writing the declared value into the document is
     * how the authored starters are built, and it leaves nothing to disagree
     * about.
     *
     * The resistor keeps its own line because its options list starts at 0 Ω —
     * "none (wire)" — which is a legitimate choice but a terrible default.
     */
    const props: Record<string, number | string> = {}
    for (const p of def.props ?? []) if (p.default !== undefined) props[p.key] = p.default
    if (def.electrical.kind === 'resistor') props.ohms = def.electrical.defaultOhms

    dispatch({ type: 'addPart', part: { id, type, x, y, rotation: 0, props } })
    onSelect(id)
  }

  return (
    <div className="px-4 py-4 border-b border-[#dfe3e8]">
      {/* "Add a part", not "Components": the rail itself is now headed
          Components, and two identical headings a row apart read as a mistake.
          This one names the ACTION the grid below performs. */}
      <div className={`${SECTION_LABEL} mb-2`}>Add a part</div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search parts"
        aria-label="Search parts"
        data-testid="palette-search"
        className="w-full h-[37px] mb-3 px-2.5 rounded-none bg-white border-[0.8px] border-[#dfe3e8] text-[15px] text-[#34495e] placeholder:text-[#566573] outline-none focus:border-[#1477d1]"
      />

      {shown.length === 0 ? (
        <p className="text-xs text-[#566573]" data-testid="palette-empty">
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

/** A declared prop whose only two positions are 0 and 1 is a boolean. */
function isToggle(prop: PropSpec): boolean {
  return prop.type === 'range' && prop.min === 0 && prop.max === 1 && prop.step === 1
}

/** Shared field chrome, so the text box and the unit dropdown line up. */
const FIELD =
  'h-[37px] bg-white border-[0.8px] border-[#dfe3e8] rounded-none px-2 text-xs ' +
  'text-[#34495e] outline-none focus:border-[#1477d1]'

/**
 * Free numeric entry plus an SI unit dropdown — Tinkercad's `VALUE_AND_UNIT`.
 *
 * The control this replaces was a ten-entry `<select>` that could not express
 * 150 Ω or 3.3 kΩ. Two things about it are load-bearing rather than cosmetic:
 *
 *  - **All validation is in parts.ts**, not here. `parseValueUnit` is what
 *    decides what a typed string means, and it exists outside React because
 *    `Resistor.stamp` THROWS on a negative or non-finite resistance — the last
 *    place that can stop a student reaching that stack trace is this field, so
 *    the rule it enforces has to be assertable without mounting a component.
 *  - **A rejected entry does not reach the document.** The text stays as typed,
 *    the field says why in words, and the simulation keeps running on the last
 *    good value. Silently substituting something plausible is the failure mode
 *    the whole audit is about.
 *
 * Changing the UNIT changes the value, as it does on Tinkercad: `1` + `kΩ`
 * becomes `1` + `Ω` = 1 Ω. The figure is what the student typed; the dropdown
 * says what they meant by it.
 */
function ValueUnitControl({
  prop,
  value,
  onChange,
}: {
  prop: PropSpec
  value: number
  onChange: (v: number) => void
}) {
  const units = useMemo(() => prop.units ?? [{ label: prop.unit ?? '', mul: 1 }], [prop])
  const id = `prop-input-${prop.key}`
  const unitId = `prop-unit-${prop.key}`
  const noteId = `prop-note-${prop.key}`
  const listId = `prop-list-${prop.key}`

  const [draft, setDraft] = useState(() => splitValueUnit(value, units))
  const [note, setNote] = useState<{ kind: 'error' | 'clamp'; text: string } | null>(null)

  /**
   * The value this control itself last wrote.
   *
   * STATE, not a ref, and not by preference: the comparison below happens
   * during render, and a ref may not be read or written there — React makes no
   * promise about when a render runs, so a ref touched during one is a value
   * that can silently disagree with what was committed.
   *
   * Its job is to tell apart the two ways `value` can change. Committing `4.7`
   * changes it, and re-splitting then would overwrite the `4.7` the student is
   * still typing. So only changes that came from SOMEWHERE ELSE — undo, a
   * starter load, the knob being dragged on the canvas — reformat the box.
   */
  const [lastWritten, setLastWritten] = useState(value)

  /**
   * Adjusting state DURING RENDER, which is React's documented pattern for
   * "some state needs to follow a prop" — not an effect.
   *
   * An effect would be a second render pass: the box would paint once with the
   * stale figure and again with the new one, which for a value arriving from an
   * undo is a visible flicker of the previous resistance. React sees a setState
   * during the render of the same component, discards the in-progress output
   * and re-runs immediately, before the browser paints anything — so there is
   * one commit and no flicker. This is what the react-hooks lint rule steers
   * toward, rather than something suppressed to satisfy it.
   */
  if (value !== lastWritten) {
    setLastWritten(value)
    setDraft(splitValueUnit(value, units))
    setNote(null)
  }

  function commit(text: string, unitIndex: number) {
    const result = parseValueUnit(text, prop, unitIndex)
    if (!result.ok) {
      setNote({ kind: 'error', text: result.reason })
      return
    }
    const asked = Number(text.trim()) * (units[unitIndex]?.mul ?? 1)
    if (result.value !== asked) {
      setNote({ kind: 'clamp', text: `Limited to ${formatValueUnit(result.value, units)}.` })
      setDraft(splitValueUnit(result.value, units))
    } else {
      setNote(null)
    }
    setLastWritten(result.value)
    onChange(result.value)
  }

  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-[10px] text-[#566573] mb-1">
        {prop.label}
      </label>
      <div className="flex gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          id={id}
          data-testid={`prop-${prop.key}`}
          value={draft.text}
          list={prop.options ? listId : undefined}
          aria-invalid={note?.kind === 'error' ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          onChange={(e) => {
            setDraft((d) => ({ ...d, text: e.target.value }))
            commit(e.target.value, draft.unitIndex)
          }}
          /* Leaving the field tidies a half-typed or rejected entry back to
             what the document actually holds, so the box can never be left
             showing a figure the simulation is not using. */
          onBlur={() => {
            setDraft(splitValueUnit(lastWritten, units))
            setNote(null)
          }}
          className={`${FIELD} flex-1 min-w-0 tabular-nums ${
            note?.kind === 'error' ? 'border-red-500' : ''
          }`}
        />
        {/* Suggestions, not the vocabulary. A datalist keeps the common values
            one keystroke away without taking the free field back off them. */}
        {prop.options && (
          <datalist id={listId}>
            {prop.options.map((o) => {
              const split = splitValueUnit(o, units)
              return split.unitIndex === draft.unitIndex ? (
                <option key={o} value={split.text} />
              ) : null
            })}
          </datalist>
        )}
        <select
          id={unitId}
          data-testid={`prop-${prop.key}-unit`}
          aria-label={`${prop.label} unit`}
          value={draft.unitIndex}
          onChange={(e) => {
            const next = Number(e.target.value)
            setDraft((d) => ({ ...d, unitIndex: next }))
            commit(draft.text, next)
          }}
          className={`${FIELD} w-[74px] shrink-0`}
        >
          {units.map((u, i) => (
            <option key={u.label} value={i}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      {note ? (
        <p
          id={noteId}
          data-testid={`prop-${prop.key}-note`}
          role={note.kind === 'error' ? 'alert' : 'status'}
          className={`mt-1 text-[10px] leading-snug ${
            note.kind === 'error' ? 'text-red-600' : 'text-[#566573]'
          }`}
        >
          {note.text}
        </p>
      ) : (
        prop.hint && (
          <p className="mt-1 text-[10px] leading-snug text-[#566573]">{prop.hint}</p>
        )
      )}
    </div>
  )
}

/**
 * One editable property, rendered from the part's own declaration.
 *
 * Nothing here knows what a PIR or an ultrasonic module is — the SHAPE of the
 * declared prop picks the control, so a part that ships tomorrow gets a working
 * inspector for free. The one addition over "range → slider, else → select" is
 * the toggle: a two-stop slider is a miserable way to ask "is something moving
 * in front of the sensor?", and a 0/1 range is a checkbox in everything but
 * name.
 */
function PropControl({
  prop,
  value,
  onChange,
}: {
  prop: PropSpec
  value: number | string
  onChange: (v: number | string) => void
}) {
  const id = `prop-input-${prop.key}`
  const testId = `prop-${prop.key}`

  if (isToggle(prop)) {
    return (
      <div className="mb-3 flex items-center gap-2">
        <input
          type="checkbox"
          id={id}
          data-testid={testId}
          checked={Number(value) >= 0.5}
          onChange={(e) => onChange(e.target.checked ? 1 : 0)}
          className="h-3.5 w-3.5 shrink-0 accent-[#1477d1]"
        />
        <label htmlFor={id} className="text-[11px] text-[#34495e] leading-none">
          {prop.label}
        </label>
      </div>
    )
  }

  if (prop.type === 'range') {
    return (
      <div className="mb-3">
        <label htmlFor={id} className="flex justify-between text-[10px] text-[#566573] mb-1">
          <span>{prop.label}</span>
          <span className="text-[#34495e] tabular-nums" data-testid={`${testId}-value`}>
            {Number(value)}
            {prop.unit ?? ''}
          </span>
        </label>
        <input
          type="range"
          id={id}
          data-testid={testId}
          min={prop.min}
          max={prop.max}
          step={prop.step}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-[#1477d1]"
        />
      </div>
    )
  }

  if (prop.type === 'number') {
    return <ValueUnitControl prop={prop} value={Number(value)} onChange={onChange} />
  }

  /**
   * A fixed list of STRINGS — an LED's colour. Separate from the numeric
   * `select` below because the document stores the string: encoding a colour as
   * an index would put "3" in a saved circuit and leave every future reader
   * guessing which list it was an index into.
   */
  if (prop.type === 'choice') {
    return (
      <div className="mb-3">
        <label htmlFor={id} className="block text-[10px] text-[#566573] mb-1">
          {prop.label}
        </label>
        <select
          id={id}
          data-testid={testId}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD} w-full`}
        >
          {prop.choices?.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {prop.hint && <p className="mt-1 text-[10px] leading-snug text-[#566573]">{prop.hint}</p>}
      </div>
    )
  }

  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-[10px] text-[#566573] mb-1">
        {prop.label}
      </label>
      <select
        id={id}
        data-testid={testId}
        value={String(Number(value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${FIELD} w-full`}
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
  )
}

/** What a part is currently reporting, in words rather than raw keys. */
type Readout = { headline: string; detail?: string }

/**
 * A current, on whatever prefix keeps it readable.
 *
 * Fixed milliamps is wrong for the reactive parts specifically. An RC settles
 * ASYMPTOTICALLY — at ten time constants a 1 kΩ/1 µF charge is still passing
 * 227 nA — and `(2.27e-7 * 1000).toFixed(3)` is "0.000 mA", which sat next to
 * the word "charging" and read as a contradiction. It is not a contradiction;
 * it is a current three decimal places too small for the unit it was printed in.
 */
function formatAmps(amps: number): string {
  const a = Math.abs(amps)
  if (!Number.isFinite(a)) return '— A'
  if (a >= 1) return `${a.toFixed(3)} A`
  if (a >= 1e-3) return `${(a * 1e3).toFixed(3)} mA`
  if (a >= 1e-6) return `${(a * 1e6).toFixed(2)} µA`
  if (a > 0) return `${(a * 1e9).toFixed(1)} nA`
  return '0 A'
}

/**
 * Turn one device's reported state into something a student can read.
 *
 * Reported, never solved: every number here came out of the engine's snapshot.
 * Where a device reports NOTHING happening — a passive buzzer held at a steady
 * level, an unpowered module — that is what is shown, with the reason. Inventing
 * a plausible-looking value would be worse than useless: the whole point of the
 * panel is that the student can trust it against their own wiring.
 */
function describeDevice(def: PartDefinition, s: DeviceState): Readout {
  const num = (k: string) => Number(s[k] ?? 0)
  const el = def.electrical

  if (el.kind === 'buzzer') {
    const volts = num('volts')
    if (s.sounding === true) {
      // A buzzer driven by digitalWrite in a 1 s blink is being driven at half a
      // hertz, and rounding that to a whole number printed "0 Hz" over a part
      // the model had just said was sounding.
      const hz = num('hertz')
      return {
        headline: `${hz >= 10 ? Math.round(hz) : Number(hz.toFixed(2))} Hz`,
        detail:
          s.passive === true
            ? 'piezo element following the drive waveform'
            : 'active buzzer — sounding at its own oscillator pitch',
      }
    }
    return {
      headline: 'silent',
      detail:
        s.passive === true
          ? `steady ${volts.toFixed(2)} V across it — a piezo only sounds when that voltage changes (tone(), not digitalWrite())`
          : `${volts.toFixed(2)} V across it — not enough to drive it`,
    }
  }

  if (el.kind === 'motor') {
    const amps = Math.abs(num('amps'))
    const detail = `${(amps * 1000).toFixed(0)} mA · load ${Math.round(num('load') * 100)}%`
    if (s.stalled === true) return { headline: 'stalled', detail: `${detail} · shaft not turning` }
    const direction = String(s.direction ?? 'stopped')
    if (direction === 'stopped') return { headline: 'stopped', detail }
    return { headline: `${Math.round(num('rpm'))} rpm ${direction}`, detail }
  }

  if (el.kind === 'sensor') {
    if (el.protocol === 'hc_sr04') {
      if (s.powered !== true) {
        return { headline: 'no power', detail: 'VCC is not on a live rail — the module drives nothing' }
      }
      const echo = num('echoMicros')
      if (s.inRange !== true) {
        return {
          headline: `${num('distanceCm')} cm — out of range`,
          detail: `outside the module's 2–400 cm window, so ECHO reports its ${Math.round(echo / 1000)} ms timeout`,
        }
      }
      return { headline: `${num('distanceCm')} cm`, detail: `echo pulse ${Math.round(echo)} µs` }
    }

    if (el.protocol === 'pir') {
      if (s.powered !== true) {
        return { headline: 'no power', detail: 'VCC is not on a live rail — the module drives nothing' }
      }
      if (s.warming === true) {
        return {
          headline: 'warming up',
          detail: `${Math.ceil(num('warmupRemaining'))} s left before it will trigger`,
        }
      }
      // The hold window is real and survives an edit — un-ticking "motion in
      // front" starts it rather than cancelling it, so the output stays high for
      // the hold time and only then falls. (It did not always: every prop change
      // used to rebuild the behavioural devices, which reset the window at the
      // exact moment the student asked to see it. See buildBehavioural().)
      return s.motion === true
        ? { headline: 'motion', detail: `output high · holds for ${num('holdSeconds')} s after motion stops` }
        : { headline: 'no motion', detail: 'output low' }
    }

    if (el.protocol === 'flow') {
      const hz = num('hertz')
      const detail =
        `${hz.toFixed(1)} Hz · ${Math.round(num('pulses'))} pulses · ${num('litres').toFixed(3)} L total` +
        (s.inRange === true ? '' : ' · outside the 1–30 L/min working range')
      return { headline: hz === 0 ? 'no flow' : `${num('litresPerMinute').toFixed(1)} L/min`, detail }
    }

    if (el.protocol === 'dht11') {
      return { headline: `${num('temperature')} °C · ${num('humidity')}% RH` }
    }

    if (el.protocol === 'ds18b20') {
      if (s.powered !== true) {
        return { headline: 'no power', detail: 'VDD is not on a 3.0–5.5 V rail — the sensor cannot answer' }
      }
      // A 1-Wire bus that never rises is the single commonest way to get
      // nothing at all out of this part, and it has exactly one cause worth
      // naming: no pull-up. The model reports it rather than letting the
      // student's driver just time out.
      if (s.busIdleHigh !== true) {
        return {
          headline: 'bus held low',
          detail: 'nothing is pulling DQ up — a DS18B20 is open-drain and needs the 4.7 kΩ to 3.3 V',
        }
      }
      const detail =
        `${num('resolution')}-bit · ROM ${String(s.rom ?? '')}` +
        (s.converting === true ? ' · converting…' : '')
      return { headline: `${num('celsius').toFixed(4)} °C`, detail }
    }

    if (el.protocol === 'pulse') {
      if (s.powered !== true) {
        return { headline: 'no power', detail: 'VCC is not on a 3–5 V rail — the amplifier is dead' }
      }
      // "synthesised" is said out loud on every reading, not buried in a
      // docstring. This part generates a waveform; it does not model optics,
      // and a heart rate read off it came from a slider.
      return {
        headline: `${Math.round(num('bpm'))} BPM`,
        detail:
          `${num('signalVolts').toFixed(3)} V on the wire · ${Math.round(num('beats'))} beats · ` +
          `synthesised waveform, not a real PPG`,
      }
    }

    if (el.protocol === 'mcp3008') {
      if (s.powered !== true) {
        return { headline: 'no power', detail: 'VDD is not on a 2.7–5.5 V rail — the converter cannot answer' }
      }
      const vref = num('vref')
      if (!(vref > 0)) {
        return {
          headline: 'no reference',
          detail: 'VREF is not on a rail — every conversion reads 0 without one',
        }
      }
      const conversions = Math.round(num('conversions'))
      if (conversions === 0) {
        return { headline: 'idle', detail: `VREF ${vref.toFixed(2)} V · nothing has clocked the bus yet` }
      }
      return {
        headline: `CH${Math.round(num('channel'))} = ${Math.round(num('code'))}`,
        detail:
          `${num('volts').toFixed(3)} V of ${vref.toFixed(2)} V VREF · ${String(s.mode ?? 'single')}-ended · ` +
          `${conversions} conversion${conversions === 1 ? '' : 's'}`,
      }
    }
  }

  if (el.kind === 'relay_module') {
    if (s.powered !== true) {
      return {
        headline: 'no power',
        detail: 'VCC is not on a live rail — the coils cannot be energised',
      }
    }
    const supply = num('supplyVolts')
    const trigger = s.activeLow === true ? 'active-low' : 'active-high'
    const detail =
      `${supply.toFixed(2)} V supply · ${trigger} · contacts ${String(s.contacts ?? '')} · ` +
      `${(num('coilAmps') * 1000).toFixed(0)} mA in the coils`
    // The trap this part exists to expose: a 5 V board on a 3.3 V rail lights
    // its opto-couplers and never moves an armature.
    if (s.underVolted === true) {
      return {
        headline: 'coils under-volted',
        detail:
          `${supply.toFixed(2)} V is below the 3.75 V an SRD-05VDC coil is guaranteed to pull in at — ` +
          `the opto switches but the contact does not. Feed VCC from 5 V.`,
      }
    }
    const on = Math.round(num('energised'))
    return {
      headline: on === 0 ? 'all released' : `${on} of ${Math.round(num('channels'))} energised`,
      detail: `${String(s.pattern ?? '')} · ${detail}`,
    }
  }

  if (el.kind === 'stepper') {
    const errors = num('sequenceErrors')
    // The 85 °C-equivalent teaching moment for a stepper: a coil pattern that
    // is not on the half-step ring, or a jump the rotor could not have followed.
    // The model refuses to credit those, so saying so is the whole point.
    const detail =
      `${Math.round(num('halfSteps'))} half-steps · ${num('revolutions').toFixed(3)} rev · ` +
      `${Math.abs(num('rpm')).toFixed(1)} rpm · coils ${String(s.pattern ?? '····')}` +
      (errors > 0 ? ` · ${Math.round(errors)} refused pattern${errors === 1 ? '' : 's'}` : '')
    if (s.holding !== true) return { headline: 'coils off', detail }
    return { headline: `${num('shaftDegrees').toFixed(1)}°`, detail }
  }

  /**
   * A capacitor or an inductor.
   *
   * The transient engine genuinely integrates these in time — a capacitor really
   * does charge — and until now there was nowhere for it to say so. A student
   * building an RC could watch the current decay in the Measurements panel and
   * had no way at all to read the VOLTAGE that current was building, which is
   * the number the exercise is about.
   *
   * The trend word comes from the engine (analog-state.ts) rather than being
   * inferred here from successive renders, because it is exact physics there —
   * i = C·dv/dt — and would be a guess over a 20 Hz sample here.
   */
  if (el.kind === 'reactive') {
    const isCap = el.element === 'capacitor'
    if (s.connected !== true) {
      return {
        headline: 'not in the circuit',
        detail: 'both leads have to reach something before there is anything to charge',
      }
    }
    const volts = num('volts')
    const amps = num('amps')
    const trend = String(s.trend ?? 'steady')
    const size = isCap
      ? `${formatValueUnit(num('value'), FARAD_UNITS)}`
      : `${formatValueUnit(num('value'), HENRY_UNITS)}`
    if (isCap) {
      return {
        headline: `${volts.toFixed(3)} V · ${trend}`,
        detail:
          `${formatAmps(amps)} into it · ${size}` +
          // Said out loud, because "steady" over a capacitor has two very
          // different causes and the student can only tell them apart by
          // knowing which engine is running.
          (s.transient === true
            ? trend === 'steady'
              ? ' · the current has stopped'
              : ''
            : ' · solved at its DC limit (an open), not integrated in time'),
      }
    }
    return {
      headline: `${formatAmps(amps)} · ${trend}`,
      detail:
        `${volts.toFixed(3)} V across it · ${size}` +
        (s.transient === true
          ? trend === 'steady'
            ? ' · settled — an inductor at DC is a wire'
            : ''
          : ' · solved at its DC limit (a wire), not integrated in time'),
    }
  }

  if (el.kind === 'potentiometer') {
    const detail =
      `${Math.round(num('lowerOhms'))} Ω below the wiper · ` +
      `${Math.round(num('upperOhms'))} Ω above · ` +
      `${formatValueUnit(num('totalOhms'), OHM_UNITS)} track`
    if (s.connected !== true) {
      return { headline: `${num('position')}%`, detail: `${detail} · wiper wired to nothing` }
    }
    // The wiper voltage is the whole reason this part exists: it is what
    // analogRead() actually converts. A pot used as a RHEOSTAT has one end
    // open, which is legitimate and gives a wiper voltage that means something
    // quite different, so the readout says which it is looking at.
    return {
      headline: `${num('position')}% · ${num('wiperVolts').toFixed(3)} V`,
      detail: s.endsWired === true ? detail : `${detail} · one end open (rheostat)`,
    }
  }

  if (el.kind === 'variable_resistor') {
    const ohms = num('ohms')
    if (s.connected !== true) {
      return {
        headline: formatValueUnit(Number(ohms.toPrecision(4)), OHM_UNITS),
        detail: `${num('light')}% light · not wired into anything`,
      }
    }
    return {
      headline: formatValueUnit(Number(ohms.toPrecision(4)), OHM_UNITS),
      detail:
        `${num('light')}% light · ${num('volts').toFixed(3)} V across it · ` +
        formatAmps(num('amps')),
    }
  }

  if (el.kind === 'diode') {
    if (s.connected !== true) {
      return { headline: 'not in the circuit', detail: 'a lead is wired to nothing' }
    }
    const volts = num('volts')
    // A junction has no threshold it "turns on" at — it conducts exponentially —
    // so the word here is about which WAY it is biased. Backwards is the
    // mistake this readout exists to catch.
    return {
      headline: `${volts.toFixed(3)} V ${String(s.biased ?? 'none')}`,
      detail:
        s.biased === 'reverse'
          ? 'reverse biased — it blocks, which is either the point or the wrong way round'
          : 'anode to cathode',
    }
  }

  if (el.kind === 'button') {
    const volts = num('volts')
    if (s.connected !== true) {
      return {
        headline: s.pressed === true ? 'pressed' : 'released',
        detail: 'contacts wired to nothing',
      }
    }
    return {
      headline: s.pressed === true ? 'pressed' : 'released',
      detail:
        s.pressed === true
          ? `contacts closed · ${Math.abs(volts * 1000).toFixed(1)} mV across them`
          : `contacts open · ${Math.abs(volts).toFixed(3)} V across them`,
    }
  }

  /**
   * The L298N. Two independent bridges, reported independently.
   *
   * `mode` is what a bridge is DOING and `asked` is what it was TOLD to do. They
   * only differ when the chip cannot drive — no logic supply, no motor supply —
   * and that gap is the whole reason this row exists: the model has always known
   * why a motor was not turning and the student could not see any of it.
   */
  if (el.kind === 'h_bridge') {
    if (s.built !== true) {
      return {
        headline: 'not wired up',
        detail: 'the GND terminal has to reach the rest of the circuit before the chip does anything',
      }
    }
    const bridge = (mode: string, asked: string, amps: number): string => {
      // A bridge told to drive that is not driving names the fault; one that was
      // never enabled just says so.
      if (mode === asked) {
        return mode === 'coast'
          ? 'coast'
          : `${mode} · ${Math.abs(amps * 1000).toFixed(0)} mA`
      }
      return `${asked} asked — dead`
    }
    const headline =
      `A ${bridge(String(s.modeA ?? 'coast'), String(s.askedA ?? 'coast'), num('ampsA'))} · ` +
      `B ${bridge(String(s.modeB ?? 'coast'), String(s.askedB ?? 'coast'), num('ampsB'))}`
    const supplies =
      s.logicOk !== true
        ? 'Vss (logic, the "+5V" screw) is outside 4.5–7 V — the logic is dead'
        : s.supplyOk !== true
          ? 'Vs (motor, the "+12V" screw) is under VIH + 2.5 V — the output stage cannot drive'
          : 'Vss and Vs both in range'
    return {
      headline,
      detail:
        `${supplies} · enable ${s.enabledA === true ? 'A' : '–'}` +
        `${s.enabledB === true ? 'B' : '–'}`,
    }
  }

  /**
   * The ULN2003. Seven independent open-collector sinks.
   *
   * `-` in the pattern is a channel whose IN pin reaches nothing, the same way
   * the relay board's pattern marks a channel it never built: six of a
   * 28BYJ-48's seven are legitimately unused, and printing those as a confident
   * "off" would put six meaningless readings beside the four that matter.
   */
  if (el.kind === 'darlington_array') {
    if (s.built !== true) {
      return {
        headline: 'no channels built',
        detail: 'a channel exists once its IN pin is wired — and GND has to reach the circuit too',
      }
    }
    const on = Math.round(num('energised'))
    const conducting = String(s.conducting ?? '')
    return {
      headline: on === 0 ? 'all off' : `${on} sinking`,
      detail:
        `${String(s.pattern ?? '')} · ` +
        (on === 0 ? 'no channel conducting' : `IN${conducting.replace(/, /g, ', IN')} on`) +
        ` · ${(num('amps') * 1000).toFixed(0)} mA total`,
    }
  }

  // A part whose model reports a shape this panel has never seen still gets its
  // numbers shown, rather than an empty row that looks like a broken sensor.
  const pairs = Object.entries(s).map(
    ([k, v]) => `${k} ${typeof v === 'number' ? Number(v.toFixed(2)) : String(v)}`,
  )
  return { headline: pairs.length > 0 ? pairs.join(' · ') : 'no reading' }
}

/**
 * Part kinds that publish reported state into the snapshot.
 *
 * The first five publish it through a behavioural model of their own. The rest
 * are purely ANALOG parts with no such model — they have nowhere to report FROM,
 * so the engine reads their state out of the solve instead (analog-state.ts).
 * The distinction matters to nothing here: both arrive in the same
 * `deviceStates` record, and this set only decides whether the panel is worth
 * drawing at all.
 */
const REPORTS_STATE = new Set([
  'buzzer',
  'motor',
  'sensor',
  'stepper',
  'relay_module',
  'reactive',
  'potentiometer',
  'variable_resistor',
  'diode',
  'button',
  // The two driver ICs. Both compute everything a student needs on every solve
  // — an HBridgeChannel's mode and both supply verdicts, every DarlingtonSink's
  // on/off — and until they were added here all of it was thrown away, so the
  // only way to see an L298N working was to look at the motor on the end of it.
  'h_bridge',
  'darlington_array',
])

/**
 * How far the Pico has got with the student's script, in words.
 *
 * This is not decoration. Getting a .py into a running interpreter means
 * booting MicroPython (~1.8 s of simulated time), waiting for a prompt, and then
 * streaming the source in over an emulated USB serial link — during which the
 * board is powered and doing nothing the student asked for. Saying which stage
 * it is at is the difference between "wait a moment" and "this is broken".
 */
/* ── The student's source, and the one rule about it ──────────────────── */

/**
 * TWO copies of the program, and the distinction is the whole run model.
 *
 *  - `draft`  is what is in the editor. It changes on every keystroke, and it
 *    is what gets AUTOSAVED, so a student who types a line and reloads gets
 *    that line back whether or not they ever ran it.
 *  - `loaded` is what the board was actually given. usePicoSimulator reboots
 *    MicroPython whenever this changes (pico.worker's `setScript` case), so it
 *    must change only when the student asks.
 *
 * Feeding the draft straight into the simulator would reboot the interpreter on
 * every keystroke — the emulated board would spend its life in the ~1.8 s boot
 * it takes MicroPython to reach a prompt and never run anything. Committing on
 * Run is not a compromise; it is the only workable shape, and the UI says so out
 * loud rather than letting the board silently disagree with the screen.
 */
interface CodeState {
  draft: string
  loaded: string
}

type CodeAction =
  /** A keystroke, or Reset to starter. Never reaches the board on its own. */
  | { type: 'edit'; source: string }
  /** Autosave came back. Both copies move, so arrival is never "dirty". */
  | { type: 'restore'; source: string }
  /** The student pressed Run. THIS is what reboots the interpreter. */
  | { type: 'load' }

/**
 * A reducer rather than two useStates, for one concrete reason: the restore
 * lands inside an effect, and `dispatch` is the only way to move state from an
 * effect without the cascading re-render that react-hooks/set-state-in-effect
 * (correctly) rejects. The document beside it is already a reducer for the same
 * reason.
 */
function codeReducer(state: CodeState, action: CodeAction): CodeState {
  switch (action.type) {
    case 'edit':
      return action.source === state.draft ? state : { ...state, draft: action.source }
    case 'restore':
      return action.source === state.draft && action.source === state.loaded
        ? state
        : { draft: action.source, loaded: action.source }
    case 'load':
      return state.draft === state.loaded ? state : { ...state, loaded: state.draft }
  }
}

const REPL_LABEL: Record<string, string> = {
  booting: 'booting…',
  pasting: 'sending script…',
  running: 'script running',
  idle: 'REPL idle — no script',
}

export function CircuitEditor({
  initial,
  remote,
  experimentSlug,
  starterSketch,
}: {
  initial?: CircuitDoc
  /** Omitted in the dev harness, where there is no class or simulation. */
  remote?: RemoteTarget
  /**
   * Which experiment this editor is opened for, so a PICO document can be given
   * the MicroPython the lab sheet asks the student to run.
   *
   * The slug is only the STARTING point and the reset target: the student edits
   * their own copy in the code panel and it is autosaved into
   * sim_attempts.code, so a returning student gets their program back, not the
   * authored one. A slug with no Pico script lands at an empty editor and a bare
   * REPL rather than guessing at one.
   *
   * ARDUINO SKETCHES DO NOT COME THROUGH HERE — see `starterSketch`. The Pico
   * scripts are a PORT of lab sheets written for a Raspberry Pi SBC and so have
   * to live in reviewable code; the Arduino listings already target the exact
   * board being emulated, so they are read from the database instead.
   */
  experimentSlug?: string
  /**
   * The experiment's own published Arduino sketch, verbatim from its `code`
   * section in the database.
   *
   * Passed in rather than fetched here because this is a client component and
   * the page that renders it is already a server component holding a Supabase
   * client and the experiment id — one more column on a query it is already
   * making, against a section the student is already allowed to read, versus a
   * second round trip and a loading state in the editor.
   */
  starterSketch?: string
}) {
  /**
   * What the editor holds before the restore lands.
   *
   * With a `remote` target the real document is the student's attempt or this
   * experiment's authored starter, and both arrive asynchronously — so the seed
   * must be NEUTRAL. It used to be EXPERIMENT_01, which meant a student opening
   * the traffic-light experiment was seeded with experiment 1's finished LED
   * circuit, and, if the starter row was missing or the load failed, kept it.
   * An empty board is the honest fallback: nothing to unlearn, nothing that
   * looks like an answer to a different question.
   *
   * The dev harness (no `remote`) keeps EXPERIMENT_01 — there is nothing to
   * fetch there and a populated board is the point of the harness.
   */
  const seed = initial ?? (remote ? BLANK : EXPERIMENT_01)

  // The lazy initialiser (rather than a plain initial value) so the starting
  // document's ids are claimed too — it never passes through the 'load' action.
  const [state, dispatch] = useReducer(docReducer, seed, (doc) => {
    adoptIds(doc)
    return { doc, past: [], future: [] }
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [hexUrl, setHexUrl] = useState(FIRMWARE[0].url)

  const doc = state.doc

  /**
   * The experiment's AUTHORED program — what "Reset to starter" goes back to,
   * and what a student who has never opened this experiment starts on.
   *
   * TWO SOURCES, AND THEY ARE NOT THE SAME KIND OF THING.
   *
   * The Pico script comes from PICO_EXPERIMENTS, a table in this repository,
   * because the published lab sheets for those six experiments target a
   * Raspberry Pi SBC running RPi.GPIO under Linux — a different machine from
   * the microcontroller we emulate. pico/experiments.ts is the PORT, and a port
   * has to live in code where it can be reviewed and tested.
   *
   * The Arduino sketch arrives as `starterSketch`, read from the experiment's
   * own published `code` section in the database by the page that renders this.
   * Nothing is ported: that listing already targets exactly the board the
   * student is looking at, and it is the same text they read two sections
   * earlier in the lab sheet. Copying it into this repository would have made a
   * second copy that could drift from the one an instructor edits — the very
   * problem scripts/sketches/traffic-mega.cpp calls out in its header when it
   * says it is transcribed "so that what students read and what the emulated
   * board executes cannot drift apart". With the database as the single source,
   * they cannot.
   *
   * (The `#include <Arduino.h>` that transcription had to add by hand is no
   * longer needed either — lib/simulator/avr/ino.ts inserts it, along with the
   * prototypes the Arduino IDE would have hoisted, so a published listing
   * compiles verbatim. Five of the six do; the sixth needed one extra core
   * translation unit, not an edit to the sketch.)
   *
   * Empty string, not undefined, for everything else — the dev harness, the
   * free-form workspace, an experiment with no published listing. The Pico
   * worker reads an empty script as "no program, sit at the REPL"; the AVR path
   * reads it as "nothing to compile yet", and both are honest.
   */
  const starterScript = (experimentSlug && PICO_EXPERIMENTS[experimentSlug]?.script) || ''
  const starterProgram = starterSketch || starterScript

  /** Draft vs loaded — see codeReducer above, which is where the rule is stated. */
  const [code, codeDispatch] = useReducer(codeReducer, starterProgram, (s) => ({
    draft: s,
    loaded: s,
  }))
  const draft = code.draft
  const script = code.loaded
  /**
   * Whether each docked panel is showing — the student's choice, or the layout's.
   *
   * `null` means "nobody has said", and then the DEFAULT decides. For the code
   * panel that default is the viewport: open beside the circuit on a laptop,
   * closed on a phone where the two cannot share the screen (see useIsNarrow,
   * which records the 387×0 canvas that made this necessary). For the parts rail
   * it is simply open — that is where the palette, the inspector and the Checks
   * list live, and a student who has never pressed anything should land on all
   * three.
   *
   * An explicit press wins from then on, in either direction, and keeps winning
   * if the window is resized — a student who opened the editor on a narrow
   * window did mean it. It also SURVIVES A RELOAD, in localStorage beside the
   * panel width: which panels are open is a property of the person and the
   * screen in front of them, not of the circuit, so it does not belong in the
   * document (usePanelOpen says this at length).
   */
  const isNarrow = useIsNarrow()
  const [codeOpenChoice, setCodeOpenChoice] = usePanelOpen(CODE_OPEN_KEY)
  const [railOpenChoice, setRailOpenChoice] = usePanelOpen(RAIL_OPEN_KEY)
  const codeOpen = codeOpenChoice ?? !isNarrow
  const railOpen = railOpenChoice ?? true
  /**
   * BELOW `md`, THE TWO PANELS ARE MUTUALLY EXCLUSIVE, and that is a measured
   * constraint rather than a preference.
   *
   * Three stacked regions do not fit in one phone-width column. The canvas needs
   * a floor (it was measured at 387×0 before it had one), and a code panel or a
   * parts rail squeezed into what is left of a 390×844 screen after a 48 px
   * header and a wrapped toolbar has room for its chrome and nothing else — the
   * editor's own textarea would be the thing crushed to zero instead of the
   * canvas, which is not an improvement.
   *
   * So opening one CLOSES the other, explicitly, in the stored state — not by
   * quietly hiding it behind a `max-md:hidden` the way this layout used to. The
   * difference matters because there is now a switch on screen claiming to
   * describe the rail: a button reading "pressed" over a panel CSS has hidden is
   * a lie to everyone, and to a screen-reader user it is the only thing they
   * have to go on.
   *
   * `railVisible` carries the same rule at render time, for the one case the
   * handlers cannot catch: a window resized (or a phone rotated) while both were
   * open on a wide screen. From `md` up nothing here applies and both panels
   * live side by side.
   */
  const toggleCode = useCallback(() => {
    const next = !codeOpen
    setCodeOpenChoice(next)
    if (next && isNarrow) setRailOpenChoice(false)
  }, [codeOpen, isNarrow, setCodeOpenChoice, setRailOpenChoice])

  /**
   * Where focus goes when a panel disappears.
   *
   * Closing a region that CONTAINS the focused element — the panel's own ✕, or
   * the board being deleted out from under an open editor — leaves the browser
   * with nothing focused and dumps it on <body>, which strands a keyboard user
   * at the top of the document with no idea what just happened. Sending focus to
   * the switch that governs the region is the ARIA convention and, more to the
   * point, is where they will want to press next.
   */
  const codeToggleRef = useRef<HTMLButtonElement>(null)
  const railToggleRef = useRef<HTMLButtonElement>(null)
  const railRef = useRef<HTMLElement>(null)

  /**
   * Forward references, so the restore effect below can reach two things that
   * are declared after it.
   *
   * The restore effect has to run BEFORE the simulator hooks in source order —
   * it decides which document and which program those hooks are given — but it
   * also needs to kick off the first compile, and `useSketchCompile` cannot be
   * called until the document exists. Refs are the ordinary way out: both are
   * assigned during render, and the effect that reads them runs after the whole
   * render has committed, so neither is ever read stale or unset.
   */
  const draftRef = useRef(draft)
  const compileRef = useRef<(source: string, board: 'arduino_uno' | 'arduino_mega') => void>(
    () => {},
  )

  /**
   * The code panel's width, remembered across reloads.
   *
   * Persisted on every change rather than on drag end: the resizer streams
   * widths and has no "finished" event, so a student who drags the divider and
   * immediately reloads would otherwise lose it. One localStorage write per
   * pointermove is a string assignment — cheaper than the layout the same event
   * has already caused. See useCodeWidth for why this is an external store
   * rather than state plus an effect.
   */
  const [codeWidth, setCodeWidth] = useCodeWidth()

  /**
   * Whether this document has a board whose program the student can edit.
   *
   * BOTH TRACKS NOW DO, and that is the asymmetry this file used to record and
   * no longer has to. The note here said the AVR track had no editable source
   * because "there is no avr-gcc in the browser, only three prebuilt .hex
   * fixtures, so an editable C++ box would be a lie". That was true and is the
   * reason six of twelve experiments could not be programmed.
   *
   * It stopped being true when the compiler moved to the SERVER rather than to
   * the browser. AVR_COMPILE_FINDINGS.md showed the WebAssembly toolchain works
   * and cannot be shipped — serving GPL-3.0 cc1plus.wasm to a student is
   * conveying under §6, and we cannot supply the Corresponding Source for
   * binaries somebody else built. Running that same toolchain in a worker
   * thread behind app/api/compile conveys nothing (GPLv3 §0 excludes network
   * interaction with no transfer of a copy), needs no arduino-cli, and returns
   * Intel HEX — which is compiler output and already covered.
   */
  const boardTrack = useMemo(() => detectBoard(doc).board?.track ?? null, [doc])
  const isPico = boardTrack === 'rp2040'
  const isAvr = boardTrack === 'avr'

  /**
   * WHETHER THE CODE PANEL IS OFFERED AT ALL.
   *
   * `detectBoard` returns a board only when there is EXACTLY ONE. No board and
   * two boards both come back null — the second deliberately, because two CPUs
   * with two independent clocks cannot be co-simulated by one engine — and in
   * both cases there is no program to edit and nothing that could run it. A
   * `Code` switch there would open an editor bound to nothing, so it is not
   * offered; the Checks panel and the toolbar say which of the two it is, in the
   * board detector's own words.
   *
   * The PARTS RAIL is deliberately NOT gated the same way. Placing components is
   * meaningful in every document there can be — including, and especially, the
   * two this gate refuses: an empty canvas needs the rail to get its first
   * board, and a canvas with two boards needs the inspector's Delete to get back
   * to one. Gating it on a board would make both states unrecoverable from
   * inside the editor.
   */
  const canRunCode = boardTrack !== null
  const codeVisible = canRunCode && codeOpen
  /** See toggleCode: one column cannot hold the canvas and both panels. */
  const railVisible = railOpen && !(isNarrow && codeVisible)
  const toggleRail = useCallback(() => {
    const next = !railVisible
    setRailOpenChoice(next)
    if (next && isNarrow) setCodeOpenChoice(false)
  }, [railVisible, isNarrow, setCodeOpenChoice, setRailOpenChoice])

  /**
   * Rescue focus from a region that has just been removed.
   *
   * Two ways a student can be standing inside a panel when it vanishes: the
   * panel's own ✕, and — for the code panel — deleting the board, which
   * withdraws the whole editor because there is no longer a program to edit.
   * React unmounts the focused node either way, and the browser's only response
   * is to drop focus onto <body>: the tab ring disappears and the next Tab
   * starts again from the top of the page.
   *
   * WHICH SIGNAL, and it differs between the two panels because they disappear
   * by different mechanisms — this was measured, not assumed.
   *
   * The code panel is UNMOUNTED, so React has already detached the focused node
   * by the time effects run and `activeElement` is `<body>`. The rail is only
   * HIDDEN (`display: none`, to keep the palette's search box), and the browser
   * does not drop focus out of it until it next recalculates style — which is
   * after this effect. Asked for `activeElement` at that moment it still answers
   * with the input inside the now-invisible rail, so the body check alone missed
   * it and focus really did end up on `<body>` a frame later. Asking the region
   * whether it contains the focused element is exact in both orders.
   *
   * Either way it is CHECKED rather than assumed: closing a panel from the
   * TOOLBAR leaves focus exactly where it was — on the switch — and stealing it
   * back to the same button would be a no-op at best and, if the student had
   * already tabbed on, a theft.
   *
   * The rail's switch is the fallback for the one case where the code panel's
   * own switch went away with it (the board was deleted), so focus never ends up
   * nowhere.
   */
  const wasCodeVisible = useRef(codeVisible)
  const wasRailVisible = useRef(railVisible)
  useEffect(() => {
    const active = document.activeElement
    const stranded =
      active === null ||
      active === document.body ||
      (!railVisible && railRef.current?.contains(active) === true)
    const codeClosed = wasCodeVisible.current && !codeVisible
    const railClosed = wasRailVisible.current && !railVisible
    wasCodeVisible.current = codeVisible
    wasRailVisible.current = railVisible
    if (!stranded) return
    if (codeClosed) (codeToggleRef.current ?? railToggleRef.current)?.focus({ preventScroll: true })
    else if (railClosed) railToggleRef.current?.focus({ preventScroll: true })
  }, [codeVisible, railVisible])
  /** Which language the panel edits, and therefore how Run behaves. */
  const codeLanguage: CodeLanguage = isAvr ? 'arduino_c' : 'micropython'
  /** Both tracks store a program; only the file name and language differ. */
  const codeFileName = fileNameFor(codeLanguage)

  /**
   * The placed board's own id, which is what the code is bound TO.
   *
   * Tinkercad's code panel carries a selector reading `1 (Arduino Uno R3)` —
   * the board's Name property — because a program there belongs to one MCU
   * instance, not to the document. Ours can only ever be one board (detectBoard
   * refuses two), so this is shown rather than chosen; it is the same idea with
   * the choice removed, and it makes the binding visible instead of implied.
   */
  const mcuPartId = useMemo(
    () => doc.parts.find((p) => PART_LIBRARY[p.type]?.electrical.kind === 'mcu')?.id ?? '',
    [doc],
  )

  /**
   * The draft, in the shape the `code` jsonb column has held since migration
   * 015. Memoised on the text so autosave sees one changed value per keystroke
   * rather than a new object on every render.
   *
   * `undefined` — not an empty bundle — for a document with NO PROGRAMMABLE
   * BOARD, so that saving a circuit the student has temporarily removed the MCU
   * from cannot blank the program stored against the same attempt row. See
   * saveAttempt(): an absent key is left alone by the upsert; a present empty
   * one would overwrite.
   *
   * The file name and language come from the track, so a Pico attempt stores
   * `main.py` as `micropython` and an Arduino attempt stores `sketch.ino` as
   * `arduino_c` — the same two values the published `code` sections already
   * use, and the same ones parseCodeBundle reads back.
   */
  const codeBundle = useMemo(
    () =>
      isPico || isAvr
        ? writeCodeFile(EMPTY_CODE, draft, codeFileName, codeLanguage)
        : undefined,
    [isPico, isAvr, draft, codeFileName, codeLanguage],
  )

  // Local-first autosave. Restores previous work before the student notices
  // they lost anything — the wiring AND the program, through one write, so the
  // two can never come back from a reload out of step with each other.
  const {
    state: saveState,
    restored,
    restoredCode,
    restoreSource,
    restoreChecked,
  } = useAutosave(doc, remote, codeBundle)
  const appliedRestore = useRef(false)
  useEffect(() => {
    if (!restoreChecked || appliedRestore.current) return
    appliedRestore.current = true
    if (restored && (restored.parts?.length ?? 0) > 0) {
      dispatch({ type: 'load', doc: restored })
    }
    /**
     * A saved program replaces BOTH copies, so the editor opens on the
     * student's own code and the board is given that same code — not the
     * starter, and with no spurious "you have unsaved edits" on arrival.
     *
     * `null` means no file was stored, which is different from a stored empty
     * string: a student who deliberately cleared their program and reloaded
     * must get an empty editor back, not the starter script they deleted.
     */
    /**
     * WHICH FILE TO READ IS DECIDED BY THE DOCUMENT BEING RESTORED, not by the
     * one currently on screen — and the difference is a bug, not a nicety.
     *
     * This effect runs the moment the restore lands, and at that instant `doc`
     * is still the neutral BLANK seed: the `dispatch({type:'load'})` two lines
     * up is queued, not applied. `detectBoard(BLANK)` finds no board, so the
     * track-derived name would be `main.py` for EVERY experiment, and an
     * Arduino student's saved `sketch.ino` would silently fail to load — they
     * would open on the starter sketch with their own work still in the
     * database, which is the worst possible outcome for an autosave.
     *
     * `restored` is the document about to become `doc`, so asking it is asking
     * the right question one render early.
     */
    const restoredBoard = restored ? detectBoard(restored).board : detectBoard(doc).board
    const saved = readCodeFile(
      restoredCode,
      fileNameFor(restoredBoard?.track === 'avr' ? 'arduino_c' : 'micropython'),
    )
    if (saved !== null) codeDispatch({ type: 'restore', source: saved })

    /**
     * COMPILE THE EXPERIMENT'S SKETCH HERE, in the same effect, for the same
     * reason the file name is read here.
     *
     * This started as a separate effect gated on `restoreChecked`, and it was
     * wrong in a way that only showed up on the second visit: both effects ran
     * in the SAME commit, so the compile read `draft` before the `restore`
     * dispatch above had been applied and built the STARTER. A returning
     * student therefore opened with their own code in the editor and somebody
     * else's program on the board, reported — accurately but absurdly — as
     * "Edited, press Run". Reading `saved` directly removes the race: this is
     * the exact text the editor is about to hold, known one render before the
     * reducer holds it.
     *
     * The board is passed explicitly for the same reason; see the note on
     * `SketchCompile.compile`. Deriving it from `doc` here would build a Mega
     * circuit's firmware for a 328P.
     */
    const program = saved !== null ? saved : draftRef.current
    if (restoredBoard?.track === 'avr' && program.trim() !== '') {
      compileRef.current(program, restoredBoard.type as 'arduino_uno' | 'arduino_mega')
    }
    // `doc` and the two refs are read only as fallbacks; adding them would
    // re-run a deliberately once-only effect on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreChecked, restored, restoredCode])

  /**
   * Whichever board the document contains, running its own emulator.
   *
   * Not `useSimulator` any more. The document decides — a Pico in the circuit
   * runs rp2040js and MicroPython, an Uno runs avr8js and the selected .hex, and
   * a document with no board (or, deliberately, with two) runs nothing and says
   * why. Only the selected hook creates a worker, so exactly one emulator is
   * ever resident.
   */
  /**
   * The sketches this document's board can actually run.
   *
   * A .hex is compiled for ONE part. An ATmega328P image handed to a Mega does
   * not error — it runs, moves whichever pads the 328P's register addresses
   * name on an ATmega2560, and presents the result as the student's sketch. So
   * the selector is filtered by board rather than trusting the student not to
   * pick the wrong one.
   *
   * A board with no firmware at all still gets an honest refusal: the empty url
   * below stops the worker fetching anything, so the circuit compiles, solves
   * and reports while nothing pretends to execute. That was every Mega until
   * traffic-mega.hex existed; it is now no board, but the path stays because
   * the next board added will land here first.
   */
  const boardFirmware = useMemo(() => {
    const board = detectBoard(doc).board
    if (!board || board.track !== 'avr') return []
    return FIRMWARE.filter((f) => f.board === board.type)
  }, [doc])

  const noFirmwareFor = useMemo(() => {
    const board = detectBoard(doc).board
    if (!board || board.track !== 'avr') return null
    return boardFirmware.length === 0 ? board.label : null
  }, [doc, boardFirmware])

  /**
   * Keep the selection legal when the board changes.
   *
   * Swapping an Uno for a Mega leaves `hexUrl` pointing at a 328P image the new
   * board must never be given, so it falls back to that board's first sketch.
   * Derived during render rather than synced in an effect: an effect would let
   * one frame reach the worker with the wrong firmware.
   */
  const selectedHexUrl = boardFirmware.some((f) => f.url === hexUrl)
    ? hexUrl
    : (boardFirmware[0]?.url ?? '')

  /**
   * The student's own C++, compiled to firmware.
   *
   * Disabled on the Pico track, which has no compile step at all — MicroPython
   * is interpreted on the board, so its source goes to the worker as text.
   */
  /**
   * Which AVR this document holds. Defaulted rather than optional because the
   * value is only ever USED under an `isAvr` guard, and a nullable board would
   * push a meaningless null check into every call site.
   */
  const avrBoardType: 'arduino_uno' | 'arduino_mega' =
    detectBoard(doc).board?.type === 'arduino_mega' ? 'arduino_mega' : 'arduino_uno'

  const sketch = useSketchCompile({ classId: remote?.classId, enabled: isAvr })
  // See the refs' declaration: assigned during render, read only from effects.
  draftRef.current = draft
  compileRef.current = sketch.compile

  /**
   * WHAT THE BOARD IS ACTUALLY GIVEN.
   *
   * The student's compiled sketch wins whenever one exists. Until then — a dev
   * harness with no experiment, a workspace circuit nobody has written code
   * for — the prebuilt .hex selector behaves exactly as it always has, so
   * nothing that worked before this change stops working.
   *
   * The blob URL is what makes this a one-line junction rather than a rewrite
   * of useSimulator: that hook takes a URL, fetches it, and tags every piece of
   * worker state with it. A new compile mints a new URL, which tears down the
   * worker and builds a fresh ATmega with cleared SRAM — the same thing
   * flashing a real board does.
   */
  const activeHexUrl = sketch.hexUrl || selectedHexUrl
  /** True once the student's own code, rather than a fixture, is on the board. */
  const runningOwnCode = sketch.hexUrl !== '' && activeHexUrl === sketch.hexUrl

  const sim = useBoardSimulator(doc, { hexUrl: noFirmwareFor ? '' : activeHexUrl, script })
  const { ready, running, error, speedRatio, start, stop, reset } = sim
  const snapshot: SharedSnapshot = sim.snapshot ?? NO_SNAPSHOT

  /* ── Running the student's code ──────────────────────────────────────── */

  /**
   * Whether the board is running something older than what is on screen.
   *
   * Shown in two places (the toolbar and the panel) because a student who has
   * edited and not run must not be left wondering why the output has not
   * changed.
   *
   * The two tracks compare against different things, because "what the board
   * was given" means different things. A Pico was given SOURCE, so the
   * comparison is against the script last handed to the interpreter. An Uno was
   * given a BINARY, so the comparison is against the source that produced it —
   * `compiledSource`, recorded by useSketchCompile at the moment the HEX came
   * back. Comparing against a boolean "has been compiled" would get the common
   * case wrong: a student who edits a line and then undoes it is not dirty, and
   * telling them their board is stale would send them compiling for nothing.
   *
   * Before anything has been compiled at all, an AVR document is NOT dirty — it
   * is running a prebuilt fixture and there is nothing stale about it.
   */
  const codeDirty = isPico
    ? draft !== script
    : isAvr && sketch.compiledSource !== null && draft !== sketch.compiledSource

  /**
   * "Start it once the new script has actually gone out."
   *
   * Committing a new script and calling start() in the same handler does NOT
   * work: `start` is memoised on the script it will tag the run with, so the one
   * in hand at that moment still carries the OLD source, and usePicoSimulator
   * would immediately derive `running: false` again. Deferring to an effect
   * means the call happens on the render that already has the new script, after
   * the hook's own `setScript` effect has posted the reboot — worker message
   * order is FIFO, so the interpreter reboots and is then started, in that
   * order.
   *
   * A ref rather than state because this is a one-shot intent, not something
   * anything renders: it is set in an event handler and consumed by the next
   * effect pass, and making it state would only add a render and trip
   * react-hooks/set-state-in-effect on the way back down.
   */
  const pendingStart = useRef(false)
  useEffect(() => {
    if (!pendingStart.current || !ready) return
    pendingStart.current = false
    start()
    // `start`'s identity changes with the script it will tag, which is exactly
    // the render this needs to fire on.
  }, [ready, start])

  /**
   * The ONE run control, shared by the toolbar and the code panel — Tinkercad
   * has a single `Start Simulation` for the circuit and the code, and splitting
   * it would give a student two buttons that disagree.
   *
   * Editing never touches the running board; pressing this does. When the draft
   * has moved on, this loads it, which REBOOTS MicroPython and starts the
   * program from the top — there is no way to hot-patch a running interpreter
   * (see pico/engine.ts). Everything the old program had in memory is gone, and
   * the panel says so above the editor rather than letting it be a surprise.
   */
  const runCode = useCallback(() => {
    if (isPico && draft !== script) {
      pendingStart.current = true
      codeDispatch({ type: 'load' })
      return
    }
    /**
     * On the AVR track, Run means COMPILE and then run.
     *
     * The same `pendingStart` machinery carries it: a successful compile mints
     * a new blob URL, `useSimulator` tears the old worker down and brings a new
     * one up, `ready` flips true, and the effect above fires `start()` on the
     * render that already has the new firmware. Calling start() here instead
     * would tag the run with the OLD hexUrl and be discarded, which is the same
     * trap documented for the Pico path.
     *
     * A FAILED compile simply never sets `ready` again for a new URL, so the
     * pending start expires harmlessly and the board keeps running whatever it
     * had — which is exactly what should happen when the new code does not
     * build.
     */
    if (isAvr && draft.trim() !== '' && draft !== sketch.compiledSource) {
      pendingStart.current = true
      sketch.compile(draft, avrBoardType)
      return
    }
    start()
  }, [draft, isPico, isAvr, script, start, sketch, avrBoardType])

  const editCode = useCallback((source: string) => codeDispatch({ type: 'edit', source }), [])

  /** Back to the authored program. Loads the editor only — Run still has to be pressed. */
  const resetToStarter = useCallback(
    () => codeDispatch({ type: 'edit', source: starterProgram }),
    [starterProgram],
  )

  /**
   * Pause while the editor is gated out of fullscreen, resume on the way back.
   *
   * Safe to do because `stop` does NOT reset anything: both workers handle it by
   * setting their own `running` flag to false and posting one last snapshot —
   * the SimulationEngine / PicoSimulationEngine instance, its SRAM, its
   * registers and the solver's transient state all stay exactly as they were.
   * (Resetting is `reset`, which rebuilds the engine, and is a separate button.)
   * So this is a genuine pause, not a stop-and-restart, and a student who leaves
   * fullscreen mid-run comes back to the same simulated second they left.
   *
   * ONLY if it was running. A simulation the student deliberately stopped must
   * not spring back to life because they toggled fullscreen.
   *
   * Guarded on the TRANSITION rather than the value, so `running` changing for
   * any other reason (the Stop button, a firmware swap) cannot be mistaken for a
   * fullscreen event.
   */
  const gate = useFullscreenGate()
  const gateActive = gate.active
  const resumeOnReturn = useRef(false)
  const wasGateActive = useRef(gateActive)
  useEffect(() => {
    if (wasGateActive.current === gateActive) return
    wasGateActive.current = gateActive
    if (!gateActive) {
      if (running) {
        resumeOnReturn.current = true
        stop()
      }
    } else if (resumeOnReturn.current) {
      resumeOnReturn.current = false
      start()
    }
  }, [gateActive, running, start, stop])

  /**
   * The document compiled on the main thread, for the canvas (pin hover
   * highlighting). The authoritative electrical solve happens in the worker.
   *
   * It also carries the Checks panel whenever NOTHING IS RUNNING: no worker
   * means no snapshot, and a document reporting nothing at all reads as a
   * document with nothing wrong with it. This compile already had to happen, so
   * the fallback is free.
   *
   * Two cases reach it, not one. A document with no board (or with two) is the
   * original. The second is an Arduino Mega, which HAS a board and no firmware
   * to run on it — and its starter opens with twenty-eight parts still to wire,
   * every one of them a line in the Checks panel. Gating the fallback on
   * `track === 'none'` alone silently emptied that whole to-do list.
   */
  const compiled = useMemo(() => compile(doc), [doc])
  const netOf = compiled.netOf
  const usingLocalCompile = sim.track === 'none' || (!ready && !running)
  const problems = usingLocalCompile ? compiled.problems : snapshot.problems
  const limitations = usingLocalCompile ? compiled.limitations : snapshot.limitations
  const unknowns = usingLocalCompile ? compiled.unknowns : snapshot.unknowns

  const ledBrightness = useMemo(
    () => new Map(Object.entries(snapshot.ledBrightness)),
    [snapshot.ledBrightness],
  )

  const selectedPart = doc.parts.find((p) => p.id === selected) ?? null
  const selectedDef = selectedPart ? getPart(selectedPart.type) : null

  const readings = Object.entries(snapshot.currents)
  const highPins = Object.entries(snapshot.pins).filter(([, d]) => d === 'high')

  /**
   * Reported device state, walked in DOCUMENT order.
   *
   * Driving the list from the document rather than from the snapshot's keys does
   * two things: the rows keep a stable order while the simulation runs, and a
   * state left over from a part the student has since deleted can never show up.
   */
  const deviceRows = useMemo(() => {
    const rows: Array<{ id: string; label: string } & Readout> = []
    for (const part of doc.parts) {
      const state = snapshot.deviceStates[part.id]
      const def = PART_LIBRARY[part.type]
      if (!state || !def) continue
      rows.push({ id: part.id, label: def.label, ...describeDevice(def, state) })
    }
    return rows
  }, [doc.parts, snapshot.deviceStates])

  /**
   * Whether the panel is worth showing at all. A board of LEDs and resistors has
   * nothing that reports, and an empty section labelled "device state" would just
   * be one more thing to scroll past.
   */
  const hasReporters = doc.parts.some((p) =>
    REPORTS_STATE.has(PART_LIBRARY[p.type]?.electrical.kind ?? ''),
  )

  /**
   * Hold the first paint until the restore has resolved.
   *
   * Only when there is something to wait FOR: without a `remote` target the
   * document is already final, and gating on an IndexedDB round-trip would add
   * a flash to the dev harness for nothing. With one, painting the seed first
   * would show every student a board that is about to be replaced — and, for a
   * moment, run the simulator on it.
   *
   * `restoreChecked` is set unconditionally by useAutosave, including when the
   * server load throws, so this cannot become a permanent spinner.
   */
  if (remote && !restoreChecked) {
    return (
      <div
        data-testid="editor-restoring"
        className="flex h-[100dvh] items-center justify-center bg-[#f4f5f6] px-4 text-center"
      >
        <p className="text-xs text-[#566573]">Loading your circuit…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-[#f4f5f6] text-[#34495e]">
      {/* Top bar */}
      <header className="h-12 shrink-0 flex items-center justify-between gap-3 px-4 bg-white border-b border-[#dfe3e8]">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-sm font-semibold text-[#34495e] shrink-0">Circuit editor</h1>
          <p className="text-[11px] text-[#566573] truncate">
            {doc.parts.length} parts · {doc.wires.length} wires · {unknowns} unknowns
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            data-testid="save-state"
            className={`text-[11px] shrink-0 ${
              saveState === 'offline'
                ? 'text-amber-600'
                : saveState === 'saved'
                  ? 'text-green-700'
                  : 'text-[#566573]'
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

          {/* Only when a gate is actually above this editor. An ungated editor —
              the dev harness, a future embed — reports `gated: false` and gets
              no button, rather than one that cannot do anything. */}
          {gate.gated && gate.active && (
            <button
              type="button"
              data-testid="exit-fullscreen"
              onClick={gate.exit}
              className="h-7 shrink-0 inline-flex items-center gap-1.5 px-2.5 rounded-[3px] text-[11px] border border-[#dfe3e8] bg-white text-[#566573] transition-colors hover:border-[#1477d1] hover:text-[#34495e]"
            >
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              Exit fullscreen
            </button>
          )}
        </div>
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

        {/* What is going to RUN. The AVR track compiles, so it picks a .hex; the
            Pico track does not, so there is nothing to pick — the board and the
            language are stated instead, and the script itself is in the rail. A
            firmware selector over a MicroPython board would be a lie. */}
        {/*
          A BOARD IS ONLY EVER OFFERED ITS OWN FIRMWARE.

          A .hex is compiled for one part. An ATmega328P image loaded into an
          ATmega2560 does not fail — the image parses, the CPU runs it, and the
          pins it moves are whatever the 328P's register addresses happen to be
          on this part. That is the silent-wrong-answer failure
          SIMULATOR_ARCHITECTURE.md §2.3 forbids, so the list is filtered by
          board rather than trusting the student to pick correctly.

          A board with nothing to offer still gets a statement of fact instead
          of somebody else's binary. That was the Mega until traffic-mega.hex
          was built from experiment 11's own published sketch; the branch stays
          because it is what any future board hits first.
        */}
        {sim.track === 'avr' && noFirmwareFor && (
          <div className="flex items-center gap-2 shrink-0" data-testid="no-firmware">
            <span className="text-[11px] text-[#566573]">{sim.board.label}</span>
            <span className="h-8 flex items-center px-2.5 rounded-[3px] text-xs border border-amber-300 bg-amber-50 text-amber-900">
              No {noFirmwareFor} firmware yet — the circuit solves, but nothing runs
            </span>
          </div>
        )}

        {sim.track === 'avr' && !noFirmwareFor && (
          <div className="flex items-center gap-2 shrink-0" data-testid="avr-firmware">
            {/**
             * THE PREBUILT SELECTOR IS A FALLBACK NOW, NOT THE MAIN EVENT.
             *
             * It is shown only while the board is running one of the fixture
             * images — the dev harness, the free-form workspace, an experiment
             * with no published listing. The moment the student's own sketch is
             * compiled it takes the board over, and leaving a selector on
             * screen that no longer selects anything would be a control that
             * lies. It is replaced by a statement of what is actually loaded.
             */}
            {runningOwnCode ? (
              <span
                data-testid="fw-own-code"
                title="This board is running the sketch in the code panel"
                className="h-8 flex items-center px-2.5 rounded-[3px] text-xs border border-[#1477d1] bg-[#1477d1]/10 text-[#1477d1]"
              >
                Your sketch
                {sketch.flashBytes > 0 && (
                  <span className="ml-1.5 text-[#566573]">
                    {sketch.flashBytes.toLocaleString()} B
                  </span>
                )}
              </span>
            ) : (
              <>
                <span className="text-[11px] text-[#566573] shrink-0">Firmware</span>
                <div className="flex shrink-0" role="group" aria-label="Firmware">
                  {boardFirmware.map((f, i) => (
                    <button
                      key={f.url}
                      data-testid={`fw-${f.label}`}
                      onClick={() => setHexUrl(f.url)}
                      title={f.note}
                      aria-pressed={activeHexUrl === f.url}
                      className={`h-8 px-2.5 text-xs border transition-colors ${
                        i === 0 ? 'rounded-l-[3px]' : '-ml-px'
                      } ${i === boardFirmware.length - 1 ? 'rounded-r-[3px]' : ''} ${
                        activeHexUrl === f.url
                          ? 'z-10 border-[#1477d1] bg-[#1477d1]/10 text-[#1477d1]'
                          : 'border-[#dfe3e8] bg-white text-[#566573] hover:border-[#1477d1]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Compiling is seconds, not instant, so it is said out loud. */}
            {sketch.status === 'compiling' && (
              <span
                data-testid="compile-status"
                className="h-8 flex items-center gap-1.5 px-2 rounded-[3px] text-[11px] border border-[#dfe3e8] bg-white text-[#566573]"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Compiling…
              </span>
            )}
            {sketch.status === 'error' && (
              <span
                data-testid="compile-error"
                className="h-8 flex items-center px-2 rounded-[3px] text-[11px] border border-red-200 bg-red-50 text-red-700"
              >
                {sketch.error ? 'Compiler unreachable' : 'Compile error'} — see the code panel
              </span>
            )}
            {codeDirty && sketch.status !== 'compiling' && sketch.status !== 'error' && (
              <span
                data-testid="code-dirty"
                className="h-8 flex items-center px-2 rounded-[3px] text-[11px] border border-[#fde68a] bg-[#fffbeb] text-[#b45309]"
              >
                Board is running your previous code
              </span>
            )}
          </div>
        )}

        {sim.track === 'rp2040' && (
          <div className="flex items-center gap-2 shrink-0" data-testid="pico-firmware">
            <span className="text-[11px] text-[#566573]">{sim.board.label}</span>
            <span className="h-8 flex items-center px-2.5 rounded-[3px] text-xs border border-[#dfe3e8] bg-white text-[#34495e]">
              MicroPython
            </span>
            <span className="text-[11px] text-[#566573]" data-testid="repl-phase">
              {REPL_LABEL[sim.snapshot.repl]}
            </span>
            {codeDirty && (
              <span
                data-testid="code-dirty"
                className="h-8 flex items-center px-2 rounded-[3px] text-[11px] border border-[#fde68a] bg-[#fffbeb] text-[#b45309]"
              >
                Board is running your previous code
              </span>
            )}
          </div>
        )}

        {/* THE TWO PANEL SWITCHES.

            One group, outside the per-track blocks, because these are about the
            LAYOUT rather than about the board — and because the code switch used
            to be written twice, once per track, with the AVR copy nested inside
            `!noFirmwareFor` and therefore withheld from any board that happened
            to ship no prebuilt .hex.

            `Code` appears only when there is exactly one board to run; see
            `canRunCode`. `Components` is unconditional: adding parts is the one
            thing that is meaningful in every document, including the two the
            code switch refuses. */}
        <div
          className="flex items-center gap-2 shrink-0"
          role="group"
          aria-label="Panels"
          data-testid="panel-toggles"
        >
          {canRunCode && (
            <PanelToggle
              testId="code-toggle"
              label="Code"
              controls="code-panel-region"
              open={codeVisible}
              onToggle={toggleCode}
              buttonRef={codeToggleRef}
            >
              <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
            </PanelToggle>
          )}
          <PanelToggle
            testId="rail-toggle"
            label="Components"
            controls="parts-rail-region"
            open={railVisible}
            onToggle={toggleRail}
            buttonRef={railToggleRef}
          >
            <Blocks className="h-3.5 w-3.5" aria-hidden="true" />
          </PanelToggle>
        </div>

        <div className="hidden md:block w-px h-6 shrink-0 bg-[#dfe3e8]" />

        {/* No board, or two of them. There is nothing to start, so the button is
            not offered — the reason is, in its place. */}
        {sim.track === 'none' ? (
          <p
            data-testid="no-board"
            className="shrink-0 text-[11px] leading-snug text-[#566573] max-w-md"
          >
            {sim.problem}
          </p>
        ) : (
          <>
            {/* ONE run control for the circuit and the code, which is what
                Tinkercad ships and what a student expects. `runCode` is
                `start` on the AVR track and whenever the draft already matches
                the board; when it does not, it loads the draft first — and
                loading reboots MicroPython, which is why it is an explicit
                press and not a keystroke side-effect. */}
            <button
              onClick={running && !codeDirty ? stop : runCode}
              disabled={!ready}
              data-testid="run-toggle"
              className={`h-8 shrink-0 px-4 rounded-[3px] text-xs font-semibold text-white transition-colors disabled:opacity-40 ${
                running && !codeDirty ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {ready
                ? codeDirty
                  ? 'Run new code'
                  : running
                    ? 'Stop'
                    : 'Start Simulation'
                : noFirmwareFor
                  ? `No ${noFirmwareFor} firmware yet`
                  : sim.track === 'rp2040'
                    ? 'Loading MicroPython…'
                    : 'Loading firmware…'}
            </button>
            <button onClick={reset} data-testid="reset" className={BTN}>
              Reset MCU
            </button>
          </>
        )}

        <div className="flex items-center gap-3 text-[11px] text-[#566573] shrink-0 md:ml-auto md:pl-3">
          <span data-testid="speed">{speedRatio.toFixed(2)}× real time</span>
          <span data-testid="simtime">{snapshot.simSeconds.toFixed(1)} s</span>
          <span className="hidden lg:inline">
            {snapshot.solves} solves / {snapshot.cacheHits} hits
          </span>
        </div>
      </div>

      {/* Canvas + code panel + rail. Stacked on phones, side by side from md up
          — a side-by-side rail at 390px left the canvas 70px wide. */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        {/* `min-h-[30dvh]` below md is a FLOOR, not a preference: the panel and
            the parts rail beneath it are both `shrink-0`, so the canvas is the
            only child flex can take height from, and it was measured at 387×0
            on a 390 px viewport — the circuit simply absent from the page. A
            minimum means the worst case is a small circuit rather than no
            circuit. Released at md, where the three sit side by side. */}
        <div className="flex-1 relative min-w-0 min-h-[30dvh] md:min-h-0">
          <CircuitCanvas
            doc={doc}
            dispatch={dispatch}
            ledBrightness={ledBrightness}
            netOf={netOf}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        {/* The code panel DOCKS beside the circuit rather than covering it: the
            student has to be able to see the wire that `Pin(17)` refers to
            while they are writing `Pin(17)`. Width is theirs to set — a long
            line of Python and a wide breadboard both need room and only they
            know which they are working on right now.

            Below md it stacks under the canvas at a fixed height, because a
            three-column layout on a phone gives every column nothing.

            The track check is what NARROWS `sim` for `sim.board.label` below;
            `codeVisible` is the gate, and the two agree by construction — both
            are `detectBoard(doc).board !== null`. */}
        {(sim.track === 'rp2040' || sim.track === 'avr') && codeVisible && (
          <>
            <CodePanelResizer width={codeWidth} onWidth={setCodeWidth} />
            <div
              id="code-panel-region"
              /* The width lives in a custom property so it can apply from md up
                 and be ignored below it, which an inline `width` could not do —
                 on a phone the panel is full-width and stacked. */
              style={{ '--code-w': `${codeWidth}px` } as CSSProperties}
              /* 45dvh below md, not 55: with the canvas floor above it, 55dvh
                 plus a 30dvh canvas overflowed the column and clipped whatever
                 came last. 45 + 30 leaves the canvas its floor and room. */
              className="flex h-[45dvh] min-h-0 w-full shrink-0 md:h-auto md:w-[var(--code-w)]"
            >
              <CodePanel
                boardLabel={sim.board.label}
                boardId={mcuPartId}
                language={codeLanguage}
                source={draft}
                onSourceChange={editCode}
                dirty={codeDirty}
                /**
                 * "Loading" until the board has firmware — and on the AVR track
                 * a compile in flight is ALSO not-yet-loaded, because `ready`
                 * still describes the previous binary. Reporting `stopped`
                 * there would make the panel claim a settled state in the
                 * middle of the one operation that takes visible time.
                 */
                status={
                  !ready || (isAvr && sketch.status === 'compiling')
                    ? 'loading'
                    : running
                      ? 'running'
                      : 'stopped'
                }
                replLabel={
                  sim.track === 'rp2040' ? (REPL_LABEL[sim.snapshot.repl] ?? '') : ''
                }
                serial={snapshot.serial}
                canReset={starterProgram.length > 0}
                onReset={resetToStarter}
                onRun={runCode}
                onStop={stop}
                onClose={() => setCodeOpenChoice(false)}
                compile={
                  isAvr
                    ? {
                        phase: sketch.status,
                        diagnostics: sketch.diagnostics,
                        error: sketch.error,
                        flashBytes: sketch.flashBytes,
                        flashLimit: sketch.flashLimit,
                        ms: sketch.ms,
                        cached: sketch.cached,
                        hasFirmware: runningOwnCode,
                      }
                    : undefined
                }
              />
            </div>
          </>
        )}

        {/* The parts rail. Closable now, from the toolbar switch or from its own
            ✕, and it remembers which it was — a student on a laptop who wants
            the whole width for a breadboard should not have to reclaim it on
            every reload.

            `hidden` rather than an unmounted branch, unlike the code panel: the
            palette holds a search box, and unmounting would silently throw away
            what the student had typed into it every time they gave the canvas
            the width for a moment. `display: none` takes it out of the layout
            just as completely — the canvas reclaims every pixel — and out of the
            tab order and the accessibility tree with it. */}
        <aside
          ref={railRef}
          id="parts-rail-region"
          aria-label="Components and readouts"
          className={`w-full h-[45dvh] shrink-0 border-t border-[#dfe3e8] md:h-auto md:w-80 md:border-t-0 md:border-l bg-white overflow-y-auto text-sm ${
            railVisible ? '' : 'hidden'
          }`}
        >
          {/* The way out, where the code panel keeps its own. Sticky so it is
              still reachable after a scroll down a long rail. */}
          <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b border-[#dfe3e8] bg-white px-3">
            <span className={SECTION_LABEL}>Components</span>
            <button
              type="button"
              data-testid="rail-close"
              aria-label="Close the components panel"
              onClick={toggleRail}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border border-[#dfe3e8] bg-white text-[#566573] transition-colors hover:border-[#1477d1] hover:text-[#34495e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* A native experiment whose circuits.role='starter' row is missing
              (or whose load failed) lands on the empty seed board. Saying so is
              better than letting the student wonder where the parts went. */}
          {remote && restoreSource === 'none' && (
            <div
              className="px-4 py-3 bg-amber-50 text-amber-900 text-xs leading-snug"
              data-testid="no-starter"
            >
              No starter circuit is set up for this experiment yet, and you have no saved work —
              starting from an empty board.
            </div>
          )}

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

              {selectedDef.props?.map((prop) => (
                <PropControl
                  /**
                   * Keyed by PART as well as by prop, so selecting a different
                   * resistor remounts the field. The value/unit control holds
                   * the half-typed figure in its own state, and without the id
                   * in the key React would reuse the mounted instance and show
                   * the previous resistor's draft over the new one's value.
                   */
                  key={`${selectedPart.id}:${prop.key}`}
                  prop={prop}
                  /**
                   * The engine falls back to the declared default when a part
                   * carries no value for a prop, so the control shows that same
                   * default — otherwise the panel and the simulation disagree
                   * before the student has touched anything.
                   *
                   * `?? prop.options?.[0]` USED TO BE THE NEXT LINK IN THIS
                   * CHAIN and it was the bug. A resistor's options start at 0 Ω
                   * — "none (wire)" — so a resistor arriving from a saved
                   * document, an authored starter or `loadInto` without an
                   * explicit `ohms` displayed "none (wire)" while compile.ts
                   * solved it at its 220 Ω default. Inventing a value from the
                   * options list is what let the two drift; the declaration is
                   * now the only source, and parts.ts's
                   * propDeclarationProblems() shouts if a prop omits one. The
                   * trailing `?? 0` only satisfies Number() and is unreachable
                   * while that check is clean.
                   */
                  value={selectedPart.props[prop.key] ?? prop.default ?? 0}
                  onChange={(value) =>
                    dispatch({ type: 'setProp', id: selectedPart.id, key: prop.key, value })
                  }
                />
              ))}

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
                  {ex.short}
                </button>
              ))}
            </div>
          </div>

          {/* Live pins */}
          <div className="px-4 py-4 border-b border-[#dfe3e8]">
            <div className={`${SECTION_LABEL} mb-2`}>Pins driven high</div>
            {highPins.length === 0 ? (
              <p className="text-xs text-[#566573]">none</p>
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

          {/* Analog inputs. The heading names the call the STUDENT writes, and
              the range is the board's own: an Uno's analogRead() is 10-bit over
              A0–A5, a Pico's machine.ADC is 12-bit over GP26–GP28. Printing a
              Pico count under an "analogRead 0–1023" heading would misreport it
              by a factor of four. */}
          {Object.keys(snapshot.adc).length > 0 && (
            <div className="px-4 py-4 border-b border-[#dfe3e8]">
              <div className={`${SECTION_LABEL} mb-2`}>
                {sim.track === 'rp2040' ? 'ADC · 0–4095' : 'analogRead · 0–1023'}
              </div>
              <div className="grid grid-cols-3 gap-1.5" data-testid="adc">
                {Object.entries(snapshot.adc).map(([name, counts]) => (
                  <div key={name} className="text-[10px]">
                    <span className="text-[#566573]">{name}</span>{' '}
                    <span className="text-[#34495e] tabular-nums">{counts}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The Pico's program, and the two things about it a node voltage
              cannot show: how far the REPL hand-off has got, and GP25 — the
              on-board LED, which has no header pad and therefore cannot reach
              the solver or the canvas at all. A student whose first script
              blinks it must still see something happen. */}
          {sim.track === 'rp2040' && (
            <div className="px-4 py-4 border-b border-[#dfe3e8]">
              <div className={`${SECTION_LABEL} mb-2`}>MicroPython</div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-xs text-[#566573]">interpreter</span>
                <span className="text-xs text-[#34495e]" data-testid="repl-state">
                  {REPL_LABEL[sim.snapshot.repl]}
                </span>
              </div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-xs text-[#566573]">on-board LED (GP25)</span>
                <span className="text-xs text-[#34495e]" data-testid="onboard-led">
                  {sim.snapshot.onboardLed ? 'on' : 'off'}
                </span>
              </div>
              {/* The source itself lives in the code panel now, where it can be
                  edited. What stays here is the ONE fact the panel cannot tell
                  you: whether the board is running the code you can see. */}
              {codeDirty ? (
                <p className="text-xs text-[#b45309] leading-snug" data-testid="pico-script-state">
                  You have edited your program. The board is still running the previous version —
                  press <span className="font-semibold">Run new code</span> to load it.
                </p>
              ) : script ? (
                <p className="text-xs text-[#566573] leading-snug" data-testid="pico-script-state">
                  {script.split('\n').length} lines loaded on the board.{' '}
                  {codeVisible ? 'Edit it in the code panel.' : 'Press Code to edit it.'}
                </p>
              ) : (
                <p className="text-xs text-[#566573] leading-snug" data-testid="pico-no-script">
                  No program on the board — it boots to a bare REPL. Write one in the code panel.
                </p>
              )}
            </div>
          )}

          {/* Measurements */}
          <div className="px-4 py-4 border-b border-[#dfe3e8]">
            <div className={`${SECTION_LABEL} mb-2`}>Measurements</div>
            {readings.length === 0 ? (
              <p className="text-xs text-[#566573]">No components to measure yet.</p>
            ) : (
              readings.map(([partId, current]) => (
                <div key={partId} className="flex justify-between items-baseline mb-1">
                  <span className="text-xs text-[#566573]">{partId}</span>
                  <span className="text-[#34495e] tabular-nums" data-testid={`reading-${partId}`}>
                    {/* Magnitude, not signed: the sign is just which pin the student
                        wired first, which is arbitrary and confusing — a beginner reads
                        "current through r1" as a size. Math.abs also kills the -0.00 that
                        a negative zero would otherwise print. */}
                    {Math.abs(current * 1000).toFixed(2)} mA
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Reported device state. Sensors and outputs say what they are doing;
              a current in milliamps cannot tell a student that the buzzer is
              silent because it is being driven DC. */}
          {hasReporters && (
            <div className="px-4 py-4 border-b border-[#dfe3e8]">
              <div className={`${SECTION_LABEL} mb-2`}>Device state</div>
              {deviceRows.length === 0 ? (
                <p className="text-xs text-[#566573]" data-testid="device-states-empty">
                  Nothing reported yet — start the simulation.
                </p>
              ) : (
                <div className="space-y-2" data-testid="device-states">
                  {deviceRows.map((row) => (
                    <div key={row.id} data-testid={`device-${row.id}`}>
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-xs text-[#566573] truncate">
                          {row.label} <span className="text-[10px]">{row.id}</span>
                        </span>
                        <span
                          className="text-xs text-[#34495e] tabular-nums text-right shrink-0"
                          data-testid={`device-state-${row.id}`}
                        >
                          {row.headline}
                        </span>
                      </div>
                      {row.detail && (
                        <p className="text-[10px] text-[#566573] leading-snug mt-0.5">
                          {row.detail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Serial monitor. On the Pico this is the USB REPL rather than a
              UART, so it carries MicroPython's own banner and prompt as well as
              the script's output — naming it "Serial" there would be wrong. */}
          <div className="px-4 py-4 border-b border-[#dfe3e8]">
            <div className={`${SECTION_LABEL} mb-2`}>
              {sim.track === 'rp2040' ? 'REPL output' : 'Serial'}
            </div>
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
            {/* "No board" is a check, not an error: a half-built canvas with no
                MCU on it yet is the normal state of a blank board, and two boards
                is a real thing a student can draw that we honestly cannot run. */}
            {sim.track === 'none' && (
              <p className="text-xs text-amber-700 mb-2 leading-snug" data-testid="board-problem">
                {sim.problem}
              </p>
            )}
            {snapshot.solveError && (
              <p className="text-xs text-red-600 mb-2">Solver: {snapshot.solveError}</p>
            )}
            {snapshot.faults.length > 0 && (
              <ul className="space-y-2 mb-3" data-testid="faults">
                {snapshot.faults.map((f, i) => {
                  // A 'caution' part is stressed but alive; a 'destructive' one is
                  // gone. Amber vs the existing red so the two read apart at a
                  // glance — the wording already differs, this is colour only.
                  const caution = f.severity === 'caution'
                  return (
                    <li
                      key={i}
                      data-severity={f.severity}
                      className={`text-xs leading-snug border px-2.5 py-2 ${
                        caution
                          ? 'text-[#b45309] border-[#fde68a] bg-[#fffbeb]'
                          : 'text-red-800 border-red-200 bg-red-50'
                      }`}
                    >
                      <span
                        className={`font-bold uppercase text-[9px] tracking-wider block mb-0.5 ${
                          caution ? 'text-[#b45309]' : 'text-red-600'
                        }`}
                      >
                        {f.kind.replace('_', ' ')}
                      </span>
                      {f.message}
                    </li>
                  )
                })}
              </ul>
            )}
            {problems.length === 0 &&
            !snapshot.solveError &&
            snapshot.faults.length === 0 &&
            /*
             * A board — any board — has had its document compiled, either in
             * the worker or here. Only a document with NO board has been
             * checked by nothing, and that is the one case where silence must
             * not be read as a clean bill of health.
             */
            sim.track !== 'none' ? (
              <p className="text-xs text-green-700">No problems detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {problems.map((p, i) => (
                  <li key={i} className="text-xs text-amber-700 leading-snug">
                    {p}
                  </li>
                ))}
              </ul>
            )}
            {/*
             * Model simplifications are NOT problems, and must not be dressed
             * as them. They come LAST — after the verdict, not instead of it —
             * in slate rather than warning amber, and they no longer suppress
             * the all-clear (they used to be part of the condition above). A
             * circuit that works can still carry a note about which
             * second-order effect the model leaves out; reading that as a
             * defect is what a bold amber "NOT SIMULATED" made every student
             * do, and the owner read it that way too.
             */}
            {limitations.length > 0 && (
              <ul className="space-y-2 mt-3" data-testid="limitations">
                {limitations.map((l, i) => (
                  <li
                    key={i}
                    className="text-xs text-slate-600 leading-snug border border-slate-200 bg-slate-50 px-2.5 py-2"
                  >
                    <span className="font-bold uppercase text-[9px] tracking-wider text-slate-500 block mb-0.5">
                      simplified model
                    </span>
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-4 pb-6 text-[10px] text-[#566573] leading-relaxed">
            Drag from any pin to another to wire them. Click a wire to delete it. The firmware keeps
            running while you rewire — the MCU is not reset.
          </div>
        </aside>
      </div>
    </div>
  )
}
