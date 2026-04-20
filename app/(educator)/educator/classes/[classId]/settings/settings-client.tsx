'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateClass,
  regenerateJoinCode,
  updateClassQuizSettings,
} from '@/lib/actions/classes'
import { Copy, Check, Loader2, RefreshCw, AlertTriangle, Save } from 'lucide-react'

type ClassData = {
  name: string
  description: string | null
  status: string
  join_code: string
  join_code_expires_at: string | null
  max_students: number | null
  academic_year: string | null
  semester: string | null
}

type QuizSettings = {
  passing_percentage: number | null
  max_attempts: number | null
  show_score: boolean | null
  show_answers: string | null
  due_date: string | null
  is_graded: boolean
}

type QuizRow = {
  experimentId: string
  experimentTitle: string
  labTitle: string
  quizId: string
  quizTitle: string
  quizType: string
  settings: QuizSettings
}

type Props = {
  classId: string
  classData: ClassData
  quizRows: QuizRow[]
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#f2f2f2] border border-[#c1c1c1] rounded-lg hover:bg-[#e8e8e8] transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-[#6a6a6a]" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function SettingsClient({ classId, classData, quizRows }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // General settings state
  const [name, setName] = useState(classData.name)
  const [description, setDescription] = useState(classData.description ?? '')
  const [maxStudents, setMaxStudents] = useState(classData.max_students?.toString() ?? '')
  const [expiresAt, setExpiresAt] = useState(
    classData.join_code_expires_at ? classData.join_code_expires_at.slice(0, 10) : '',
  )
  const [joinCode, setJoinCode] = useState(classData.join_code)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [generalSaved, setGeneralSaved] = useState(false)

  // Quiz settings state — track per quizId
  const [quizSettings, setQuizSettings] = useState<Record<string, QuizSettings>>(
    Object.fromEntries(quizRows.map((q) => [q.quizId, { ...q.settings }])),
  )
  const [quizSaving, setQuizSaving] = useState<string | null>(null)
  const [quizSaved, setQuizSaved] = useState<string | null>(null)
  const [quizError, setQuizError] = useState<Record<string, string>>({})

  // Archive state
  const [archiveConfirm, setArchiveConfirm] = useState(false)

  function handleSaveGeneral() {
    setGeneralError(null)
    setGeneralSaved(false)
    if (!name.trim()) {
      setGeneralError('Class name is required.')
      return
    }
    startTransition(async () => {
      const result = await updateClass(classId, {
        name: name.trim(),
        description: description.trim() || undefined,
        max_students: maxStudents ? parseInt(maxStudents, 10) : null,
        join_code_expires_at: expiresAt
          ? new Date(expiresAt).toISOString()
          : null,
      })
      if (result.success) {
        setGeneralSaved(true)
        setTimeout(() => setGeneralSaved(false), 3000)
      } else {
        setGeneralError(result.error ?? 'Failed to save.')
      }
    })
  }

  function handleRegenerateCode() {
    startTransition(async () => {
      const result = await regenerateJoinCode(classId)
      if (result.success && result.joinCode) {
        setJoinCode(result.joinCode)
      }
    })
  }

  async function handleSaveQuizSettings(quizId: string) {
    setQuizSaving(quizId)
    setQuizError((prev) => ({ ...prev, [quizId]: '' }))
    const settings = quizSettings[quizId]
    const result = await updateClassQuizSettings(classId, quizId, settings)
    if (result.success) {
      setQuizSaved(quizId)
      setTimeout(() => setQuizSaved(null), 2000)
    } else {
      setQuizError((prev) => ({ ...prev, [quizId]: result.error ?? 'Failed to save.' }))
    }
    setQuizSaving(null)
  }

  function handleArchive() {
    startTransition(async () => {
      await updateClass(classId, { status: 'archived' })
      router.push('/educator')
    })
  }

  function updateQuizSetting(quizId: string, field: keyof QuizSettings, value: QuizSettings[typeof field]) {
    setQuizSettings((prev) => ({
      ...prev,
      [quizId]: { ...prev[quizId], [field]: value },
    }))
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#222222]">Class Settings</h1>

      {/* General settings */}
      <div
        className="bg-white rounded-2xl border border-[#c1c1c1] p-6"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <h2 className="text-base font-semibold text-[#222222] mb-5">General</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#222222] mb-1.5">
              Class Name <span className="text-[#ff385c]">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-[#c1c1c1] rounded-xl text-[#222222] text-sm focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#222222] mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 border border-[#c1c1c1] rounded-xl text-[#222222] text-sm focus:outline-none focus:ring-2 focus:ring-[#ff385c] resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#222222] mb-1.5">Max Students</label>
              <input
                type="number"
                min={1}
                value={maxStudents}
                onChange={(e) => setMaxStudents(e.target.value)}
                placeholder="Unlimited"
                className="w-full px-4 py-2.5 border border-[#c1c1c1] rounded-xl text-[#222222] text-sm focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#222222] mb-1.5">
                Join Code Expiry
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-4 py-2.5 border border-[#c1c1c1] rounded-xl text-[#222222] text-sm focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
              />
            </div>
          </div>

          {generalError && (
            <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-xl border border-red-200">
              {generalError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            {generalSaved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <Check className="w-4 h-4" /> Saved
              </span>
            )}
            <button
              onClick={handleSaveGeneral}
              disabled={isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#ff385c] text-white rounded-xl text-sm font-medium hover:bg-[#e0314f] disabled:opacity-60 transition-colors"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Join code management */}
      <div
        className="bg-white rounded-2xl border border-[#c1c1c1] p-6"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <h2 className="text-base font-semibold text-[#222222] mb-4">Join Code</h2>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 px-4 py-2.5 bg-[#f2f2f2] border border-[#c1c1c1] rounded-xl">
            <span className="font-mono font-bold text-[#222222] text-xl tracking-[0.2em]">
              {joinCode}
            </span>
          </div>
          <CopyButton text={joinCode} />
          <button
            onClick={handleRegenerateCode}
            disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#c1c1c1] rounded-xl text-sm font-medium text-[#222222] hover:bg-[#f2f2f2] disabled:opacity-60 transition-colors"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Regenerate
          </button>
        </div>
        <p className="text-xs text-[#6a6a6a]">
          Students use this code to join your class. Regenerating will invalidate the old code.
        </p>
      </div>

      {/* Quiz settings */}
      {quizRows.length > 0 && (
        <div
          className="bg-white rounded-2xl border border-[#c1c1c1] overflow-hidden"
          style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
        >
          <div className="px-6 py-4 border-b border-[#f2f2f2]">
            <h2 className="text-base font-semibold text-[#222222]">Quiz Settings</h2>
            <p className="text-sm text-[#6a6a6a] mt-0.5">
              Configure per-quiz settings for this class
            </p>
          </div>
          <div className="divide-y divide-[#f2f2f2]">
            {quizRows.map((q) => {
              const s = quizSettings[q.quizId]
              const saving = quizSaving === q.quizId
              const saved = quizSaved === q.quizId
              const err = quizError[q.quizId]

              return (
                <div key={q.quizId} className="px-6 py-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <p className="text-xs text-[#6a6a6a]">
                        {q.labTitle} › {q.experimentTitle}
                      </p>
                      <p className="text-sm font-semibold text-[#222222]">
                        {q.quizTitle}
                        <span className="ml-2 text-xs font-normal text-[#6a6a6a]">({q.quizType})</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {saved && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Saved
                        </span>
                      )}
                      <button
                        onClick={() => handleSaveQuizSettings(q.quizId)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#222222] text-white rounded-lg text-xs font-medium hover:bg-[#333] disabled:opacity-60 transition-colors"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Save
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {/* Is Graded */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.is_graded}
                        onChange={(e) => updateQuizSetting(q.quizId, 'is_graded', e.target.checked)}
                        className="w-4 h-4 rounded border-[#c1c1c1] accent-[#ff385c]"
                      />
                      <span className="text-sm text-[#222222]">Graded</span>
                    </label>

                    {/* Show Score */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.show_score ?? false}
                        onChange={(e) => updateQuizSetting(q.quizId, 'show_score', e.target.checked)}
                        className="w-4 h-4 rounded border-[#c1c1c1] accent-[#ff385c]"
                      />
                      <span className="text-sm text-[#222222]">Show Score</span>
                    </label>

                    {/* Show Answers */}
                    <div>
                      <label className="block text-xs text-[#6a6a6a] mb-1">Show Answers</label>
                      <select
                        value={s.show_answers ?? 'never'}
                        onChange={(e) => updateQuizSetting(q.quizId, 'show_answers', e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-[#c1c1c1] rounded-lg text-sm text-[#222222] bg-white focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
                      >
                        <option value="never">Never</option>
                        <option value="after_submit">After Submit</option>
                        <option value="after_due">After Due Date</option>
                        <option value="always">Always</option>
                      </select>
                    </div>

                    {/* Passing % */}
                    <div>
                      <label className="block text-xs text-[#6a6a6a] mb-1">Passing %</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={s.passing_percentage ?? ''}
                        onChange={(e) =>
                          updateQuizSetting(
                            q.quizId,
                            'passing_percentage',
                            e.target.value ? parseInt(e.target.value, 10) : null,
                          )
                        }
                        placeholder="60"
                        className="w-full px-2.5 py-1.5 border border-[#c1c1c1] rounded-lg text-sm text-[#222222] focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
                      />
                    </div>

                    {/* Max Attempts */}
                    <div>
                      <label className="block text-xs text-[#6a6a6a] mb-1">Max Attempts</label>
                      <input
                        type="number"
                        min={1}
                        value={s.max_attempts ?? ''}
                        onChange={(e) =>
                          updateQuizSetting(
                            q.quizId,
                            'max_attempts',
                            e.target.value ? parseInt(e.target.value, 10) : null,
                          )
                        }
                        placeholder="Unlimited"
                        className="w-full px-2.5 py-1.5 border border-[#c1c1c1] rounded-lg text-sm text-[#222222] focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
                      />
                    </div>

                    {/* Due Date */}
                    <div>
                      <label className="block text-xs text-[#6a6a6a] mb-1">Due Date</label>
                      <input
                        type="date"
                        value={s.due_date ? s.due_date.slice(0, 10) : ''}
                        onChange={(e) =>
                          updateQuizSetting(
                            q.quizId,
                            'due_date',
                            e.target.value ? e.target.value : null,
                          )
                        }
                        className="w-full px-2.5 py-1.5 border border-[#c1c1c1] rounded-lg text-sm text-[#222222] focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
                      />
                    </div>
                  </div>

                  {err && (
                    <p className="text-xs text-red-600 mt-2">{err}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Danger zone */}
      <div
        className="bg-white rounded-2xl border border-red-200 p-6"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <h2 className="text-base font-semibold text-red-700 mb-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Danger Zone
        </h2>
        <p className="text-sm text-[#6a6a6a] mb-4">
          Archiving a class hides it from active view. This action can be undone by changing the status back.
        </p>

        {classData.status === 'archived' ? (
          <button
            onClick={() =>
              startTransition(async () => {
                await updateClass(classId, { status: 'active' })
              })
            }
            disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#c1c1c1] rounded-xl text-sm font-medium text-[#222222] hover:bg-[#f2f2f2] disabled:opacity-60 transition-colors"
          >
            Restore Class
          </button>
        ) : !archiveConfirm ? (
          <button
            onClick={() => setArchiveConfirm(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-red-200 rounded-xl text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
          >
            Archive Class
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-red-700">Are you sure?</span>
            <button
              onClick={handleArchive}
              disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-60 transition-colors"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Yes, Archive
            </button>
            <button
              onClick={() => setArchiveConfirm(false)}
              className="px-4 py-2 text-sm text-[#6a6a6a] hover:text-[#222222] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
