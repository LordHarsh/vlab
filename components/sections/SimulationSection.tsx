'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { PlayCircle, ExternalLink, LogIn, Loader2, MonitorPlay, AlertTriangle } from 'lucide-react'
import { SIM_REGISTRY } from '@/components/simulations'
import { FullscreenGate } from '@/components/simulator/FullscreenGate'

export type SimulationKind = 'tinkercad' | 'builtin' | 'native' | (string & {})

/**
 * The native circuit editor is lazy-loaded with `ssr: false` so the heavy
 * avr8js + Web Worker bundle is fetched only when a section is actually
 * `native`. Every text / quiz / builtin-widget section stays free of it, and it
 * never enters the section route's server bundle. `ssr: false` is legal here
 * because this whole module is a client component (`'use client'` above).
 */
const NativeCircuitEditor = dynamic(
  () => import('@/components/simulator/CircuitEditor').then((m) => m.CircuitEditor),
  {
    ssr: false,
    loading: () => (
      <SimNotice heading="Loading circuit editor…" body="Preparing the interactive editor." />
    ),
  },
)

/**
 * Dispatches a simulation section to the right renderer.
 *
 *  - `tinkercad` — the Tinkercad embed below, untouched. Migration 015 calls it
 *    "the permanent fallback for every experiment the native simulator cannot
 *    yet cover"; it must never be removed.
 *  - `builtin`   — one of the in-app simulations keyed by `config.sim_type`.
 *  - `native`    — the native circuit editor. Not wired into sections yet.
 */
export function SimulationSection({
  type = 'tinkercad',
  simType = null,
  designId = null,
  height = 500,
  title = 'Interactive Simulation',
  platform = null,
  simulationId = null,
  classId = null,
  experimentSlug = null,
}: {
  type?: SimulationKind
  simType?: string | null
  /** Tinkercad only — the `builtin` and `native` paths never read it. */
  designId?: string | null
  height?: number
  title?: string
  platform?: string | null
  /** Native only — the target for autosave into sim_attempts. */
  simulationId?: string | null
  /** Native only — the enrolled class the attempt belongs to. */
  classId?: string | null
  /**
   * Native only — which experiment this is, so a Raspberry Pi Pico circuit can
   * be given the MicroPython its lab sheet asks the student to run. There is no
   * compile step on that track and no in-browser Python editor yet, so the
   * script is looked up by slug. Ignored by every Arduino experiment.
   */
  experimentSlug?: string | null
}) {
  if (type === 'builtin') {
    return <BuiltinSimulation simType={simType} title={title} platform={platform} />
  }

  if (type === 'native') {
    return (
      <NativeSimulation
        simulationId={simulationId}
        classId={classId}
        title={title}
        experimentSlug={experimentSlug}
      />
    )
  }

  return <TinkercadSimulation designId={designId} height={height} title={title} />
}

/* ── Built-in simulations ─────────────────────────────────────────────── */

function BuiltinSimulation({
  simType,
  title,
  platform,
}: {
  simType: string | null
  title: string
  platform: string | null
}) {
  const Sim = simType ? SIM_REGISTRY[simType] : undefined

  if (!Sim) {
    return (
      <SimNotice
        heading="This simulation isn’t available yet"
        body={
          simType
            ? `This section asks for the built-in simulation “${simType}”, but no simulation is registered under that name. Please let your instructor know.`
            : 'This section is marked as a built-in simulation but no simulation key was configured for it. Please let your instructor know.'
        }
      />
    )
  }

  return (
    <div className="w-full max-w-full overflow-hidden rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dfe3e8] bg-white px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-green-600" />
          <span className="truncate text-sm font-semibold text-[#34495e]">{title}</span>
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[#566573]">
          Interactive simulation
        </span>
      </div>
      <div className="p-3 sm:p-4">
        <Sim platform={platform} />
      </div>
    </div>
  )
}

/* ── Native circuit editor ────────────────────────────────────────────── */

/**
 * The in-app circuit editor, wired for a lesson section. It autosaves the
 * student's work to sim_attempts through the server actions, which re-derive the
 * student from the Clerk session and check enrollment — so both a simulationId
 * and the classId are required to have somewhere to save. A section marked
 * `native` without them is a configuration error, surfaced rather than silently
 * dropped.
 */
function NativeSimulation({
  simulationId,
  classId,
  title,
  experimentSlug,
}: {
  simulationId: string | null
  classId: string | null
  title: string
  experimentSlug: string | null
}) {
  if (!simulationId || !classId) {
    return (
      <SimNotice
        heading={title}
        body="This experiment uses the native circuit editor, but it isn’t fully configured for this section yet. Please let your instructor know."
      />
    )
  }

  return (
    <div
      data-testid="native-simulation"
      className="w-full max-w-full overflow-hidden rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6]"
    >
      {/* The editor is gated behind fullscreen, and the gate keeps it MOUNTED
          while it is blocked — see components/simulator/FullscreenGate.tsx. A
          student who drops out of fullscreen to re-read the lab sheet comes back
          to the same circuit, the same undo history and the same simulated
          second; nothing is remounted, so nothing is restored over. */}
      <FullscreenGate label="circuit simulator">
        <NativeCircuitEditor
          remote={{ simulationId, classId }}
          experimentSlug={experimentSlug ?? undefined}
        />
      </FullscreenGate>
    </div>
  )
}

function SimNotice({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="w-full max-w-full rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6] px-4 py-8 text-center sm:py-10">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[5px] border border-[#dfe3e8] bg-white">
        <AlertTriangle className="h-5 w-5 text-[#566573]" />
      </div>
      <p className="text-sm font-semibold text-[#34495e]">{heading}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-[#566573]">{body}</p>
    </div>
  )
}

/* ── Tinkercad embed — unchanged ──────────────────────────────────────── */

function TinkercadSimulation({
  designId,
  height = 500,
  title = 'Interactive Simulation',
}: {
  designId: string | null
  height?: number
  title?: string
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [simActive, setSimActive] = useState(false)

  useEffect(() => {
    // No designId renders the empty state below, which never reads previewLoading.
    if (!designId) return
    fetch(`/api/tinkercad-preview?id=${encodeURIComponent(designId)}`)
      .then((r) => r.json())
      .then((data) => setPreviewUrl(data.imageUrl ?? null))
      .catch(() => {})
      .finally(() => setPreviewLoading(false))
  }, [designId])

  if (!designId) {
    return (
      <div className="rounded-2xl border border-[#e8e8e8] bg-[#fafafa] flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
        <div className="w-12 h-12 rounded-2xl bg-[#f2f2f2] flex items-center justify-center">
          <MonitorPlay className="w-6 h-6 text-[#c1c1c1]" />
        </div>
        <p className="text-sm text-[#6a6a6a]">No simulation linked to this section yet.</p>
      </div>
    )
  }

  const tinkercadUrl = `https://www.tinkercad.com/things/${designId}`
  const loginUrl = `https://www.tinkercad.com/login`

  return (
    <div className="rounded-2xl border border-[#e8e8e8] overflow-hidden bg-white"
      style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.08) 0px 4px 8px' }}>

      {simActive ? (
        /* ── Active simulation view ── */
        <div>
          {/* Header bar while simulation runs */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[#e8e8e8] bg-white">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-semibold text-[#222222]">{title}</span>
            </div>
            <div className="flex items-center gap-2">
              <a href={tinkercadUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[#6a6a6a] hover:text-[#222222] transition-colors px-3 py-1.5 rounded-lg border border-[#e8e8e8] hover:border-[#c1c1c1]">
                <ExternalLink className="w-3.5 h-3.5" />
                Full screen
              </a>
              <button onClick={() => setSimActive(false)}
                className="text-xs text-[#6a6a6a] hover:text-[#222222] transition-colors px-3 py-1.5 rounded-lg border border-[#e8e8e8] hover:border-[#c1c1c1]">
                ← Back
              </button>
            </div>
          </div>

          {/* Info bar */}
          <div className="flex items-center gap-2 px-5 py-2.5 bg-[#fafafa] border-b border-[#e8e8e8] text-xs text-[#6a6a6a]">
            <span>Click <strong className="text-[#222222]">Start Simulation</strong> in the viewer below to run the circuit.</span>
          </div>

          <iframe
            src={`https://www.tinkercad.com/embed/${designId}`}
            title={title}
            width="100%"
            height={height}
            allowFullScreen
            style={{ border: 'none', display: 'block' }}
          />
        </div>
      ) : (
        /* ── Preview / launch view ── */
        <div>
          {/* Preview image */}
          <div className="relative bg-[#f7f7f7] flex items-center justify-center"
            style={{ minHeight: 280 }}>
            {previewLoading ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2 className="w-8 h-8 text-[#c1c1c1] animate-spin" />
                <p className="text-xs text-[#6a6a6a]">Loading preview…</p>
              </div>
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt={title}
                className="max-w-full object-contain"
                style={{ maxHeight: 320 }}
                onError={(e) => { (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="py-16 flex flex-col items-center gap-2"><svg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'#c1c1c1\' stroke-width=\'1.5\'><rect x=\'2\' y=\'3\' width=\'20\' height=\'14\' rx=\'2\'/><path d=\'M8 21h8M12 17v4\'/></svg><p class=\'text-xs text-[#c1c1c1]\'>Preview unavailable</p></div>' }}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-16">
                <MonitorPlay className="w-10 h-10 text-[#c1c1c1]" />
                <p className="text-xs text-[#6a6a6a]">No preview available</p>
              </div>
            )}

            {/* Overlay play button */}
            {!previewLoading && (
              <button
                onClick={() => setSimActive(true)}
                className="absolute inset-0 flex items-center justify-center group"
                aria-label="Launch simulation"
              >
                <div className="w-16 h-16 rounded-full bg-[#ff385c] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <PlayCircle className="w-8 h-8 text-white" />
                </div>
              </button>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-[#e8e8e8] px-5 py-4 space-y-3">
            {/* Title + launch */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#222222]">{title}</p>
                <p className="text-xs text-[#6a6a6a] mt-0.5">Tinkercad Circuit Simulation</p>
              </div>
              <button
                onClick={() => setSimActive(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#ff385c] text-white text-sm font-semibold hover:bg-[#e0314f] transition-colors shrink-0"
              >
                <PlayCircle className="w-4 h-4" />
                Launch
              </button>
            </div>

            {/* Login hint — subtle, not alarming */}
            <div className="flex items-start gap-2.5 pt-1 border-t border-[#f2f2f2]">
              <LogIn className="w-3.5 h-3.5 text-[#c1c1c1] shrink-0 mt-0.5" />
              <p className="text-xs text-[#6a6a6a] leading-relaxed">
                If the simulation doesn&apos;t load,{' '}
                <a href={loginUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[#222222] font-medium underline underline-offset-2 hover:text-[#ff385c] transition-colors">
                  sign in to Tinkercad
                </a>{' '}
                first, then click{' '}
                <button onClick={() => setSimActive(true)} className="text-[#222222] font-medium underline underline-offset-2 hover:text-[#ff385c] transition-colors">
                  Launch
                </button>
                {' '}again.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
