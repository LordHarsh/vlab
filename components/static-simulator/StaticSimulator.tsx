'use client'

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { getStaticExperiment } from './experiment-map'
import { StaticCircuit } from './StaticCircuit'
import { SyntaxCodeViewer } from './features/SyntaxCodeViewer'
import { languageForPlatform } from './utils/highlight'
import { useShowreel, useStickToBottom, type SerialLine } from './showreel/useShowreel'
import './static-simulator.css'

/**
 * The colleague's simulator, ported and mounted for one experiment.
 *
 * READ-ONLY BY CONSTRUCTION, not by configuration. There is no `editable` prop
 * to get flipped, no disabled state to defeat and no event handlers on the
 * circuit at all: the ported editor (drag, wire drawing, the parts palette,
 * Monaco, the run/step controls, the interpreter) was left out of the port
 * rather than switched off. What is here is a drawing and a listing.
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
 * from it. The alternative — the circuit on its own timer, the log on another
 * — is how a panel ends up printing a temperature the artwork is not showing.
 *
 * NOT WIRED TO ANY BACKEND. Upstream persisted circuits into its own Supabase
 * project behind its own Supabase Auth session. None of that came across —
 * there is nothing to save, so there is nothing to sign in to, and the
 * enrolment check on the route group above is the only gate this needs.
 *
 * Everything on screen comes from components/static-simulator/utils/
 * experimentData.ts, which ships with the port. That is deliberate for the
 * circuit — it is their drawing of their twelve circuits — and worth flagging
 * for the code: the listing shown here is THEIR `defaultCode`, which is not
 * necessarily byte-identical to the `code` section of the same experiment in
 * our database. If the two ever need to agree, the lesson page already reads
 * ours and can pass it in via `code`.
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

  // Called unconditionally — the early return below is after it, because a
  // hook cannot sit behind a branch.
  const showreel = useShowreel(experiment?.id)
  const logRef = useStickToBottom(showreel.serialLines.length)

  if (!experiment) {
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

  return (
    // `static-sim` is the scope class every rule in static-simulator.css hangs
    // off. Without it the ported artwork loses its LED glows, motor spin and
    // the whole snitch card/code-block treatment.
    <div className="static-sim w-full max-w-full overflow-hidden rounded-[5px] border border-[#dfe3e8] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dfe3e8] bg-white px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-sm font-semibold text-[#34495e]">
            {title ?? experiment.title}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showreel.hasTimeline && (
            <RunState
              isRunning={showreel.isRunning}
              clockRef={showreel.clockRef}
              initialClock={showreel.initialClock}
            />
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#566573]">
            {experiment.platform} · reference circuit
          </span>
        </div>
      </div>

      <div className="space-y-4 p-3 sm:p-4">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#566573]">
            Circuit
          </h3>
          <div className="overflow-hidden rounded-[5px] border border-[#dfe3e8]">
            <StaticCircuit experiment={experiment} frame={showreel.frame} />
          </div>
        </section>

        {showreel.hasTimeline && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#566573]">
              Serial monitor
            </h3>
            <SerialLog lines={showreel.serialLines} scrollRef={logRef} />
          </section>
        )}

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#566573]">
            Code
          </h3>
          <SyntaxCodeViewer
            code={code ?? experiment.defaultCode}
            language={languageForPlatform(experiment.platform)}
            fileName={experiment.platform === 'Arduino' ? 'sketch.ino' : 'main.py'}
          />
        </section>
      </div>
    </div>
  )
}

/* ── The chrome ───────────────────────────────────────────────────────────
 *
 * Both pieces below are display only. There is no start button, no stop
 * button and no speed control, and that is on purpose: a control implies the
 * student can change what happens, and the one thing this panel must never
 * suggest is that the circuit or the code can be touched. It autoplays.
 */

/**
 * The dot and the elapsed timer.
 *
 * `React.memo` with props that never change means React commits this subtree
 * once and then leaves it alone, which is what lets the loop write the elapsed
 * time straight into the text node without React putting "0:00.0" back on the
 * next step change. If a future React does re-render it anyway the clock
 * self-heals on the following frame — the loop rewrites whenever the text does
 * not match — so this is an optimisation, not a correctness crutch.
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
    <span className="flex items-center gap-1.5 rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6] px-2 py-1">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          isRunning ? 'showreel-blip bg-[#16a34a]' : 'bg-[#566573]'
        }`}
        aria-hidden="true"
      />
      <span className="text-[11px] font-semibold leading-none text-[#34495e]">
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
      className="h-[148px] w-full overflow-y-auto overflow-x-hidden rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6] p-2.5 font-mono text-[11px] leading-[1.7] text-[#34495e] sm:text-[12px]"
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
