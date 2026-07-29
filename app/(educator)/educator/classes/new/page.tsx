'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClass } from '@/lib/actions/classes'
import { ArrowLeft, Loader2 } from 'lucide-react'

export default function NewClassPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = e.currentTarget
    const fd = new FormData(form)
    const name = (fd.get('name') as string).trim()
    const description = (fd.get('description') as string).trim()
    const academic_year = (fd.get('academic_year') as string).trim()
    const semester = fd.get('semester') as string
    const max_students_raw = (fd.get('max_students') as string).trim()
    const max_students = max_students_raw ? parseInt(max_students_raw, 10) : undefined

    if (!name) {
      setError('Class name is required.')
      setLoading(false)
      return
    }

    const result = await createClass({
      name,
      description: description || undefined,
      academic_year: academic_year || undefined,
      semester: semester || undefined,
      max_students,
    })

    if (!result.success) {
      setError(result.error ?? 'Failed to create class.')
      setLoading(false)
      return
    }

    router.push(`/educator/classes/${result.classId}`)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/educator"
          className="inline-flex items-center gap-2 text-sm text-vlab-muted hover:text-vlab-ink transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to My Classes
        </Link>
        <h1 className="text-2xl font-semibold text-vlab-ink">Create New Class</h1>
        <p className="text-vlab-muted mt-1">Set up a new class for your students</p>
      </div>

      <div
        className="bg-white rounded-lg border border-vlab-rule-strong p-8"
        style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Class Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-vlab-ink mb-1.5">
              Class Name <span className="text-vlab-600">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="e.g. IoT Lab — Section A"
              className="w-full px-4 py-2.5 border border-vlab-rule-strong rounded-lg text-vlab-ink placeholder-vlab-muted text-sm focus:outline-none focus:ring-2 focus:ring-vlab-600 focus:border-vlab-600 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-vlab-ink mb-1.5">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Optional description for this class..."
              className="w-full px-4 py-2.5 border border-vlab-rule-strong rounded-lg text-vlab-ink placeholder-vlab-muted text-sm focus:outline-none focus:ring-2 focus:ring-vlab-600 focus:border-vlab-600 transition-colors resize-none"
            />
          </div>

          {/* Academic Year & Semester */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="academic_year" className="block text-sm font-medium text-vlab-ink mb-1.5">
                Academic Year
              </label>
              <input
                id="academic_year"
                name="academic_year"
                type="text"
                placeholder="e.g. 2025-26"
                className="w-full px-4 py-2.5 border border-vlab-rule-strong rounded-lg text-vlab-ink placeholder-vlab-muted text-sm focus:outline-none focus:ring-2 focus:ring-vlab-600 focus:border-vlab-600 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="semester" className="block text-sm font-medium text-vlab-ink mb-1.5">
                Semester
              </label>
              <select
                id="semester"
                name="semester"
                className="w-full px-4 py-2.5 border border-vlab-rule-strong rounded-lg text-vlab-ink text-sm focus:outline-none focus:ring-2 focus:ring-vlab-600 focus:border-vlab-600 transition-colors bg-white"
              >
                <option value="">— Select —</option>
                <option value="odd">Odd</option>
                <option value="even">Even</option>
                <option value="summer">Summer</option>
              </select>
            </div>
          </div>

          {/* Max Students */}
          <div>
            <label htmlFor="max_students" className="block text-sm font-medium text-vlab-ink mb-1.5">
              Max Students
            </label>
            <input
              id="max_students"
              name="max_students"
              type="number"
              min={1}
              placeholder="e.g. 60 (leave blank for unlimited)"
              className="w-full px-4 py-2.5 border border-vlab-rule-strong rounded-lg text-vlab-ink placeholder-vlab-muted text-sm focus:outline-none focus:ring-2 focus:ring-vlab-600 focus:border-vlab-600 transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm border border-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link
              href="/educator"
              className="px-5 py-2.5 text-sm font-medium text-vlab-muted hover:text-vlab-ink transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-vlab-600 text-white rounded-lg text-sm font-medium hover:bg-vlab-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Class
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
