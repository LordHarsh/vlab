'use client'

import { useTransition } from 'react'
import { updateUserRole, toggleAdminFlag } from '@/lib/actions/admin'
import { CheckCircle2, Shield } from 'lucide-react'

type User = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  role: string
  is_admin: boolean
  profile_completed: boolean
  approval_status: string
  created_at: string | null
}

function RoleCell({ user }: { user: User }) {
  const [isPending, startTransition] = useTransition()

  function toggle() {
    const newRole = user.role === 'educator' ? 'student' : 'educator'
    startTransition(async () => { await updateUserRole(user.id, newRole) })
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
        user.role === 'educator'
          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'bg-vlab-surface text-vlab-muted hover:bg-vlab-rule'
      } disabled:opacity-50`}
    >
      {user.role}
    </button>
  )
}

function AdminCell({ user }: { user: User }) {
  const [isPending, startTransition] = useTransition()

  function toggle() {
    startTransition(async () => { await toggleAdminFlag(user.id, !user.is_admin) })
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      title={user.is_admin ? 'Remove admin' : 'Make admin'}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
        user.is_admin
          ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
          : 'bg-vlab-surface text-vlab-300 hover:bg-vlab-rule'
      }`}
    >
      <Shield className="w-3.5 h-3.5" />
    </button>
  )
}

function ApprovalBadge({ status }: { status: string }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <CheckCircle2 className="w-3.5 h-3.5" /> approved
      </span>
    )
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700">
        pending
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-600">
      rejected
    </span>
  )
}

export function UsersTable({ users }: { users: User[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-vlab-surface">
          {['Name', 'Email', 'Role', 'Status', 'Admin', 'Joined'].map((h) => (
            <th
              key={h}
              className="px-5 py-3 text-left text-xs font-semibold text-vlab-muted uppercase tracking-wide"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {users.map((user) => {
          const name =
            [user.first_name, user.last_name].filter(Boolean).join(' ') || '—'
          const joined = user.created_at
            ? new Date(user.created_at).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : '—'
          return (
            <tr key={user.id} className="border-b border-vlab-surface-alt hover:bg-vlab-surface-alt transition-colors">
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-vlab-surface flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-vlab-muted">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="font-medium text-vlab-ink">{name}</span>
                </div>
              </td>
              <td className="px-5 py-3.5 text-vlab-muted">{user.email}</td>
              <td className="px-5 py-3.5">
                <RoleCell user={user} />
              </td>
              <td className="px-5 py-3.5">
                <ApprovalBadge status={user.approval_status} />
              </td>
              <td className="px-5 py-3.5">
                <AdminCell user={user} />
              </td>
              <td className="px-5 py-3.5 text-vlab-muted text-xs">{joined}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
