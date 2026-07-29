import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ArrowLeft, Clock, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

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

  return (
    <div className="max-w-5xl px-5 py-8 sm:px-8">
      <Link
        href={`/dashboard/class/${classId}`}
        className="mb-5 inline-flex items-center gap-1.5 font-chrome text-[13px] font-semibold text-vlab-steel transition-colors hover:text-vlab-orange-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to class
      </Link>

      <PageHeader
        eyebrow={
          <>
            Laboratory
            {lab.difficulty ? ` · ${lab.difficulty}` : ''}
            {lab.tags && lab.tags.length > 0 ? ` · ${lab.tags.join(', ')}` : ''}
          </>
        }
        title={lab.title}
        description={lab.description}
      />

      <h2 className="vlab-page-title mb-3 text-[1.15rem]">List of Experiments</h2>

      {!experiments || experiments.length === 0 ? (
        <div className="border border-vlab-rule-strong bg-vlab-surface-alt px-6 py-14 text-center text-sm text-vlab-muted">
          No experiments published in this laboratory yet.
        </div>
      ) : (
        /* The reference's List of Experiments is a literal two-column table —
           S.No | Experiment — and that is what makes it read as a syllabus
           rather than a catalogue. Ours carries the same two columns first, with
           duration and progress appended because they are actually ours to show. */
        <div className="overflow-x-auto border border-vlab-rule-strong">
          <table className="vlab-table">
            <thead>
              <tr>
                <th scope="col">S.No</th>
                <th scope="col">Experiment</th>
                <th scope="col">Duration</th>
                <th scope="col">Sections</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((exp, idx) => {
                const totalSections = sectionCountMap[exp.id] ?? 0
                const prog = progressMap[exp.id]
                const completedSections = prog?.completedSections ?? 0
                const isCompleted = !!prog?.completedAt
                const href = `/dashboard/class/${classId}/lab/${labSlug}/${exp.slug}`

                return (
                  <tr key={exp.id}>
                    <th scope="row">{idx + 1}</th>
                    <td>
                      <Link
                        href={href}
                        className="font-chrome font-bold text-vlab-600 hover:text-vlab-800 hover:underline"
                      >
                        {exp.title}
                      </Link>
                      {exp.description && (
                        <p className="mt-0.5 max-w-xl text-[13px] leading-relaxed text-vlab-muted">
                          {exp.description}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-vlab-muted">
                      {exp.estimated_duration ? (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Clock className="h-3.5 w-3.5" />
                          {exp.estimated_duration} min
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-vlab-ink">
                      {completedSections} / {totalSections}
                    </td>
                    <td className="whitespace-nowrap">
                      {isCompleted ? (
                        <span className="inline-flex items-center gap-1.5 border border-vlab-green px-2 py-0.5 font-chrome text-[12px] font-bold text-vlab-green-ink">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Completed
                        </span>
                      ) : completedSections > 0 ? (
                        <span className="font-chrome text-[12px] font-bold text-vlab-orange-ink">
                          In progress
                        </span>
                      ) : (
                        <span className="font-chrome text-[12px] text-vlab-faint">
                          Not started
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
