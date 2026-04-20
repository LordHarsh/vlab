'use client'

import { useState, useTransition } from 'react'
import {
  generateInviteLink,
  addStudentManual,
  updateEnrollment,
} from '@/lib/actions/classes'
import {
  Copy,
  Check,
  Plus,
  Loader2,
  Link as LinkIcon,
  Mail,
  UserX,
  ChevronDown,
  Clock,
} from 'lucide-react'

type Student = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  registration_no: string | null
  class_section: string | null
} | null

type Enrollment = {
  id: string
  status: string
  enrolled_at: string | null
  enrolled_via: string | null
  student: Student
}

type InviteEmail = {
  id: string
  email: string
  status: string
  accepted_at: string | null
}

type Invite = {
  id: string
  token: string
  type: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  is_active: boolean
  created_at: string | null
  invite_emails: InviteEmail[]
}

type Props = {
  classId: string
  className: string
  joinCode: string
  joinCodeExpiresAt: string | null
  maxStudents: number | null
  enrollments: Enrollment[]
  invites: Invite[]
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    dropped: 'bg-red-100 text-red-700',
    completed: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[status] ?? 'bg-[#f2f2f2] text-[#6a6a6a]'}`}>
      {status}
    </span>
  )
}

function CopyButton({ text, label }: { text: string; label?: string }) {
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
      {label ?? (copied ? 'Copied!' : 'Copy')}
    </button>
  )
}

export function StudentsClient({
  classId,
  className,
  joinCode,
  joinCodeExpiresAt,
  maxStudents,
  enrollments: initialEnrollments,
  invites: initialInvites,
}: Props) {
  const [enrollments] = useState(initialEnrollments)
  const [invites, setInvites] = useState(initialInvites)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [manualEmail, setManualEmail] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualSuccess, setManualSuccess] = useState(false)
  const [expiryDays, setExpiryDays] = useState<number>(7)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const filtered = enrollments.filter(
    (e) => statusFilter === 'all' || e.status === statusFilter,
  )

  function handleGenerateLink() {
    startTransition(async () => {
      const result = await generateInviteLink(classId, { expiresInDays: expiryDays })
      if (result.success && result.token) {
        const link = `${window.location.origin}/join/${result.token}`
        setGeneratedLink(link)
        setInvites((prev) => [
          {
            id: crypto.randomUUID(),
            token: result.token!,
            type: 'link',
            expires_at: null,
            max_uses: null,
            use_count: 0,
            is_active: true,
            created_at: new Date().toISOString(),
            invite_emails: [],
          },
          ...prev,
        ])
      }
    })
  }

  function handleAddManual() {
    if (!manualEmail.trim()) return
    setManualError(null)
    setManualSuccess(false)
    startTransition(async () => {
      const result = await addStudentManual(classId, manualEmail.trim())
      if (result.success) {
        setManualEmail('')
        setManualSuccess(true)
        setTimeout(() => setManualSuccess(false), 3000)
      } else {
        setManualError(result.error ?? 'Failed to add student.')
      }
    })
  }

  async function handleStatusChange(enrollmentId: string, status: 'active' | 'dropped' | 'completed') {
    setActionLoading(enrollmentId)
    await updateEnrollment(enrollmentId, status)
    setActionLoading(null)
  }

  const activeCount = enrollments.filter((e) => e.status === 'active').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#222222]">Students</h1>
          <p className="text-[#6a6a6a] text-sm mt-0.5">
            {activeCount} active
            {maxStudents ? ` / ${maxStudents} max` : ''}
          </p>
        </div>
      </div>

      {/* Invite section */}
      <div
        className="bg-white rounded-2xl border border-[#c1c1c1] p-6"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <h2 className="text-base font-semibold text-[#222222] mb-4">Invite Students</h2>

        {/* Join code */}
        <div className="mb-5">
          <p className="text-sm text-[#6a6a6a] mb-2">Share this join code with your students:</p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#f2f2f2] rounded-xl border border-[#c1c1c1]">
              <span className="font-mono font-bold text-[#222222] text-xl tracking-[0.2em]">
                {joinCode}
              </span>
            </div>
            <CopyButton text={joinCode} label="Copy Code" />
          </div>
          {joinCodeExpiresAt && (
            <p className="text-xs text-[#6a6a6a] mt-1.5 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Expires {new Date(joinCodeExpiresAt).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Generate invite link */}
        <div className="border-t border-[#f2f2f2] pt-4 mb-4">
          <p className="text-sm font-medium text-[#222222] mb-2">Generate Invite Link</p>
          <div className="flex items-center gap-2 mb-2">
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className="px-3 py-2 border border-[#c1c1c1] rounded-xl text-sm text-[#222222] bg-white focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
            >
              <option value={1}>Expires in 1 day</option>
              <option value={3}>Expires in 3 days</option>
              <option value={7}>Expires in 7 days</option>
              <option value={14}>Expires in 14 days</option>
              <option value={30}>Expires in 30 days</option>
            </select>
            <button
              onClick={handleGenerateLink}
              disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#222222] text-white rounded-xl text-sm font-medium hover:bg-[#333] disabled:opacity-60 transition-colors"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LinkIcon className="w-3.5 h-3.5" />
              )}
              Generate Link
            </button>
          </div>
          {generatedLink && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
              <span className="text-xs text-green-700 flex-1 truncate">{generatedLink}</span>
              <CopyButton text={generatedLink} />
            </div>
          )}
        </div>

        {/* Add manually */}
        <div className="border-t border-[#f2f2f2] pt-4">
          <p className="text-sm font-medium text-[#222222] mb-2">Add Student by Email</p>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              placeholder="student@example.com"
              className="flex-1 px-3 py-2 border border-[#c1c1c1] rounded-xl text-sm text-[#222222] placeholder-[#6a6a6a] focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
              onKeyDown={(e) => e.key === 'Enter' && handleAddManual()}
            />
            <button
              onClick={handleAddManual}
              disabled={isPending || !manualEmail.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#ff385c] text-white rounded-xl text-sm font-medium hover:bg-[#e0314f] disabled:opacity-60 transition-colors"
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add
            </button>
          </div>
          {manualError && (
            <p className="text-xs text-red-600 mt-1.5">{manualError}</p>
          )}
          {manualSuccess && (
            <p className="text-xs text-green-600 mt-1.5">Student added successfully.</p>
          )}
        </div>
      </div>

      {/* Pending invites */}
      {invites.some((inv) => inv.invite_emails.some((e) => e.status === 'pending')) && (
        <div
          className="bg-white rounded-2xl border border-[#c1c1c1] p-6"
          style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
        >
          <h2 className="text-base font-semibold text-[#222222] mb-4">Pending Invitations</h2>
          <div className="space-y-2">
            {invites
              .flatMap((inv) =>
                inv.invite_emails
                  .filter((e) => e.status === 'pending')
                  .map((e) => ({ ...e, inviteType: inv.type })),
              )
              .map((ie) => (
                <div
                  key={ie.id}
                  className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#f2f2f2]"
                >
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-[#6a6a6a]" />
                    <span className="text-sm text-[#222222]">{ie.email}</span>
                  </div>
                  <span className="text-xs text-[#6a6a6a] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                    Pending
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Students table */}
      <div
        className="bg-white rounded-2xl border border-[#c1c1c1] overflow-hidden"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#f2f2f2]">
          <h2 className="text-base font-semibold text-[#222222]">
            Enrolled Students ({filtered.length})
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 border border-[#c1c1c1] rounded-lg text-sm text-[#222222] bg-white focus:outline-none focus:ring-2 focus:ring-[#ff385c]"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="dropped">Dropped</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[#6a6a6a] text-sm">No students found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#f2f2f2] bg-[#f9f9f9]">
                  <th className="text-left text-xs font-medium text-[#6a6a6a] px-5 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-[#6a6a6a] px-5 py-3">Email</th>
                  <th className="text-left text-xs font-medium text-[#6a6a6a] px-5 py-3">Reg. No</th>
                  <th className="text-left text-xs font-medium text-[#6a6a6a] px-5 py-3">Section</th>
                  <th className="text-left text-xs font-medium text-[#6a6a6a] px-5 py-3">Enrolled</th>
                  <th className="text-left text-xs font-medium text-[#6a6a6a] px-5 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-[#6a6a6a] px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f2f2f2]">
                {filtered.map((enrollment) => {
                  const s = enrollment.student
                  const name =
                    s?.first_name || s?.last_name
                      ? `${s?.first_name ?? ''} ${s?.last_name ?? ''}`.trim()
                      : s?.email ?? '—'
                  return (
                    <tr key={enrollment.id} className="hover:bg-[#fafafa] transition-colors">
                      <td className="px-5 py-3.5 text-sm font-medium text-[#222222]">{name}</td>
                      <td className="px-5 py-3.5 text-sm text-[#6a6a6a]">{s?.email ?? '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-[#6a6a6a]">{s?.registration_no ?? '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-[#6a6a6a]">{s?.class_section ?? '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-[#6a6a6a]">
                        {enrollment.enrolled_at
                          ? new Date(enrollment.enrolled_at).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={enrollment.status} />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {actionLoading === enrollment.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[#6a6a6a] ml-auto" />
                        ) : (
                          <div className="relative inline-block">
                            <select
                              defaultValue=""
                              onChange={(e) => {
                                const val = e.target.value as 'active' | 'dropped' | 'completed'
                                if (val) handleStatusChange(enrollment.id, val)
                                e.target.value = ''
                              }}
                              className="appearance-none pl-3 pr-8 py-1.5 border border-[#c1c1c1] rounded-lg text-xs text-[#222222] bg-white focus:outline-none focus:ring-2 focus:ring-[#ff385c] cursor-pointer"
                            >
                              <option value="" disabled>Actions</option>
                              {enrollment.status !== 'active' && <option value="active">Set Active</option>}
                              {enrollment.status !== 'dropped' && <option value="dropped">Drop Student</option>}
                              {enrollment.status !== 'completed' && <option value="completed">Mark Completed</option>}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6a6a6a] pointer-events-none" />
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
