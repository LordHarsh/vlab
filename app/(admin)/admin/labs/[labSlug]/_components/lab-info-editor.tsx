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
        <label className="block text-xs font-medium text-vlab-muted mb-1">Title</label>
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
          className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-vlab-muted mb-1">Difficulty</label>
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition bg-white"
        >
          <option value="">None</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-vlab-muted mb-1">Tags</label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="IoT, Arduino, Python"
          className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-vlab-muted mb-1">Thumbnail URL</label>
        <input
          type="url"
          value={thumbnailUrl}
          onChange={(e) => setThumbnailUrl(e.target.value)}
          placeholder="https://..."
          className="w-full px-3 py-2 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-vlab-muted">Published</label>
        <button
          type="button"
          onClick={() => setPublished(!published)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            published ? 'bg-vlab-600' : 'bg-vlab-rule-strong'
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
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-vlab-green-ink bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          Saved successfully.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-vlab-600 text-white text-sm font-medium hover:bg-vlab-700 transition-colors disabled:opacity-50"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Save Changes
      </button>
    </form>
  )
}
