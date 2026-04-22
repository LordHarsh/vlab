'use client'

import { useState, useEffect } from 'react'
import { PlayCircle, ExternalLink, LogIn, RefreshCw, Loader2 } from 'lucide-react'

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
      .then((data) => { setPreviewUrl(data.imageUrl ?? null) })
      .catch(() => {})
      .finally(() => setPreviewLoading(false))
  }, [designId])

  if (!designId) {
    return (
      <div className="rounded-2xl border border-[#c1c1c1] overflow-hidden bg-white flex flex-col items-center justify-center gap-3 py-12 text-center px-6"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px' }}>
        <PlayCircle className="w-8 h-8 text-[#c1c1c1]" />
        <p className="text-sm text-[#6a6a6a]">No simulation linked to this section yet.</p>
      </div>
    )
  }

  const tinkercadUrl = `https://www.tinkercad.com/things/${designId}`
  const loginUrl = `https://www.tinkercad.com/login?next=%2Fthings%2F${designId}`

  return (
    <div className="rounded-2xl border border-[#c1c1c1] overflow-hidden"
      style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-[#f2f2f2] border-b border-[#c1c1c1]">
        <div className="w-9 h-9 rounded-xl bg-[#ff385c]/10 flex items-center justify-center">
          <PlayCircle className="w-5 h-5 text-[#ff385c]" />
        </div>
        <p className="text-sm font-semibold text-[#222222] flex-1">{title}</p>
        <a href={tinkercadUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[#6a6a6a] hover:text-[#ff385c] transition-colors">
          <ExternalLink className="w-3.5 h-3.5" />
          Open in Tinkercad
        </a>
      </div>

      {simActive ? (
        /* ── Active: show the iframe ── */
        <>
          <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
            <PlayCircle className="w-3.5 h-3.5 shrink-0" />
            Click <strong className="mx-0.5">Start Simulation</strong> inside the viewer to run it.
            <button onClick={() => setSimActive(false)}
              className="ml-auto text-[#6a6a6a] hover:text-[#222222] transition-colors underline">
              Back to preview
            </button>
          </div>
          <iframe
            src={`https://www.tinkercad.com/embed/${designId}`}
            title={title}
            width="100%"
            height={height}
            allowFullScreen
            style={{ border: 'none', display: 'block' }}
          />
        </>
      ) : (
        /* ── Preview: circuit image + login/launch flow ── */
        <div className="bg-white">
          {/* Circuit preview image */}
          <div className="relative bg-[#f7f7f7] flex items-center justify-center"
            style={{ minHeight: Math.round(height * 0.6) }}>
            {previewLoading ? (
              <Loader2 className="w-8 h-8 text-[#c1c1c1] animate-spin" />
            ) : previewUrl ? (
              <img src={previewUrl} alt={title}
                className="max-w-full max-h-full object-contain"
                style={{ maxHeight: Math.round(height * 0.6) }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-16 text-center px-6">
                <PlayCircle className="w-12 h-12 text-[#c1c1c1]" />
                <p className="text-sm text-[#6a6a6a]">Circuit preview unavailable</p>
              </div>
            )}
          </div>

          {/* CTA strip */}
          <div className="border-t border-[#f2f2f2] px-5 py-4 space-y-3">
            {/* Primary: Launch simulation */}
            <button
              onClick={() => setSimActive(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#ff385c] text-white text-sm font-semibold hover:bg-[#e0314f] transition-colors"
            >
              <PlayCircle className="w-4 h-4" />
              Launch Simulation
            </button>

            {/* Info + login nudge */}
            <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-xl">
              <LogIn className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-700 leading-relaxed">
                <p className="font-medium mb-0.5">Simulation not loading?</p>
                <p>
                  Tinkercad requires you to be signed in.{' '}
                  <a href={loginUrl} target="_blank" rel="noopener noreferrer"
                    className="underline font-semibold hover:text-blue-900">
                    Log in to Tinkercad ↗
                  </a>
                  , then come back and click <strong>Launch Simulation</strong> above.
                </p>
              </div>
            </div>

            {/* Re-launch after login */}
            <button
              onClick={() => setSimActive(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#c1c1c1] text-sm text-[#6a6a6a] hover:bg-[#f2f2f2] hover:text-[#222222] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              I've logged in — try again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
