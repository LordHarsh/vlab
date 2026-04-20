'use client'

import { useEffect, useState, useTransition } from 'react'
import { useSupabaseClient } from '@/lib/supabase/client'
import { submitQuiz, type QuizResult } from '@/lib/actions/quiz'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
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
  const [isPending, startTransition] = useTransition()

  const [loading, setLoading] = useState(true)
  const [quiz, setQuiz] = useState<QuizData | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [existingAttempts, setExistingAttempts] = useState(0)
  const [classSettings, setClassSettings] = useState<ClassSettings | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startTime] = useState(Date.now())

  useEffect(() => {
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
    if (!quiz) return

    async function countAttempts() {
      const { count } = await supabase
        .from('quiz_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('quiz_id', quizId)
        .eq('class_id', classId)

      setExistingAttempts(count ?? 0)
    }

    countAttempts()
  }, [quiz, quizId, classId, supabase])

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
    const timeTaken = Math.round((Date.now() - startTime) / 1000)

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
        <Loader2 className="w-6 h-6 text-[#6a6a6a] animate-spin" />
      </div>
    )
  }

  if (error && !result) {
    return (
      <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
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
        {/* Score card */}
        <div
          className={`rounded-2xl p-6 border ${
            result.passed
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <div className="flex items-start gap-4">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                result.passed ? 'bg-green-100' : 'bg-red-100'
              }`}
            >
              {result.passed ? (
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600" />
              )}
            </div>
            <div>
              <p
                className={`font-700 text-lg ${
                  result.passed ? 'text-green-800' : 'text-red-800'
                }`}
              >
                {result.passed ? 'Passed!' : 'Not passed'}
              </p>
              <p
                className={`text-sm ${result.passed ? 'text-green-700' : 'text-red-700'}`}
              >
                {result.percentage}% · {result.score}/{result.maxScore} points
              </p>
              <p className="text-xs text-[#6a6a6a] mt-1">
                Attempt #{result.attemptNumber}
                {effectiveMaxAttempts !== null &&
                  ` of ${effectiveMaxAttempts}`}
              </p>
            </div>
          </div>
        </div>

        {/* Answer review */}
        {result.showAnswers && result.answerDetails && result.answerDetails.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-600 text-[#222222]">Answer Review</h3>
            {questions.map((q, idx) => {
              const detail = result.answerDetails?.find((d) => d.questionId === q.id)
              const studentAnswerId = answers[q.id]
              const studentOption = q.options.find((o) => o.id === studentAnswerId)
              const correctOption = q.options.find((o) => o.id === detail?.correctAnswerId)
              const isCorrect = detail?.isCorrect ?? false

              return (
                <div
                  key={q.id}
                  className={`rounded-xl p-4 border ${
                    isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-xs font-600 text-[#6a6a6a] shrink-0 mt-0.5">
                      Q{idx + 1}
                    </span>
                    <p className="text-sm text-[#222222] font-500">{q.question_text}</p>
                    {isCorrect ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 ml-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 shrink-0 ml-auto" />
                    )}
                  </div>

                  <p className="text-xs text-[#6a6a6a] ml-5">
                    Your answer:{' '}
                    <span
                      className={`font-500 ${isCorrect ? 'text-green-700' : 'text-red-700'}`}
                    >
                      {studentOption?.text ?? '—'}
                    </span>
                  </p>

                  {!isCorrect && correctOption && (
                    <p className="text-xs ml-5 mt-0.5">
                      Correct answer:{' '}
                      <span className="font-500 text-green-700">{correctOption.text}</span>
                    </p>
                  )}

                  {detail?.explanation && (
                    <p className="text-xs text-[#6a6a6a] ml-5 mt-2 p-2 bg-white/60 rounded-lg">
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
            className="px-4 py-2.5 border border-[#c1c1c1] rounded-xl text-sm text-[#222222] hover:border-[#ff385c] hover:text-[#ff385c] transition-colors"
          >
            Try Again
            {attemptsRemaining !== null && ` (${attemptsRemaining} left)`}
          </button>
        )}
      </div>
    )
  }

  // Form view
  return (
    <div className="space-y-5">
      {/* Quiz header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#ff385c]/10 flex items-center justify-center shrink-0">
          <HelpCircle className="w-5 h-5 text-[#ff385c]" />
        </div>
        <div>
          <h2 className="text-base font-600 text-[#222222]">{quiz.title}</h2>
          {quiz.description && (
            <p className="text-xs text-[#6a6a6a] mt-0.5">{quiz.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-[#6a6a6a]">
            <span>{questions.length} question{questions.length !== 1 ? 's' : ''}</span>
            <span>Pass: {passingPct}%</span>
            {attemptsRemaining !== null && (
              <span>
                Attempt{existingAttempts > 0 ? ` ${existingAttempts + 1}` : ''} of{' '}
                {effectiveMaxAttempts}
              </span>
            )}
          </div>
        </div>
      </div>

      {!canAttempt ? (
        <div className="p-4 bg-[#f2f2f2] rounded-xl text-sm text-[#6a6a6a] text-center">
          You have used all allowed attempts for this quiz.
        </div>
      ) : (
        <>
          {/* Questions */}
          <div className="space-y-5">
            {questions.map((q, idx) => (
              <div
                key={q.id}
                className="bg-white rounded-xl border border-[#c1c1c1] p-5"
                style={{
                  boxShadow:
                    'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px',
                }}
              >
                <p className="text-sm font-600 text-[#222222] mb-3">
                  <span className="text-[#ff385c] mr-1">Q{idx + 1}.</span>
                  {q.question_text}
                </p>
                <div className="space-y-2">
                  {q.options.map((option) => {
                    const selected = answers[q.id] === option.id
                    return (
                      <label
                        key={option.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                          selected
                            ? 'border-[#ff385c] bg-[#ff385c]/5'
                            : 'border-[#f2f2f2] hover:border-[#c1c1c1] hover:bg-[#f2f2f2]/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`question-${q.id}`}
                          value={option.id}
                          checked={selected}
                          onChange={() => handleAnswer(q.id, option.id)}
                          className="accent-[#ff385c]"
                        />
                        <span className="text-sm text-[#222222]">{option.text}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 rounded-xl border border-red-200">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!allAnswered || isPending}
            className="w-full py-3 bg-[#ff385c] text-white rounded-xl text-sm font-600 hover:bg-[#e0324f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting...
              </span>
            ) : (
              'Submit Answers'
            )}
          </button>
        </>
      )}
    </div>
  )
}
