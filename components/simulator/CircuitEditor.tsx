'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Code2, Minimize2 } from 'lucide-react'
import { CircuitCanvas } from './CircuitCanvas'
import { CodePanel, CodePanelResizer, useCodeWidth } from './CodePanel'
import { useFullscreenGate } from './FullscreenGate'
import { detectBoard } from '@/lib/simulator/model/boards'
import { EMPTY_CODE, readCodeFile, writeCodeFile } from '@/lib/simulator/model/code'
import { compile } from '@/lib/simulator/model/compile'
import {
  PALETTE,
  PART_LIBRARY,
  formatValueUnit,
  getPart,
  parseValueUnit,
  splitValueUnit,
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

const FIRMWARE = [
  { url: '/sim/blink.hex', label: 'Blink', note: 'D13 on/off, 1 s' },
  { url: '/sim/dht11.hex', label: 'DHT11', note: 'Experiment 01 sketch' },
  { url: '/sim/pot.hex', label: 'Pot', note: 'analogRead(A0) → PWM on D9' },
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
      <div className={`${SECTION_LABEL} mb-2`}>Components</div>

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

  // A part whose model reports a shape this panel has never seen still gets its
  // numbers shown, rather than an empty row that looks like a broken sensor.
  const pairs = Object.entries(s).map(
    ([k, v]) => `${k} ${typeof v === 'number' ? Number(v.toFixed(2)) : String(v)}`,
  )
  return { headline: pairs.length > 0 ? pairs.join(' · ') : 'no reading' }
}

/** Part kinds that publish reported state into the snapshot. */
const REPORTS_STATE = new Set(['buzzer', 'motor', 'sensor', 'stepper', 'relay_module'])

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
}: {
  initial?: CircuitDoc
  /** Omitted in the dev harness, where there is no class or simulation. */
  remote?: RemoteTarget
  /**
   * Which experiment this editor is opened for, so a PICO document can be given
   * the MicroPython the lab sheet asks the student to run.
   *
   * The two tracks get their program in genuinely different ways and this is
   * where that shows up in the UI. The AVR track has a compile step, so the
   * editor picks a prebuilt .hex; the Pico track has none — one MicroPython image
   * serves every experiment and the student's .py is typed into the emulated USB
   * REPL at runtime.
   *
   * The slug is now only the STARTING point and the reset target: the student
   * edits their own copy in the code panel and it is autosaved into
   * sim_attempts.code, so a returning student gets their program back, not the
   * authored one. A slug with no Pico script lands at an empty editor and a bare
   * REPL rather than guessing at one.
   */
  experimentSlug?: string
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
   * The experiment's AUTHORED MicroPython — the thing "Reset to starter" goes
   * back to, and what a student who has never opened this experiment starts on.
   *
   * Empty string, not undefined, for everything else: the worker reads an empty
   * script as "no program — sit at the REPL", which is the honest state for a
   * Pico circuit nobody has written code for yet.
   */
  const starterScript = (experimentSlug && PICO_EXPERIMENTS[experimentSlug]?.script) || ''

  /** Draft vs loaded — see codeReducer above, which is where the rule is stated. */
  const [code, codeDispatch] = useReducer(codeReducer, starterScript, (s) => ({
    draft: s,
    loaded: s,
  }))
  const draft = code.draft
  const script = code.loaded
  const [codeOpen, setCodeOpen] = useState(true)

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
   * The Pico track interprets MicroPython, so its source is editable and worth
   * storing. The AVR track does NOT: there is no avr-gcc in the browser, only
   * three prebuilt .hex fixtures, so an editable C++ box would be a lie and
   * there is nothing to persist. That asymmetry is why this is a track check
   * and not a generic "has a board" check.
   */
  const isPico = useMemo(() => detectBoard(doc).board?.track === 'rp2040', [doc])

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
   * `undefined` — not an empty bundle — for a document with no Pico, so that
   * saving an Arduino circuit cannot blank the MicroPython stored against the
   * same attempt row. See saveAttempt(): an absent key is left alone by the
   * upsert; a present empty one would overwrite.
   */
  const codeBundle = useMemo(
    () => (isPico ? writeCodeFile(EMPTY_CODE, draft) : undefined),
    [isPico, draft],
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
    const saved = readCodeFile(restoredCode)
    if (saved !== null) codeDispatch({ type: 'restore', source: saved })
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
   * An Arduino Mega gets NO firmware, deliberately, and therefore never starts.
   *
   * The emulated ATmega2560 is complete — vectors, timers, USART0, the 16-channel
   * ADC and all eleven ports, all pinned against the datasheet in
   * lib/simulator/__tests__/mega.test.ts. What does not exist is a Mega .hex:
   * every image in public/sim/ was compiled for an ATmega328P, and there is no
   * avr-gcc here to build another. Handing one of those to a Mega would not
   * error — it would run, move whichever pads the 328P's register addresses
   * happen to name on this part, and present the result as the student's sketch.
   * Passing an empty url is what stops the worker fetching one at all, so the
   * circuit still compiles, solves and reports, and nothing pretends to execute.
   */
  const noFirmwareFor = useMemo(() => {
    const board = detectBoard(doc).board
    return board?.track === 'avr' && board.type === 'arduino_mega' ? board.label : null
  }, [doc])

  const sim = useBoardSimulator(doc, { hexUrl: noFirmwareFor ? '' : hexUrl, script })
  const { ready, running, error, speedRatio, start, stop, reset } = sim
  const snapshot: SharedSnapshot = sim.snapshot ?? NO_SNAPSHOT

  /* ── Running the student's code ──────────────────────────────────────── */

  /**
   * Whether the board is running something older than what is on screen.
   *
   * Shown in two places (the toolbar and the panel) because a student who has
   * edited and not run must not be left wondering why the output has not
   * changed. It is never true on the AVR track — there is no editable source
   * there for a draft to diverge from.
   */
  const codeDirty = isPico && draft !== script

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
    start()
  }, [draft, isPico, script, start])

  const editCode = useCallback((source: string) => codeDispatch({ type: 'edit', source }), [])

  /** Back to the authored script. Loads the editor only — Run still has to be pressed. */
  const resetToStarter = useCallback(
    () => codeDispatch({ type: 'edit', source: starterScript }),
    [starterScript],
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
          THE MEGA HAS NO FIRMWARE YET, and says so rather than offering an
          Uno's.

          Every .hex in public/sim/ was compiled for an ATmega328P. Loaded into
          an ATmega2560 it does not fail — the image parses, the CPU runs it,
          and the pins it moves are whatever the 328P's register addresses
          happen to be on this part. That is the silent-wrong-answer failure
          SIMULATOR_ARCHITECTURE.md §2.3 forbids, so the picker is replaced by a
          statement of fact. The emulated chip itself is complete and tested
          (lib/simulator/__tests__/mega.test.ts); what is missing is a
          toolchain, which is its own piece of work.
        */}
        {sim.track === 'avr' && sim.board.type === 'arduino_mega' && (
          <div className="flex items-center gap-2 shrink-0" data-testid="mega-firmware">
            <span className="text-[11px] text-[#566573]">{sim.board.label}</span>
            <span className="h-8 flex items-center px-2.5 rounded-[3px] text-xs border border-amber-300 bg-amber-50 text-amber-900">
              No Mega firmware yet — the circuit solves, but nothing runs
            </span>
          </div>
        )}

        {sim.track === 'avr' && sim.board.type !== 'arduino_mega' && (
          <>
            <span className="text-[11px] text-[#566573] shrink-0">Firmware</span>
            <div className="flex shrink-0" role="group" aria-label="Firmware">
              {FIRMWARE.map((f, i) => (
                <button
                  key={f.url}
                  data-testid={`fw-${f.label}`}
                  onClick={() => setHexUrl(f.url)}
                  title={f.note}
                  aria-pressed={hexUrl === f.url}
                  className={`h-8 px-2.5 text-xs border transition-colors ${
                    i === 0 ? 'rounded-l-[3px]' : '-ml-px'
                  } ${i === FIRMWARE.length - 1 ? 'rounded-r-[3px]' : ''} ${
                    hexUrl === f.url
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

        {sim.track === 'rp2040' && (
          <div className="flex items-center gap-2 shrink-0" data-testid="pico-firmware">
            <span className="text-[11px] text-[#566573]">{sim.board.label}</span>
            <span className="h-8 flex items-center px-2.5 rounded-[3px] text-xs border border-[#dfe3e8] bg-white text-[#34495e]">
              MicroPython
            </span>
            {/* Opens the docked editor, exactly as Tinkercad's `Code` does. Only
                on this track: there is no in-browser avr-gcc, so an equivalent
                button over an Arduino would open an editor whose contents could
                never be compiled or run. */}
            <button
              type="button"
              data-testid="code-toggle"
              onClick={() => setCodeOpen((v) => !v)}
              aria-expanded={codeOpen}
              aria-controls="code-panel-region"
              className={`h-8 shrink-0 inline-flex items-center gap-1.5 px-2.5 rounded-[3px] text-xs border transition-colors ${
                codeOpen
                  ? 'border-[#1477d1] bg-[#1477d1]/10 text-[#1477d1]'
                  : 'border-[#dfe3e8] bg-white text-[#34495e] hover:border-[#1477d1]'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
              Code
            </button>
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

        {/* The code panel DOCKS beside the circuit rather than covering it: the
            student has to be able to see the wire that `Pin(17)` refers to
            while they are writing `Pin(17)`. Width is theirs to set — a long
            line of Python and a wide breadboard both need room and only they
            know which they are working on right now.

            Below md it stacks under the canvas at a fixed height, because a
            three-column layout on a phone gives every column nothing. */}
        {sim.track === 'rp2040' && codeOpen && (
          <>
            <CodePanelResizer width={codeWidth} onWidth={setCodeWidth} />
            <div
              id="code-panel-region"
              /* The width lives in a custom property so it can apply from md up
                 and be ignored below it, which an inline `width` could not do —
                 on a phone the panel is full-width and stacked. */
              style={{ '--code-w': `${codeWidth}px` } as CSSProperties}
              className="flex h-[55dvh] min-h-0 w-full shrink-0 md:h-auto md:w-[var(--code-w)]"
            >
              <CodePanel
                boardLabel={sim.board.label}
                boardId={mcuPartId}
                source={draft}
                onSourceChange={editCode}
                dirty={codeDirty}
                status={!ready ? 'loading' : running ? 'running' : 'stopped'}
                replLabel={REPL_LABEL[sim.snapshot.repl] ?? ''}
                serial={snapshot.serial}
                canReset={starterScript.length > 0}
                onReset={resetToStarter}
                onRun={runCode}
                onStop={stop}
                onClose={() => setCodeOpen(false)}
              />
            </div>
          </>
        )}

        <aside className="w-full h-[45dvh] shrink-0 border-t border-[#dfe3e8] md:h-auto md:w-80 md:border-t-0 md:border-l bg-white overflow-y-auto text-sm">
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
                  {codeOpen ? 'Edit it in the code panel.' : 'Press Code to edit it.'}
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
            {limitations.length > 0 && (
              <ul className="space-y-2 mb-3" data-testid="limitations">
                {limitations.map((l, i) => (
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
            limitations.length === 0 &&
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
