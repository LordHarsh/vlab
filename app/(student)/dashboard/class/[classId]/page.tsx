import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FlaskConical,
  Tag,
  BarChart3,
} from 'lucide-react'

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

  const difficultyColors: Record<string, string> = {
    beginner: 'bg-green-100 text-green-700',
    intermediate: 'bg-yellow-100 text-yellow-700',
    advanced: 'bg-red-100 text-red-700',
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Back */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-[#6a6a6a] hover:text-[#222222] transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        My Classes
      </Link>

      {/* Class header */}
      <div
        className="bg-white rounded-2xl p-6 mb-8 border border-[#f2f2f2]"
        style={{
          boxShadow:
            'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
        }}
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#ff385c]/10 flex items-center justify-center shrink-0">
            <BookOpen className="w-6 h-6 text-[#ff385c]" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-[#222222]">{cls.name}</h1>
            {cls.description && (
              <p className="text-sm text-[#6a6a6a] mt-1">{cls.description}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-[#6a6a6a]">
              <span className="flex items-center gap-1">
                <BarChart3 className="w-3.5 h-3.5" />
                {educatorName}
              </span>
              {cls.academic_year && <span>{cls.academic_year}</span>}
              {cls.semester && <span>{cls.semester}</span>}
              <span>{(classLabs ?? []).length} labs assigned</span>
            </div>
          </div>
        </div>
      </div>

      {/* Labs section */}
      <h2 className="text-base font-semibold text-[#222222] mb-4">Assigned Labs</h2>

      {!classLabs || classLabs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#f2f2f2] flex items-center justify-center mb-4">
            <FlaskConical className="w-7 h-7 text-[#c1c1c1]" />
          </div>
          <p className="text-[#6a6a6a] text-sm">No labs assigned to this class yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {classLabs.map((cl) => {
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
            const diffClass =
              difficultyColors[lab.difficulty?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-600'

            const isLocked =
              cl.unlock_at ? new Date(cl.unlock_at) > new Date() : false

            return (
              <div
                key={cl.id}
                className={`group block bg-white rounded-2xl p-5 border border-[#c1c1c1] transition-all duration-200 ${isLocked ? 'opacity-60' : 'hover:border-[#ff385c]'}`}
                style={{
                  boxShadow:
                    'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
                }}
              >
                {isLocked ? (
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-[#f2f2f2] flex items-center justify-center">
                        <FlaskConical className="w-5 h-5 text-[#c1c1c1]" />
                      </div>
                      <span className="text-xs text-[#6a6a6a] bg-[#f2f2f2] px-2 py-1 rounded-full">
                        Unlocks {new Date(cl.unlock_at!).toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className="font-semibold text-[#222222] mb-1">{lab.title}</h3>
                    {lab.description && (
                      <p className="text-xs text-[#6a6a6a] line-clamp-2">{lab.description}</p>
                    )}
                  </div>
                ) : (
                  <Link href={`/dashboard/class/${classId}/lab/${lab.slug}`} className="block">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-[#ff385c]/10 flex items-center justify-center">
                        <FlaskConical className="w-5 h-5 text-[#ff385c]" />
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#c1c1c1] group-hover:text-[#ff385c] transition-colors mt-1" />
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-[#222222] flex-1 leading-snug">{lab.title}</h3>
                      {lab.difficulty && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${diffClass}`}>
                          {lab.difficulty}
                        </span>
                      )}
                    </div>

                    {lab.description && (
                      <p className="text-xs text-[#6a6a6a] mb-3 line-clamp-2">
                        {lab.description}
                      </p>
                    )}

                    {lab.tags && lab.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {lab.tags.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 text-xs text-[#6a6a6a] bg-[#f2f2f2] px-2 py-0.5 rounded-full"
                          >
                            <Tag className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="text-xs text-[#6a6a6a] mb-2">
                      {total} experiment{total !== 1 ? 's' : ''} · {completed} completed
                    </div>
                    <div className="w-full h-1.5 bg-[#f2f2f2] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#ff385c] rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
