'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowUp, ArrowDown, Archive, Pencil, X, Check,
  ClipboardList, MessageSquare, Loader2,
} from 'lucide-react'
import { archiveSection, updateSection, updateSimulation } from '@/lib/actions/admin'
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
  // simulation sections only
  simulation_id?: string | null
  simulation_design_id?: string | null
  simulation_height?: number | null
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

// ─── Shared field components ─────────────────────────────────────────────────

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${value ? 'bg-[#ff385c]' : 'bg-[#c1c1c1]'}`}>
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-1'}`} />
      </button>
      <span className="text-xs text-[#6a6a6a]">{label}</span>
    </div>
  )
}

function SaveCancel({ isPending, onCancel }: { isPending: boolean; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="submit" disabled={isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff385c] text-white text-xs font-medium hover:bg-[#e0314f] transition-colors disabled:opacity-50">
        {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        Save
      </button>
      <button type="button" onClick={onCancel}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f2f2f2] text-[#6a6a6a] text-xs font-medium hover:bg-[#e8e8e8] transition-colors">
        <X className="w-3 h-3" />
        Cancel
      </button>
    </div>
  )
}

// ─── Simulation editor (Tinkercad) ────────────────────────────────────────────
function SimulationEditor({ section, onClose }: { section: Section; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [title, setTitle] = useState(section.title ?? '')
  const [designId, setDesignId] = useState(section.simulation_design_id ?? '')
  const [height, setHeight] = useState(String(section.simulation_height ?? 500))
  const [isRequired, setIsRequired] = useState(section.is_required)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!designId.trim()) { setError('Tinkercad Design ID is required.'); return }
    if (!section.simulation_id) { setError('No simulation row linked to this section.'); return }
    setError(null)
    startTransition(async () => {
      const [simResult, secResult] = await Promise.all([
        updateSimulation(section.simulation_id!, {
          title: title.trim() || undefined,
          design_id: designId.trim(),
          height: parseInt(height) || 500,
        }),
        updateSection(section.id, {
          title: title.trim() || undefined,
          is_required: isRequired,
        }),
      ])
      if (!simResult.success) { setError(simResult.error ?? 'Failed to save simulation'); return }
      if (!secResult.success) { setError(secResult.error ?? 'Failed to save section'); return }
      router.refresh()
      onClose()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 border border-[#e8e8e8] rounded-xl p-4 bg-[#fafafa] space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Section Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Circuit Simulation"
            className="w-full px-3 py-2 rounded-lg border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Height (px)</label>
          <input value={height} onChange={(e) => setHeight(e.target.value)} type="number" min="300" max="900" step="50"
            className="w-full px-3 py-2 rounded-lg border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">
          Tinkercad Design ID <span className="text-[#ff385c]">*</span>
        </label>
        <input value={designId} onChange={(e) => setDesignId(e.target.value)} placeholder="e.g. XXXXXXXXXXXXXXXX"
          className="w-full px-3 py-2 rounded-lg border border-[#c1c1c1] text-sm font-mono text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white" />
        <p className="text-xs text-[#6a6a6a] mt-1">
          From <span className="font-mono">tinkercad.com/things/<strong>DESIGN_ID</strong></span> — design must be public
        </p>
      </div>

      <Toggle value={isRequired} onChange={setIsRequired} label="Required section" />

      {error && <p className="text-xs text-[#c13515] bg-[#fff0f0] border border-[#ffd0d0] rounded-lg px-3 py-2">{error}</p>}
      <SaveCancel isPending={isPending} onCancel={onClose} />
    </form>
  )
}

// ─── Generic content editor (JSON) ───────────────────────────────────────────
function ContentEditor({ section, onClose }: { section: Section; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [raw, setRaw] = useState(section.content != null ? JSON.stringify(section.content, null, 2) : '{}')
  const [title, setTitle] = useState(section.title ?? '')
  const [isRequired, setIsRequired] = useState(section.is_required)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { setError('Invalid JSON — check the content.'); return }
    setError(null)
    startTransition(async () => {
      const result = await updateSection(section.id, {
        title: title.trim() || undefined,
        content: parsed as Json,
        is_required: isRequired,
      })
      if (!result.success) { setError(result.error ?? 'Failed to save'); return }
      router.refresh()
      onClose()
    })
  }

  const HINTS: Record<string, string> = {
    aim: '{"objectives":["..."],"outcomes":["..."],"note":"..."}',
    theory: '{"introduction":"...","sections":[{"heading":"...","body":"..."}]}',
    components: '{"items":[{"name":"...","quantity":1,"notes":"..."}]}',
    circuit: '{"connections":[{"from":"...","to":"..."}]}',
    procedure: '{"steps":["Step 1...","Step 2..."]}',
    code: '{"language":"arduino_c","platform":"Arduino Uno","code":"..."}',
    references: '{"items":[{"title":"...","url":"..."}]}',
    text: '{"content":"..."}',
    video: '{"url":"...","caption":"..."}',
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 border border-[#e8e8e8] rounded-xl p-4 bg-[#fafafa] space-y-3">
      <div>
        <label className="block text-xs font-medium text-[#6a6a6a] mb-1">Section Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leave empty to use type as title"
          className="w-full px-3 py-2 rounded-lg border border-[#c1c1c1] text-sm text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white" />
      </div>

      <Toggle value={isRequired} onChange={setIsRequired} label="Required section" />

      {section.type !== 'quiz' && section.type !== 'feedback' && (
        <div>
          <label className="block text-xs font-medium text-[#6a6a6a] mb-1">
            Content <span className="text-[#c1c1c1] font-normal">(JSON)</span>
          </label>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={10} spellCheck={false}
            className="w-full px-3 py-2 rounded-lg border border-[#c1c1c1] text-xs font-mono text-[#222222] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white resize-y" />
          {HINTS[section.type] && (
            <p className="text-xs text-[#6a6a6a] mt-1 font-mono truncate">Shape: {HINTS[section.type]}</p>
          )}
        </div>
      )}
      {(section.type === 'quiz' || section.type === 'feedback') && (
        <p className="text-xs text-[#6a6a6a] bg-[#f2f2f2] rounded-lg px-3 py-2">
          Content is managed via the dedicated editor (linked in the row above).
        </p>
      )}

      {error && <p className="text-xs text-[#c13515] bg-[#fff0f0] border border-[#ffd0d0] rounded-lg px-3 py-2">{error}</p>}
      <SaveCancel isPending={isPending} onCancel={onClose} />
    </form>
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

            {/* Inline editor — simulation gets Tinkercad form, everything else gets JSON editor */}
            {isEditing && (
              <div className="px-3 pb-3">
                {section.type === 'simulation'
                  ? <SimulationEditor section={section} onClose={() => setEditingId(null)} />
                  : <ContentEditor section={section} onClose={() => setEditingId(null)} />
                }
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
