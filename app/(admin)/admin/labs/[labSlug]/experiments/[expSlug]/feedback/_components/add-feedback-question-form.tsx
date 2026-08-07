'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, X } from 'lucide-react'
import { addFeedbackQuestion } from '@/lib/actions/admin'

type QuestionType = 'rating' | 'text' | 'scale' | 'multiple_choice'

export function AddFeedbackQuestionForm({ formId }: { formId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [questionText, setQuestionText] = useState('')
  const [questionType, setQuestionType] = useState<QuestionType>('rating')
  const [isRequired, setIsRequired] = useState(false)

  // For rating/scale: min/max labels
  const [minLabel, setMinLabel] = useState('')
  const [maxLabel, setMaxLabel] = useState('')
  const [minValue, setMinValue] = useState('1')
  const [maxValue, setMaxValue] = useState('5')

  // For multiple_choice: list of options
  const [mcOptions, setMcOptions] = useState<string[]>(['', ''])

  function addMcOption() {
    setMcOptions((prev) => [...prev, ''])
  }

  function removeMcOption(idx: number) {
    setMcOptions((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateMcOption(idx: number, val: string) {
    setMcOptions((prev) => prev.map((o, i) => (i === idx ? val : o)))
  }

  function buildOptions(): unknown {
    if (questionType === 'multiple_choice') {
      return mcOptions.filter((o) => o.trim()).map((text, i) => ({ id: String(i), text }))
    }
    return null
  }

  function buildConfig(): unknown {
    if (questionType === 'rating' || questionType === 'scale') {
      return {
        min: parseInt(minValue),
        max: parseInt(maxValue),
        min_label: minLabel || undefined,
        max_label: maxLabel || undefined,
      }
    }
    return null
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!questionText.trim()) return
    setError(null)

    startTransition(async () => {
      const result = await addFeedbackQuestion(formId, {
        question_text: questionText.trim(),
        question_type: questionType,
        options: buildOptions(),
        config: buildConfig(),
        is_required: isRequired,
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to add question')
        return
      }
      setQuestionText('')
      setQuestionType('rating')
      setIsRequired(false)
      setMinLabel('')
      setMaxLabel('')
      setMinValue('1')
      setMaxValue('5')
      setMcOptions(['', ''])
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-vlab-muted mb-1">
          Question Text <span className="text-vlab-600">*</span>
        </label>
        <textarea
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          placeholder="How would you rate this experiment?"
          rows={2}
          required
          className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-vlab-muted mb-1">
            Question Type <span className="text-vlab-600">*</span>
          </label>
          <select
            value={questionType}
            onChange={(e) => setQuestionType(e.target.value as QuestionType)}
            className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition bg-white"
          >
            <option value="rating">Rating (stars/emoji)</option>
            <option value="text">Text (open-ended)</option>
            <option value="scale">Scale (numeric)</option>
            <option value="multiple_choice">Multiple Choice</option>
          </select>
        </div>
        <div className="flex items-end">
          <div className="flex items-center justify-between w-full">
            <label className="text-xs font-medium text-vlab-muted">Required</label>
            <button
              type="button"
              onClick={() => setIsRequired(!isRequired)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                isRequired ? 'bg-vlab-600' : 'bg-vlab-rule-strong'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  isRequired ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Rating / Scale config */}
      {(questionType === 'rating' || questionType === 'scale') && (
        <div className="bg-vlab-surface-alt rounded-lg border border-vlab-rule p-4 space-y-3">
          <p className="text-xs font-medium text-vlab-muted">Scale Configuration</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-vlab-muted mb-1">Min Value</label>
              <input
                type="number"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
              />
            </div>
            <div>
              <label className="block text-xs text-vlab-muted mb-1">Max Value</label>
              <input
                type="number"
                value={maxValue}
                onChange={(e) => setMaxValue(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-vlab-muted mb-1">Min Label (optional)</label>
              <input
                type="text"
                value={minLabel}
                onChange={(e) => setMinLabel(e.target.value)}
                placeholder="e.g. Poor"
                className="w-full px-3 py-1.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
              />
            </div>
            <div>
              <label className="block text-xs text-vlab-muted mb-1">Max Label (optional)</label>
              <input
                type="text"
                value={maxLabel}
                onChange={(e) => setMaxLabel(e.target.value)}
                placeholder="e.g. Excellent"
                className="w-full px-3 py-1.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
              />
            </div>
          </div>
        </div>
      )}

      {/* Multiple choice options */}
      {questionType === 'multiple_choice' && (
        <div className="bg-vlab-surface-alt rounded-lg border border-vlab-rule p-4 space-y-2">
          <p className="text-xs font-medium text-vlab-muted mb-2">Options</p>
          {mcOptions.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={opt}
                onChange={(e) => updateMcOption(idx, e.target.value)}
                placeholder={`Option ${idx + 1}`}
                className="flex-1 px-3 py-1.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
              />
              {mcOptions.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeMcOption(idx)}
                  className="p-1.5 rounded-lg text-vlab-muted hover:bg-vlab-rule transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addMcOption}
            className="inline-flex items-center gap-1 text-xs text-vlab-600 font-medium hover:underline mt-1"
          >
            <Plus className="w-3 h-3" />
            Add Option
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || !questionText.trim()}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-vlab-600 text-white text-sm font-medium hover:bg-vlab-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Add Question
      </button>
    </form>
  )
}
