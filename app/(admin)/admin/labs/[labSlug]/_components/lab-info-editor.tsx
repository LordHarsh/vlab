'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { updateLab } from '@/lib/actions/admin'
import type { Tables } from '@/types/database'

type Lab = Tables<'labs'>

export function LabInfoEditor({ lab }: { lab: Lab }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [title, setTitle] = useState(lab.title)
  const [description, setDescription] = useState(lab.description ?? '')
  const [difficulty, setDifficulty] = useState(lab.difficulty ?? '')
  const [tags, setTags] = useState((lab.tags ?? []).join(', '))
  const [published, setPublished] = useState(lab.published)
  const [thumbnailUrl, setThumbnailUrl] = useState(lab.thumbnail_url ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    startTransition(async () => {
      const result = await updateLab(lab.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        difficulty: difficulty || undefined,
        tags: tags.trim() ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        published,
        thumbnail_url: thumbnailUrl.trim() || undefined,
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to update lab')
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
          rows={3}
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Difficulty</label>
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white"
        >
          <option value="">None</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Tags</label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="IoT, Arduino, Python"
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Thumbnail URL</label>
        <input
          type="url"
          value={thumbnailUrl}
          onChange={(e) => setThumbnailUrl(e.target.value)}
          placeholder="https://..."
          className="w-full px-3 py-2 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[#6a6a6a]">Published</label>
        <button
          type="button"
          onClick={() => setPublished(!published)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            published ? 'bg-[#ff385c]' : 'bg-[#c1c1c1]'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              published ? 'translate-x-4' : 'translate-x-0.5'
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
          Saved successfully.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#ff385c] text-white text-sm font-medium hover:bg-[#e0314f] transition-colors disabled:opacity-50"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Save Changes
      </button>
    </form>
  )
}
