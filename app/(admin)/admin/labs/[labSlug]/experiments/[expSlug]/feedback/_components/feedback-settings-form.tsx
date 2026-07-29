'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { updateFeedbackForm } from '@/lib/actions/admin'
import type { Tables } from '@/types/database'

type FeedbackForm = Tables<'feedback_forms'>

export function FeedbackSettingsForm({ form }: { form: FeedbackForm }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [title, setTitle] = useState(form.title)
  const [description, setDescription] = useState(form.description ?? '')
  const [isEnabled, setIsEnabled] = useState(form.is_enabled)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    startTransition(async () => {
      const result = await updateFeedbackForm(form.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        is_enabled: isEnabled,
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to update form settings')
      } else {
        setSuccess(true)
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-vlab-muted mb-1">Form Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-vlab-muted mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Brief description for students..."
          className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition resize-none"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-vlab-muted">Form Enabled</label>
        <button
          type="button"
          onClick={() => setIsEnabled(!isEnabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            isEnabled ? 'bg-vlab-600' : 'bg-vlab-rule-strong'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              isEnabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-vlab-green-ink bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          Settings saved.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-vlab-600 text-white text-sm font-medium hover:bg-vlab-700 transition-colors disabled:opacity-50"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Save Settings
      </button>
    </form>
  )
}
