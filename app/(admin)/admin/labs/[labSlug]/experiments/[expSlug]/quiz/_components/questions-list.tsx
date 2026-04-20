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
    return <p className="text-sm text-[#6a6a6a] text-center py-6">No questions yet. Add one below.</p>
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
            className="border border-[#e8e8e8] rounded-xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center gap-3 p-3">
              <span className="w-6 h-6 rounded-full bg-[#f2f2f2] flex items-center justify-center text-xs font-bold text-[#6a6a6a] shrink-0">
                {idx + 1}
              </span>
              <p className="flex-1 text-sm text-[#222222] line-clamp-2">{q.question_text}</p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setEditingId(isEditing ? null : q.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#6a6a6a] bg-[#f2f2f2] hover:bg-[#e8e8e8] transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => handleArchive(q.id)}
                  disabled={isPending && pendingId === q.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#ff385c] bg-[#fff0f2] hover:bg-[#ffe0e5] transition-colors disabled:opacity-50"
                >
                  <Archive className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : q.id)}
                  className="p-1.5 rounded-lg text-[#6a6a6a] hover:bg-[#f2f2f2] transition-colors"
                >
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Expanded view */}
            {isExpanded && !isEditing && (
              <div className="border-t border-[#f2f2f2] p-3 bg-[#fafafa]">
                <div className="space-y-1.5 mb-3">
                  {options.map((opt) => (
                    <div
                      key={opt.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                        opt.id === q.correct_answer
                          ? 'bg-[#e6f9f5] border border-[#b3ecde] text-[#00a699]'
                          : 'bg-white border border-[#e8e8e8] text-[#222222]'
                      }`}
                    >
                      <span className="font-mono text-xs uppercase font-bold w-5">{opt.id}</span>
                      <span>{opt.text}</span>
                    </div>
                  ))}
                </div>
                {q.explanation && (
                  <p className="text-xs text-[#6a6a6a] bg-[#fffbe6] border border-[#ffe999] rounded-lg px-3 py-2">
                    <span className="font-medium">Explanation:</span> {q.explanation}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-[#6a6a6a]">
                  <span>{q.points} pt{q.points !== 1 ? 's' : ''}</span>
                  <span className="capitalize">{q.question_type.replace('_', ' ')}</span>
                </div>
              </div>
            )}

            {/* Inline edit form */}
            {isEditing && (
              <div className="border-t border-[#f2f2f2] p-4 bg-[#fafafa]">
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
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Question Text</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          required
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-[#6a6a6a]">Options</label>
        {options.map((opt, idx) => (
          <div key={opt.id} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct"
              value={opt.id}
              checked={correctAnswer === opt.id}
              onChange={() => setCorrectAnswer(opt.id)}
              className="accent-[#ff385c]"
            />
            <span className="text-xs font-mono font-bold text-[#6a6a6a] w-4 uppercase">{opt.id}</span>
            <input
              type="text"
              value={opt.text}
              onChange={(e) => updateOption(idx, e.target.value)}
              placeholder={`Option ${opt.id.toUpperCase()}`}
              required
              className="flex-1 px-3 py-1.5 rounded-lg border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
            />
          </div>
        ))}
        <p className="text-xs text-[#6a6a6a]">Select the radio button next to the correct answer.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Explanation</label>
          <input
            type="text"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Optional explanation..."
            className="w-full px-3 py-1.5 rounded-lg border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Points</label>
          <input
            type="number"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            min={1}
            required
            className="w-full px-3 py-1.5 rounded-lg border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-[#c13515] bg-[#fff0f0] border border-[#ffd0d0] rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#ff385c] text-white text-xs font-medium hover:bg-[#e0314f] transition-colors disabled:opacity-50"
        >
          {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
          Save (archive old, create new)
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3.5 py-2 rounded-xl text-xs font-medium text-[#6a6a6a] hover:bg-[#f2f2f2] transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
