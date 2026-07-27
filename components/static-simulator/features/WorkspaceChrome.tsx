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
  Play,
  Redo2,
  Scan,
  Search,
  Spline,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  getPart,
  ledBodyFill,
  ledColour,
  type PartDefinition,
} from '@/lib/simulator/model/parts'
import type { CircuitDoc, PlacedPart } from '@/lib/simulator/model/document'
import { inertPartArt } from '@/components/simulator/inert-art'
import type { ShowreelFrame } from '../showreel/useShowreel'
import type { ShowreelSensors } from '../showreel/timelines'

/**
 * THE WORKBENCH FURNITURE AROUND THE READ-ONLY CIRCUIT.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ALMOST EVERY CONTROL IN THIS FILE IS A PICTURE OF A CONTROL.            │
 * │                                                                         │
 * │ Two are real, on the owner's explicit instruction: the Code toggle and  │
 * │ the RunState Start/Stop button, both below. Both are safe by what they  │
 * │ DO, not by being disabled — showing or hiding a panel, and playing or   │
 * │ pausing a canned loop, touch neither the circuit's topology nor its     │
 * │ code. Everything else — the edit-tool icons, the wire-colour swatch,    │
 * │ the Components dropdown, the search field — is still a `<span>`/`<div>` │
 * │ with a border on it: not focusable, not tabbable, no pointer cursor,    │
 * │ `aria-hidden` so a screen reader is never walked through a control that │
 * │ does nothing.                                                          │
 * │                                                                         │
 * │ That is not laziness about wiring the REST of it up — it is the whole   │
 * │ point. A student cannot add a part, cannot draw a wire, cannot rewire   │
 * │ this circuit's topology, so offering them a live-looking Delete or Undo │
 * │ would be a lie told in pixels. The app's real, editable workbench is    │
 * │ components/simulator/ over lib/simulator/.                             │
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
 * WHY THE EDIT TOOLS STAY GREYED EVEN WHEN THE STUDENT PRESSES STOP
 *
 * Tinkercad greys its own edit controls only WHILE A SIMULATION IS RUNNING —
 * copy, paste, delete, undo and redo all go flat and parts stop being
 * draggable while it plays, then come back the moment it stops (parity doc,
 * "Editing during simulation"). Stopping THIS panel's playback does not do
 * that: there is no topology here to edit, playing or not, so these stay
 * greyed regardless of `isRunning`. Copying the product's greyed LOOK without
 * copying the reason it greys would imply an edit mode that opens on Stop and
 * then does not; staying muted in both states is what keeps the toolbar
 * honest about what it can never do.
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
  onToggleRun,
  codeOpen,
  onToggleCode,
}: {
  boardLabel: string
  isRunning: boolean
  hasTimeline: boolean
  clockRef: React.RefObject<HTMLSpanElement | null>
  initialClock: string
  /** Absent (undefined) rather than a no-op — see RunState's own comment. */
  onToggleRun?: () => void
  codeOpen: boolean
  onToggleCode: () => void
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
        {/* The Code marker is now a real toggle — see the file header for why
            this and RunState are the two controls in this bar that stopped
            being pictures of controls. `aria-pressed` carries the state a
            screen reader would otherwise only get from the colour swap. */}
        <button
          type="button"
          onClick={onToggleCode}
          aria-pressed={codeOpen}
          title={codeOpen ? 'Hide the code panel' : 'Show the code panel'}
          className={`flex h-8 shrink-0 select-none items-center gap-1.5 rounded-[3px] border px-2.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] focus-visible:ring-offset-1 ${
            codeOpen
              ? 'border-[#c7dcf0] bg-[#1477d1]/[0.08] text-[#1477d1] hover:bg-[#1477d1]/[0.14]'
              : 'border-[#dfe3e8] bg-white text-[#566573] hover:border-[#1477d1] hover:text-[#1477d1]'
          }`}
        >
          <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
          Code
        </button>

        {hasTimeline && (
          <RunState
            isRunning={isRunning}
            clockRef={clockRef}
            initialClock={initialClock}
            onToggle={onToggleRun}
          />
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
 * Tinkercad puts `Start Simulation` / `Stop Simulation`.
 *
 * NOW A REAL TOGGLE, on the owner's explicit instruction after reviewing the
 * live product: Tinkercad's own control swaps between an outlined "▶ Start
 * Simulation" and a filled green "■ Stop Simulation", with the elapsed
 * `Simulator time: HH:MM:SS.mmm` appearing only while running. This keeps our
 * existing running-dot pill (it already reads well and was already checked
 * against the product) but makes it clickable and swaps the icon the same way.
 *
 * `onToggle` calls `useShowreel`'s `toggleRunning`, which flips a manual-pause
 * flag the showreel's own effect re-reads — see that file's comment on why a
 * click does not tear the timer down and restart it from a dependency change.
 * Pressing Stop then Start restarts the sequence from t = 0 rather than
 * resuming, which sounds like a regression until you remember what it is
 * imitating: real Tinkercad's Stop actually halts the emulated MCU, and Start
 * reboots the sketch from `setup()`. Restarting is the FAITHFUL behaviour here,
 * not a shortcut.
 *
 * `onToggle` stays optional and the fallback below stays non-interactive
 * (no button, no cursor, `aria-hidden`) for any caller that has a timeline to
 * show but nothing to drive play/pause from — the harness once needed exactly
 * this shape before it was wired up, and a control that occasionally has
 * nothing behind it is worse than one that degrades to a plain readout.
 *
 * `React.memo` with props that never change means React commits this subtree
 * once and then leaves it alone, which is what lets the showreel loop write the
 * elapsed time straight into the text node without React putting `00:00:00.000`
 * back on the next step change. If a future React does re-render it anyway the
 * clock self-heals on the following frame — the loop rewrites whenever the text
 * does not match — so this is an optimisation, not a correctness crutch.
 * `onToggle` is passed through unchanged from `useShowreel` (a `useCallback`
 * with no deps), so it never breaks that memoisation.
 */
const RunState = React.memo(function RunState({
  isRunning,
  clockRef,
  initialClock,
  onToggle,
}: {
  isRunning: boolean
  clockRef: React.RefObject<HTMLSpanElement | null>
  initialClock: string
  onToggle?: () => void
}) {
  const toneClass = isRunning
    ? 'border-[#bbe5c6] bg-[#e9f7ee] text-[#15803d]'
    : 'border-[#dfe3e8] bg-[#f4f5f6] text-[#566573]'

  const inner = (
    <>
      {onToggle ? (
        isRunning ? (
          <Square className="h-3 w-3 shrink-0 fill-current" aria-hidden="true" />
        ) : (
          <Play className="h-3 w-3 shrink-0 fill-current" aria-hidden="true" />
        )
      ) : (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            isRunning ? 'showreel-blip bg-[#16a34a]' : 'bg-[#566573]'
          }`}
          aria-hidden="true"
        />
      )}
      <span className="text-[11px] font-semibold leading-none sm:text-[12px]">
        {isRunning ? 'Simulation running' : 'Simulation paused'}
      </span>
      <span
        ref={clockRef}
        className="font-mono text-[11px] leading-none tabular-nums text-[#566573]"
      >
        {initialClock}
      </span>
    </>
  )

  if (!onToggle) {
    return (
      <span
        className={`flex h-8 shrink-0 select-none items-center gap-2 rounded-[3px] border px-2.5 sm:px-3 ${toneClass}`}
      >
        {inner}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isRunning}
      title={isRunning ? 'Stop simulation' : 'Start simulation'}
      className={`flex h-8 shrink-0 select-none items-center gap-2 rounded-[3px] border px-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 sm:px-3 ${toneClass} ${
        isRunning
          ? 'hover:bg-[#dcf3e3] focus-visible:ring-[#15803d]'
          : 'hover:border-[#1477d1] hover:text-[#1477d1] focus-visible:ring-[#1477d1]'
      }`}
    >
      {inner}
    </button>
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

/**
 * Rail ordering — board first, then the board it sits on, then what is plugged
 * into it, then the sensors, then the discretes and the supplies.
 *
 * Keyed on `electrical.kind` from OUR part library, because that is the only
 * classification our parts carry; the ported catalogue's `category` field went
 * with the rest of it. Anything unlisted sorts last, so a part added to
 * PART_LIBRARY tomorrow appears at the end rather than disappearing.
 */
const KIND_RANK: Record<string, number> = {
  mcu: 0,
  breadboard: 1,
  led: 2,
  character_lcd: 2,
  buzzer: 2,
  motor: 2,
  stepper: 2,
  h_bridge: 3,
  darlington_array: 3,
  relay_module: 3,
  sensor: 4,
  potentiometer: 5,
  variable_resistor: 5,
  button: 5,
  resistor: 6,
  diode: 6,
  reactive: 6,
  source: 7,
}

interface RailTile {
  type: string
  name: string
  count: number
  /** A real part from the circuit, so the tile draws THAT LED's colour. */
  instance: PlacedPart
  def: PartDefinition
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
 * The thumbnails are the CIRCUIT'S OWN ARTWORK — literally `def.svg` out of
 * lib/simulator/model/parts.ts, the same markup the canvas injects — rather
 * than a second set of icons. Two consequences, both wanted: nothing can be
 * drawn in the rail that is not on the board, and a tile cannot contradict the
 * board, because a red LED tile beside a canvas showing a yellow one is
 * precisely the drift this panel is not allowed to have.
 *
 * The tile is built straight from the DOCUMENT, so it lists exactly the parts
 * the canvas draws — there is no separate bill of materials to fall out of date.
 */
export function ComponentsRail({
  doc,
  frame,
  className = '',
}: {
  doc: CircuitDoc
  frame: ShowreelFrame
  className?: string
}) {
  const tiles = useMemo<RailTile[]>(() => {
    const byType = new Map<string, RailTile>()

    for (const part of doc.parts) {
      const seen = byType.get(part.type)
      if (seen) {
        seen.count += 1
        continue
      }
      const def = getPart(part.type)
      byType.set(part.type, { type: part.type, name: def.label, count: 1, instance: part, def })
    }

    return [...byType.values()].sort((a, b) => {
      const rank =
        (KIND_RANK[a.def.electrical.kind] ?? 9) - (KIND_RANK[b.def.electrical.kind] ?? 9)
      return rank !== 0 ? rank : a.name.localeCompare(b.name)
    })
  }, [doc])

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
              viewBox={`0 0 ${tile.def.width} ${tile.def.height}`}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
              className="pointer-events-none overflow-visible"
            >
              {/* The part's own markup, injected exactly as the canvas injects
                  it, with the one custom property a thumbnail is big enough to
                  show: an LED's dome fill, driven by the same `frame.leds` the
                  board's LED is drawn from — so a lamp cannot be lit here and
                  dark there. The halo is NOT drawn; at 56 x 44 it would bleed
                  over the tile's own border and read as a rendering fault. */}
              <g
                style={ledVars(tile, frame)}
                dangerouslySetInnerHTML={{ __html: inertPartArt(tile.def) }}
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

/**
 * The one per-instance custom property a rail thumbnail carries.
 *
 * Same mechanism as the canvas's: the harvested LED art is shared by every
 * instance and injected as raw markup, so its dome fill reads
 * `var(--led-body, …)` and setting that property on an ancestor is the only way
 * to reach it. Everything else the canvas parameterises — a knob's angle, a
 * button's cap, a battery pack's cell count — is left at its default here,
 * because none of it is legible in a 56 x 44 tile.
 */
function ledVars(tile: RailTile, frame: ShowreelFrame): React.CSSProperties {
  if (tile.def.electrical.kind !== 'led') return {}
  const colour = ledColour(tile.instance.props.color)
  const brightness = frame.leds.get(tile.instance.id) ?? 0
  return { '--led-body': ledBodyFill(colour, brightness) } as React.CSSProperties
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
