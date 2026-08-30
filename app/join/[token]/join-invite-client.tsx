'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { acceptInvite } from '@/lib/actions/enrollment'

export function JoinInviteForm({ token }: { token: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result = await acceptInvite(token)
      if (result.success && result.classId) {
        setJoined(true)
        router.push(`/dashboard/class/${result.classId}`)
      } else {
        setError(result.error ?? 'Something went wrong. Please try again.')
      }
    })
  }

  if (joined) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
        <div>
          <p className="text-sm font-semibold text-green-800">Joined successfully</p>
          <p className="mt-0.5 text-xs text-green-700">Opening your class...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="w-full rounded-lg bg-vlab-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-vlab-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Joining...' : 'Join class'}
      </button>
    </div>
  )
}
