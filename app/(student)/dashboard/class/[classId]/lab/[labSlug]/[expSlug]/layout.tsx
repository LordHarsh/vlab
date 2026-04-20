import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ExperimentShell } from '@/components/layout/ExperimentShell'

export default async function ExperimentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ classId: string; labSlug: string; expSlug: string }>
}) {
  const { classId, labSlug, expSlug } = await params
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

  // Fetch experiment by slug and lab slug
  const { data: lab } = await supabase
    .from('labs')
    .select('id, slug, title')
    .eq('slug', labSlug)
    .single()

  if (!lab) notFound()

  const { data: experiment } = await supabase
    .from('experiments')
    .select('id, slug, title, lab_id')
    .eq('slug', expSlug)
    .eq('lab_id', lab.id)
    .eq('published', true)
    .single()

  if (!experiment) notFound()

  // Fetch active sections
  const { data: sections } = await supabase
    .from('experiment_sections')
    .select('id, type, title, order_index, is_required')
    .eq('experiment_id', experiment.id)
    .eq('status', 'active')
    .order('order_index', { ascending: true })

  // Fetch student progress
  const { data: progress } = await supabase
    .from('student_progress')
    .select('completed_section_ids, last_section_id')
    .eq('student_id', profile.id)
    .eq('experiment_id', experiment.id)
    .eq('class_id', classId)
    .single()

  const completedSectionIds: string[] = progress?.completed_section_ids ?? []

  return (
    <ExperimentShell
      classId={classId}
      labSlug={labSlug}
      experiment={experiment}
      sections={sections ?? []}
      completedSectionIds={completedSectionIds}
    >
      {children}
    </ExperimentShell>
  )
}
