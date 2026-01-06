import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { QuizClient } from './quiz-client'

export default async function PretestPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params
  const supabase = await createServerSupabaseClient()

  // Fetch experiment to get its ID
  const expResult = await supabase
    .from('experiments')
    .select('id, slug')
    .eq('slug', experimentId)
    .eq('published', true)
    .single()

  const experiment = expResult.data as { id: string; slug: string } | null

  if (!experiment) {
    notFound()
  }

  // Fetch pretest quiz for this experiment
  const quizResult = await supabase
    .from('quizzes')
    .select('id, passing_percentage')
    .eq('experiment_id', experiment.id)
    .eq('quiz_type', 'pretest')
    .single()

  const quiz = quizResult.data as { id: string; passing_percentage: number } | null

  if (!quiz) {
    notFound()
  }

  // Fetch quiz questions
  const questionsResult = await supabase
    .from('quiz_questions')
    .select('*')
    .eq('quiz_id', quiz.id)
    .order('display_order', { ascending: true })

  const questions = questionsResult.data as any[] | null

  if (!questions || questions.length === 0) {
    notFound()
  }

  // Parse options from JSONB
  const parsedQuestions = questions.map(q => ({
    ...q,
    options: q.options as string[],
  }))

  return (
    <QuizClient
      questions={parsedQuestions}
      passingPercentage={quiz.passing_percentage}
      category={category}
      experimentId={experimentId}
      quizId={quiz.id}
    />
  )
}
