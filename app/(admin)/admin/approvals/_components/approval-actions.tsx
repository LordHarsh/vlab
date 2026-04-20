'use client'

import { useTransition } from 'react'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { approveEducator, rejectEducator } from '@/lib/actions/admin'

export function ApprovalActions({
  userId,
  currentStatus,
  showReapprove,
}: {
  userId: string
  currentStatus: string
  showReapprove?: boolean
}) {
  const [isPending, startTransition] = useTransition()

  function handleApprove() {
    startTransition(async () => {
      await approveEducator(userId)
    })
  }

  function handleReject() {
    if (!confirm('Reject this educator? They will be notified when they try to log in.')) return
    startTransition(async () => {
      await rejectEducator(userId)
    })
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center w-16">
        <Loader2 className="w-4 h-4 animate-spin text-[#6a6a6a]" />
      </div>
    )
  }

  if (currentStatus === 'pending') {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleApprove}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-xs font-medium transition-colors"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Approve
        </button>
        <button
          onClick={handleReject}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-medium transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          Reject
        </button>
      </div>
    )
  }

  if (currentStatus === 'rejected' && showReapprove) {
    return (
      <button
        onClick={handleApprove}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-xs font-medium transition-colors shrink-0"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        Approve
      </button>
    )
  }

  return null
}
