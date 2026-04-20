import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function ExperimentIndexPage({
  params,
}: {
  params: Promise<{ classId: string; labSlug: string; expSlug: string }>
}) {
  const { classId, labSlug, expSlug } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()

  const { data: lab } = await supabase
    .from('labs')
    .select('id')
    .eq('slug', labSlug)
    .single()

  if (!lab) notFound()

  const { data: experiment } = await supabase
    .from('experiments')
    .select('id')
    .eq('slug', expSlug)
    .eq('lab_id', lab.id)
    .eq('published', true)
    .single()

  if (!experiment) notFound()

  const { data: firstSection } = await supabase
    .from('experiment_sections')
    .select('id')
    .eq('experiment_id', experiment.id)
    .eq('status', 'active')
    .order('order_index', { ascending: true })
    .limit(1)
    .single()

  if (!firstSection) {
    // No sections yet — show placeholder
    return (
      <div className="py-16 text-center text-[#6a6a6a]">
        <p>This experiment has no sections yet.</p>
      </div>
    )
  }

  redirect(
    `/dashboard/class/${classId}/lab/${labSlug}/${expSlug}/section/${firstSection.id}`,
  )
}
