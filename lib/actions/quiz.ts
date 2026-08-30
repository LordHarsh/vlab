'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

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

/**
 * The student's most recent submission, rebuilt for display.
 *
 * Once attempts run out the quiz UI had nothing to show but "you have used all
 * allowed attempts" — the score and the answer review disappeared on reload and
 * the student could never see how they did. Correct answers are revoked from
 * `authenticated` (migration 013), so the key has to be re-read server-side,
 * behind the same enrolment and quiz-belongs-to-class checks submitQuiz uses.
 */
export async function getMyLatestSubmission(
  quizId: string,
  classId: string,
): Promise<(QuizResult & { selectedAnswers: Record<string, string> }) | null> {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()
  if (!profile) return null

  const { data: submission } = await supabase
    .from('quiz_submissions')
    .select('attempt_number, answers, score, max_score, percentage, passed')
    .eq('quiz_id', quizId)
    .eq('class_id', classId)
    .eq('student_id', profile.id)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!submission) return null

  const snapshot = (submission.answers ?? []) as unknown as Array<{
    questionId: string
    selectedAnswerId: string
    isCorrect: boolean
  }>
  const selectedAnswers: Record<string, string> = {}
  for (const a of snapshot) selectedAnswers[a.questionId] = a.selectedAnswerId

  const base = {
    success: true as const,
    score: submission.score,
    maxScore: submission.max_score,
    percentage: submission.percentage,
    passed: submission.passed,
    attemptNumber: submission.attempt_number,
    selectedAnswers,
  }

  const { data: quiz } = await supabase
    .from('quizzes')
    .select('experiment_id, default_show_answers')
    .eq('id', quizId)
    .single()

  const { data: settings } = await supabase
    .from('class_quiz_settings')
    .select('show_answers')
    .eq('quiz_id', quizId)
    .eq('class_id', classId)
    .single()

  const effectiveShowAnswers =
    settings?.show_answers ?? quiz?.default_show_answers ?? 'after_submission'
  const showAnswers =
    effectiveShowAnswers === 'after_submission' || effectiveShowAnswers === 'immediately'

  if (!showAnswers || !quiz) return { ...base, showAnswers: false }

  // Same two gates as submitQuiz, for the same reason: quizId is a free
  // parameter, so it must be tied to a class this student is actually in
  // before the service-role read below hands back the answer key.
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('class_id', classId)
    .eq('student_id', profile.id)
    .eq('status', 'active')
    .single()
  if (!enrollment) return { ...base, showAnswers: false }

  const { data: experiment } = await supabase
    .from('experiments')
    .select('lab_id')
    .eq('id', quiz.experiment_id)
    .single()

  const { data: labInClass } = experiment
    ? await supabase
        .from('class_labs')
        .select('id')
        .eq('class_id', classId)
        .eq('lab_id', experiment.lab_id)
        .maybeSingle()
    : { data: null }

  if (!labInClass) return { ...base, showAnswers: false }

  const { data: questions } = await createAdminSupabaseClient()
    .from('quiz_questions')
    .select('id, correct_answer, explanation')
    .eq('quiz_id', quizId)
    .eq('status', 'active')

  return {
    ...base,
    showAnswers: true,
    answerDetails: (questions ?? []).map((q) => ({
      questionId: q.id,
      isCorrect: (selectedAnswers[q.id] ?? '') === q.correct_answer,
      correctAnswerId: q.correct_answer,
      explanation: q.explanation ?? undefined,
    })),
  }
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
      'id, experiment_id, default_max_attempts, default_passing_percentage, default_show_score, default_show_answers',
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

  // Verify the student is actively enrolled in the class they claim to be
  // submitting under. RLS on quiz_submissions checks student_id but not class_id,
  // and the grading read below bypasses RLS entirely, so this is the gate.
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('class_id', classId)
    .eq('student_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!enrollment) {
    return {
      success: false,
      score: 0,
      maxScore: 0,
      percentage: 0,
      passed: false,
      attemptNumber: currentAttempts,
      showAnswers: false,
      error: 'You are not enrolled in this class.',
    }
  }

  // Enrollment proves the caller is in `classId`. It says nothing about
  // `quizId`, which is a free parameter — so bind the two before the
  // answer-key read below. Without this, an enrolled student could pass ANY
  // quiz id on the platform and the service-role read would hand back its
  // correct_answer and explanation, defeating migration 013's column revoke.
  // It also stops a student sidestepping a class's max_attempts /
  // show_answers by submitting under a different class they belong to, where
  // no class_quiz_settings row exists and the quiz defaults apply instead.
  const { data: experiment } = await supabase
    .from('experiments')
    .select('lab_id')
    .eq('id', quiz.experiment_id)
    .single()

  const { data: labInClass } = experiment
    ? await supabase
        .from('class_labs')
        .select('id')
        .eq('class_id', classId)
        .eq('lab_id', experiment.lab_id)
        .maybeSingle()
    : { data: null }

  if (!labInClass) {
    return {
      success: false,
      score: 0,
      maxScore: 0,
      percentage: 0,
      passed: false,
      attemptNumber: currentAttempts,
      showAnswers: false,
      error: 'This quiz is not part of this class.',
    }
  }

  // The service-role client. Needed twice below, and it bypasses RLS, so it is
  // created only after identity (line 46), attempt cap, active enrollment and
  // the quiz-belongs-to-class check above have all passed.
  const adminSupabase = createAdminSupabaseClient()

  // Fetch active questions with the answer key.
  // Migration 013 revokes SELECT on correct_answer/explanation from the
  // `authenticated` role, so grading must go through the service-role client.
  const { data: questions } = await adminSupabase
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

  // Insert quiz submission through the service-role client.
  //
  // Migration 031 drops "quiz_submissions: student insert own", because that
  // policy checked only student_id and let the browser POST its own score,
  // percentage and passed straight to PostgREST. This action is now the only
  // writer of the gradebook, and every value below is computed server-side:
  // score/maxScore/percentage/passed come from the answer key above, student_id
  // from the Clerk session, and attemptNumber from the counted attempts. The
  // only client-supplied values that reach the row are the answers themselves
  // and timeTakenSeconds.
  const { error: insertError } = await adminSupabase.from('quiz_submissions').insert({
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

  // 'after_due_date' and 'never' withhold the key at submission time.
  // ('always' is not a permitted value — see the check constraint in 003.)
  const showAnswers =
    effectiveShowAnswers === 'after_submission' || effectiveShowAnswers === 'immediately'

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
