'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useUser } from '@clerk/nextjs'
import { useSupabaseClient } from '@/lib/supabase/client'
import { submitQuiz, getMyLatestSubmission, type QuizResult } from '@/lib/actions/quiz'
import {
  Loader2,
  CheckCircle2,
  XCircle,

  AlertCircle,
} from 'lucide-react'

type QuizQuestion = {
  id: string
  question_text: string
  options: Array<{ id: string; text: string }>
  order_number: number
  points: number
}

type QuizData = {
  id: string
  title: string
  description: string | null
  type: string
  default_max_attempts: number | null
  default_passing_percentage: number | null
  default_show_score: boolean | null
}

type ClassSettings = {
  max_attempts: number | null
  passing_percentage: number | null
  show_score: boolean | null
  show_answers: string | null
}

export function QuizSection({
  quizId,
  classId,
}: {
  quizId: string
  classId: string
}) {
  const supabase = useSupabaseClient()
  const { user } = useUser()
  const [isPending, startTransition] = useTransition()

  const [loading, setLoading] = useState(true)
  const [quiz, setQuiz] = useState<QuizData | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [existingAttempts, setExistingAttempts] = useState(0)
  const [classSettings, setClassSettings] = useState<ClassSettings | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Date.now() is impure, so it cannot be read during render. Stamp it on mount.
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    startTimeRef.current ??= Date.now()

    async function load() {
      setLoading(true)
      setError(null)

      const [quizRes, questionsRes, settingsRes] = await Promise.all([
        supabase
          .from('quizzes')
          .select(
            'id, title, description, type, default_max_attempts, default_passing_percentage, default_show_score',
          )
          .eq('id', quizId)
          .single(),
        supabase
          .from('quiz_questions')
          .select('id, question_text, options, order_number, points')
          .eq('quiz_id', quizId)
          .eq('status', 'active')
          .order('order_number', { ascending: true }),
        supabase
          .from('class_quiz_settings')
          .select('max_attempts, passing_percentage, show_score, show_answers')
          .eq('quiz_id', quizId)
          .eq('class_id', classId)
          .single(),
      ])

      if (quizRes.error || !quizRes.data) {
        setError('Quiz not found.')
        setLoading(false)
        return
      }

      setQuiz(quizRes.data as QuizData)
      setQuestions(
        (questionsRes.data ?? []).map((q) => ({
          ...q,
          options: (q.options as Array<{ id: string; text: string }>) ?? [],
        })),
      )

      if (!settingsRes.error && settingsRes.data) {
        setClassSettings(settingsRes.data)
      }

      setLoading(false)
    }

    load()
  }, [quizId, classId, supabase])

  // Count existing attempts after quiz is loaded
  useEffect(() => {
    if (!quiz || !user) return

    async function countAttempts() {
      // RLS already scopes quiz_submissions to the current student, but filter
      // explicitly so this stays correct if the policy is ever widened.
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('clerk_user_id', user?.id ?? '')
        .single()

      if (!profile) return

      const { count } = await supabase
        .from('quiz_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('quiz_id', quizId)
        .eq('class_id', classId)
        .eq('student_id', profile.id)

      setExistingAttempts(count ?? 0)

      // Re-show the last attempt instead of a bare "no attempts left" notice.
      if ((count ?? 0) > 0) {
        const previous = await getMyLatestSubmission(quizId, classId)
        if (previous) {
          setAnswers(previous.selectedAnswers)
          setResult(previous)
        }
      }
    }

    countAttempts()
  }, [quiz, quizId, classId, supabase, user])

  const effectiveMaxAttempts =
    classSettings?.max_attempts ?? quiz?.default_max_attempts ?? null
  const attemptsRemaining =
    effectiveMaxAttempts !== null ? effectiveMaxAttempts - existingAttempts : null
  const canAttempt = attemptsRemaining === null || attemptsRemaining > 0

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] !== undefined)

  function handleAnswer(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }))
  }

  function handleSubmit() {
    setError(null)
    const timeTaken = Math.round((Date.now() - (startTimeRef.current ?? Date.now())) / 1000)

    startTransition(async () => {
      const res = await submitQuiz(quizId, classId, answers, timeTaken)
      if (!res.success && res.error) {
        setError(res.error)
      } else {
        setResult(res)
        setExistingAttempts((n) => n + 1)
      }
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-vlab-muted animate-spin" />
      </div>
    )
  }

  if (error && !result) {
    return (
      <div className="flex items-start gap-3 border border-red-300 bg-red-50 p-4">
        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{error}</p>
      </div>
    )
  }

  if (!quiz) return null

  const passingPct =
    classSettings?.passing_percentage ?? quiz.default_passing_percentage ?? 60

  // Results view
  if (result && result.success) {
    return (
      <div className="space-y-5">
        {/* Result of assessment — a marksheet row, not a celebration card. */}
        <div
          className={`border-l-4 border-y border-r ${
            result.passed
              ? 'border-l-vlab-green border-y-vlab-rule-strong border-r-vlab-rule-strong bg-white'
              : 'border-l-red-500 border-y-vlab-rule-strong border-r-vlab-rule-strong bg-white'
          }`}
        >
          <div className="vlab-panel-header justify-between">
            <span>Result of assessment</span>
            <span className="font-normal normal-case tracking-normal">
              Attempt {result.attemptNumber}
              {effectiveMaxAttempts !== null && ` of ${effectiveMaxAttempts}`}
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-px bg-vlab-rule">
            <div className="bg-white px-4 py-3">
              <dt className="vlab-eyebrow">Score</dt>
              <dd className="mt-0.5 font-chrome text-lg font-bold tabular-nums text-vlab-800">
                {result.score}/{result.maxScore}
              </dd>
            </div>
            <div className="bg-white px-4 py-3">
              <dt className="vlab-eyebrow">Percentage</dt>
              <dd className="mt-0.5 font-chrome text-lg font-bold tabular-nums text-vlab-800">
                {result.percentage}%
              </dd>
            </div>
            <div className="bg-white px-4 py-3">
              <dt className="vlab-eyebrow">Outcome</dt>
              <dd
                className={`mt-0.5 flex items-center gap-1.5 font-chrome text-lg font-bold ${
                  result.passed ? 'text-vlab-green-ink' : 'text-red-700'
                }`}
              >
                {result.passed ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {result.passed ? 'Pass' : 'Fail'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Answer review */}
        {result.showAnswers && result.answerDetails && result.answerDetails.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-chrome text-[14px] font-bold uppercase tracking-[0.07em] text-vlab-800">Answer Review</h3>
            {questions.map((q, idx) => {
              const detail = result.answerDetails?.find((d) => d.questionId === q.id)
              const studentAnswerId = answers[q.id]
              const studentOption = q.options.find((o) => o.id === studentAnswerId)
              const correctOption = q.options.find((o) => o.id === detail?.correctAnswerId)
              const isCorrect = detail?.isCorrect ?? false

              return (
                <div
                  key={q.id}
                  className={`border p-4 ${
                    isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-xs font-semibold text-vlab-muted shrink-0 mt-0.5">
                      Q{idx + 1}
                    </span>
                    <p className="text-sm text-vlab-ink font-medium">{q.question_text}</p>
                    {isCorrect ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 ml-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 shrink-0 ml-auto" />
                    )}
                  </div>

                  <p className="text-xs text-vlab-muted ml-5">
                    Your answer:{' '}
                    <span
                      className={`font-medium ${isCorrect ? 'text-green-700' : 'text-red-700'}`}
                    >
                      {studentOption?.text ?? '—'}
                    </span>
                  </p>

                  {!isCorrect && correctOption && (
                    <p className="text-xs ml-5 mt-0.5">
                      Correct answer:{' '}
                      <span className="font-medium text-green-700">{correctOption.text}</span>
                    </p>
                  )}

                  {detail?.explanation && (
                    <p className="ml-5 mt-2 border border-vlab-rule bg-white/70 p-2 text-xs text-vlab-muted">
                      {detail.explanation}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Retry button */}
        {(attemptsRemaining === null || attemptsRemaining > 0) && (
          <button
            onClick={() => {
              setResult(null)
              setAnswers({})
              setError(null)
            }}
            className="border border-vlab-rule-strong px-4 py-2 font-chrome text-[13px] font-semibold text-vlab-steel transition-colors hover:border-vlab-600 hover:text-vlab-800"
          >
            Try again
            {attemptsRemaining !== null && ` (${attemptsRemaining} left)`}
          </button>
        )}
      </div>
    )
  }

  // Form view
  return (
    <div className="space-y-5">
      {/* Assessment particulars, stated as facts rather than dressed as a card.
          The reference's pre/post test pages are austere: a bold question, a
          plain column of answers, a Submit Quiz button. */}
      <div className="border border-vlab-rule-strong">
        <div className="vlab-panel-header">{quiz.title}</div>
        <div className="px-4 py-3">
          {quiz.description && (
            <p className="mb-2 text-sm leading-relaxed text-vlab-muted">{quiz.description}</p>
          )}
          <dl className="flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
            <div className="flex gap-1.5">
              <dt className="text-vlab-muted">Questions:</dt>
              <dd className="font-semibold tabular-nums text-vlab-ink">{questions.length}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-vlab-muted">Pass mark:</dt>
              <dd className="font-semibold tabular-nums text-vlab-ink">{passingPct}%</dd>
            </div>
            {attemptsRemaining !== null && (
              <div className="flex gap-1.5">
                <dt className="text-vlab-muted">Attempt:</dt>
                <dd className="font-semibold tabular-nums text-vlab-ink">
                  {/* Once the cap is reached there is no "next" attempt to
                      number, and counting one past it read "2 of 1". */}
                  {Math.min(existingAttempts + 1, effectiveMaxAttempts ?? Infinity)} of{' '}
                  {effectiveMaxAttempts}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {!canAttempt ? (
        <div className="border border-vlab-rule-strong bg-vlab-surface-alt px-4 py-6 text-center text-sm text-vlab-muted">
          You have used all allowed attempts for this quiz.
        </div>
      ) : (
        <>
          <ol className="space-y-4">
            {questions.map((q, idx) => (
              <li key={q.id} className="border border-vlab-rule-strong p-4">
                {/* OBSERVED `.question { font-weight: 900 }` — the reference
                    sets its questions in the heaviest weight it has. */}
                <p className="mb-3 font-chrome text-[15px] font-extrabold leading-snug text-vlab-ink">
                  <span className="mr-1.5 text-vlab-600">Q{idx + 1}.</span>
                  {q.question_text}
                </p>
                {/* OBSERVED `.answers { display: flex; flex-direction: column }` */}
                <div className="flex flex-col gap-1.5">
                  {q.options.map((option) => {
                    const selected = answers[q.id] === option.id
                    return (
                      <label
                        key={option.id}
                        className={`flex cursor-pointer items-center gap-3 border px-3 py-2 transition-colors ${
                          selected
                            ? 'border-vlab-600 bg-vlab-50'
                            : 'border-vlab-rule hover:border-vlab-rule-strong hover:bg-vlab-surface-alt'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`question-${q.id}`}
                          value={option.id}
                          checked={selected}
                          onChange={() => handleAnswer(q.id, option.id)}
                          className="accent-vlab-600"
                        />
                        <span className="text-sm text-vlab-ink">{option.text}</span>
                      </label>
                    )
                  })}
                </div>
              </li>
            ))}
          </ol>

          {error && (
            <div className="flex items-start gap-2.5 border border-red-300 bg-red-50 p-3.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!allAnswered || isPending}
            className="w-full border border-vlab-600 bg-vlab-600 py-2.5 font-chrome text-sm font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </span>
            ) : (
              'Submit Quiz'
            )}
          </button>
        </>
      )}
    </div>
  )
}
