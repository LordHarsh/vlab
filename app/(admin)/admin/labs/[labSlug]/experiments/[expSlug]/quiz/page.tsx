import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { QuizSettingsForm } from './_components/quiz-settings-form'
import { QuestionsList } from './_components/questions-list'
import { AddQuestionForm } from './_components/add-question-form'

const TYPE_LABEL: Record<string, string> = {
  pretest: 'Pre-Test',
  posttest: 'Post-Test',
  practice: 'Practice',
}

export default async function QuizEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ labSlug: string; expSlug: string }>
  searchParams: Promise<{ quizId?: string }>
}) {
  const { labSlug, expSlug } = await params
  const { quizId } = await searchParams

  if (!quizId) notFound()

  const supabase = await createServerSupabaseClient()

  const { data: lab } = await supabase.from('labs').select('id, title, slug').eq('slug', labSlug).single()
  if (!lab) notFound()

  const { data: experiment } = await supabase.from('experiments').select('id, title, slug').eq('lab_id', lab.id).eq('slug', expSlug).single()
  if (!experiment) notFound()

  const { data: quiz } = await supabase.from('quizzes').select('*').eq('id', quizId).eq('experiment_id', experiment.id).single()
  if (!quiz) notFound()

  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('*')
    .eq('quiz_id', quiz.id)
    .eq('status', 'active')
    .order('order_number', { ascending: true })

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 mb-6 text-sm text-[#6a6a6a]">
        <Link href="/admin/labs" className="hover:text-[#222222] transition-colors">Labs</Link>
        <span>/</span>
        <Link href={`/admin/labs/${labSlug}`} className="hover:text-[#222222] transition-colors">{lab.title}</Link>
        <span>/</span>
        <Link href={`/admin/labs/${labSlug}/experiments/${expSlug}`} className="hover:text-[#222222] transition-colors">{experiment.title}</Link>
        <span>/</span>
        <span className="text-[#222222]">{TYPE_LABEL[quiz.type] ?? quiz.type} Quiz</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#222222]">{quiz.title}</h1>
          <span className="inline-flex items-center mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-pink-50 text-pink-700">
            {TYPE_LABEL[quiz.type] ?? quiz.type}
          </span>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#f2f2f2] text-[#6a6a6a]">
          {(questions ?? []).length} question{(questions ?? []).length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}>
            <h2 className="text-base font-semibold text-[#222222] mb-4">Quiz Settings</h2>
            <QuizSettingsForm quiz={quiz} />
          </div>
        </div>
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}>
            <h2 className="text-base font-semibold text-[#222222] mb-4">
              Active Questions ({(questions ?? []).length})
            </h2>
            <QuestionsList questions={questions ?? []} />
          </div>
          <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}>
            <h2 className="text-base font-semibold text-[#222222] mb-4">Add Question</h2>
            <AddQuestionForm quizId={quiz.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
