import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Plus, BookOpen } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

/** Squared status tag rather than a pill — institutional chrome, not a badge. */
function StatusBadge({ status }: { status: string }) {
  const styles = {
    active: 'border-vlab-green text-vlab-green-ink',
    completed: 'border-vlab-300 text-vlab-700',
    archived: 'border-vlab-rule-strong text-vlab-muted',
  }
  const style = styles[status as keyof typeof styles] ?? styles.archived
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 font-chrome text-[12px] font-bold capitalize ${style}`}
    >
      {status}
    </span>
  )
}

export default async function EducatorPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')

  const { data: classes } = await supabase
    .from('classes')
    .select(`
      id, name, description, status, academic_year, semester, join_code,
      enrollments(id, status),
      class_labs(id)
    `)
    .eq('educator_id', profile.id)
    .order('created_at', { ascending: false })

  const classList = classes ?? []

  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow="Educator Console"
        title="My Classes"
        description="Classes you run. Open one to enrol students, assign laboratories and read the gradebook."
        actions={
          <Link
            href="/educator/classes/new"
            className="inline-flex items-center gap-2 border border-vlab-600 bg-vlab-600 px-4 py-2 font-chrome text-[13px] font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
          >
            <Plus className="h-4 w-4" />
            New class
          </Link>
        }
      />

      {classList.length === 0 ? (
        <div className="border border-vlab-rule-strong bg-vlab-surface-alt px-6 py-16 text-center">
          <BookOpen className="mx-auto mb-3 h-8 w-8 text-vlab-300" />
          <p className="font-chrome text-base font-bold text-vlab-800">No classes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-vlab-muted">
            Create a class to enrol students and assign laboratories to them.
          </p>
          <Link
            href="/educator/classes/new"
            className="mt-5 inline-flex items-center gap-2 border border-vlab-600 bg-vlab-600 px-4 py-2 font-chrome text-[13px] font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
          >
            <Plus className="h-4 w-4" />
            New class
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto border border-vlab-rule-strong">
          <table className="vlab-table">
            <thead>
              <tr>
                <th scope="col">S.No</th>
                <th scope="col">Class</th>
                <th scope="col">Term</th>
                <th scope="col">Students</th>
                <th scope="col">Laboratories</th>
                <th scope="col">Join code</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {classList.map((cls, idx) => {
                const enrollments = (cls.enrollments as { id: string; status: string }[]) ?? []
                const activeStudents = enrollments.filter((e) => e.status === 'active').length
                const labCount = (cls.class_labs as { id: string }[])?.length ?? 0

                return (
                  <tr key={cls.id}>
                    <th scope="row">{idx + 1}</th>
                    <td>
                      <Link
                        href={`/educator/classes/${cls.id}`}
                        className="font-chrome font-bold text-vlab-600 hover:text-vlab-800 hover:underline"
                      >
                        {cls.name}
                      </Link>
                      {cls.description && (
                        <p className="mt-0.5 max-w-md text-[13px] leading-relaxed text-vlab-muted">
                          {cls.description}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-vlab-muted">
                      {[cls.academic_year, cls.semester].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-vlab-ink">
                      {activeStudents}
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-vlab-ink">{labCount}</td>
                    <td className="whitespace-nowrap">
                      <span className="border border-vlab-rule bg-vlab-surface px-2 py-0.5 font-mono text-[13px] tracking-wider text-vlab-ink">
                        {cls.join_code}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusBadge status={cls.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
