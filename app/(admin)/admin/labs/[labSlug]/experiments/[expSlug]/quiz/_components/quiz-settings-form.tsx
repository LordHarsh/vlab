'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { updateQuiz } from '@/lib/actions/admin'
import type { Tables } from '@/types/database'

type Quiz = Tables<'quizzes'>

export function QuizSettingsForm({ quiz }: { quiz: Quiz }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [title, setTitle] = useState(quiz.title)
  const [description, setDescription] = useState(quiz.description ?? '')
  const [timeLimit, setTimeLimit] = useState(quiz.time_limit_minutes?.toString() ?? '')
  const [maxAttempts, setMaxAttempts] = useState(quiz.default_max_attempts?.toString() ?? '')
  const [passingPct, setPassingPct] = useState(quiz.default_passing_percentage?.toString() ?? '60')
  const [showScore, setShowScore] = useState(quiz.default_show_score ?? true)
  const [showAnswers, setShowAnswers] = useState(quiz.default_show_answers ?? 'after_submission')
  const [randomize, setRandomize] = useState(quiz.randomize_questions ?? false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    startTransition(async () => {
      const result = await updateQuiz(quiz.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        time_limit_minutes: timeLimit ? parseInt(timeLimit) : undefined,
        default_max_attempts: maxAttempts ? parseInt(maxAttempts) : undefined,
        default_passing_percentage: passingPct ? parseInt(passingPct) : undefined,
        default_show_score: showScore,
        default_show_answers: showAnswers,
        randomize_questions: randomize,
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to update quiz settings')
      } else {
        setSuccess(true)
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Time Limit (minutes)</label>
        <input
          type="number"
          value={timeLimit}
          onChange={(e) => setTimeLimit(e.target.value)}
          placeholder="No limit"
          min={1}
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Max Attempts</label>
        <input
          type="number"
          value={maxAttempts}
          onChange={(e) => setMaxAttempts(e.target.value)}
          placeholder="Unlimited"
          min={1}
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Passing % (default)</label>
        <input
          type="number"
          value={passingPct}
          onChange={(e) => setPassingPct(e.target.value)}
          min={0}
          max={100}
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Show Answers</label>
        <select
          value={showAnswers}
          onChange={(e) => setShowAnswers(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white"
        >
          <option value="immediately">Immediately</option>
          <option value="after_submission">After Submission</option>
          <option value="after_due_date">After Due Date</option>
          <option value="never">Never</option>
        </select>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[#6a6a6a]">Show Score</label>
        <button
          type="button"
          onClick={() => setShowScore(!showScore)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            showScore ? 'bg-[#ff385c]' : 'bg-[#c1c1c1]'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              showScore ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[#6a6a6a]">Randomize Questions</label>
        <button
          type="button"
          onClick={() => setRandomize(!randomize)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            randomize ? 'bg-[#ff385c]' : 'bg-[#c1c1c1]'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              randomize ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {error && (
        <p className="text-xs text-[#c13515] bg-[#fff0f0] border border-[#ffd0d0] rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-[#00a699] bg-[#e6f9f5] border border-[#b3ecde] rounded-lg px-3 py-2">
          Settings saved.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#ff385c] text-white text-sm font-medium hover:bg-[#e0314f] transition-colors disabled:opacity-50"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Save Settings
      </button>
    </form>
  )
}
