import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { FeedbackSettingsForm } from './_components/feedback-settings-form'
import { FeedbackQuestionsList } from './_components/feedback-questions-list'
import { AddFeedbackQuestionForm } from './_components/add-feedback-question-form'

async function getFeedbackData(labSlug: string, expSlug: string) {
  const supabase = await createServerSupabaseClient()

  const { data: lab } = await supabase
    .from('labs')
    .select('id, title, slug')
    .eq('slug', labSlug)
    .single()
  if (!lab) return null

  const { data: experiment } = await supabase
    .from('experiments')
    .select('id, title, slug')
    .eq('lab_id', lab.id)
    .eq('slug', expSlug)
    .single()
  if (!experiment) return null

  const { data: form } = await supabase
    .from('feedback_forms')
    .select('*')
    .eq('experiment_id', experiment.id)
    .single()
  if (!form) return null

  const { data: questions } = await supabase
    .from('feedback_questions')
    .select('*')
    .eq('form_id', form.id)
    .eq('status', 'active')
    .order('order_index', { ascending: true })

  return { lab, experiment, form, questions: questions ?? [] }
}

export default async function FeedbackEditorPage({
  params,
}: {
  params: Promise<{ labSlug: string; expSlug: string }>
}) {
  const { labSlug, expSlug } = await params
  const data = await getFeedbackData(labSlug, expSlug)
  if (!data) notFound()

  const { lab, experiment, form, questions } = data

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 mb-6 text-sm text-[#6a6a6a]">
        <Link href="/admin/labs" className="hover:text-[#222222] transition-colors">Labs</Link>
        <span>/</span>
        <Link href={`/admin/labs/${labSlug}`} className="hover:text-[#222222] transition-colors">{lab.title}</Link>
        <span>/</span>
        <Link href={`/admin/labs/${labSlug}/experiments/${expSlug}`} className="hover:text-[#222222] transition-colors">{experiment.title}</Link>
        <span>/</span>
        <span className="text-[#222222]">Feedback Form</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#222222]">{form.title}</h1>
          {form.description && (
            <p className="text-sm text-[#6a6a6a] mt-1">{form.description}</p>
          )}
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
            form.is_enabled ? 'bg-[#e6f9f5] text-[#00a699]' : 'bg-[#f2f2f2] text-[#6a6a6a]'
          }`}
        >
          {form.is_enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: form settings */}
        <div className="lg:col-span-1">
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <h2 className="text-base font-semibold text-[#222222] mb-4">Form Settings</h2>
            <FeedbackSettingsForm form={form} />
          </div>
        </div>

        {/* Right: questions */}
        <div className="lg:col-span-2 space-y-4">
          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <h2 className="text-base font-semibold text-[#222222] mb-4">
              Questions ({questions.length})
            </h2>
            <FeedbackQuestionsList questions={questions} />
          </div>

          <div
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <h2 className="text-base font-semibold text-[#222222] mb-4">Add Question</h2>
            <AddFeedbackQuestionForm formId={form.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
