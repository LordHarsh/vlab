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
        className="inline-flex items-center gap-1.5 text-sm text-vlab-muted hover:text-vlab-ink mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Labs
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-vlab-ink">{lab.title}</h1>
          <p className="text-sm text-vlab-muted mt-1 font-mono">{lab.slug}</p>
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
            lab.published ? 'bg-green-50 text-vlab-green-ink' : 'bg-vlab-surface text-vlab-muted'
          }`}
        >
          {lab.published ? 'Published' : 'Draft'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Lab info editor */}
        <div className="lg:col-span-1">
          <div
            className="bg-white rounded-lg p-6"
            style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
          >
            <h2 className="text-base font-semibold text-vlab-ink mb-4">Lab Settings</h2>
            <LabInfoEditor lab={lab} />
          </div>
        </div>

        {/* Right: Experiments */}
        <div className="lg:col-span-2 space-y-4">
          <div
            className="bg-white rounded-lg p-6"
            style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-vlab-ink">
                Experiments ({experiments.length})
              </h2>
            </div>
            <ExperimentCards experiments={experiments} labSlug={labSlug} />
          </div>

          {/* Add experiment */}
          <div
            className="bg-white rounded-lg p-6"
            style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-4 h-4 text-vlab-600" />
              <h2 className="text-base font-semibold text-vlab-ink">Add Experiment</h2>
            </div>
            <AddExperimentForm labId={lab.id} labSlug={labSlug} />
          </div>
        </div>
      </div>
    </div>
  )
}
