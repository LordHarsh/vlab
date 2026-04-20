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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Back */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-[#6a6a6a] hover:text-[#222222] transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>

        <div
          className="bg-white rounded-2xl p-8"
          style={{
            boxShadow:
              'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
          }}
        >
          {/* Icon */}
          <div className="w-12 h-12 rounded-2xl bg-[#ff385c]/10 flex items-center justify-center mb-5">
            <Hash className="w-6 h-6 text-[#ff385c]" />
          </div>

          <h1 className="text-xl font-700 text-[#222222] mb-1">Join a class</h1>
          <p className="text-sm text-[#6a6a6a] mb-6">
            Enter the join code your educator shared with you.
          </p>

          {success ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl border border-green-200">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-600 text-green-800">Joined successfully!</p>
                <p className="text-xs text-green-700 mt-0.5">Redirecting to your class...</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="join-code"
                  className="block text-sm font-500 text-[#222222] mb-2"
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
                  className="w-full px-4 py-3 border border-[#c1c1c1] rounded-xl text-lg font-600 text-center text-[#222222] placeholder:text-[#c1c1c1] placeholder:font-400 placeholder:text-base focus:outline-none focus:border-[#ff385c] focus:ring-2 focus:ring-[#ff385c]/20 tracking-widest transition-colors"
                />
                <p className="text-xs text-[#6a6a6a] mt-1.5">Format: ABC-1234</p>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 p-3.5 bg-red-50 rounded-xl border border-red-200">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isPending || code.length < 7}
                className="w-full py-3 bg-[#ff385c] text-white rounded-xl text-sm font-600 hover:bg-[#e0324f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
