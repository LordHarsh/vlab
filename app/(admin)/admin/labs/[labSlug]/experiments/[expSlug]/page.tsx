import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ClipboardList, MessageSquare } from 'lucide-react'
import { ExperimentInfoEditor } from './_components/experiment-info-editor'
import { SectionsList } from './_components/sections-list'
import { AddSectionForm } from './_components/add-section-form'

async function getExperimentData(labSlug: string, expSlug: string) {
  const supabase = await createServerSupabaseClient()

  const { data: lab } = await supabase
    .from('labs')
    .select('id, title, slug')
    .eq('slug', labSlug)
    .single()

  if (!lab) return null

  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('lab_id', lab.id)
    .eq('slug', expSlug)
    .single()

  if (!experiment) return null

  const { data: sections } = await supabase
    .from('experiment_sections')
    .select('*')
    .eq('experiment_id', experiment.id)
    .eq('status', 'active')
    .order('order_index', { ascending: true })

  // Check for quiz section
  const hasQuiz = sections?.some((s) => s.type === 'quiz') ?? false
  // Check for feedback section
  const hasFeedback = sections?.some((s) => s.type === 'feedback') ?? false

  // Get quiz id if exists
  let quizData: { id: string; type: string } | null = null
  if (hasQuiz) {
    const { data: quiz } = await supabase
      .from('quizzes')
      .select('id, type')
      .eq('experiment_id', experiment.id)
      .limit(1)
      .single()
    quizData = quiz
  }

  return { lab, experiment, sections: sections ?? [], hasQuiz, hasFeedback, quizData }
}

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ labSlug: string; expSlug: string }>
}) {
  const { labSlug, expSlug } = await params
  const data = await getExperimentData(labSlug, expSlug)
  if (!data) notFound()

  const { lab, experiment, sections, hasQuiz, hasFeedback } = data

  return (
    <div className="p-8">
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
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
            experiment.published ? 'bg-[#e6f9f5] text-[#00a699]' : 'bg-[#f2f2f2] text-[#6a6a6a]'
          }`}
        >
          {experiment.published ? 'Published' : 'Draft'}
        </span>
      </div>

      {/* Quick links */}
      {(hasQuiz || hasFeedback) && (
        <div className="flex items-center gap-3 mb-6">
          {hasQuiz && (
            <Link
              href={`/admin/labs/${labSlug}/experiments/${expSlug}/quiz`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#f2f2f2] text-sm font-medium text-[#222222] hover:bg-[#e8e8e8] transition-colors"
            >
              <ClipboardList className="w-4 h-4 text-[#ff385c]" />
              Manage Quiz
            </Link>
          )}
          {hasFeedback && (
            <Link
              href={`/admin/labs/${labSlug}/experiments/${expSlug}/feedback`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#f2f2f2] text-sm font-medium text-[#222222] hover:bg-[#e8e8e8] transition-colors"
            >
              <MessageSquare className="w-4 h-4 text-[#ff385c]" />
              Manage Feedback Form
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: info editor */}
        <div className="lg:col-span-1">
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <h2 className="text-base font-semibold text-[#222222] mb-4">Experiment Settings</h2>
            <ExperimentInfoEditor experiment={experiment} />
          </div>
        </div>

        {/* Right: sections */}
        <div className="lg:col-span-2 space-y-4">
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <h2 className="text-base font-semibold text-[#222222] mb-4">
              Sections ({sections.length})
            </h2>
            <SectionsList sections={sections} labSlug={labSlug} expSlug={expSlug} />
          </div>

          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <h2 className="text-base font-semibold text-[#222222] mb-4">Add Section</h2>
            <AddSectionForm experimentId={experiment.id} currentCount={sections.length} />
          </div>
        </div>
      </div>
    </div>
  )
}
