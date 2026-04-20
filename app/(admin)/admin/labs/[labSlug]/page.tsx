import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Plus } from 'lucide-react'
import { LabInfoEditor } from './_components/lab-info-editor'
import { ExperimentCards } from './_components/experiment-cards'
import { AddExperimentForm } from './_components/add-experiment-form'

async function getLabData(slug: string) {
  const supabase = await createServerSupabaseClient()

  const { data: lab } = await supabase
    .from('labs')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!lab) return null

  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, slug, title, description, difficulty, estimated_duration, published, order_index')
    .eq('lab_id', lab.id)
    .order('order_index', { ascending: true })

  // Get section counts per experiment
  const { data: sections } = await supabase
    .from('experiment_sections')
    .select('experiment_id')
    .eq('status', 'active')

  const sectionCountMap: Record<string, number> = {}
  for (const s of sections ?? []) {
    sectionCountMap[s.experiment_id] = (sectionCountMap[s.experiment_id] ?? 0) + 1
  }

  return {
    lab,
    experiments: (experiments ?? []).map((exp) => ({
      ...exp,
      sectionCount: sectionCountMap[exp.id] ?? 0,
    })),
  }
}

export default async function LabDetailPage({ params }: { params: Promise<{ labSlug: string }> }) {
  const { labSlug } = await params
  const data = await getLabData(labSlug)
  if (!data) notFound()

  const { lab, experiments } = data

  return (
    <div className="p-8">
      <Link
        href="/admin/labs"
        className="inline-flex items-center gap-1.5 text-sm text-[#6a6a6a] hover:text-[#222222] mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Labs
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#222222]">{lab.title}</h1>
          <p className="text-sm text-[#6a6a6a] mt-1 font-mono">{lab.slug}</p>
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
            lab.published ? 'bg-[#e6f9f5] text-[#00a699]' : 'bg-[#f2f2f2] text-[#6a6a6a]'
          }`}
        >
          {lab.published ? 'Published' : 'Draft'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Lab info editor */}
        <div className="lg:col-span-1">
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <h2 className="text-base font-semibold text-[#222222] mb-4">Lab Settings</h2>
            <LabInfoEditor lab={lab} />
          </div>
        </div>

        {/* Right: Experiments */}
        <div className="lg:col-span-2 space-y-4">
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[#222222]">
                Experiments ({experiments.length})
              </h2>
            </div>
            <ExperimentCards experiments={experiments} labSlug={labSlug} />
          </div>

          {/* Add experiment */}
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-4 h-4 text-[#ff385c]" />
              <h2 className="text-base font-semibold text-[#222222]">Add Experiment</h2>
            </div>
            <AddExperimentForm labId={lab.id} labSlug={labSlug} />
          </div>
        </div>
      </div>
    </div>
  )
}
