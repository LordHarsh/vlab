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
import { isSensorWarn, type SensorControlSpec } from '../showreel/sensorOverrides'
import { SensorControls } from './SensorControls'
import { LED_OPTIONS, WIRE_OPTIONS, type ColourSelection } from './colours'

/**
 * THE WORKBENCH FURNITURE AROUND THE READ-ONLY CIRCUIT.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ALMOST EVERY CONTROL IN THIS FILE IS A PICTURE OF A CONTROL.            │
 * │                                                                         │
 * │ Three are real, on the owner's explicit instruction: the Code toggle,   │
 * │ the RunState Start/Stop button, and the colour swatch that appears once │
 * │ a wire or an LED is selected on the canvas (ColourSwatchControl,        │
 * │ below). All three are safe by what they DO, not by being disabled —     │
 * │ showing or hiding a panel, playing or pausing a canned loop, and        │
 * │ recolouring a part or a wire, touch neither the circuit's topology nor  │
 * │ its code. Everything else — the edit-tool icons, the decorative wire-   │
 * │ style swatch, the Components dropdown, the search field — is still a    │
 * │ `<span>`/`<div>` with a border on it: not focusable, not tabbable, no   │
 * │ pointer cursor, `aria-hidden` so a screen reader is never walked        │
 * │ through a control that does nothing.                                   │
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

/* ── The unavailable tools ────────────────────────────────────────────────
 *
 * THEY ARE REAL BUTTONS NOW, AND THEY SAY WHY THEY CANNOT WORK.
 *
 * They used to be `<span>`s with `aria-hidden` and a `cursor-default`, on the
 * reasoning that a control which can never work should not pretend to be one.
 * The owner's judgement, looking at it, was that a row of dead grey glyphs
 * reads as FAKE rather than as honest — and that a student who presses Delete
 * deserves a sentence, not silence. Both are fair: the old version could not
 * be mistaken for working, but it also could not explain itself.
 *
 * So each one is a `<button>` that does exactly one thing — say what it would
 * have done and why it will not. That is a real answer to a real press, it is
 * reachable by keyboard, and it still cannot touch the circuit.
 */

const ICON_SLOT =
  'flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-[3px] text-[#9aa3ab] ' +
  'transition-colors hover:bg-[#f1f1f3] hover:text-[#566573] focus:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-[#1477d1] focus-visible:ring-offset-1'

/**
 * One reason, reused wherever the answer is the same: this circuit's wiring is
 * the lab sheet's, and the panel exists to show it rather than to change it.
 */
const LOCKED_REASON = 'The reference circuit is fixed — its wiring and code match the lab sheet.'

function InertTool({
  label,
  reason,
  onNotify,
  children,
  className = '',
}: {
  /** The accessible name — what this control WOULD do. */
  label: string
  reason: string
  onNotify: (message: string) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onNotify(reason)}
      className={`${ICON_SLOT} ${className}`}
    >
      {children}
    </button>
  )
}

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
  selection,
  onPickColour,
  onNotify,
  wide,
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
  /** The wire/LED selected on the canvas right now, if any. */
  selection: ColourSelection | null
  onPickColour: (value: string) => void
  /** Says why a control that cannot act did not act — see useInertToast.ts. */
  onNotify: (message: string) => void
  /**
   * Whether the PANEL has room for the decorative left cluster. Measured, not
   * a `sm:` — on a lesson page the window is wide while the panel is ~720 px,
   * so the viewport query kept the furniture and pushed the controls that
   * matter onto a second row. Furniture yields first.
   */
  wide: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[#dfe3e8] bg-white px-2 py-1.5 sm:px-3">
      {/* The tools this panel does not have. Real buttons that explain
          themselves — see InertTool above for why they stopped being
          `aria-hidden` spans. */}
      <div className={`${wide ? 'flex' : 'hidden'} items-center gap-0.5`}>
        <InertTool label="Copy" reason={LOCKED_REASON} onNotify={onNotify}>
          <Copy className="h-4 w-4" />
        </InertTool>
        <InertTool label="Paste" reason={LOCKED_REASON} onNotify={onNotify}>
          <ClipboardPaste className="h-4 w-4" />
        </InertTool>
        <InertTool
          label="Delete"
          reason="Nothing can be deleted here — the parts and wiring are the lab sheet's."
          onNotify={onNotify}
        >
          <Trash2 className="h-4 w-4" />
        </InertTool>

        <Divider />

        <InertTool
          label="Undo"
          reason="There is nothing to undo — this circuit cannot be changed."
          onNotify={onNotify}
        >
          <Undo2 className="h-4 w-4" />
        </InertTool>
        <InertTool
          label="Redo"
          reason="There is nothing to redo — this circuit cannot be changed."
          onNotify={onNotify}
        >
          <Redo2 className="h-4 w-4" />
        </InertTool>
        <InertTool
          label="Notes"
          reason="Notes are not part of the reference circuit."
          onNotify={onNotify}
        >
          <MessageSquare className="h-4 w-4" />
        </InertTool>
        <InertTool
          label="Show or hide parts"
          reason="Every part in this circuit is shown — none can be hidden."
          onNotify={onNotify}
        >
          <Eye className="h-4 w-4" />
        </InertTool>

        <Divider />
      </div>

      {/* THE COLOUR DROPDOWN, in the slot the decorative one used to occupy.
          It is the same control the product puts here and it is now the real
          one — the panel's only way to recolour a wire or an LED. Outside the
          cluster above so it survives at narrow widths, where it drops its
          label and keeps the swatch. */}
      <ColourSwatchControl
        selection={selection}
        onPick={onPickColour}
        onNotify={onNotify}
        showLabel={wide}
      />

      {/* No wire-width dropdown. Like "Send To" it named a setting this panel
          has no notion of — every lead is drawn at one gauge — so it was
          furniture whose only possible answer was "this does nothing". */}
      <span className={`${wide ? 'flex' : 'hidden'} items-center gap-0.5`}>
        <InertTool
          label="Bend wire"
          reason="Wire routing is fixed — the leads are drawn as the lab sheet runs them."
          onNotify={onNotify}
          className="hidden md:flex"
        >
          <Spline className="h-4 w-4" />
        </InertTool>
        <InertTool
          label="Flip part"
          reason="Parts cannot be moved or flipped — their pins are the lab sheet's."
          onNotify={onNotify}
          className="hidden md:flex"
        >
          <FlipHorizontal className="h-4 w-4" />
        </InertTool>
      </span>

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

        {/* No "Send To" here any more. It was the one piece of furniture that
            named a capability this app does not have at all — there is no
            board to send a sketch to — so it was the least honest thing in the
            bar and the easiest to simply not draw. */}
        <span className="hidden shrink-0 select-none font-mono text-[10px] uppercase tracking-[0.08em] text-[#566573] lg:inline">
          {boardLabel}
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

/**
 * The colour swatch and palette dropdown, for whichever wire or LED is
 * currently selected on the canvas.
 *
 * ONE CONTROL FOR BOTH KINDS, exactly as the owner asked for wires and LEDs
 * alike: it does not know or care which is selected beyond picking the right
 * palette (`LED_OPTIONS` vs `WIRE_OPTIONS`, the same lists the old floating
 * popover drew from). `selection.current` seeds which swatch reads as
 * "already chosen" in the dropdown.
 *
 * AUTO-OPENS ON A NEW SELECTION, because "click a wire and connect it with
 * the options in the toolbar" is the whole feature — a student should not
 * have to find and click a second control after the first one to see the
 * palette. Re-selecting whatever is already open does not reopen it if the
 * student closed the dropdown without picking; that only happens by picking
 * a fresh shape on the canvas, which is a new `selection.id`/`kind` pair.
 *
 * CLOSES WITHOUT CLEARING on outside-click, so dismissing the dropdown still
 * leaves the selection outline on the canvas and the swatch in the toolbar —
 * clicking the swatch button again reopens the same palette. Clicking blank
 * canvas clears the selection, and this control falls back to its empty state.
 *
 * IT IS ALWAYS PRESENT, even with nothing selected. It used to render only
 * once a wire or an LED had been picked, which meant the control a student is
 * being asked to use appeared out of nowhere AFTER they had already worked out
 * what to click. It now sits permanently where the product puts it, and
 * pressing it with nothing selected says what to select. That is the same
 * bargain the tools around it make: present, honest, and it explains itself.
 */
function ColourSwatchControl({
  selection,
  onPick,
  onNotify,
  showLabel,
}: {
  selection: ColourSelection | null
  onPick: (value: string) => void
  onNotify: (message: string) => void
  /** Drops to swatch-and-chevron when the panel is too narrow for the words. */
  showLabel: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const options = selection?.kind === 'part' ? LED_OPTIONS : WIRE_OPTIONS
  const swatch = selection
    ? (options.find((o) => o.value === selection.current)?.swatch ?? '#9aa3ab')
    : '#c7ccd1'

  const selectionKey = selection ? `${selection.kind}:${selection.id}` : null
  React.useEffect(() => {
    if (selectionKey) setOpen(true)
    else setOpen(false)
  }, [selectionKey])

  React.useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const label = selection?.label ?? 'Colour'

  return (
    <div ref={wrapRef} className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => {
          if (!selection) {
            onNotify('Click a wire or an LED on the board first, then pick its colour here.')
            return
          }
          setOpen((o) => !o)
        }}
        aria-expanded={selection ? open : undefined}
        aria-haspopup={selection ? 'true' : undefined}
        title={selection ? label : 'Wire and LED colour — select one on the board first'}
        className={`flex h-8 shrink-0 select-none items-center gap-1.5 rounded-[3px] border bg-white px-2 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] focus-visible:ring-offset-1 ${
          selection
            ? 'border-[#dfe3e8] text-[#34495e] hover:border-[#1477d1]'
            : 'border-[#e6e9ec] text-[#9aa3ab] hover:border-[#dfe3e8]'
        }`}
      >
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-[2px] border border-black/10"
          style={{ background: swatch }}
          aria-hidden="true"
        />
        {showLabel && <span>{label}</span>}
        <ChevronDown className="h-3 w-3 shrink-0 text-[#9aa3ab]" aria-hidden="true" />
      </button>

      {open && selection && (
        <div
          role="menu"
          aria-label={label}
          className="absolute left-0 top-[calc(100%+4px)] z-50 grid w-[176px] grid-cols-4 gap-1 rounded-[6px] border border-[#dfe3e8] bg-white p-2 shadow-lg"
        >
          {options.map((opt) => {
            const isCurrent = opt.value === selection.current
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                title={opt.label}
                onClick={() => {
                  onPick(opt.value)
                  setOpen(false)
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] ${
                  isCurrent ? 'border-[#1477d1]' : 'border-transparent hover:border-[#dfe3e8]'
                }`}
              >
                <span
                  className="h-5 w-5 rounded-full border border-black/10"
                  style={{ background: opt.swatch }}
                  aria-hidden="true"
                />
                <span className="sr-only">{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

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

/** The rail's width when it sits beside the canvas. Narrower than the code
 *  panel because eight thumbnails in a 3-column grid need less than a sketch. */
const RAIL_W = 264

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
  wide,
  onNotify,
}: {
  doc: CircuitDoc
  frame: ShowreelFrame
  /** Same explaining-toast the toolbar uses. */
  onNotify: (message: string) => void
  /**
   * Whether the PANEL (not the window) has room for this to sit beside the
   * canvas — see StaticSimulator.tsx's `panelLayout` and useContainerWidth.ts.
   * Stacked under the canvas it becomes a capped, scrolling strip instead of
   * a full-height column.
   */
  wide: boolean
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
      className={`workspace-scroll shrink-0 overflow-y-auto bg-white ${
        wide ? 'border-l border-[#dfe3e8]' : 'max-h-[300px] w-full border-t border-[#dfe3e8]'
      }`}
      style={wide ? { width: RAIL_W } : undefined}
    >
      {/* The rail head: category dropdown, view switch, search. None of the
          three can act, and each says so when pressed. */}
      <div className="flex items-start gap-2 border-b border-[#dfe3e8] px-3 py-2.5">
        <button
          type="button"
          onClick={() =>
            onNotify('This list is fixed — it is the parts this circuit is built from.')
          }
          className="min-w-0 flex-1 select-none rounded-[3px] border border-[#dfe3e8] px-2.5 py-1 text-left transition-colors hover:border-[#1477d1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] focus-visible:ring-offset-1"
        >
          <div className="text-[9px] uppercase leading-tight tracking-[0.08em] text-[#9aa3ab]">
            Components
          </div>
          <div className="flex items-center gap-1">
            <span className="truncate text-[12px] font-semibold text-[#34495e]">
              In this circuit
            </span>
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-[#9aa3ab]" aria-hidden="true" />
          </div>
        </button>
        <InertTool
          label="Change view"
          reason="There is one view of this list — every part in the circuit."
          onNotify={onNotify}
          className="mt-1.5 border border-[#dfe3e8]"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </InertTool>
      </div>

      {/* A search field in the product's position. Pressing it explains that
          there is nothing to search — the whole list is on screen. */}
      <div className="px-3 pb-2.5 pt-2.5">
        <button
          type="button"
          onClick={() => onNotify('Nothing to search — every part in this circuit is listed below.')}
          className="flex h-8 w-full select-none items-center gap-2 rounded-[3px] border border-[#e6e9ec] bg-[#f4f5f6] px-2.5 text-left transition-colors hover:border-[#dfe3e8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] focus-visible:ring-offset-1"
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-[#b6bdc4]" aria-hidden="true" />
          <span className="text-[12px] text-[#b6bdc4]">Search</span>
        </button>
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

/**
 * One row per sensor the current step is showing, in the artwork's own units
 * — except a field named in `skip`, which SensorControls renders instead (its
 * slider or toggle already carries the label and the live value, so a plain
 * text row beside it would be the same number said twice).
 */
function readouts(
  sensors: ShowreelSensors,
  skip: ReadonlySet<SensorControlSpec['field']>,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  if (!skip.has('temperature') && typeof sensors.temperature === 'number')
    rows.push({ label: 'Temp', value: `${sensors.temperature} °C` })
  if (!skip.has('humidity') && typeof sensors.humidity === 'number')
    rows.push({ label: 'Humidity', value: `${sensors.humidity} %RH` })
  if (!skip.has('tempProbe') && typeof sensors.tempProbe === 'number')
    rows.push({ label: 'Probe', value: `${sensors.tempProbe} °C` })
  if (!skip.has('distance') && typeof sensors.distance === 'number')
    rows.push({ label: 'Distance', value: `${sensors.distance} cm` })
  if (!skip.has('flowRate') && typeof sensors.flowRate === 'number')
    rows.push({ label: 'Flow', value: `${sensors.flowRate} L/min` })
  if (!skip.has('bpm') && typeof sensors.bpm === 'number')
    rows.push({ label: 'Pulse', value: `${sensors.bpm} bpm` })
  if (!skip.has('motion') && typeof sensors.motion === 'boolean')
    rows.push({ label: 'Motion', value: sensors.motion ? 'detected' : 'clear' })
  return rows
}

const NO_CONTROLS: readonly SensorControlSpec[] = []

/**
 * The bench's status line: the sliders/toggles (if this experiment has any)
 * on the left, the live readouts on the right.
 *
 * NO VERDICT LINE HERE, ON PURPOSE. This panel used to open with "Reference
 * build — wiring matches the lab sheet" — a fact about the drawing, and true,
 * but on the owner's instruction it is gone: this strip is where a student's
 * eye actually lands to read a number, and a sentence with nothing to do with
 * that reading was competing with it for the same line. Our own editor's
 * "No problems detected" is a real verdict, earned by compiling a netlist and
 * solving it — this panel solves nothing, so it is better off not echoing
 * that shape of claim in miniature.
 *
 * The readouts are the same numbers the artwork is displaying this instant,
 * read off the same `frame`. They are labelled as the sensors' readings, never
 * as measurements, because nothing measured them: for a field with no slider
 * they are stage direction from showreel/timelines.ts; for a field WITH one
 * they are the student's own dragged value, or the circuit's authored resting
 * value if nobody has touched it yet — never the timeline's live sweep of
 * that field, dragging or not. Same `frame`, same field, so the two can never
 * disagree. See showreel/sensorOverrides.ts's `applySensorOverrides`.
 *
 * `warn` recolours a reading red the instant it crosses the line the sketch
 * beside it draws (`showreel/sensorOverrides.ts`'s `isSensorWarn`) — true
 * whether that reading came from the script or from a slider, because the
 * comparison does not know which.
 */
export function CanvasStatusStrip({
  frame,
  experimentId,
  controls = NO_CONTROLS,
  onSensorChange,
}: {
  frame: ShowreelFrame
  /** For the one threshold check `isSensorWarn` runs. */
  experimentId?: number
  /** This experiment's sliders/toggles, if any — see showreel/sensorOverrides.ts. */
  controls?: readonly SensorControlSpec[]
  /** Applies a dragged/toggled value. Omitted renders the plain read-only strip. */
  onSensorChange?: (field: SensorControlSpec['field'], value: number | boolean) => void
}) {
  const skip = useMemo(() => new Set(controls.map((c) => c.field)), [controls])
  const rows = readouts(frame.sensors, skip)
  const warn = isSensorWarn(experimentId, frame.sensors)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[#dfe3e8] bg-white px-3 py-1.5">
      {controls.length > 0 && onSensorChange && (
        <SensorControls controls={controls} sensors={frame.sensors} warn={warn} onChange={onSensorChange} />
      )}

      {rows.length > 0 && (
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {rows.map((row) => (
            <span key={row.label} className="text-[11px] text-[#566573]">
              {row.label}{' '}
              <span className={`font-mono tabular-nums ${warn ? 'text-[#c0392b]' : 'text-[#34495e]'}`}>
                {row.value}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
