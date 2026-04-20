'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ArrowDown, Archive, Pencil } from 'lucide-react'
import { archiveSection, updateSection } from '@/lib/actions/admin'
import type { Tables } from '@/types/database'

type Section = Tables<'experiment_sections'>

const TYPE_COLORS: Record<string, string> = {
  aim: 'bg-blue-50 text-blue-700',
  theory: 'bg-purple-50 text-purple-700',
  components: 'bg-yellow-50 text-yellow-700',
  circuit: 'bg-orange-50 text-orange-700',
  procedure: 'bg-green-50 text-green-700',
  code: 'bg-gray-100 text-gray-700',
  simulation: 'bg-teal-50 text-teal-700',
  quiz: 'bg-pink-50 text-pink-700',
  feedback: 'bg-rose-50 text-rose-700',
  references: 'bg-indigo-50 text-indigo-700',
  text: 'bg-slate-50 text-slate-700',
  video: 'bg-red-50 text-red-700',
}

export function SectionsList({
  sections,
  labSlug,
  expSlug,
}: {
  sections: Section[]
  labSlug: string
  expSlug: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  function handleArchive(sectionId: string) {
    if (!confirm('Archive this section?')) return
    setPendingId(sectionId)
    startTransition(async () => {
      await archiveSection(sectionId)
      router.refresh()
      setPendingId(null)
    })
  }

  function handleMove(section: Section, direction: 'up' | 'down') {
    const idx = sections.findIndex((s) => s.id === section.id)
    const swapWith = direction === 'up' ? sections[idx - 1] : sections[idx + 1]
    if (!swapWith) return

    setPendingId(section.id)
    startTransition(async () => {
      await Promise.all([
        updateSection(section.id, { order_index: swapWith.order_index }),
        updateSection(swapWith.id, { order_index: section.order_index }),
      ])
      router.refresh()
      setPendingId(null)
    })
  }

  if (sections.length === 0) {
    return (
      <p className="text-sm text-[#6a6a6a] text-center py-6">No sections yet. Add one below.</p>
    )
  }

  return (
    <div className="space-y-2">
      {sections.map((section, idx) => (
        <div
          key={section.id}
          className="flex items-center gap-3 p-3 rounded-xl border border-[#e8e8e8] hover:border-[#c1c1c1] transition-colors"
        >
          {/* Order controls */}
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => handleMove(section, 'up')}
              disabled={(isPending && pendingId === section.id) || idx === 0}
              className="p-1 rounded-lg hover:bg-[#f2f2f2] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowUp className="w-3 h-3 text-[#6a6a6a]" />
            </button>
            <button
              onClick={() => handleMove(section, 'down')}
              disabled={(isPending && pendingId === section.id) || idx === sections.length - 1}
              className="p-1 rounded-lg hover:bg-[#f2f2f2] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowDown className="w-3 h-3 text-[#6a6a6a]" />
            </button>
          </div>

          {/* Type badge */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize shrink-0 ${
              TYPE_COLORS[section.type] ?? 'bg-[#f2f2f2] text-[#6a6a6a]'
            }`}
          >
            {section.type}
          </span>

          {/* Title */}
          <span className="flex-1 text-sm text-[#222222] truncate">
            {section.title || <span className="text-[#c1c1c1] italic">Untitled</span>}
          </span>

          {/* Required badge */}
          {section.is_required && (
            <span className="text-xs text-[#ff385c] font-medium shrink-0">Required</span>
          )}

          {/* Archive button */}
          <button
            onClick={() => handleArchive(section.id)}
            disabled={isPending && pendingId === section.id}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#6a6a6a] bg-[#f2f2f2] hover:bg-[#e8e8e8] transition-colors disabled:opacity-50"
          >
            <Archive className="w-3 h-3" />
            Archive
          </button>
        </div>
      ))}
    </div>
  )
}
