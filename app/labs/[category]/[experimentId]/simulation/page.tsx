import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SimulationClient } from './simulation-client'

export default async function SimulationPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params
  const supabase = await createServerSupabaseClient()

  const result = await supabase
    .from('experiments')
    .select('id, title, simulation, categories(slug)')
    .eq('slug', experimentId)
    .eq('published', true)
    .single()

  const experiment = result.data as { id: string; title: string; simulation: any } | null

  if (!experiment || !experiment.simulation) {
    notFound()
  }

  const simulationConfig = experiment.simulation as {
    gpio_pins?: number[]
    instructions?: string[]
    code_example?: string
    learning_points?: string[]
  }

  return (
    <SimulationClient
      config={simulationConfig}
      category={category}
      experimentId={experimentId}
    />
  )
}
