'use client'

import { useState, useEffect } from 'react'
import { PlayCircle, ExternalLink, LogIn, RotateCcw, Loader2, MonitorPlay } from 'lucide-react'

export function SimulationSection({
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
    if (!designId) { setPreviewLoading(false); return }
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
                <p className="text-xs text-[#c1c1c1]">Loading preview…</p>
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
                <p className="text-xs text-[#c1c1c1]">No preview available</p>
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
                If the simulation doesn't load,{' '}
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
