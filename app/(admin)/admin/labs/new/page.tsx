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
        className="inline-flex items-center gap-1.5 text-sm text-[#6a6a6a] hover:text-[#222222] mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Labs
      </Link>

      <h1 className="text-2xl font-semibold text-[#222222] mb-6">Create New Lab</h1>

      <div
        className="bg-white rounded-2xl p-6"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-[#222222] mb-1.5">
              Title <span className="text-[#ff385c]">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="e.g. Raspberry Pi Lab"
              required
              className="w-full px-3 py-2.5 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-sm font-medium text-[#222222] mb-1.5">
              Slug <span className="text-[#ff385c]">*</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="raspberry-pi-lab"
              required
              className="w-full px-3 py-2.5 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] font-mono placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
            />
            <p className="text-xs text-[#6a6a6a] mt-1">Auto-generated from title. Used in URLs.</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[#222222] mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of the lab..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition resize-none"
            />
          </div>

          {/* Difficulty */}
          <div>
            <label className="block text-sm font-medium text-[#222222] mb-1.5">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white"
            >
              <option value="">Select difficulty</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-[#222222] mb-1.5">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="IoT, Raspberry Pi, Python"
              className="w-full px-3 py-2.5 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition"
            />
            <p className="text-xs text-[#6a6a6a] mt-1">Comma-separated list of tags.</p>
          </div>

          {error && (
            <p className="text-sm text-[#c13515] bg-[#fff0f0] border border-[#ffd0d0] rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={isPending || !title.trim() || !slug.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#ff385c] text-white text-sm font-medium hover:bg-[#e0314f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Lab
            </button>
            <Link
              href="/admin/labs"
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-[#6a6a6a] hover:bg-[#f2f2f2] transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
