'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export type QuizResult = {
  success: boolean
  score: number
  maxScore: number
  percentage: number
  passed: boolean
  attemptNumber: number
  showAnswers: boolean
  answerDetails?: Array<{
    questionId: string
    isCorrect: boolean
    correctAnswerId?: string
    explanation?: string
  }>
  error?: string
}

export async function submitQuiz(
  quizId: string,
  classId: string,
  answers: Record<string, string>,
  timeTakenSeconds?: number,
): Promise<QuizResult> {
  const { userId } = await auth()
  if (!userId) {
    return {
      success: false,
      score: 0,
      maxScore: 0,
      percentage: 0,
      passed: false,
      attemptNumber: 0,
      showAnswers: false,
      error: 'Not authenticated',
    }
  }

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) {
    return {
      success: false,
      score: 0,
      maxScore: 0,
      percentage: 0,
      passed: false,
      attemptNumber: 0,
      showAnswers: false,
      error: 'Profile not found',
    }
  }

  // Fetch quiz defaults
  const { data: quiz } = await supabase
    .from('quizzes')
    .select(
      'id, default_max_attempts, default_passing_percentage, default_show_score, default_show_answers',
    )
    .eq('id', quizId)
    .single()

  if (!quiz) {
    return {
      success: false,
      score: 0,
      maxScore: 0,
      percentage: 0,
      passed: false,
      attemptNumber: 0,
      showAnswers: false,
      error: 'Quiz not found',
    }
  }

  // Fetch class_quiz_settings (may be null)
  const { data: settings } = await supabase
    .from('class_quiz_settings')
    .select('max_attempts, passing_percentage, show_score, show_answers')
    .eq('quiz_id', quizId)
    .eq('class_id', classId)
    .single()

  const effectiveMaxAttempts = settings?.max_attempts ?? quiz.default_max_attempts
  const effectivePassingPct = settings?.passing_percentage ?? quiz.default_passing_percentage ?? 60
  const effectiveShowAnswers = settings?.show_answers ?? quiz.default_show_answers ?? 'after_submission'

  // Count existing attempts
  const { count: attemptCount } = await supabase
    .from('quiz_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('quiz_id', quizId)
    .eq('class_id', classId)
    .eq('student_id', profile.id)

  const currentAttempts = attemptCount ?? 0

  if (effectiveMaxAttempts !== null && currentAttempts >= effectiveMaxAttempts) {
    return {
      success: false,
      score: 0,
      maxScore: 0,
      percentage: 0,
      passed: false,
      attemptNumber: currentAttempts,
      showAnswers: false,
      error: `You have used all ${effectiveMaxAttempts} allowed attempt(s).`,
    }
  }

  const attemptNumber = currentAttempts + 1

  // Fetch active questions with snapshot data
  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('id, question_text, options, correct_answer, explanation, points, order_number')
    .eq('quiz_id', quizId)
    .eq('status', 'active')
    .order('order_number', { ascending: true })

  if (!questions || questions.length === 0) {
    return {
      success: false,
      score: 0,
      maxScore: 0,
      percentage: 0,
      passed: false,
      attemptNumber,
      showAnswers: false,
      error: 'No questions found for this quiz',
    }
  }

  // Grade the submission
  let score = 0
  let maxScore = 0
  const answerDetails: QuizResult['answerDetails'] = []

  for (const q of questions) {
    const pts = q.points ?? 1
    maxScore += pts
    const studentAnswer = answers[q.id] ?? ''
    const isCorrect = studentAnswer === q.correct_answer
    if (isCorrect) score += pts
    answerDetails.push({
      questionId: q.id,
      isCorrect,
      correctAnswerId: q.correct_answer,
      explanation: q.explanation ?? undefined,
    })
  }

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  const passed = percentage >= effectivePassingPct

  // Build snapshot of answers with question text and options
  type AnswerSnapshot = {
    questionId: string
    questionText: string
    options: unknown
    selectedAnswerId: string
    isCorrect: boolean
  }
  const answersSnapshot: AnswerSnapshot[] = questions.map((q) => ({
    questionId: q.id,
    questionText: q.question_text,
    options: q.options,
    selectedAnswerId: answers[q.id] ?? '',
    isCorrect: (answers[q.id] ?? '') === q.correct_answer,
  }))

  // Insert quiz submission
  const { error: insertError } = await supabase.from('quiz_submissions').insert({
    quiz_id: quizId,
    class_id: classId,
    student_id: profile.id,
    attempt_number: attemptNumber,
    answers: answersSnapshot as unknown as import('@/types/database').Json,
    score,
    max_score: maxScore,
    percentage,
    passed,
    time_taken_seconds: timeTakenSeconds,
  })

  if (insertError) {
    return {
      success: false,
      score,
      maxScore,
      percentage,
      passed,
      attemptNumber,
      showAnswers: false,
      error: 'Failed to save submission. Please try again.',
    }
  }

  const showAnswers = effectiveShowAnswers === 'after_submission' || effectiveShowAnswers === 'always'

  return {
    success: true,
    score,
    maxScore,
    percentage,
    passed,
    attemptNumber,
    showAnswers,
    answerDetails: showAnswers ? answerDetails : undefined,
  }
}
