'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { joinByCode } from '@/lib/actions/enrollment'
import { ArrowLeft, AlertCircle, CheckCircle2, Hash } from 'lucide-react'

export default function JoinClassPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Auto-format as user types: ABC-1234
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (val.length > 3) {
      val = val.slice(0, 3) + '-' + val.slice(3, 7)
    }
    setCode(val)
    setError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmed = code.trim()
    if (!trimmed) {
      setError('Please enter a join code.')
      return
    }

    startTransition(async () => {
      const result = await joinByCode(trimmed)
      if (result.success && result.classId) {
        setSuccess(true)
        setTimeout(() => {
          router.push(`/dashboard/class/${result.classId}`)
        }, 1200)
      } else {
        setError(result.error ?? 'Something went wrong. Please try again.')
      }
    })
  }

  return (
    // Not min-h-screen: this renders inside StudentShell, which already spends
    // a header and a footer on the viewport, so a full-height child forced the
    // whole page to scroll.
    <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Back */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-vlab-muted hover:text-vlab-ink transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>

        <div
          className="bg-white rounded-lg p-8"
          style={{
            boxShadow:
              '0 1px 2px rgba(15,48,80,0.05)',
          }}
        >
          {/* Icon */}
          <div className="w-12 h-12 rounded-lg bg-vlab-600/10 flex items-center justify-center mb-5">
            <Hash className="w-6 h-6 text-vlab-600" />
          </div>

          <h1 className="text-xl font-bold text-vlab-ink mb-1">Join a class</h1>
          <p className="text-sm text-vlab-muted mb-6">
            Enter the join code your educator shared with you.
          </p>

          {success ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">Joined successfully!</p>
                <p className="text-xs text-green-700 mt-0.5">Redirecting to your class...</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="join-code"
                  className="block text-sm font-medium text-vlab-ink mb-2"
                >
                  Class join code
                </label>
                <input
                  id="join-code"
                  type="text"
                  value={code}
                  onChange={handleCodeChange}
                  placeholder="ABC-1234"
                  maxLength={8}
                  autoFocus
                  autoComplete="off"
                  className="w-full px-4 py-3 border border-vlab-rule-strong rounded-lg text-lg font-semibold text-center text-vlab-ink placeholder:text-vlab-300 placeholder:font-400 placeholder:text-base focus:outline-none focus:border-vlab-600 focus:ring-2 focus:ring-vlab-600/20 tracking-widest transition-colors"
                />
                <p className="text-xs text-vlab-muted mt-1.5">Format: ABC-1234</p>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 p-3.5 bg-red-50 rounded-lg border border-red-200">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isPending || code.length < 7}
                className="w-full py-3 bg-vlab-600 text-white rounded-lg text-sm font-semibold hover:bg-vlab-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? 'Joining...' : 'Join Class'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
