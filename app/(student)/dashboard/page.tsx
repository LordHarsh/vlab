import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Plus, BookOpen, ChevronRight, GraduationCap } from 'lucide-react'

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
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#222222]">Welcome back, {firstName}</h1>
          <p className="text-[#6a6a6a] mt-1">Your enrolled classes are listed below.</p>
        </div>
        <Link
          href="/dashboard/join"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#ff385c] text-white rounded-xl text-sm font-semibold hover:bg-[#e0324f] transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Join a Class
        </Link>
      </div>

      {/* Classes grid */}
      {!enrollments || enrollments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#f2f2f2] flex items-center justify-center mb-4">
            <GraduationCap className="w-8 h-8 text-[#c1c1c1]" />
          </div>
          <h2 className="text-lg font-semibold text-[#222222] mb-2">No classes yet</h2>
          <p className="text-[#6a6a6a] mb-6 max-w-sm">
            Join a class using the code your educator shared with you.
          </p>
          <Link
            href="/dashboard/join"
            className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff385c] text-white rounded-xl text-sm font-semibold hover:bg-[#e0324f] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Join a Class
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {enrollments.map((enrollment: EnrollmentRow) => {
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
            const progressPct = labCount > 0 ? Math.round((completedCount / labCount) * 100) : 0

            return (
              <Link
                key={enrollment.id}
                href={`/dashboard/class/${cls.id}`}
                className="group block bg-white rounded-2xl p-5 border border-[#c1c1c1] hover:border-[#ff385c] transition-all duration-200"
                style={{
                  boxShadow:
                    'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
                }}
              >
                {/* Class badge */}
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-[#ff385c]/10 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-[#ff385c]" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#c1c1c1] group-hover:text-[#ff385c] transition-colors mt-1" />
                </div>

                <h3 className="font-semibold text-[#222222] text-base leading-snug mb-1">
                  {cls.name}
                </h3>
                <p className="text-xs text-[#6a6a6a] mb-3">by {educatorName}</p>

                {(cls.academic_year || cls.semester) && (
                  <p className="text-xs text-[#6a6a6a] mb-3">
                    {[cls.academic_year, cls.semester].filter(Boolean).join(' · ')}
                  </p>
                )}

                {/* Stats */}
                <div className="flex items-center gap-4 text-xs text-[#6a6a6a] mb-3">
                  <span>{labCount} {labCount === 1 ? 'lab' : 'labs'}</span>
                  <span>{completedCount} completed</span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-[#f2f2f2] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#ff385c] rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-xs text-[#6a6a6a] mt-1.5">{progressPct}% complete</p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
