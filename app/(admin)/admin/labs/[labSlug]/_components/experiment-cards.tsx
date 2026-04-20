'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2, Layers } from 'lucide-react'
import { deleteExperiment } from '@/lib/actions/admin'

type Experiment = {
  id: string
  slug: string
  title: string
  description: string | null
  difficulty: string | null
  estimated_duration: number | null
  published: boolean
  order_index: number
  sectionCount: number
}

export function ExperimentCards({
  experiments,
  labSlug,
}: {
  experiments: Experiment[]
  labSlug: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  function handleDelete(exp: Experiment) {
    if (!confirm(`Delete experiment "${exp.title}"? This cannot be undone.`)) return
    setPendingId(exp.id)
    startTransition(async () => {
      await deleteExperiment(exp.id)
      router.refresh()
      setPendingId(null)
    })
  }

  if (experiments.length === 0) {
    return (
      <p className="text-sm text-[#6a6a6a] text-center py-6">
        No experiments yet. Add one below.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {experiments.map((exp) => (
        <div
          key={exp.id}
          className="flex items-center gap-4 p-4 rounded-xl border border-[#e8e8e8] hover:border-[#c1c1c1] transition-colors"
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#f2f2f2] flex items-center justify-center text-xs font-bold text-[#6a6a6a]">
            {exp.order_index}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-[#222222] truncate">{exp.title}</span>
              <span
                className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  exp.published ? 'bg-[#e6f9f5] text-[#00a699]' : 'bg-[#f2f2f2] text-[#6a6a6a]'
                }`}
              >
                {exp.published ? 'Live' : 'Draft'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-[#6a6a6a] flex items-center gap-1">
                <Layers className="w-3 h-3" />
                {exp.sectionCount} section{exp.sectionCount !== 1 ? 's' : ''}
              </span>
              {exp.difficulty && (
                <span className="text-xs text-[#6a6a6a] capitalize">{exp.difficulty}</span>
              )}
              {exp.estimated_duration && (
                <span className="text-xs text-[#6a6a6a]">{exp.estimated_duration}min</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/admin/labs/${labSlug}/experiments/${exp.slug}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#6a6a6a] bg-[#f2f2f2] hover:bg-[#e8e8e8] transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </Link>
            <button
              onClick={() => handleDelete(exp)}
              disabled={isPending && pendingId === exp.id}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#ff385c] bg-[#fff0f2] hover:bg-[#ffe0e5] transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
