'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { createLab } from '@/lib/actions/admin'

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export default function NewLabPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [description, setDescription] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [tags, setTags] = useState('')

  function handleTitleChange(val: string) {
    setTitle(val)
    if (!slugManual) setSlug(slugify(val))
  }

  function handleSlugChange(val: string) {
    setSlug(val)
    setSlugManual(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !slug.trim()) return
    setError(null)

    startTransition(async () => {
      const result = await createLab({
        title: title.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        difficulty: difficulty || undefined,
        tags: tags.trim() ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to create lab')
        return
      }
      router.push(`/admin/labs/${slug.trim()}`)
    })
  }

  return (
    <div className="p-8 max-w-2xl">
      <Link
        href="/admin/labs"
        className="inline-flex items-center gap-1.5 text-sm text-vlab-muted hover:text-vlab-ink mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Labs
      </Link>

      <h1 className="text-2xl font-semibold text-vlab-ink mb-6">Create New Lab</h1>

      <div
        className="bg-white rounded-lg p-6"
        style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-vlab-ink mb-1.5">
              Title <span className="text-vlab-600">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="e.g. Raspberry Pi Lab"
              required
              className="w-full px-3 py-2.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-sm font-medium text-vlab-ink mb-1.5">
              Slug <span className="text-vlab-600">*</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="raspberry-pi-lab"
              required
              className="w-full px-3 py-2.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink font-mono placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
            />
            <p className="text-xs text-vlab-muted mt-1">Auto-generated from title. Used in URLs.</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-vlab-ink mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of the lab..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition resize-none"
            />
          </div>

          {/* Difficulty */}
          <div>
            <label className="block text-sm font-medium text-vlab-ink mb-1.5">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition bg-white"
            >
              <option value="">Select difficulty</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-vlab-ink mb-1.5">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="IoT, Raspberry Pi, Python"
              className="w-full px-3 py-2.5 rounded-lg border border-vlab-rule-strong text-sm text-vlab-ink placeholder:text-vlab-300 focus:outline-none focus:border-vlab-600 focus:ring-1 focus:ring-vlab-600 transition"
            />
            <p className="text-xs text-vlab-muted mt-1">Comma-separated list of tags.</p>
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={isPending || !title.trim() || !slug.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-vlab-600 text-white text-sm font-medium hover:bg-vlab-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Lab
            </button>
            <Link
              href="/admin/labs"
              className="px-5 py-2.5 rounded-lg text-sm font-medium text-vlab-muted hover:bg-vlab-surface transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
