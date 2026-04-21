import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ExperimentInfoEditor } from './_components/experiment-info-editor'
import { SectionsList } from './_components/sections-list'
import { AddSectionForm } from './_components/add-section-form'
import type { Json } from '@/types/database'

type SectionWithMeta = {
  id: string
  type: string
  title: string | null
  order_index: number
  content: Json
  is_required: boolean
  status: string
  quiz_id?: string | null
  quiz_type?: string | null
  feedback_form_id?: string | null
}

async function getExperimentData(labSlug: string, expSlug: string) {
  const supabase = await createServerSupabaseClient()

  const { data: lab } = await supabase
    .from('labs').select('id, title, slug').eq('slug', labSlug).single()
  if (!lab) return null

  const { data: experiment } = await supabase
    .from('experiments').select('*').eq('lab_id', lab.id).eq('slug', expSlug).single()
  if (!experiment) return null

  const { data: sections } = await supabase
    .from('experiment_sections').select('*')
    .eq('experiment_id', experiment.id).eq('status', 'active')
    .order('order_index', { ascending: true })

  // For quiz sections, resolve the quiz_id stored in content to get quiz type
  const enriched: SectionWithMeta[] = await Promise.all(
    (sections ?? []).map(async (s) => {
      if (s.type === 'quiz') {
        const quizId = (s.content as Record<string, string> | null)?.quiz_id ?? null
        if (quizId) {
          const { data: quiz } = await supabase
            .from('quizzes').select('id, type').eq('id', quizId).single()
          return { ...s, quiz_id: quiz?.id ?? null, quiz_type: quiz?.type ?? null }
        }
      }
      if (s.type === 'feedback') {
        const formId = (s.content as Record<string, string> | null)?.form_id ?? null
        return { ...s, feedback_form_id: formId }
      }
      return s
    })
  )

  return { lab, experiment, sections: enriched }
}

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ labSlug: string; expSlug: string }>
}) {
  const { labSlug, expSlug } = await params
  const data = await getExperimentData(labSlug, expSlug)
  if (!data) notFound()
  const { lab, experiment, sections } = data

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm text-[#6a6a6a]">
        <Link href="/admin/labs" className="hover:text-[#222222] transition-colors">Labs</Link>
        <span>/</span>
        <Link href={`/admin/labs/${labSlug}`} className="hover:text-[#222222] transition-colors">{lab.title}</Link>
        <span>/</span>
        <span className="text-[#222222]">{experiment.title}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#222222]">{experiment.title}</h1>
          <p className="text-sm text-[#6a6a6a] mt-1 font-mono">{experiment.slug}</p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
          experiment.published ? 'bg-[#e6f9f5] text-[#00a699]' : 'bg-[#f2f2f2] text-[#6a6a6a]'
        }`}>
          {experiment.published ? 'Published' : 'Draft'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: experiment settings */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}>
            <h2 className="text-base font-semibold text-[#222222] mb-4">Experiment Settings</h2>
            <ExperimentInfoEditor experiment={experiment} />
          </div>
        </div>

        {/* Right: sections */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}>
            <h2 className="text-base font-semibold text-[#222222] mb-4">
              Sections ({sections.length})
            </h2>
            <SectionsList
              sections={sections}
              labSlug={labSlug}
              expSlug={expSlug}
              experimentId={experiment.id}
            />
          </div>

          <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}>
            <h2 className="text-base font-semibold text-[#222222] mb-4">Add Section</h2>
            <AddSectionForm experimentId={experiment.id} currentCount={sections.length} />
          </div>
        </div>
      </div>
    </div>
  )
}
