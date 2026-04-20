'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { archiveFeedbackQuestion } from '@/lib/actions/admin'
import type { Tables } from '@/types/database'

type FeedbackQuestion = Tables<'feedback_questions'>

const TYPE_LABELS: Record<string, string> = {
  rating: 'Rating',
  text: 'Text',
  scale: 'Scale',
  multiple_choice: 'Multiple Choice',
}

const TYPE_COLORS: Record<string, string> = {
  rating: 'bg-yellow-50 text-yellow-700',
  text: 'bg-blue-50 text-blue-700',
  scale: 'bg-purple-50 text-purple-700',
  multiple_choice: 'bg-green-50 text-green-700',
}

export function FeedbackQuestionsList({ questions }: { questions: FeedbackQuestion[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  function handleArchive(id: string) {
    if (!confirm('Archive this question?')) return
    setPendingId(id)
    startTransition(async () => {
      await archiveFeedbackQuestion(id)
      router.refresh()
      setPendingId(null)
    })
  }

  if (questions.length === 0) {
    return (
      <p className="text-sm text-[#6a6a6a] text-center py-6">
        No questions yet. Add one below.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {questions.map((q, idx) => (
        <div
          key={q.id}
          className="flex items-start gap-3 p-3 rounded-xl border border-[#e8e8e8] hover:border-[#c1c1c1] transition-colors"
        >
          <span className="w-6 h-6 rounded-full bg-[#f2f2f2] flex items-center justify-center text-xs font-bold text-[#6a6a6a] shrink-0 mt-0.5">
            {idx + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#222222]">{q.question_text}</p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  TYPE_COLORS[q.question_type] ?? 'bg-[#f2f2f2] text-[#6a6a6a]'
                }`}
              >
                {TYPE_LABELS[q.question_type] ?? q.question_type}
              </span>
              {q.is_required && (
                <span className="text-xs text-[#ff385c] font-medium">Required</span>
              )}
            </div>
          </div>
          <button
            onClick={() => handleArchive(q.id)}
            disabled={isPending && pendingId === q.id}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#6a6a6a] bg-[#f2f2f2] hover:bg-[#e8e8e8] transition-colors disabled:opacity-50 shrink-0"
          >
            <Archive className="w-3 h-3" />
            Archive
          </button>
        </div>
      ))}
    </div>
  )
}
