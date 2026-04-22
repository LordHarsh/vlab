'use client'

import { PlayCircle, ExternalLink } from 'lucide-react'

// Props come from the server — no client-side fetch, so the iframe
// src is stable and never changes across re-renders.
export function SimulationSection({
  designId,
  height = 500,
  title = 'Interactive Simulation',
}: {
  designId: string | null
  height?: number
  title?: string
}) {
  return (
    <div
      className="rounded-2xl border border-[#c1c1c1] overflow-hidden"
      style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-[#f2f2f2] border-b border-[#c1c1c1]">
        <div className="w-9 h-9 rounded-xl bg-[#ff385c]/10 flex items-center justify-center">
          <PlayCircle className="w-5 h-5 text-[#ff385c]" />
        </div>
        <p className="text-sm font-semibold text-[#222222] flex-1">{title}</p>
        {designId && (
          <a
            href={`https://www.tinkercad.com/things/${designId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[#6a6a6a] hover:text-[#ff385c] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Tinkercad
          </a>
        )}
      </div>

      {designId ? (
        <>
          {/* Hint strip */}
          <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
            <PlayCircle className="w-3.5 h-3.5 shrink-0" />
            Click <strong className="mx-0.5">Start Simulation</strong> inside the circuit viewer to run it.
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
        <div className="bg-white px-6 py-12 flex flex-col items-center justify-center text-center gap-3 min-h-[320px]">
          <div className="w-14 h-14 rounded-2xl bg-[#f2f2f2] flex items-center justify-center">
            <PlayCircle className="w-7 h-7 text-[#c1c1c1]" />
          </div>
          <p className="text-sm font-medium text-[#222222]">{title}</p>
          <p className="text-xs text-[#6a6a6a]">No Tinkercad design linked yet.</p>
        </div>
      )}
    </div>
  )
}
