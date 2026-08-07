'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createSection } from '@/lib/actions/admin'

const SECTION_TYPES = [
  'aim', 'theory', 'components', 'circuit', 'procedure',
  'code', 'simulation', 'quiz', 'feedback', 'references', 'text', 'video',
] as const

export function AddSectionForm({
  experimentId,
  currentCount,
}: {
  experimentId: string
  currentCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<string>('text')
  const [title, setTitle] = useState('')
  const [isRequired, setIsRequired] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createSection(
        experimentId,
        type,
        title.trim() || type.charAt(0).toUpperCase() + type.slice(1),
        currentCount + 1,
        {},
        isRequired,
      )
      if (!result.success) {
        setError(result.error ?? 'Failed to create section')
        return
      }
      setType('text')
      setTitle('')
      setIsRequired(false)
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-vlab-muted mb-1">
            Section Type <span className="text-vlab-600">*</span>
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition bg-white"
          >
            {SECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-vlab-muted mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Leave empty to use type"
            className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
          />
        </div>
      </div>

      {/* is_required toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsRequired((v) => !v)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            isRequired ? 'bg-vlab-600' : 'bg-vlab-rule-strong'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            isRequired ? 'translate-x-4' : 'translate-x-1'
          }`} />
        </button>
        <span className="text-xs text-vlab-muted">Required section</span>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-vlab-600 text-white text-sm font-medium hover:bg-vlab-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Add Section
      </button>
    </form>
  )
}
