'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import { updateLab, deleteLab } from '@/lib/actions/admin'

type Lab = {
  id: string
  slug: string
  title: string
  difficulty: string | null
  published: boolean
  experimentCount: number
}

export function LabsTable({ labs }: { labs: Lab[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  function handlePublishToggle(lab: Lab) {
    setPendingId(lab.id)
    startTransition(async () => {
      await updateLab(lab.id, { published: !lab.published })
      router.refresh()
      setPendingId(null)
    })
  }

  function handleDelete(lab: Lab) {
    if (!confirm(`Delete lab "${lab.title}"? This cannot be undone.`)) return
    setPendingId(lab.id)
    startTransition(async () => {
      await deleteLab(lab.id)
      router.refresh()
      setPendingId(null)
    })
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-vlab-surface">
          <th className="px-6 py-3 text-left font-medium text-vlab-muted">Title</th>
          <th className="px-6 py-3 text-left font-medium text-vlab-muted">Slug</th>
          <th className="px-6 py-3 text-left font-medium text-vlab-muted">Difficulty</th>
          <th className="px-6 py-3 text-left font-medium text-vlab-muted">Experiments</th>
          <th className="px-6 py-3 text-left font-medium text-vlab-muted">Published</th>
          <th className="px-6 py-3 text-left font-medium text-vlab-muted">Actions</th>
        </tr>
      </thead>
      <tbody>
        {labs.map((lab) => (
          <tr key={lab.id} className="border-b border-vlab-surface last:border-0 hover:bg-vlab-surface-alt transition-colors">
            <td className="px-6 py-3 font-medium text-vlab-ink">{lab.title}</td>
            <td className="px-6 py-3 text-vlab-muted font-mono text-xs">{lab.slug}</td>
            <td className="px-6 py-3">
              {lab.difficulty ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-vlab-surface text-vlab-muted capitalize">
                  {lab.difficulty}
                </span>
              ) : (
                <span className="text-vlab-300">—</span>
              )}
            </td>
            <td className="px-6 py-3 text-vlab-muted">{lab.experimentCount}</td>
            <td className="px-6 py-3">
              <button
                onClick={() => handlePublishToggle(lab)}
                disabled={pending && pendingId === lab.id}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                  lab.published ? 'bg-vlab-600' : 'bg-vlab-rule-strong'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    lab.published ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </td>
            <td className="px-6 py-3">
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/labs/${lab.slug}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-vlab-muted bg-vlab-surface hover:bg-vlab-rule transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </Link>
                <button
                  onClick={() => handleDelete(lab)}
                  disabled={pending && pendingId === lab.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-vlab-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
