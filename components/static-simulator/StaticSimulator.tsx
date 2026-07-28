'use client'

import React from 'react'
import { AlertTriangle, Code2, Maximize2, Minimize2, Terminal } from 'lucide-react'
import { useFullscreenToggle } from './useFullscreenToggle'
import { getPart } from '@/lib/simulator/model/parts'
import type { CircuitDoc } from '@/lib/simulator/model/document'
import { getStaticExperiment } from './experiment-map'
import type { Experiment } from './types'
import { REFERENCE_CIRCUITS } from './circuits'
import { StaticCircuit } from './StaticCircuit'
import { SyntaxCodeViewer } from './features/SyntaxCodeViewer'
import {
  CanvasCornerMark,
  CanvasStatusStrip,
  ComponentsRail,
  WorkspaceToolbar,
} from './features/WorkspaceChrome'
import { ColourPickerOverlay, type ColourSelection } from './features/ColourPickerOverlay'
import { languageForPlatform } from './utils/highlight'
import { useShowreel, useStickToBottom, type SerialLine } from './showreel/useShowreel'
import { useSensorOverride } from './showreel/useSensorOverride'
import './static-simulator.css'

/**
 * One experiment's reference circuit, mounted as a read-only workbench.
 *
 * DRAWN BY OUR OWN CANVAS. The circuit is a `CircuitDoc` from ./circuits.ts —
 * our part library, our pin ids — rendered by components/simulator/
 * CircuitCanvas with `readOnly`, which is the same component and the same
 * artwork the live editor uses. There is no second renderer here any more: the
 * ported ComponentSVGs.tsx and features/Wire.tsx are deleted, and with them the
 * risk of a part looking one way in the lab and another way in the figure.
 *
 * READ-ONLY BY CONSTRUCTION, not by configuration. `readOnly` attaches no
 * handler, exposes no focusable control and puts `pointer-events: none` on the
 * drawing; the workbench furniture around it contains no `<button>`, `<input>`
 * or handler at all. There is nothing to defeat and nothing to flip.
 *
 * IT PLAYS, BUT IT DOES NOT SIMULATE. The circuit animates, the sensors count,
 * the serial monitor scrolls and the clock runs — all of it from
 * showreel/timelines.ts, which is a hand-written script per experiment. There
 * is no interpreter behind it and no solver: nothing here computes a voltage,
 * because nothing here has one to compute. It is a moving diagram.
 *
 * That is a deliberate, narrow thing to build, and it is only defensible while
 * it stays honest about itself. So: no claim anywhere in this panel that a
 * number was measured, that hardware is attached, or that the student's own
 * code is what is running. The app's real simulator — emulated MCU, compiled
 * sketch, solved circuit — is components/simulator/ over lib/simulator/, and
 * that is what a section typed `native` renders.
 *
 * ONE CLOCK. `useShowreel` is called here, once, and everything below reads
 * from it — the circuit, the parts rail, the readout strip, the serial log and
 * the elapsed timer. The alternative — the circuit on its own timer, the log on
 * another — is how a panel ends up printing a temperature the artwork is not
 * showing.
 *
 * IT IS DRESSED AS A WORKBENCH, AND THE WORKBENCH IS ALSO A DRAWING. Around the
 * circuit sit a toolbar, a components rail, a code panel and a serial monitor,
 * laid out after Tinkercad Circuits because that is the tool these students
 * recognise. MOST of that shell is still a picture of a control — the edit
 * tools, the wire-colour swatch, the Components dropdown and the search field
 * in features/WorkspaceChrome carry no `<button>`, `<input>` or handler, and
 * every one of those clusters is `aria-hidden`.
 *
 * Four controls in this panel are genuinely real, and all four are safe by
 * what they DO rather than by being disabled:
 *   - the code viewer's Copy button
 *   - the fullscreen toggle in the document bar (useFullscreenToggle.ts)
 *   - the Code button in the toolbar, which shows or hides the panel below
 *   - the RunState Start/Stop button, which plays or pauses the SCRIPTED
 *     sequence (useShowreel's `toggleRunning`) — it does not start or stop
 *     anything real, because nothing here is real to start
 * None of the four touches the circuit's topology, its code, or which
 * experiment this is, so none of them can be mistaken for the editing
 * affordances the rest of this file is built to avoid looking like.
 *
 * The reason to build the furniture at all is that a lone animated figure in a
 * bare card reads as a video. The reason MOST of it still does not click is
 * that a student cannot edit a reference circuit, and a Delete button that
 * declines to delete teaches them the app is broken. Present and visibly
 * inert beats live-looking and dead — for the controls that stayed that way.
 *
 * NOT WIRED TO ANY BACKEND. Upstream persisted circuits into its own Supabase
 * project behind its own Supabase Auth session. None of that came across —
 * there is nothing to save, so there is nothing to sign in to, and the
 * enrolment check on the route group above is the only gate this needs.
 *
 * WHERE EACH PIECE COMES FROM, because it is no longer one place:
 *
 *   the CIRCUIT   ./circuits.ts — ours, authored against our part library.
 *   the ARTWORK   lib/simulator/model/parts.ts, via CircuitCanvas — ours.
 *   the PLAYBACK  ./showreel/timelines.ts — ours, hand-written.
 *   the LISTING   utils/experimentData.ts — THEIRS, and the one thing that is.
 *
 * That last one is worth flagging: the listing shown here is their
 * `defaultCode`, which is not necessarily byte-identical to the `code` section
 * of the same experiment in our database. If the two ever need to agree, the
 * lesson page already reads ours and can pass it in via `code`. It also decided
 * several of the circuits: where their published wiring and their published
 * sketch disagreed, the drawing follows the SKETCH, because the sketch is the
 * thing sitting on screen next to it. See circuits.ts.
 */
export function StaticSimulator({
  experimentSlug,
  title,
  code,
}: {
  experimentSlug: string | null
  title?: string
  /** Overrides the ported `defaultCode` when the caller has our own listing. */
  code?: string | null
}) {
  const experiment = getStaticExperiment(experimentSlug)
  /**
   * The drawing, in OUR document model — components/static-simulator/circuits.ts.
   *
   * Looked up by the SAME numeric id the code listing and the playback are, so
   * the three cannot be resolved to different experiments. An id with no
   * reference build falls through to the notice below, exactly as an unmapped
   * slug does: a circuit under the wrong heading is worse than no circuit.
   */
  const doc = experiment ? REFERENCE_CIRCUITS[experiment.id] : undefined

  // Called unconditionally — the early return below is after it, because a
  // hook cannot sit behind a branch.
  const showreel = useShowreel(experiment?.id)
  /**
   * Part 1's sliders/toggles. Does NOT touch `showreel`'s clock — dragging a
   * slider used to pause it, on the owner's later instruction it no longer
   * does. The override is layered onto whichever frame is CURRENTLY playing,
   * every frame, and a slider's own field is resolved to the student's value
   * or the circuit's authored default, never to the timeline's live sweep of
   * it. See showreel/useSensorOverride.ts and ./showreel/sensorOverrides.ts.
   */
  const sensorOverride = useSensorOverride(experiment?.id, showreel.frame, doc)
  const logRef = useStickToBottom(showreel.serialLines.length)
  const [fullscreenRef, fullscreen] = useFullscreenToggle<HTMLDivElement>()
  /**
   * Defaults OPEN, matching what every lesson page has shown since this
   * panel shipped — closing it is a new option, not a new default a student
   * would have to discover before seeing the code at all.
   */
  const [codeOpen, setCodeOpen] = React.useState(true)

  /**
   * Part 2's colour pickers: which placed part / wire has been given a new
   * colour, in local state only — nothing here ever writes into `doc`, which
   * stays the exact object `circuits.ts` exports. `coloredDoc` below is the
   * one clone, built fresh only when there is something to override.
   *
   * `selection` is which shape is picked on the canvas right now, lifted up
   * from ColourPickerOverlay so the toolbar's swatch control (in
   * WorkspaceChrome.tsx) can render and drive it — clicking a wire or an LED
   * no longer opens a popover on the canvas, it selects, and the real
   * colour control lives in the toolbar. See ColourPickerOverlay.tsx's file
   * header for the full reasoning.
   */
  const [partColors, setPartColors] = React.useState<Record<string, string>>({})
  const [wireColors, setWireColors] = React.useState<Record<string, string>>({})
  const [selection, setSelection] = React.useState<ColourSelection | null>(null)
  const coloredDoc = React.useMemo(() => {
    if (!doc) return doc
    if (Object.keys(partColors).length === 0 && Object.keys(wireColors).length === 0) return doc
    return {
      parts: doc.parts.map((p) => (partColors[p.id] ? { ...p, props: { ...p.props, color: partColors[p.id] } } : p)),
      wires: doc.wires.map((w) => (wireColors[w.id] ? { ...w, color: wireColors[w.id] } : w)),
    }
  }, [doc, partColors, wireColors])
  const handleClearSelection = React.useCallback(() => setSelection(null), [])
  const handlePickColour = React.useCallback(
    (value: string) => {
      if (!selection) return
      if (selection.kind === 'part') {
        setPartColors((prev) => ({ ...prev, [selection.id]: value }))
      } else {
        setWireColors((prev) => ({ ...prev, [selection.id]: value }))
      }
      setSelection(null)
    },
    [selection],
  )

  if (!experiment || !doc) {
    return (
      <div className="w-full max-w-full rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6] px-4 py-8 text-center sm:py-10">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[5px] border border-[#dfe3e8] bg-white">
          <AlertTriangle className="h-5 w-5 text-[#566573]" />
        </div>
        <p className="text-sm font-semibold text-[#34495e]">{title ?? 'Circuit diagram'}</p>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-[#566573]">
          There is no circuit drawing for this experiment yet. Please let your instructor know.
        </p>
      </div>
    )
  }

  const boardLabel = boardNameOf(doc, experiment)
  const fileName = experiment.platform === 'Arduino' ? 'sketch.ino' : 'main.py'

  return (
    // `static-sim` is the scope class every rule in static-simulator.css hangs
    // off. Without it the ported artwork loses its LED glows, motor spin and
    // the whole snitch card/code-block treatment.
    //
    // `fullscreen.ref` sits on THIS element rather than on some inner canvas
    // wrapper: the whole workbench — toolbar, rail, code, serial log — is what
    // "view bigger" means here, the same as it does in the product this panel
    // borrows its shape from. The fallback path (`data-fullscreen="fallback"`)
    // is styled in static-simulator.css rather than inline, because it also
    // has to win a specificity fight against the fixed canvas/rail heights set
    // below.
    <div
      ref={fullscreenRef}
      data-fullscreen={fullscreen.active ? 'on' : 'off'}
      className="static-sim w-full max-w-full overflow-hidden rounded-[5px] border border-[#dfe3e8] bg-white"
    >
      {/* The document bar, above the toolbar, where the product puts the design
          name. It carries the two facts a lesson page needs and the toolbar
          cannot: which experiment this is, and that it is a reference build. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[#dfe3e8] bg-white px-3 py-1.5 sm:px-4">
        <span className="truncate text-[13px] font-semibold text-[#34495e]">
          {title ?? experiment.title}
        </span>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#566573]">
            {experiment.platform} · reference circuit
          </span>
          {/*
           * THE ONE REAL BUTTON IN THIS FILE, AND DELIBERATELY SO.
           *
           * Every other control in this panel is a picture of a control —
           * see WorkspaceChrome's file header for why. This one is different
           * in kind, not degree: it does not touch the circuit, the code or
           * the playback, it only changes how much of the screen shows them.
           * "View fullscreen" cannot be mistaken for an editing affordance
           * the way a live-looking Delete button could, so it does not carry
           * the dishonesty the rest of the panel is built to avoid.
           */}
          <button
            type="button"
            onClick={fullscreen.toggle}
            aria-label={fullscreen.active ? 'Exit fullscreen' : 'View fullscreen'}
            title={fullscreen.active ? 'Exit fullscreen' : 'View fullscreen'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border border-[#dfe3e8] bg-white text-[#566573] transition-colors hover:border-[#1477d1] hover:text-[#1477d1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1477d1] focus-visible:ring-offset-1"
          >
            {fullscreen.active ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <WorkspaceToolbar
        boardLabel={boardLabel}
        isRunning={showreel.isRunning}
        hasTimeline={showreel.hasTimeline}
        clockRef={showreel.clockRef}
        initialClock={showreel.initialClock}
        onToggleRun={showreel.toggleRunning}
        codeOpen={codeOpen}
        onToggleCode={() => setCodeOpen((open) => !open)}
        selection={selection}
        onPickColour={handlePickColour}
      />

      {/* Canvas beside a SLOT from `lg` up, stacked below it below that. The
          slot holds the Components rail OR the Code-and-output panel, never
          both — exactly one at a time, toggled by the same Code button in
          the toolbar, matching where the product puts its own code editor:
          a side panel that takes the parts palette's place rather than a
          second panel bolted on beside it. A 264 px rail AND a code-width
          panel side by side, against a 390 px viewport, would leave the
          circuit itself no room at all; stacked, the canvas keeps the full
          width and whichever slot is open becomes a strip under it.

          `lg:items-start` only while the code panel is open: a 120-line
          sketch plus its serial log is taller than the canvas column, and
          stretching that column to match would leave empty white space
          under the circuit. The rail's own content is short enough that the
          default stretch (no `items-start`) is what makes it fill the row
          the way it always has. */}
      <div className={`flex flex-col lg:flex-row ${codeOpen ? 'lg:items-start' : ''}`}>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* `bg-[#f7f8f9]` is the box behind the drawing; the canvas paints its
              own near-white ground and its own dot grid over the whole of it, so
              what this actually covers is the frame before hydration. Checked
              rather than assumed after the swap: our artwork was drawn to read
              against a light canvas and it does — the dark bodies keep their
              white lettering, the near-white breadboard keeps its grey outline,
              and the grid is our editor's own #d3d8dd rather than the ported
              white-on-navy dots that had to be re-tuned. */}
          <div className="static-sim-canvas relative h-[260px] bg-[#f7f8f9] sm:h-[320px] lg:h-[380px]">
            <StaticCircuit doc={coloredDoc ?? doc} title={title ?? experiment.title} frame={sensorOverride.frame} />
            {/* Part 2's click layer — see ColourPickerOverlay.tsx's own header
                for why it is a sibling here rather than anything added inside
                StaticCircuit/CircuitCanvas. Geometry comes from the
                UNCOLOURED `doc`: a part's position never changes, so the hit
                boxes stay correct however many colours are picked. */}
            <ColourPickerOverlay
              doc={doc}
              partColors={partColors}
              wireColors={wireColors}
              selection={selection}
              onSelect={setSelection}
              onClear={handleClearSelection}
            />
            <CanvasCornerMark />
          </div>
          <CanvasStatusStrip
            frame={sensorOverride.frame}
            experimentId={experiment.id}
            controls={sensorOverride.controls}
            onSensorChange={sensorOverride.setValue}
          />
        </div>

        {/* THE SLOT. `codeOpen` picks which of the two goes here — see the
            toolbar comment above for why they are mutually exclusive rather
            than stacked. Unmounting the one that is not showing (rather than
            hiding it) is deliberate for the code side: the listing and the
            serial log are both derived straight from props/state that does
            not reset, so there is nothing lost by tearing the DOM down, and
            it is one less off-screen copy of a 120-line sketch for a phone
            to hold in memory whenever a student is looking at the rail. */}
        {codeOpen ? (
          <div className="static-sim-code flex shrink-0 flex-col border-t border-[#dfe3e8] bg-white p-3 sm:p-4 lg:w-[380px] lg:border-l lg:border-t-0 xl:w-[420px]">
            <div className="mb-2 flex items-center gap-2">
              <Code2 className="h-3.5 w-3.5 shrink-0 text-[#566573]" aria-hidden="true" />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#566573]">
                Code
              </h3>
              {/* What the listing is bound to, which is what the product's code
                  panel puts here. The FILE name is not repeated: the viewer draws
                  its own tab a few pixels below this line. */}
              <span className="truncate font-mono text-[10px] text-[#9aa3ab]">{boardLabel}</span>
            </div>

            {/* A plain block, not a flex row. `.snitch-code-block` is itself
                `display: flex`, so as a block-level child it fills this width and
                `snitch-h-full` gives it the height; as a flex ITEM it sized to its
                longest line instead and left a ragged gap down the right. */}
            <div className="h-[300px] sm:h-[340px]">
              <SyntaxCodeViewer
                code={code ?? experiment.defaultCode}
                language={languageForPlatform(experiment.platform)}
                fileName={fileName}
              />
            </div>

            {/* THE OUTPUT — the serial log — lives in this same side panel,
                under the listing it is the output OF, rather than as a
                separate full-width block. That is the one thing this panel
                is FOR: a sketch and what it printed, both in the same place
                a student can see without scrolling the circuit off screen. */}
            {showreel.hasTimeline && (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 shrink-0 text-[#566573]" aria-hidden="true" />
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#566573]">
                    Serial monitor
                  </h3>
                </div>
                <SerialLog lines={showreel.serialLines} scrollRef={logRef} />
              </div>
            )}
          </div>
        ) : (
          <ComponentsRail
            doc={coloredDoc ?? doc}
            frame={sensorOverride.frame}
            className="max-h-[300px] overflow-y-auto lg:max-h-none lg:w-[264px] lg:overflow-y-auto xl:w-[288px]"
          />
        )}
      </div>
    </div>
  )
}

/**
 * The board this circuit is built around, by its real part name.
 *
 * Read off the DRAWN DOCUMENT rather than off `platform`, because "Arduino" is
 * not a board — a code panel header claiming to be bound to an "Arduino" is the
 * kind of near-miss that stops a student trusting the rest of the label — and
 * because reading it off the document is the one source that cannot disagree
 * with what is on the canvas. `platform` remains the fallback for a circuit
 * with no MCU in it at all.
 */
function boardNameOf(doc: CircuitDoc, experiment: Experiment): string {
  const board = doc.parts.find((p) => getPart(p.type).electrical.kind === 'mcu')
  return board ? getPart(board.type).label : experiment.platform
}

/**
 * The serial log, styled to match components/simulations/shared.tsx — same
 * surface, same border, same `toLocaleTimeString` stamp — so the two kinds of
 * simulation on this app do not look like they came from different products.
 *
 * Newest at the BOTTOM, unlike that one, because this is imitating an Arduino
 * IDE monitor and that is the direction those scroll.
 *
 * `aria-live` is off. A live region that announces a canned loop forever is a
 * screen-reader trap, not an accommodation; the log stays readable on demand
 * as a `log` landmark.
 */
function SerialLog({
  lines,
  scrollRef,
}: {
  lines: SerialLine[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={scrollRef}
      className="workspace-scroll h-[148px] w-full overflow-y-auto overflow-x-hidden rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6] p-2.5 font-mono text-[11px] leading-[1.7] text-[#34495e] sm:text-[12px]"
      role="log"
      aria-live="off"
      aria-label="Serial monitor output"
    >
      {lines.length === 0 ? (
        <span className="text-[#566573]">Waiting for data…</span>
      ) : (
        lines.map((line) => (
          <div key={line.id} className="break-words">
            <span className="text-[#566573]">[{line.ts}]</span> {line.msg}
          </div>
        ))
      )}
    </div>
  )
}
