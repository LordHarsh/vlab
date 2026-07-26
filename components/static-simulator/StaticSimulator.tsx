'use client'

import { AlertTriangle } from 'lucide-react'
import { getStaticExperiment } from './experiment-map'
import { StaticCircuit } from './StaticCircuit'
import { SyntaxCodeViewer } from './features/SyntaxCodeViewer'
import { languageForPlatform } from './utils/highlight'
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
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[#566573]">
          {experiment.platform} · reference circuit
        </span>
      </div>

      <div className="space-y-4 p-3 sm:p-4">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#566573]">
            Circuit
          </h3>
          <div className="overflow-hidden rounded-[5px] border border-[#dfe3e8]">
            <StaticCircuit experiment={experiment} />
          </div>
        </section>

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
