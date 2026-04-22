'use client'

import { useEffect, useState } from 'react'
import { useSupabaseClient } from '@/lib/supabase/client'
import { PlayCircle, Loader2, ExternalLink } from 'lucide-react'

type SimulationData = {
  id: string
  title: string | null
  config: { design_id?: string; height?: number }
}

export function SimulationSection({ simulationId }: { simulationId: string }) {
  const supabase = useSupabaseClient()
  const [simulation, setSimulation] = useState<SimulationData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('simulations')
      .select('id, title, config')
      .eq('id', simulationId)
      .single()
      .then(({ data }) => {
        setSimulation(data as SimulationData | null)
        setLoading(false)
      })
  }, [simulationId, supabase])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-[#6a6a6a] animate-spin" />
      </div>
    )
  }

  const designId = simulation?.config?.design_id
  const height = simulation?.config?.height ?? 500
  const title = simulation?.title ?? 'Interactive Simulation'

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

      {/* Body */}
      {designId ? (
        <iframe
          src={`https://www.tinkercad.com/embed/${designId}`}
          title={title}
          width="100%"
          height={height}
          allowFullScreen
          style={{ border: 'none', display: 'block' }}
        />
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
