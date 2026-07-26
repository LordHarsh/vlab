'use client'

import React, { useMemo } from 'react'
import {
  ChevronDown,
  ClipboardPaste,
  Code2,
  Copy,
  Eye,
  FlipHorizontal,
  LayoutGrid,
  MessageSquare,
  Redo2,
  Scan,
  Search,
  Spline,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { ComponentInstance, Experiment } from '../types'
import { COMPONENT_DEFINITIONS } from '../utils/componentDefinitions'
import { ComponentSVGs } from '../ComponentSVGs'
import { normaliseCircuit } from '../StaticCircuit'
import type { ShowreelFrame } from '../showreel/useShowreel'
import type { ShowreelSensors } from '../showreel/timelines'

/**
 * THE WORKBENCH FURNITURE AROUND THE READ-ONLY CIRCUIT.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ EVERY CONTROL IN THIS FILE IS A PICTURE OF A CONTROL.                   │
 * │                                                                         │
 * │ There is not one `<button>`, `<input>`, `<select>` or `onClick` below.  │
 * │ The toolbar icons, the wire-colour swatch, the Components dropdown and  │
 * │ the search field are `<span>`s and `<div>`s with borders on them. They  │
 * │ cannot be focused, cannot be tabbed to, carry no pointer cursor, and    │
 * │ every decorative cluster is `aria-hidden` so a screen reader is never   │
 * │ walked through a toolbar that does nothing.                             │
 * │                                                                         │
 * │ That is not laziness about wiring them up — it is the whole point. The  │
 * │ panel is a reference circuit on a lesson page. A student cannot add a   │
 * │ part, cannot draw a wire and cannot stop the playback, so offering them │
 * │ a live-looking Delete or Undo would be a lie told in pixels. The app's  │
 * │ real, editable workbench is components/simulator/ over lib/simulator/.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * WHY IT LOOKS LIKE TINKERCAD CIRCUITS
 *
 * Because that is the workbench these students have already seen, and a
 * reference figure that borrows its shape is read as "a circuit running in a
 * tool" rather than as a diagram someone pasted in. The layout follows the
 * observed product — see TINKERCAD_DEVICE_PARITY.md, which catalogues that
 * editor's toolbar, rail and inspector from the live app.
 *
 * WHY EVERYTHING IS GREYED, AND WHY THAT IS ALSO ACCURATE
 *
 * Tinkercad greys its edit controls WHILE A SIMULATION IS RUNNING — copy,
 * paste, delete, undo and redo all go flat and parts stop being draggable
 * (parity doc, "Editing during simulation"). This panel is permanently
 * running, so it is permanently in that state. The muted toolbar is not a
 * broken toolbar; it is the correct rendering of a workbench mid-run.
 *
 * ONE CLOCK. Nothing here holds a timer. The parts rail is handed the same
 * `frame` the canvas is drawing, so a thumbnail LED lights on the same step
 * as the LED on the board and the readout strip cannot print a temperature
 * the artwork is not showing. See showreel/useShowreel.ts.
 */

/* ── Shared inert chrome ──────────────────────────────────────────────────
 *
 * `cursor-default` and `select-none` are load-bearing, not tidiness: without
 * them a bordered box the size of a button gets a text caret on hover, which
 * is the one hover state that reads as "this is dead" rather than "this is
 * clickable". Muted foreground on the app's own greys.
 */

const ICON_SLOT =
  'flex h-7 w-7 shrink-0 cursor-default select-none items-center justify-center rounded-[3px] text-[#9aa3ab]'

const CHIP =
  'flex h-8 shrink-0 cursor-default select-none items-center gap-1.5 rounded-[3px] ' +
  'border border-[#dfe3e8] bg-white px-2.5 text-[11px] font-medium text-[#9aa3ab]'

function Divider() {
  return <span className="mx-0.5 hidden h-5 w-px shrink-0 bg-[#dfe3e8] sm:block" />
}

/* ── The top toolbar ──────────────────────────────────────────────────── */

/**
 * The strip across the top: edit tools left, run state right.
 *
 * The left cluster hides below `sm`. It carries no information at all — it is
 * furniture — and on a 390 px phone the space it would take belongs to the
 * circuit. The run state and the code marker stay at every width because those
 * two do say something true.
 */
export function WorkspaceToolbar({
  boardLabel,
  isRunning,
  hasTimeline,
  clockRef,
  initialClock,
}: {
  boardLabel: string
  isRunning: boolean
  hasTimeline: boolean
  clockRef: React.RefObject<HTMLSpanElement | null>
  initialClock: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[#dfe3e8] bg-white px-2 py-1.5 sm:px-3">
      {/* Edit tools. Decoration, and announced as such — `aria-hidden` keeps a
          screen reader out of eleven controls that do nothing. */}
      <div className="hidden items-center gap-0.5 sm:flex" aria-hidden="true">
        <span className={ICON_SLOT}>
          <Copy className="h-4 w-4" />
        </span>
        <span className={ICON_SLOT}>
          <ClipboardPaste className="h-4 w-4" />
        </span>
        <span className={ICON_SLOT}>
          <Trash2 className="h-4 w-4" />
        </span>

        <Divider />

        <span className={ICON_SLOT}>
          <Undo2 className="h-4 w-4" />
        </span>
        <span className={ICON_SLOT}>
          <Redo2 className="h-4 w-4" />
        </span>
        <span className={ICON_SLOT}>
          <MessageSquare className="h-4 w-4" />
        </span>
        <span className={ICON_SLOT}>
          <Eye className="h-4 w-4" />
        </span>

        <Divider />

        {/* Wire colour swatch and wire-routing style, the two dropdowns that sit
            here in the product. Drawn flat rather than as `<select>`s: a real
            select is focusable and openable however little it changes. */}
        <span className="ml-0.5 hidden h-7 shrink-0 cursor-default select-none items-center gap-1 rounded-[3px] border border-[#dfe3e8] px-1.5 md:flex">
          <span className="h-3.5 w-3.5 rounded-[2px] bg-[#4caf50]" />
          <ChevronDown className="h-3 w-3 text-[#9aa3ab]" />
        </span>
        <span className="hidden h-7 shrink-0 cursor-default select-none items-center gap-1 rounded-[3px] border border-[#dfe3e8] px-1.5 md:flex">
          <span className="h-[3px] w-5 rounded-full bg-[#9aa3ab]" />
          <ChevronDown className="h-3 w-3 text-[#9aa3ab]" />
        </span>

        <Divider />

        <span className={`${ICON_SLOT} hidden md:flex`}>
          <Spline className="h-4 w-4" />
        </span>
        <span className={`${ICON_SLOT} hidden md:flex`}>
          <FlipHorizontal className="h-4 w-4" />
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        {/* The code marker. Shown in its ON state because the code panel below
            really is open — it reports the layout rather than offering to
            change it. */}
        <span
          aria-hidden="true"
          className="flex h-8 shrink-0 cursor-default select-none items-center gap-1.5 rounded-[3px] border border-[#c7dcf0] bg-[#1477d1]/[0.08] px-2.5 text-[11px] font-medium text-[#1477d1]"
        >
          <Code2 className="h-3.5 w-3.5" />
          Code
        </span>

        {hasTimeline && (
          <RunState isRunning={isRunning} clockRef={clockRef} initialClock={initialClock} />
        )}

        <span className="hidden shrink-0 select-none font-mono text-[10px] uppercase tracking-[0.08em] text-[#566573] lg:inline">
          {boardLabel}
        </span>

        <span aria-hidden="true" className={`${CHIP} hidden sm:flex`}>
          Send To
        </span>
      </div>
    </div>
  )
}

/**
 * The run state and the simulator clock — the visual anchor of the bar, where
 * Tinkercad puts `Start Simulation`.
 *
 * IT IS NOT A BUTTON, and it does not say "Start". A green Start button on a
 * panel that is already playing invites exactly one click and then teaches the
 * student that this thing is broken. What sits here instead is the state that
 * button would be reporting: running, with the elapsed simulator time beside
 * it in the product's own `HH:MM:SS.mmm`.
 *
 * `React.memo` with props that never change means React commits this subtree
 * once and then leaves it alone, which is what lets the showreel loop write the
 * elapsed time straight into the text node without React putting `00:00:00.000`
 * back on the next step change. If a future React does re-render it anyway the
 * clock self-heals on the following frame — the loop rewrites whenever the text
 * does not match — so this is an optimisation, not a correctness crutch.
 */
const RunState = React.memo(function RunState({
  isRunning,
  clockRef,
  initialClock,
}: {
  isRunning: boolean
  clockRef: React.RefObject<HTMLSpanElement | null>
  initialClock: string
}) {
  return (
    <span
      className={`flex h-8 shrink-0 select-none items-center gap-2 rounded-[3px] border px-2.5 sm:px-3 ${
        isRunning
          ? 'border-[#bbe5c6] bg-[#e9f7ee] text-[#15803d]'
          : 'border-[#dfe3e8] bg-[#f4f5f6] text-[#566573]'
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          isRunning ? 'showreel-blip bg-[#16a34a]' : 'bg-[#566573]'
        }`}
        aria-hidden="true"
      />
      <span className="text-[11px] font-semibold leading-none sm:text-[12px]">
        {isRunning ? 'Simulation running' : 'Simulation paused'}
      </span>
      <span
        ref={clockRef}
        className="font-mono text-[11px] leading-none tabular-nums text-[#566573]"
      >
        {initialClock}
      </span>
    </span>
  )
})

/* ── The canvas corner control ────────────────────────────────────────── */

/**
 * Tinkercad's zoom-to-fit button, floating at the canvas's top-left.
 *
 * Ours is genuinely nothing to click: the drawing is already zoomed to fit —
 * StaticCircuit derives its viewBox from the circuit's own bounding box every
 * render, so "fit" is the only state this canvas has. The glyph marks the
 * corner the way the product does and says so in a title.
 */
export function CanvasCornerMark() {
  return (
    <span
      aria-hidden="true"
      title="The drawing is always zoomed to fit"
      className="pointer-events-none absolute left-2.5 top-2.5 flex h-7 w-7 select-none items-center justify-center rounded-[3px] border border-[#dfe3e8] bg-white/90 text-[#9aa3ab]"
    >
      <Scan className="h-3.5 w-3.5" />
    </span>
  )
}

/* ── The components rail ──────────────────────────────────────────────── */

/** Rail ordering — boards first, then the board they sit on, then the rest. */
const CATEGORY_RANK: Record<string, number> = {
  controllers: 0,
  prototyping: 1,
  outputs: 2,
  sensors: 3,
  passive: 4,
  other: 5,
}

interface RailTile {
  type: string
  name: string
  count: number
  /** A real instance from the circuit, so the tile draws that LED's colour. */
  instance: ComponentInstance
  width: number
  height: number
}

/**
 * The parts rail.
 *
 * SAME SHAPE AS TINKERCAD'S PALETTE, DIFFERENT CONTENTS, AND IT SAYS SO. A
 * palette lists what you MAY ADD; this lists what this circuit ALREADY HAS,
 * with a multiplier when there is more than one. The heading reads "In this
 * circuit" rather than "Basic" for exactly that reason — the shape is borrowed,
 * the claim is not.
 *
 * Nothing is `draggable`. Upstream's palette placed parts by drag, and a tile
 * that lifts under the pointer and then refuses to land is worse than one that
 * never moves.
 *
 * The thumbnails are the CIRCUIT'S OWN ARTWORK — the same ComponentSVGs the
 * canvas draws, handed the same `frame` — rather than a second set of icons.
 * Two consequences, both wanted: nothing can be drawn in the rail that is not
 * on the board, and a tile cannot contradict the board, because a DHT11 tile
 * showing a hard-coded 24 °C beside a canvas reading 30 °C is precisely the
 * drift this panel is not allowed to have.
 */
export function ComponentsRail({
  experiment,
  frame,
  className = '',
}: {
  experiment: Experiment
  frame: ShowreelFrame
  className?: string
}) {
  const tiles = useMemo<RailTile[]>(() => {
    const { components } = normaliseCircuit(experiment)
    const byType = new Map<string, RailTile>()

    for (const comp of components) {
      const meta = COMPONENT_DEFINITIONS[comp.type]
      if (!meta) continue
      const seen = byType.get(comp.type)
      if (seen) {
        seen.count += 1
        continue
      }
      byType.set(comp.type, {
        type: comp.type,
        name: meta.name,
        count: 1,
        instance: comp,
        width: meta.width,
        height: meta.height,
      })
    }

    return [...byType.values()].sort((a, b) => {
      const rank =
        (CATEGORY_RANK[COMPONENT_DEFINITIONS[a.type]?.category ?? 'other'] ?? 5) -
        (CATEGORY_RANK[COMPONENT_DEFINITIONS[b.type]?.category ?? 'other'] ?? 5)
      return rank !== 0 ? rank : a.name.localeCompare(b.name)
    })
  }, [experiment])

  return (
    <aside
      aria-label="Components in this circuit"
      className={`workspace-scroll shrink-0 border-t border-[#dfe3e8] bg-white lg:border-l lg:border-t-0 ${className}`}
    >
      {/* The rail head: category dropdown, view switch, search. All three are
          drawn, none are wired. */}
      <div className="flex items-start gap-2 border-b border-[#dfe3e8] px-3 py-2.5">
        <div className="min-w-0 flex-1 cursor-default select-none rounded-[3px] border border-[#dfe3e8] px-2.5 py-1">
          <div className="text-[9px] uppercase leading-tight tracking-[0.08em] text-[#9aa3ab]">
            Components
          </div>
          <div className="flex items-center gap-1">
            <span className="truncate text-[12px] font-semibold text-[#34495e]">
              In this circuit
            </span>
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-[#9aa3ab]" aria-hidden="true" />
          </div>
        </div>
        <span aria-hidden="true" className={`${ICON_SLOT} mt-1.5 border border-[#dfe3e8]`}>
          <LayoutGrid className="h-3.5 w-3.5" />
        </span>
      </div>

      {/* A search field in the product's position, drawn in its disabled state:
          grey field, grey glyph, no caret, no focus ring, out of the tab order
          and out of the accessibility tree. There is nothing to search — the
          whole list is eight tiles and all of them are visible. */}
      <div className="px-3 pb-2.5 pt-2.5" aria-hidden="true">
        <div className="flex h-8 cursor-default select-none items-center gap-2 rounded-[3px] border border-[#e6e9ec] bg-[#f4f5f6] px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-[#b6bdc4]" />
          <span className="text-[12px] text-[#b6bdc4]">Search</span>
        </div>
      </div>

      <ul className="grid grid-cols-3 gap-2 px-3 pb-3">
        {tiles.map((tile) => (
          <li
            key={tile.type}
            /* `bg-[#f7f8f9]` rather than the product's white, for one measured
               reason: the breadboard's artwork is itself near-white and its
               thumbnail is too small to show the tie-point holes that give it
               texture on the canvas, so on a white tile it vanished into one. */
            className="relative flex h-[94px] select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-[4px] border border-[#e6e9ec] bg-[#f7f8f9] px-1"
          >
            <svg
              width={56}
              height={44}
              viewBox={`0 0 ${tile.width} ${tile.height}`}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
              className="pointer-events-none overflow-visible"
            >
              <ComponentSVGs
                instance={tile.instance}
                viewMode="breadboard"
                isPinActive={(pinId) => frame.isPinHigh(tile.instance.id, pinId)}
                getPinVoltage={(pinId) => frame.pinVoltage(tile.instance.id, pinId)}
                sensorValues={frame.sensors}
                rawPinStates={frame.rawPinStates}
              />
            </svg>
            {/* Clamped, as the product clamps ("Potentiomet…"). "DHT11
                Temp/Humidity Sensor" is four lines at this width and pushed
                itself out of the tile. */}
            <span
              title={tile.name}
              className="line-clamp-2 w-full text-center text-[10px] leading-tight text-[#34495e]"
            >
              {tile.name}
            </span>
            {tile.count > 1 && (
              <span className="absolute right-1 top-1 rounded-[2px] bg-[#f1f1f3] px-1 font-mono text-[9px] leading-[14px] text-[#566573]">
                ×{tile.count}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="px-3 pb-4 text-[10px] leading-relaxed text-[#566573]">
        A reference circuit. Parts cannot be added, moved or removed here — build and rewire it in
        the lab simulator.
      </p>
    </aside>
  )
}

/* ── The status strip under the canvas ────────────────────────────────── */

/** One row per sensor the current step is showing, in the artwork's own units. */
function readouts(sensors: ShowreelSensors): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  if (typeof sensors.temperature === 'number')
    rows.push({ label: 'Temp', value: `${sensors.temperature} °C` })
  if (typeof sensors.humidity === 'number')
    rows.push({ label: 'Humidity', value: `${sensors.humidity} %RH` })
  if (typeof sensors.tempProbe === 'number')
    rows.push({ label: 'Probe', value: `${sensors.tempProbe} °C` })
  if (typeof sensors.distance === 'number')
    rows.push({ label: 'Distance', value: `${sensors.distance} cm` })
  if (typeof sensors.flowRate === 'number')
    rows.push({ label: 'Flow', value: `${sensors.flowRate} L/min` })
  if (typeof sensors.bpm === 'number') rows.push({ label: 'Pulse', value: `${sensors.bpm} bpm` })
  if (typeof sensors.motion === 'boolean')
    rows.push({ label: 'Motion', value: sensors.motion ? 'detected' : 'clear' })
  return rows
}

/**
 * The bench's status line: a verdict on the left, the live readouts on the
 * right.
 *
 * WHAT THE VERDICT MEANS HERE. Our own editor earns "No problems detected" by
 * compiling a netlist and solving it. This panel solves nothing, so it claims
 * nothing of the sort — it reports that the circuit is the published reference
 * build, which is a fact about the drawing and is true.
 *
 * The readouts are the same numbers the artwork is displaying this instant,
 * read off the same `frame`. They are labelled as the sensors' readings, never
 * as measurements, because nothing measured them: they are stage direction from
 * showreel/timelines.ts.
 */
export function CanvasStatusStrip({ frame }: { frame: ShowreelFrame }) {
  const rows = readouts(frame.sensors)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#dfe3e8] bg-white px-3 py-1.5">
      <span className="flex items-center gap-1.5 text-[11px] text-[#15803d]">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#16a34a]" aria-hidden="true" />
        Reference build — wiring matches the lab sheet
      </span>

      {rows.length > 0 && (
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {rows.map((row) => (
            <span key={row.label} className="text-[11px] text-[#566573]">
              {row.label}{' '}
              <span className="font-mono tabular-nums text-[#34495e]">{row.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
