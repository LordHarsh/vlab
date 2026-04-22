import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ArrowLeft, Clock, ChevronRight, Tag, CheckCircle2, Circle } from 'lucide-react'

export default async function LabPage({
  params,
}: {
  params: Promise<{ classId: string; labSlug: string }>
}) {
  const { classId, labSlug } = await params
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

  // Fetch lab by slug
  const { data: lab } = await supabase
    .from('labs')
    .select('id, slug, title, description, difficulty, tags')
    .eq('slug', labSlug)
    .single()

  if (!lab) notFound()

  // Verify class_labs assignment
  const { data: classLab } = await supabase
    .from('class_labs')
    .select('id, unlock_at')
    .eq('class_id', classId)
    .eq('lab_id', lab.id)
    .single()

  if (!classLab) notFound()

  // Fetch experiments ordered
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, slug, title, description, order_index, difficulty, estimated_duration')
    .eq('lab_id', lab.id)
    .eq('published', true)
    .order('order_index', { ascending: true })

  // Fetch section counts per experiment
  const expIds = (experiments ?? []).map((e) => e.id)
  const sectionCountMap: Record<string, number> = {}
  if (expIds.length > 0) {
    const { data: sections } = await supabase
      .from('experiment_sections')
      .select('experiment_id')
      .in('experiment_id', expIds)
      .eq('status', 'active')

    for (const sec of sections ?? []) {
      sectionCountMap[sec.experiment_id] = (sectionCountMap[sec.experiment_id] ?? 0) + 1
    }
  }

  // Fetch student progress
  const progressMap: Record<string, { completedSections: number; completedAt: string | null }> = {}
  if (expIds.length > 0) {
    const { data: progressRows } = await supabase
      .from('student_progress')
      .select('experiment_id, completed_section_ids, completed_at')
      .eq('student_id', profile.id)
      .eq('class_id', classId)
      .in('experiment_id', expIds)

    for (const p of progressRows ?? []) {
      progressMap[p.experiment_id] = {
        completedSections: (p.completed_section_ids ?? []).length,
        completedAt: p.completed_at,
      }
    }
  }

  const difficultyColors: Record<string, string> = {
    beginner: 'bg-green-100 text-green-700',
    intermediate: 'bg-yellow-100 text-yellow-700',
    advanced: 'bg-red-100 text-red-700',
  }

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      {/* Back */}
      <Link
        href={`/dashboard/class/${classId}`}
        className="inline-flex items-center gap-1.5 text-sm text-[#6a6a6a] hover:text-[#222222] transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to class
      </Link>

      {/* Lab header */}
      <div
        className="bg-white rounded-2xl p-6 mb-8 border border-[#f2f2f2]"
        style={{
          boxShadow:
            'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
        }}
      >
        <div className="flex items-start gap-2 flex-wrap mb-2">
          <h1 className="text-xl font-bold text-[#222222] flex-1">{lab.title}</h1>
          {lab.difficulty && (
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                difficultyColors[lab.difficulty.toLowerCase()] ?? 'bg-gray-100 text-gray-600'
              }`}
            >
              {lab.difficulty}
            </span>
          )}
        </div>
        {lab.description && (
          <p className="text-sm text-[#6a6a6a] mb-3">{lab.description}</p>
        )}
        {lab.tags && lab.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {lab.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs text-[#6a6a6a] bg-[#f2f2f2] px-2.5 py-1 rounded-full"
              >
                <Tag className="w-3 h-3" />
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Experiments */}
      <h2 className="text-base font-semibold text-[#222222] mb-4">
        Experiments{' '}
        <span className="text-[#6a6a6a] font-400 text-sm">({(experiments ?? []).length})</span>
      </h2>

      {!experiments || experiments.length === 0 ? (
        <div className="py-16 text-center text-[#6a6a6a] text-sm">
          No experiments published in this lab yet.
        </div>
      ) : (
        <div className="space-y-3">
          {experiments.map((exp, idx) => {
            const totalSections = sectionCountMap[exp.id] ?? 0
            const prog = progressMap[exp.id]
            const completedSections = prog?.completedSections ?? 0
            const isCompleted = !!prog?.completedAt
            const pct =
              totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0
            const diffClass =
              difficultyColors[exp.difficulty?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-600'

            // Find first section to link to
            const href = `/dashboard/class/${classId}/lab/${labSlug}/${exp.slug}`

            return (
              <Link
                key={exp.id}
                href={href}
                className="group flex items-start gap-4 bg-white rounded-2xl p-5 border border-[#c1c1c1] hover:border-[#ff385c] transition-all duration-200"
                style={{
                  boxShadow:
                    'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
                }}
              >
                {/* Index */}
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold ${
                    isCompleted
                      ? 'bg-green-100 text-green-700'
                      : 'bg-[#f2f2f2] text-[#6a6a6a]'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-[#222222] text-sm leading-snug">{exp.title}</h3>
                    {exp.difficulty && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${diffClass}`}>
                        {exp.difficulty}
                      </span>
                    )}
                    {isCompleted && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
                        Completed
                      </span>
                    )}
                  </div>

                  {exp.description && (
                    <p className="text-xs text-[#6a6a6a] mb-2 line-clamp-2">{exp.description}</p>
                  )}

                  <div className="flex items-center gap-3 text-xs text-[#6a6a6a]">
                    {exp.estimated_duration && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {exp.estimated_duration} min
                      </span>
                    )}
                    <span>
                      {completedSections}/{totalSections} sections
                    </span>
                  </div>

                  {totalSections > 0 && (
                    <div className="mt-2 w-full h-1 bg-[#f2f2f2] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#ff385c] rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>

                <ChevronRight className="w-4 h-4 text-[#c1c1c1] group-hover:text-[#ff385c] transition-colors shrink-0 mt-1" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
