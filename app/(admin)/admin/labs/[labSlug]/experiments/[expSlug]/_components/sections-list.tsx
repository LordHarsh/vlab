'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowUp, ArrowDown, Archive, Pencil, X, Check,
  ClipboardList, MessageSquare, Loader2,
} from 'lucide-react'
import { archiveSection, updateSection } from '@/lib/actions/admin'
import type { Json } from '@/types/database'

type Section = {
  id: string
  type: string
  title: string | null
  order_index: number
  content: Json
  is_required: boolean
  status: string
  quiz_id?: string | null
  quiz_type?: string | null
  feedback_form_id?: string | null
}

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

const QUIZ_TYPE_LABEL: Record<string, string> = {
  pretest: 'Pre-Test',
  posttest: 'Post-Test',
  practice: 'Practice',
}

// ─── Inline content editor ────────────────────────────────────────────────────
// Shows a textarea with the JSON content. On save, parses and updates.
function ContentEditor({ section, onClose }: { section: Section; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [raw, setRaw] = useState(
    section.content != null ? JSON.stringify(section.content, null, 2) : '{}'
  )
  const [title, setTitle] = useState(section.title ?? '')
  const [isRequired, setIsRequired] = useState(section.is_required)
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      setError('Invalid JSON — please check the content.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await updateSection(section.id, {
        title: title.trim() || null,
        content: parsed as Json,
        is_required: isRequired,
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to save')
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="mt-3 border border-[#e8e8e8] rounded-xl p-4 bg-[#fafafa] space-y-3">
      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Section Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Leave empty to use type as title"
          className="w-full px-3 py-2 rounded-lg border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white"
        />
      </div>

      {/* is_required toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsRequired((v) => !v)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            isRequired ? 'bg-[#ff385c]' : 'bg-[#c1c1c1]'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            isRequired ? 'translate-x-4' : 'translate-x-1'
          }`} />
        </button>
        <span className="text-xs text-[#6a6a6a]">Required section</span>
      </div>

      {/* Content JSON editor — skip for quiz and feedback, those have their own editors */}
      {section.type !== 'quiz' && section.type !== 'feedback' && section.type !== 'simulation' && (
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">
            Content <span className="text-[#c1c1c1] font-normal">(JSON)</span>
          </label>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg border border-[#c1c1c1] text-xs font-mono text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white resize-y"
          />
          <p className="text-xs text-[#6a6a6a] mt-1">
            {section.type === 'aim' && 'Shape: {"objectives":["..."],"outcomes":["..."],"note":"..."}'}
            {section.type === 'theory' && 'Shape: {"introduction":"...","sections":[{"heading":"...","body":"..."}]}'}
            {section.type === 'components' && 'Shape: {"items":[{"name":"...","quantity":1,"notes":"..."}]}'}
            {section.type === 'circuit' && 'Shape: {"connections":[{"from":"...","to":"..."}]}'}
            {section.type === 'procedure' && 'Shape: {"steps":["Step 1...","Step 2..."]}'}
            {section.type === 'code' && 'Shape: {"language":"arduino_c","platform":"Arduino Uno","code":"..."}'}
            {section.type === 'references' && 'Shape: {"items":[{"title":"...","url":"..."}]}'}
            {section.type === 'text' && 'Shape: {"content":"..."}'}
            {section.type === 'video' && 'Shape: {"url":"...","caption":"..."}'}
          </p>
        </div>
      )}
      {(section.type === 'quiz' || section.type === 'feedback' || section.type === 'simulation') && (
        <p className="text-xs text-[#6a6a6a] bg-[#f2f2f2] rounded-lg px-3 py-2">
          Content for this section type is managed via its dedicated editor (linked below).
        </p>
      )}

      {error && (
        <p className="text-xs text-[#c13515] bg-[#fff0f0] border border-[#ffd0d0] rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff385c] text-white text-xs font-medium hover:bg-[#e0314f] transition-colors disabled:opacity-50"
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Save
        </button>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f2f2f2] text-[#6a6a6a] text-xs font-medium hover:bg-[#e8e8e8] transition-colors"
        >
          <X className="w-3 h-3" />
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Sections list ────────────────────────────────────────────────────────────
export function SectionsList({
  sections,
  labSlug,
  expSlug,
  experimentId,
}: {
  sections: Section[]
  labSlug: string
  expSlug: string
  experimentId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  function handleArchive(sectionId: string) {
    if (!confirm('Archive this section? It will be hidden from students.')) return
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
    return <p className="text-sm text-[#6a6a6a] text-center py-6">No sections yet. Add one below.</p>
  }

  return (
    <div className="space-y-2">
      {sections.map((section, idx) => {
        const isEditing = editingId === section.id
        const isMovePending = isPending && pendingId === section.id

        return (
          <div key={section.id} className="rounded-xl border border-[#e8e8e8] hover:border-[#c1c1c1] transition-colors">
            <div className="flex items-center gap-3 p-3">
              {/* Order controls */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => handleMove(section, 'up')} disabled={isMovePending || idx === 0}
                  className="p-1 rounded-lg hover:bg-[#f2f2f2] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ArrowUp className="w-3 h-3 text-[#6a6a6a]" />
                </button>
                <button onClick={() => handleMove(section, 'down')} disabled={isMovePending || idx === sections.length - 1}
                  className="p-1 rounded-lg hover:bg-[#f2f2f2] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ArrowDown className="w-3 h-3 text-[#6a6a6a]" />
                </button>
              </div>

              {/* Type badge */}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize shrink-0 ${TYPE_COLORS[section.type] ?? 'bg-[#f2f2f2] text-[#6a6a6a]'}`}>
                {section.type}
                {section.type === 'quiz' && section.quiz_type && ` · ${QUIZ_TYPE_LABEL[section.quiz_type] ?? section.quiz_type}`}
              </span>

              {/* Title */}
              <span className="flex-1 text-sm text-[#222222] truncate">
                {section.title ?? <span className="text-[#c1c1c1] italic">Untitled</span>}
              </span>

              {/* Required badge */}
              {section.is_required && (
                <span className="text-xs text-[#ff385c] font-medium shrink-0">Required</span>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Quiz section → link to quiz editor */}
                {section.type === 'quiz' && section.quiz_id && (
                  <Link
                    href={`/admin/labs/${labSlug}/experiments/${expSlug}/quiz?quizId=${section.quiz_id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-pink-700 bg-pink-50 hover:bg-pink-100 transition-colors"
                  >
                    <ClipboardList className="w-3 h-3" />
                    Edit Quiz
                  </Link>
                )}

                {/* Feedback section → link to feedback editor */}
                {section.type === 'feedback' && section.feedback_form_id && (
                  <Link
                    href={`/admin/labs/${labSlug}/experiments/${expSlug}/feedback`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors"
                  >
                    <MessageSquare className="w-3 h-3" />
                    Edit Form
                  </Link>
                )}

                {/* Edit button (title + content + is_required) */}
                <button
                  onClick={() => setEditingId(isEditing ? null : section.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isEditing
                      ? 'bg-[#ff385c] text-white'
                      : 'text-[#6a6a6a] bg-[#f2f2f2] hover:bg-[#e8e8e8]'
                  }`}
                >
                  <Pencil className="w-3 h-3" />
                  {isEditing ? 'Editing' : 'Edit'}
                </button>

                {/* Archive */}
                <button
                  onClick={() => handleArchive(section.id)}
                  disabled={isPending && pendingId === section.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#6a6a6a] bg-[#f2f2f2] hover:bg-[#e8e8e8] transition-colors disabled:opacity-50"
                >
                  <Archive className="w-3 h-3" />
                  Archive
                </button>
              </div>
            </div>

            {/* Inline content editor */}
            {isEditing && (
              <div className="px-3 pb-3">
                <ContentEditor section={section} onClose={() => setEditingId(null)} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
