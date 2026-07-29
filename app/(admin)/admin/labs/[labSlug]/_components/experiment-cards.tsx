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
      <p className="text-sm text-vlab-muted text-center py-6">
        No experiments yet. Add one below.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {experiments.map((exp) => (
        <div
          key={exp.id}
          className="flex items-center gap-4 p-4 rounded-lg border border-vlab-rule hover:border-vlab-rule-strong transition-colors"
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-vlab-surface flex items-center justify-center text-xs font-bold text-vlab-muted">
            {exp.order_index}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-vlab-ink truncate">{exp.title}</span>
              <span
                className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  exp.published ? 'bg-green-50 text-vlab-green-ink' : 'bg-vlab-surface text-vlab-muted'
                }`}
              >
                {exp.published ? 'Live' : 'Draft'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-vlab-muted flex items-center gap-1">
                <Layers className="w-3 h-3" />
                {exp.sectionCount} section{exp.sectionCount !== 1 ? 's' : ''}
              </span>
              {exp.difficulty && (
                <span className="text-xs text-vlab-muted capitalize">{exp.difficulty}</span>
              )}
              {exp.estimated_duration && (
                <span className="text-xs text-vlab-muted">{exp.estimated_duration}min</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/admin/labs/${labSlug}/experiments/${exp.slug}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-vlab-muted bg-vlab-surface hover:bg-vlab-rule transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </Link>
            <button
              onClick={() => handleDelete(exp)}
              disabled={isPending && pendingId === exp.id}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-vlab-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
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
