'use client'

import { useEffect, useState } from 'react'
import { useSupabaseClient } from '@/lib/supabase/client'
import { PlayCircle, Loader2 } from 'lucide-react'

type SimulationData = {
  id: string
  title: string | null
  description: string | null
  type: string
  config: Record<string, unknown>
}

export function SimulationSection({ simulationId }: { simulationId: string }) {
  const supabase = useSupabaseClient()
  const [simulation, setSimulation] = useState<SimulationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('simulations')
        .select('id, title, description, type, config')
        .eq('id', simulationId)
        .single()

      if (err || !data) {
        setError('Simulation not found.')
        setLoading(false)
        return
      }

      setSimulation(data as SimulationData)
      setLoading(false)
    }

    load()
  }, [simulationId, supabase])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-[#6a6a6a] animate-spin" />
      </div>
    )
  }

  if (error || !simulation) {
    return (
      <div className="py-8 text-center text-[#6a6a6a] text-sm">
        {error ?? 'Simulation unavailable.'}
      </div>
    )
  }

  const simType = (simulation.config as { sim_type?: string }).sim_type ?? simulation.type

  return (
    <div
      className="rounded-2xl border border-[#c1c1c1] overflow-hidden"
      style={{
        boxShadow:
          'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-[#f2f2f2] border-b border-[#c1c1c1]">
        <div className="w-9 h-9 rounded-xl bg-[#ff385c]/10 flex items-center justify-center">
          <PlayCircle className="w-5 h-5 text-[#ff385c]" />
        </div>
        <div>
          <p className="text-sm font-600 text-[#222222]">
            {simulation.title ?? 'Interactive Simulation'}
          </p>
          <p className="text-xs text-[#6a6a6a]">Simulation: {simType}</p>
        </div>
      </div>

      {/* Simulation body — placeholder panel */}
      <div className="bg-white px-6 py-12 flex flex-col items-center justify-center text-center gap-4 min-h-[320px]">
        <div className="w-16 h-16 rounded-2xl bg-[#ff385c]/10 flex items-center justify-center">
          <PlayCircle className="w-8 h-8 text-[#ff385c]" />
        </div>
        <div>
          <p className="font-600 text-[#222222] mb-1">
            {simulation.title ?? 'Interactive Simulation'}
          </p>
          <p className="text-sm text-[#6a6a6a]">Type: {simType}</p>
          {simulation.description && (
            <p className="text-sm text-[#6a6a6a] mt-2 max-w-sm">{simulation.description}</p>
          )}
        </div>
        <div className="px-4 py-2 bg-[#f2f2f2] rounded-xl text-xs text-[#6a6a6a]">
          Interactive widget coming soon
        </div>
      </div>
    </div>
  )
}
