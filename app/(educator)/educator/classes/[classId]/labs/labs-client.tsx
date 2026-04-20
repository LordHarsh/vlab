'use client'

import { useState, useTransition } from 'react'
import {
  assignLab,
  removeLabFromClass,
  reorderLab,
  updateLabUnlockAt,
} from '@/lib/actions/classes'
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Loader2,
  FlaskConical,
  Calendar,
} from 'lucide-react'

type AssignedLab = {
  id: string
  lab_id: string
  order_index: number
  unlock_at: string | null
  lab: {
    id: string
    title: string
    slug: string
    description: string | null
    difficulty: string | null
    experiments: { id: string }[]
  } | null
}

type AvailableLab = {
  id: string
  title: string
  slug: string
  description: string | null
  difficulty: string | null
  experiment_count: number
}

type Props = {
  classId: string
  className: string
  assignedLabs: AssignedLab[]
  availableLabs: AvailableLab[]
}

function DifficultyBadge({ difficulty }: { difficulty: string | null }) {
  if (!difficulty) return null
  const styles: Record<string, string> = {
    beginner: 'bg-green-100 text-green-700',
    intermediate: 'bg-yellow-100 text-yellow-700',
    advanced: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[difficulty] ?? 'bg-[#f2f2f2] text-[#6a6a6a]'}`}>
      {difficulty}
    </span>
  )
}

export function LabsClient({ classId, assignedLabs: initial, availableLabs: initialAvailable }: Props) {
  const [assigned, setAssigned] = useState(initial)
  const [available, setAvailable] = useState(initialAvailable)
  const [isPending, startTransition] = useTransition()
  const [actionId, setActionId] = useState<string | null>(null)
  const [unlockEditing, setUnlockEditing] = useState<string | null>(null)
  const [unlockValue, setUnlockValue] = useState('')

  function handleAssign(lab: AvailableLab) {
    const nextIndex = assigned.length
    setActionId(lab.id)
    startTransition(async () => {
      const result = await assignLab(classId, lab.id, nextIndex)
      if (result.success) {
        setAssigned((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            lab_id: lab.id,
            order_index: nextIndex,
            unlock_at: null,
            lab: {
              id: lab.id,
              title: lab.title,
              slug: lab.slug,
              description: lab.description,
              difficulty: lab.difficulty,
              experiments: Array.from({ length: lab.experiment_count }, () => ({ id: '' })),
            },
          },
        ])
        setAvailable((prev) => prev.filter((l) => l.id !== lab.id))
      }
      setActionId(null)
    })
  }

  function handleRemove(classLabId: string, labId: string) {
    setActionId(classLabId)
    startTransition(async () => {
      const result = await removeLabFromClass(classId, labId)
      if (result.success) {
        const removed = assigned.find((a) => a.id === classLabId)
        setAssigned((prev) =>
          prev
            .filter((a) => a.id !== classLabId)
            .map((a, i) => ({ ...a, order_index: i })),
        )
        if (removed?.lab) {
          const lab = removed.lab
          setAvailable((prev) => [
            ...prev,
            {
              id: removed.lab_id,
              title: lab.title,
              slug: lab.slug,
              description: lab.description,
              difficulty: lab.difficulty,
              experiment_count: lab.experiments?.length ?? 0,
            },
          ])
        }
      }
      setActionId(null)
    })
  }

  function handleMove(classLabId: string, labId: string, direction: 'up' | 'down') {
    const idx = assigned.findIndex((a) => a.id === classLabId)
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === assigned.length - 1) return

    const newIdx = direction === 'up' ? idx - 1 : idx + 1
    const newAssigned = [...assigned]
    const temp = newAssigned[idx]
    newAssigned[idx] = newAssigned[newIdx]
    newAssigned[newIdx] = temp
    const updated = newAssigned.map((a, i) => ({ ...a, order_index: i }))
    setAssigned(updated)

    startTransition(async () => {
      await reorderLab(classId, labId, newIdx)
    })
  }

  function handleSaveUnlock(classLabId: string, labId: string) {
    setActionId(classLabId)
    startTransition(async () => {
      const val = unlockValue || null
      await updateLabUnlockAt(classId, labId, val)
      setAssigned((prev) =>
        prev.map((a) => (a.id === classLabId ? { ...a, unlock_at: val } : a)),
      )
      setUnlockEditing(null)
      setUnlockValue('')
      setActionId(null)
    })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#222222]">Labs</h1>

      {/* Assigned labs */}
      <div
        className="bg-white rounded-2xl border border-[#c1c1c1] overflow-hidden"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <div className="px-6 py-4 border-b border-[#f2f2f2]">
          <h2 className="text-base font-semibold text-[#222222]">
            Assigned Labs ({assigned.length})
          </h2>
          <p className="text-sm text-[#6a6a6a] mt-0.5">Drag up/down arrows to reorder</p>
        </div>

        {assigned.length === 0 ? (
          <div className="p-10 text-center">
            <FlaskConical className="w-10 h-10 text-[#c1c1c1] mx-auto mb-3" />
            <p className="text-[#6a6a6a] text-sm">No labs assigned yet. Add labs from below.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f2f2f2]">
            {assigned.map((al, idx) => (
              <div key={al.id} className="px-6 py-4">
                <div className="flex items-start gap-3">
                  {/* Order controls */}
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    <button
                      onClick={() => handleMove(al.id, al.lab_id, 'up')}
                      disabled={idx === 0 || isPending}
                      className="p-1 rounded hover:bg-[#f2f2f2] disabled:opacity-30 transition-colors"
                    >
                      <ChevronUp className="w-4 h-4 text-[#6a6a6a]" />
                    </button>
                    <button
                      onClick={() => handleMove(al.id, al.lab_id, 'down')}
                      disabled={idx === assigned.length - 1 || isPending}
                      className="p-1 rounded hover:bg-[#f2f2f2] disabled:opacity-30 transition-colors"
                    >
                      <ChevronDown className="w-4 h-4 text-[#6a6a6a]" />
                    </button>
                  </div>

                  {/* Index badge */}
                  <div className="w-8 h-8 rounded-lg bg-[#f2f2f2] border border-[#c1c1c1] flex items-center justify-center text-xs font-bold text-[#6a6a6a] shrink-0 mt-0.5">
                    {idx + 1}
                  </div>

                  {/* Lab info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-[#222222]">
                        {al.lab?.title ?? 'Untitled Lab'}
                      </span>
                      <DifficultyBadge difficulty={al.lab?.difficulty ?? null} />
                    </div>
                    {al.lab?.description && (
                      <p className="text-xs text-[#6a6a6a] mb-1 line-clamp-1">{al.lab.description}</p>
                    )}
                    <p className="text-xs text-[#6a6a6a]">
                      {al.lab?.experiments?.length ?? 0} experiment(s)
                    </p>

                    {/* Unlock at */}
                    {unlockEditing === al.id ? (
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="datetime-local"
                          value={unlockValue}
                          onChange={(e) => setUnlockValue(e.target.value)}
                          className="px-3 py-1.5 border border-[#c1c1c1] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
                        />
                        <button
                          onClick={() => handleSaveUnlock(al.id, al.lab_id)}
                          disabled={actionId === al.id}
                          className="px-3 py-1.5 bg-[#ff385c] text-white rounded-lg text-xs font-medium hover:bg-[#e0314f] disabled:opacity-60 transition-colors"
                        >
                          {actionId === al.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                        </button>
                        <button
                          onClick={() => { setUnlockEditing(null); setUnlockValue('') }}
                          className="px-3 py-1.5 text-[#6a6a6a] hover:text-[#222222] rounded-lg text-xs transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setUnlockEditing(al.id)
                          setUnlockValue(al.unlock_at ? al.unlock_at.slice(0, 16) : '')
                        }}
                        className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-[#6a6a6a] hover:text-[#ff385c] transition-colors"
                      >
                        <Calendar className="w-3 h-3" />
                        {al.unlock_at
                          ? `Unlocks ${new Date(al.unlock_at).toLocaleString()}`
                          : 'Set unlock date'}
                      </button>
                    )}
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => handleRemove(al.id, al.lab_id)}
                    disabled={actionId === al.id || isPending}
                    className="p-2 rounded-lg text-[#6a6a6a] hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors shrink-0"
                    title="Remove lab"
                  >
                    {actionId === al.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available labs */}
      {available.length > 0 && (
        <div
          className="bg-white rounded-2xl border border-[#c1c1c1] overflow-hidden"
          style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
        >
          <div className="px-6 py-4 border-b border-[#f2f2f2]">
            <h2 className="text-base font-semibold text-[#222222]">Available Labs</h2>
            <p className="text-sm text-[#6a6a6a] mt-0.5">Click to assign to this class</p>
          </div>
          <div className="divide-y divide-[#f2f2f2]">
            {available.map((lab) => (
              <div
                key={lab.id}
                className="px-6 py-4 flex items-start justify-between gap-4 hover:bg-[#fafafa] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#222222]">{lab.title}</span>
                    <DifficultyBadge difficulty={lab.difficulty} />
                  </div>
                  {lab.description && (
                    <p className="text-xs text-[#6a6a6a] line-clamp-1">{lab.description}</p>
                  )}
                  <p className="text-xs text-[#6a6a6a] mt-0.5">
                    {lab.experiment_count} experiment(s)
                  </p>
                </div>
                <button
                  onClick={() => handleAssign(lab)}
                  disabled={actionId === lab.id || isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#222222] text-white rounded-xl text-xs font-medium hover:bg-[#333] disabled:opacity-60 transition-colors shrink-0"
                >
                  {actionId === lab.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Assign
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
