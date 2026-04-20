'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createSection } from '@/lib/actions/admin'

const SECTION_TYPES = [
  'aim',
  'theory',
  'components',
  'circuit',
  'procedure',
  'code',
  'simulation',
  'quiz',
  'feedback',
  'references',
  'text',
  'video',
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
      )
      if (!result.success) {
        setError(result.error ?? 'Failed to create section')
        return
      }
      setType('text')
      setTitle('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">
            Section Type <span className="text-[#ff385c]">*</span>
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white capitalize"
          >
            {SECTION_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Leave empty to use type as title"
            className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
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
        disabled={isPending}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#ff385c] text-white text-sm font-medium hover:bg-[#e0314f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Add Section
      </button>
    </form>
  )
}
