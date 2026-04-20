import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ApprovalActions } from './_components/approval-actions'
import { Clock, CheckCircle2, XCircle, Users } from 'lucide-react'

async function getPendingEducators() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, employee_no, department, phone, created_at, approval_status')
    .eq('role', 'educator')
    .in('approval_status', ['pending', 'rejected'])
    .order('created_at', { ascending: false })
  return data ?? []
}

async function getApprovedCount() {
  const supabase = await createServerSupabaseClient()
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'educator')
    .eq('approval_status', 'approved')
  return count ?? 0
}

export default async function AdminApprovalsPage() {
  const [educators, approvedCount] = await Promise.all([
    getPendingEducators(),
    getApprovedCount(),
  ])

  const pending = educators.filter((e) => e.approval_status === 'pending')
  const rejected = educators.filter((e) => e.approval_status === 'rejected')

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#222222] mb-1">Educator Approvals</h1>
        <p className="text-[#6a6a6a] text-sm">
          Review and approve educator sign-up requests.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Pending Review', value: pending.length, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Approved', value: approvedCount, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Rejected', value: rejected.length, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl p-5 border border-[#e8e8e8]">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-[#222222]">{value}</p>
            <p className="text-xs text-[#6a6a6a] mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Pending section */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-[#222222] mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-500" />
          Pending ({pending.length})
        </h2>

        {pending.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e8e8e8] p-8 text-center">
            <Users className="w-8 h-8 text-[#c1c1c1] mx-auto mb-2" />
            <p className="text-sm text-[#6a6a6a]">No pending approvals</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((educator) => (
              <EducatorCard key={educator.id} educator={educator} />
            ))}
          </div>
        )}
      </section>

      {/* Rejected section */}
      {rejected.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-[#222222] mb-4 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            Rejected ({rejected.length})
          </h2>
          <div className="space-y-3">
            {rejected.map((educator) => (
              <EducatorCard key={educator.id} educator={educator} showReapprove />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function EducatorCard({
  educator,
  showReapprove = false,
}: {
  educator: {
    id: string
    first_name: string | null
    last_name: string | null
    email: string
    employee_no: string | null
    department: string | null
    phone: string | null
    created_at: string | null
    approval_status: string
  }
  showReapprove?: boolean
}) {
  const name = [educator.first_name, educator.last_name].filter(Boolean).join(' ') || 'Unknown'
  const date = educator.created_at
    ? new Date(educator.created_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'

  return (
    <div className="bg-white rounded-xl border border-[#e8e8e8] p-5 flex items-start gap-4">
      {/* Avatar placeholder */}
      <div className="w-10 h-10 rounded-full bg-[#f2f2f2] flex items-center justify-center shrink-0">
        <span className="text-sm font-semibold text-[#6a6a6a]">
          {name.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[#222222] text-sm">{name}</p>
        <p className="text-xs text-[#6a6a6a]">{educator.email}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[#6a6a6a]">
          {educator.employee_no && (
            <span>Employee: <span className="text-[#222222]">{educator.employee_no}</span></span>
          )}
          {educator.department && (
            <span>Dept: <span className="text-[#222222]">{educator.department}</span></span>
          )}
          {educator.phone && (
            <span>Phone: <span className="text-[#222222]">{educator.phone}</span></span>
          )}
          <span>Applied: <span className="text-[#222222]">{date}</span></span>
        </div>
      </div>

      {/* Actions */}
      <ApprovalActions
        userId={educator.id}
        currentStatus={educator.approval_status}
        showReapprove={showReapprove}
      />
    </div>
  )
}
