'use client'

import { useEffect, useState, useTransition } from 'react'
import { useSupabaseClient } from '@/lib/supabase/client'
import { useUser } from '@clerk/nextjs'
import { submitFeedback, type FeedbackAnswer } from '@/lib/actions/feedback'
import {
  Loader2,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Star,
} from 'lucide-react'

type FeedbackQuestion = {
  id: string
  question_text: string
  question_type: string
  options: Array<{ id: string; text: string }> | null
  config: Record<string, unknown> | null
  is_required: boolean
  order_index: number
}

type FormData = {
  id: string
  title: string
  description: string | null
  is_enabled: boolean
}

function StarRating({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const [hovered, setHovered] = useState(0)

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="transition-transform hover:scale-110"
        >
          <Star
            className={`w-7 h-7 transition-colors ${
              star <= (hovered || value)
                ? 'text-amber-400 fill-amber-400'
                : 'text-[#c1c1c1]'
            }`}
          />
        </button>
      ))}
    </div>
  )
}

function ScaleSlider({
  value,
  onChange,
  min = 1,
  max = 10,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <div className="space-y-2">
      <input
        type="range"
        min={min}
        max={max}
        value={value || min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#ff385c]"
      />
      <div className="flex justify-between text-xs text-[#6a6a6a]">
        <span>{min}</span>
        <span className="font-600 text-[#ff385c]">{value || min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

export function FeedbackSection({
  formId,
  experimentId,
  classId,
}: {
  formId: string
  experimentId: string
  classId: string
}) {
  const supabase = useSupabaseClient()
  const { user } = useUser()
  const [isPending, startTransition] = useTransition()

  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormData | null>(null)
  const [questions, setQuestions] = useState<FeedbackQuestion[]>([])
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string | number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)

      const [formRes, questionsRes] = await Promise.all([
        supabase
          .from('feedback_forms')
          .select('id, title, description, is_enabled')
          .eq('id', formId)
          .single(),
        supabase
          .from('feedback_questions')
          .select('id, question_text, question_type, options, config, is_required, order_index')
          .eq('form_id', formId)
          .eq('status', 'active')
          .order('order_index', { ascending: true }),
      ])

      if (formRes.error || !formRes.data) {
        setLoading(false)
        return
      }

      setForm(formRes.data as FormData)
      setQuestions(
        (questionsRes.data ?? []).map((q) => ({
          ...q,
          options: q.options as FeedbackQuestion['options'],
          config: q.config as FeedbackQuestion['config'],
        })),
      )

      // Check existing submission
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('clerk_user_id', user.id)
          .single()

        if (profile) {
          const { data: existing } = await supabase
            .from('feedback_responses')
            .select('id')
            .eq('form_id', formId)
            .eq('student_id', profile.id)
            .eq('experiment_id', experimentId)
            .eq('class_id', classId)
            .single()

          if (existing) setAlreadySubmitted(true)
        }
      }

      setLoading(false)
    }

    load()
  }, [formId, experimentId, classId, supabase, user])

  function setAnswer(questionId: string, value: string | number) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Validate required questions
    const missing = questions.filter(
      (q) => q.is_required && answers[q.id] === undefined,
    )
    if (missing.length > 0) {
      setError('Please answer all required questions.')
      return
    }

    startTransition(async () => {
      const feedbackAnswers: FeedbackAnswer[] = questions
        .filter((q) => answers[q.id] !== undefined)
        .map((q) => ({
          questionId: q.id,
          questionTextSnapshot: q.question_text,
          answer: answers[q.id],
        }))

      const res = await submitFeedback(formId, experimentId, classId, feedbackAnswers)
      if (res.success) {
        setSubmitted(true)
      } else {
        setError(res.error ?? 'Failed to submit. Please try again.')
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

  if (!form || !form.is_enabled) {
    return (
      <div className="py-8 text-center text-[#6a6a6a] text-sm">
        Feedback is not available for this experiment.
      </div>
    )
  }

  if (alreadySubmitted || submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <div>
          <p className="font-600 text-[#222222] mb-1">Thank you for your feedback!</p>
          <p className="text-sm text-[#6a6a6a]">Your response has been recorded.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#ff385c]/10 flex items-center justify-center shrink-0">
          <MessageSquare className="w-5 h-5 text-[#ff385c]" />
        </div>
        <div>
          <h2 className="text-base font-600 text-[#222222]">{form.title}</h2>
          {form.description && (
            <p className="text-xs text-[#6a6a6a] mt-0.5">{form.description}</p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
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
              <span className="text-[#ff385c] mr-1">{idx + 1}.</span>
              {q.question_text}
              {q.is_required && <span className="text-red-500 ml-0.5">*</span>}
            </p>

            {q.question_type === 'rating' && (
              <StarRating
                value={Number(answers[q.id] ?? 0)}
                onChange={(v) => setAnswer(q.id, v)}
              />
            )}

            {q.question_type === 'scale' && (
              <ScaleSlider
                value={Number(answers[q.id] ?? (q.config?.min as number) ?? 1)}
                onChange={(v) => setAnswer(q.id, v)}
                min={(q.config?.min as number) ?? 1}
                max={(q.config?.max as number) ?? 10}
              />
            )}

            {q.question_type === 'text' && (
              <textarea
                rows={3}
                value={(answers[q.id] as string) ?? ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Type your answer here..."
                className="w-full px-3 py-2.5 border border-[#c1c1c1] rounded-xl text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-2 focus:ring-[#ff385c]/20 resize-none transition-colors"
              />
            )}

            {q.question_type === 'multiple_choice' && q.options && (
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
                        name={`feedback-${q.id}`}
                        value={option.id}
                        checked={selected}
                        onChange={() => setAnswer(q.id, option.id)}
                        className="accent-[#ff385c]"
                      />
                      <span className="text-sm text-[#222222]">{option.text}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="flex items-start gap-2.5 p-3.5 bg-red-50 rounded-xl border border-red-200">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-3 bg-[#ff385c] text-white rounded-xl text-sm font-600 hover:bg-[#e0324f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting...
            </span>
          ) : (
            'Submit Feedback'
          )}
        </button>
      </form>
    </div>
  )
}
