import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ArrowLeft, Lock } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

export default async function ClassPage({
  params,
}: {
  params: Promise<{ classId: string }>
}) {
  const { classId } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')

  // Verify enrollment
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('class_id', classId)
    .eq('student_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!enrollment) notFound()

  // Fetch class with educator
  const { data: cls } = await supabase
    .from('classes')
    .select(
      `
      id, name, description, academic_year, semester,
      profiles!classes_educator_id_fkey (
        first_name, last_name
      )
    `,
    )
    .eq('id', classId)
    .single()

  if (!cls) notFound()

  // Fetch assigned labs ordered
  const { data: classLabs } = await supabase
    .from('class_labs')
    .select(
      `
      id, order_index, unlock_at,
      labs (
        id, slug, title, description, difficulty, tags
      )
    `,
    )
    .eq('class_id', classId)
    .order('order_index', { ascending: true })

  // Fetch experiment counts per lab
  const labIds = (classLabs ?? [])
    .map((cl) => (cl.labs as { id: string } | null)?.id)
    .filter((id): id is string => !!id)

  const expCountMap: Record<string, number> = {}
  if (labIds.length > 0) {
    const { data: exps } = await supabase
      .from('experiments')
      .select('id, lab_id')
      .in('lab_id', labIds)
      .eq('published', true)

    for (const exp of exps ?? []) {
      expCountMap[exp.lab_id] = (expCountMap[exp.lab_id] ?? 0) + 1
    }
  }

  // Fetch student progress per lab
  const progressByLab: Record<string, { completed: number; total: number }> = {}
  if (labIds.length > 0) {
    for (const labId of labIds) {
      const total = expCountMap[labId] ?? 0
      // Get experiment ids for this lab
      const { data: labExps } = await supabase
        .from('experiments')
        .select('id')
        .eq('lab_id', labId)
        .eq('published', true)

      const expIds = (labExps ?? []).map((e) => e.id)
      let completed = 0
      if (expIds.length > 0) {
        const { count } = await supabase
          .from('student_progress')
          .select('id', { count: 'exact', head: true })
          .eq('student_id', profile.id)
          .eq('class_id', classId)
          .in('experiment_id', expIds)
          .not('completed_at', 'is', null)

        completed = count ?? 0
      }
      progressByLab[labId] = { completed, total }
    }
  }

  const educator = cls.profiles as { first_name: string | null; last_name: string | null } | null
  const educatorName = educator
    ? `${educator.first_name ?? ''} ${educator.last_name ?? ''}`.trim() || 'Educator'
    : 'Educator'

  return (
    <div className="max-w-5xl px-5 py-8 sm:px-8">
      <Link
        href="/dashboard"
        className="mb-5 inline-flex items-center gap-1.5 font-chrome text-[13px] font-semibold text-vlab-steel transition-colors hover:text-vlab-orange-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Enrolled classes
      </Link>

      <PageHeader
        eyebrow={
          <>
            Class
            {cls.academic_year ? ` · ${cls.academic_year}` : ''}
            {cls.semester ? ` · ${cls.semester}` : ''}
          </>
        }
        title={cls.name}
        description={cls.description}
      />

      {/* Course particulars, set as a definition strip. A key-value row is how a
          department states the facts of a course — instructor, term, count —
          rather than scattering them as icon chips. */}
      <dl className="mb-8 grid grid-cols-2 gap-px border border-vlab-rule-strong bg-vlab-rule-strong sm:grid-cols-4">
        {[
          ['Instructor', educatorName],
          ['Academic year', cls.academic_year ?? '—'],
          ['Semester', cls.semester ?? '—'],
          ['Laboratories assigned', String((classLabs ?? []).length)],
        ].map(([term, value]) => (
          <div key={term} className="bg-white px-4 py-3">
            <dt className="vlab-eyebrow">{term}</dt>
            <dd className="mt-1 font-chrome text-sm font-bold text-vlab-800">{value}</dd>
          </div>
        ))}
      </dl>

      <h2 className="vlab-page-title mb-3 text-[1.15rem]">Assigned Laboratories</h2>

      {!classLabs || classLabs.length === 0 ? (
        <div className="border border-vlab-rule-strong bg-vlab-surface-alt px-6 py-14 text-center text-sm text-vlab-muted">
          No laboratories assigned to this class yet.
        </div>
      ) : (
        <div className="overflow-x-auto border border-vlab-rule-strong">
          <table className="vlab-table">
            <thead>
              <tr>
                <th scope="col">S.No</th>
                <th scope="col">Laboratory</th>
                <th scope="col">Level</th>
                <th scope="col">Experiments</th>
                <th scope="col">Progress</th>
              </tr>
            </thead>
            <tbody>
              {classLabs.map((cl, idx) => {
                const lab = cl.labs as {
                  id: string
                  slug: string
                  title: string
                  description: string | null
                  difficulty: string | null
                  tags: string[] | null
                } | null
                if (!lab) return null

                const { completed, total } = progressByLab[lab.id] ?? { completed: 0, total: 0 }
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0
                const isLocked = cl.unlock_at ? new Date(cl.unlock_at) > new Date() : false

                return (
                  <tr key={cl.id} className={isLocked ? 'opacity-60' : undefined}>
                    <th scope="row">{idx + 1}</th>
                    <td>
                      {isLocked ? (
                        <span className="font-chrome font-bold text-vlab-muted">{lab.title}</span>
                      ) : (
                        <Link
                          href={`/dashboard/class/${classId}/lab/${lab.slug}`}
                          className="font-chrome font-bold text-vlab-600 hover:text-vlab-800 hover:underline"
                        >
                          {lab.title}
                        </Link>
                      )}
                      {lab.description && (
                        <p className="mt-0.5 max-w-xl text-[13px] leading-relaxed text-vlab-muted">
                          {lab.description}
                        </p>
                      )}
                      {lab.tags && lab.tags.length > 0 && (
                        <p className="mt-0.5 text-[12px] text-vlab-faint">
                          {lab.tags.slice(0, 4).join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap capitalize text-vlab-ink">
                      {lab.difficulty ?? '—'}
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-vlab-ink">
                      {completed} / {total}
                    </td>
                    <td className="whitespace-nowrap">
                      {isLocked ? (
                        <span className="inline-flex items-center gap-1.5 font-chrome text-[12px] font-bold text-vlab-orange-ink">
                          <Lock className="h-3.5 w-3.5" />
                          Unlocks {new Date(cl.unlock_at!).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-vlab-surface">
                            <span
                              className="block h-full bg-vlab-600"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="tabular-nums text-[13px] text-vlab-muted">{pct}%</span>
                        </span>
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
  )
}
