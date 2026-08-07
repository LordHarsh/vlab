import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Plus, GraduationCap } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

export default async function DashboardPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')

  // Fetch active enrollments with class and educator info
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(
      `
      id,
      status,
      enrolled_at,
      class_id,
      classes (
        id,
        name,
        description,
        academic_year,
        semester,
        educator_id,
        profiles!classes_educator_id_fkey (
          first_name,
          last_name
        )
      )
    `,
    )
    .eq('student_id', profile.id)
    .eq('status', 'active')
    .order('enrolled_at', { ascending: false })

  // For each class, get lab count and progress
  type EnrollmentRow = NonNullable<typeof enrollments>[number]

  const classIds = (enrollments ?? [])
    .map((e: EnrollmentRow) => (e.classes as { id: string } | null)?.id)
    .filter((id): id is string => !!id)

  // Fetch class_labs counts
  const labCountMap: Record<string, number> = {}
  if (classIds.length > 0) {
    const { data: classLabs } = await supabase
      .from('class_labs')
      .select('class_id')
      .in('class_id', classIds)

    for (const cl of classLabs ?? []) {
      labCountMap[cl.class_id] = (labCountMap[cl.class_id] ?? 0) + 1
    }
  }

  // Fetch student progress counts per class
  const progressMap: Record<string, number> = {}
  if (classIds.length > 0) {
    const { data: progressRows } = await supabase
      .from('student_progress')
      .select('class_id, completed_at')
      .eq('student_id', profile.id)
      .in('class_id', classIds)

    for (const p of progressRows ?? []) {
      if (p.completed_at) {
        progressMap[p.class_id] = (progressMap[p.class_id] ?? 0) + 1
      }
    }
  }

  const firstName = profile.first_name ?? 'there'

  return (
    <div className="max-w-5xl px-5 py-8 sm:px-8">
      <PageHeader
        eyebrow={`Signed in as ${firstName}`}
        title="Enrolled Classes"
        description="Classes you are currently enrolled in. Open a class to see the laboratories assigned to it."
        actions={
          <Link
            href="/dashboard/join"
            className="inline-flex items-center gap-2 border border-vlab-600 bg-vlab-600 px-4 py-2 font-chrome text-[13px] font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
          >
            <Plus className="h-4 w-4" />
            Join a class
          </Link>
        }
      />

      {!enrollments || enrollments.length === 0 ? (
        <div className="border border-vlab-rule-strong bg-vlab-surface-alt px-6 py-16 text-center">
          <GraduationCap className="mx-auto mb-3 h-8 w-8 text-vlab-300" />
          <p className="font-chrome text-base font-bold text-vlab-800">No classes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-vlab-muted">
            Enrolment is by join code. Use the code issued by your instructor to enrol.
          </p>
          <Link
            href="/dashboard/join"
            className="mt-5 inline-flex items-center gap-2 border border-vlab-600 bg-vlab-600 px-4 py-2 font-chrome text-[13px] font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
          >
            <Plus className="h-4 w-4" />
            Join a class
          </Link>
        </div>
      ) : (
        /* A register of enrolments, not a gallery of cards. The reference's
           index pages are all tables; a table also carries the term, the
           instructor and the completion count in one glance, which the card
           grid could not do without stacking five typographic levels. */
        <div className="overflow-x-auto border border-vlab-rule-strong">
          <table className="vlab-table">
            <thead>
              <tr>
                <th scope="col">S.No</th>
                <th scope="col">Class</th>
                <th scope="col">Instructor</th>
                <th scope="col">Term</th>
                <th scope="col">Laboratories</th>
                <th scope="col">Progress</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((enrollment: EnrollmentRow, i: number) => {
                const cls = enrollment.classes as {
                  id: string
                  name: string
                  description: string | null
                  academic_year: string | null
                  semester: string | null
                  profiles: { first_name: string | null; last_name: string | null } | null
                } | null
                if (!cls) return null

                const educatorName = cls.profiles
                  ? `${cls.profiles.first_name ?? ''} ${cls.profiles.last_name ?? ''}`.trim() ||
                    'Educator'
                  : 'Educator'

                const labCount = labCountMap[cls.id] ?? 0
                const completedCount = progressMap[cls.id] ?? 0
                const progressPct =
                  labCount > 0 ? Math.round((completedCount / labCount) * 100) : 0

                return (
                  <tr key={enrollment.id}>
                    <th scope="row">{i + 1}</th>
                    <td>
                      <Link
                        href={`/dashboard/class/${cls.id}`}
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
                    <td className="whitespace-nowrap text-vlab-ink">{educatorName}</td>
                    <td className="whitespace-nowrap text-vlab-muted">
                      {[cls.academic_year, cls.semester].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-vlab-ink">{labCount}</td>
                    <td className="whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-vlab-surface">
                          <span
                            className="block h-full bg-vlab-600"
                            style={{ width: `${progressPct}%` }}
                          />
                        </span>
                        <span className="tabular-nums text-[13px] text-vlab-muted">
                          {progressPct}%
                        </span>
                      </span>
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
