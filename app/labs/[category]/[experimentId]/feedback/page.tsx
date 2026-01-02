import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { FeedbackClient } from './feedback-client'

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params
  const supabase = await createServerSupabaseClient()

  // Fetch experiment to get its ID
  const { data: experiment } = await supabase
    .from('experiments')
    .select('id, slug')
    .eq('slug', experimentId)
    .eq('published', true)
    .single()

  if (!experiment) {
    notFound()
  }

  return (
    <FeedbackClient
      experimentId={experiment.id}
      category={category}
      experimentSlug={experimentId}
    />
  )
}
