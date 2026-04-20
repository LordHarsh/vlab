'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { addQuizQuestion } from '@/lib/actions/admin'

const DEFAULT_OPTIONS = [
  { id: 'a', text: '' },
  { id: 'b', text: '' },
  { id: 'c', text: '' },
  { id: 'd', text: '' },
]

export function AddQuestionForm({ quizId }: { quizId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [questionText, setQuestionText] = useState('')
  const [options, setOptions] = useState(DEFAULT_OPTIONS.map((o) => ({ ...o })))
  const [correctAnswer, setCorrectAnswer] = useState('a')
  const [explanation, setExplanation] = useState('')
  const [points, setPoints] = useState('1')

  function updateOption(idx: number, text: string) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, text } : o)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!questionText.trim() || options.some((o) => !o.text.trim())) return
    setError(null)

    startTransition(async () => {
      const result = await addQuizQuestion(quizId, {
        question_text: questionText.trim(),
        options: options.map((o) => ({ id: o.id, text: o.text.trim() })),
        correct_answer: correctAnswer,
        explanation: explanation.trim() || undefined,
        points: parseInt(points),
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to add question')
        return
      }
      // Reset form
      setQuestionText('')
      setOptions(DEFAULT_OPTIONS.map((o) => ({ ...o })))
      setCorrectAnswer('a')
      setExplanation('')
      setPoints('1')
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">
          Question Text <span className="text-[#ff385c]">*</span>
        </label>
        <textarea
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          placeholder="Enter your question..."
          rows={2}
          required
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-[#6a6a6a]">
          Options <span className="text-[#ff385c]">*</span>
        </label>
        {options.map((opt, idx) => (
          <div key={opt.id} className="flex items-center gap-2">
            <input
              type="radio"
              name="correctAnswer"
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Explanation</label>
          <input
            type="text"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Optional..."
            className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
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
            className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-[#c13515] bg-[#fff0f0] border border-[#ffd0d0] rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || !questionText.trim() || options.some((o) => !o.text.trim())}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#ff385c] text-white text-sm font-medium hover:bg-[#e0314f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Add Question
      </button>
    </form>
  )
}
