'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Pencil, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { archiveQuizQuestion, editQuizQuestion } from '@/lib/actions/admin'
import type { Tables, Json } from '@/types/database'

type Question = Tables<'quiz_questions'>
type OptionItem = { id: string; text: string }

function isOptionArray(val: Json): val is { id: string; text: string }[] {
  return Array.isArray(val)
}

export function QuestionsList({ questions }: { questions: Question[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  function handleArchive(id: string) {
    if (!confirm('Archive this question?')) return
    setPendingId(id)
    startTransition(async () => {
      await archiveQuizQuestion(id)
      router.refresh()
      setPendingId(null)
    })
  }

  if (questions.length === 0) {
    return <p className="text-sm text-vlab-muted text-center py-6">No questions yet. Add one below.</p>
  }

  return (
    <div className="space-y-3">
      {questions.map((q, idx) => {
        const options = isOptionArray(q.options) ? q.options as OptionItem[] : []
        const isExpanded = expandedId === q.id
        const isEditing = editingId === q.id

        return (
          <div
            key={q.id}
            className="border border-vlab-rule rounded-lg overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center gap-3 p-3">
              <span className="w-6 h-6 rounded-full bg-vlab-surface flex items-center justify-center text-xs font-bold text-vlab-muted shrink-0">
                {idx + 1}
              </span>
              <p className="flex-1 text-sm text-vlab-ink line-clamp-2">{q.question_text}</p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setEditingId(isEditing ? null : q.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-vlab-muted bg-vlab-surface hover:bg-vlab-rule transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => handleArchive(q.id)}
                  disabled={isPending && pendingId === q.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-vlab-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  <Archive className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : q.id)}
                  className="p-1.5 rounded-lg text-vlab-muted hover:bg-vlab-surface transition-colors"
                >
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Expanded view */}
            {isExpanded && !isEditing && (
              <div className="border-t border-vlab-surface p-3 bg-vlab-surface-alt">
                <div className="space-y-1.5 mb-3">
                  {options.map((opt) => (
                    <div
                      key={opt.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                        opt.id === q.correct_answer
                          ? 'bg-green-50 border border-green-200 text-vlab-green-ink'
                          : 'bg-white border border-vlab-rule text-vlab-ink'
                      }`}
                    >
                      <span className="font-mono text-xs uppercase font-bold w-5">{opt.id}</span>
                      <span>{opt.text}</span>
                    </div>
                  ))}
                </div>
                {q.explanation && (
                  <p className="text-xs text-vlab-muted bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <span className="font-medium">Explanation:</span> {q.explanation}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-vlab-muted">
                  <span>{q.points} pt{q.points !== 1 ? 's' : ''}</span>
                  <span className="capitalize">{q.question_type.replace('_', ' ')}</span>
                </div>
              </div>
            )}

            {/* Inline edit form */}
            {isEditing && (
              <div className="border-t border-vlab-surface p-4 bg-vlab-surface-alt">
                <EditQuestionForm
                  question={q}
                  options={options}
                  onDone={() => { setEditingId(null); router.refresh() }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function EditQuestionForm({
  question,
  options: initOptions,
  onDone,
  onCancel,
}: {
  question: Question
  options: OptionItem[]
  onDone: () => void
  onCancel: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [text, setText] = useState(question.question_text)
  const [options, setOptions] = useState<OptionItem[]>(
    initOptions.length > 0
      ? initOptions
      : [
          { id: 'a', text: '' },
          { id: 'b', text: '' },
          { id: 'c', text: '' },
          { id: 'd', text: '' },
        ],
  )
  const [correctAnswer, setCorrectAnswer] = useState(question.correct_answer)
  const [explanation, setExplanation] = useState(question.explanation ?? '')
  const [points, setPoints] = useState(question.points.toString())

  function updateOption(idx: number, text: string) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, text } : o)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await editQuizQuestion(question.id, {
        question_text: text.trim(),
        options,
        correct_answer: correctAnswer,
        explanation: explanation.trim() || undefined,
        points: parseInt(points),
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to save question')
      } else {
        onDone()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-vlab-muted mb-1">Question Text</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          required
          className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-vlab-muted">Options</label>
        {options.map((opt, idx) => (
          <div key={opt.id} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct"
              value={opt.id}
              checked={correctAnswer === opt.id}
              onChange={() => setCorrectAnswer(opt.id)}
              className="accent-vlab-600"
            />
            <span className="text-xs font-mono font-bold text-vlab-muted w-4 uppercase">{opt.id}</span>
            <input
              type="text"
              value={opt.text}
              onChange={(e) => updateOption(idx, e.target.value)}
              placeholder={`Option ${opt.id.toUpperCase()}`}
              required
              className="flex-1 px-3 py-1.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
            />
          </div>
        ))}
        <p className="text-xs text-vlab-muted">Select the radio button next to the correct answer.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-vlab-muted mb-1">Explanation</label>
          <input
            type="text"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Optional explanation..."
            className="w-full px-3 py-1.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-vlab-muted mb-1">Points</label>
          <input
            type="number"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            min={1}
            required
            className="w-full px-3 py-1.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-vlab-600 text-white text-xs font-medium hover:bg-vlab-700 transition-colors disabled:opacity-50"
        >
          {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
          Save (archive old, create new)
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3.5 py-2 rounded-lg text-xs font-medium text-vlab-muted hover:bg-vlab-surface transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
