'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function markSectionVisited(
  experimentId: string,
  classId: string,
  sectionId: string,
): Promise<void> {
  const { userId } = await auth()
  if (!userId) return

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) return

  // Fetch existing progress
  const { data: existing } = await supabase
    .from('student_progress')
    // completed_at is read below to preserve the ORIGINAL completion time —
    // revisiting a finished experiment must not restamp it.
    .select('id, completed_section_ids, completed_at')
    .eq('student_id', profile.id)
    .eq('experiment_id', experimentId)
    .eq('class_id', classId)
    .single()

  const now = new Date().toISOString()

  if (existing) {
    const completedIds: string[] = existing.completed_section_ids ?? []
    const updated = completedIds.includes(sectionId)
      ? completedIds
      : [...completedIds, sectionId]

    await supabase
      .from('student_progress')
      .update({
        completed_section_ids: updated,
        last_section_id: sectionId,
        last_accessed_at: now,
        // Seeing every section is what finishing an experiment means. Without
        // this the column was never written by anything — markExperimentComplete
        // had no callers, so completed_at stayed null for every student forever
        // and every "Completed" badge and dashboard count read zero.
        ...((await coversEverySection(supabase, experimentId, updated))
          ? { completed_at: existing.completed_at ?? now }
          : {}),
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('student_progress').insert({
      student_id: profile.id,
      experiment_id: experimentId,
      class_id: classId,
      completed_section_ids: [sectionId],
      last_section_id: sectionId,
      started_at: now,
      last_accessed_at: now,
      total_time_seconds: 0,
    })
  }
}

/**
 * Whether `visited` covers every active section of the experiment.
 *
 * Compared as a set against the ids that actually exist, rather than by
 * counting: a stale id left behind by a deleted or archived section would
 * otherwise inflate the total and mark an unfinished experiment complete.
 */
async function coversEverySection(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  experimentId: string,
  visited: string[],
): Promise<boolean> {
  const { data: sections } = await supabase
    .from('experiment_sections')
    .select('id')
    .eq('experiment_id', experimentId)
    .eq('status', 'active')

  // No sections readable (RLS, or a genuinely empty experiment) is not
  // completion — better to leave it unfinished than to award it wrongly.
  if (!sections || sections.length === 0) return false

  const seen = new Set(visited)
  return sections.every((s) => seen.has(s.id))
}

export async function markExperimentComplete(
  experimentId: string,
  classId: string,
): Promise<void> {
  const { userId } = await auth()
  if (!userId) return

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) return

  const now = new Date().toISOString()

  const { data: existing } = await supabase
    .from('student_progress')
    .select('id')
    .eq('student_id', profile.id)
    .eq('experiment_id', experimentId)
    .eq('class_id', classId)
    .single()

  if (existing) {
    await supabase
      .from('student_progress')
      .update({ completed_at: now, last_accessed_at: now })
      .eq('id', existing.id)
  } else {
    await supabase.from('student_progress').insert({
      student_id: profile.id,
      experiment_id: experimentId,
      class_id: classId,
      completed_section_ids: [],
      completed_at: now,
      started_at: now,
      last_accessed_at: now,
      total_time_seconds: 0,
    })
  }
}
