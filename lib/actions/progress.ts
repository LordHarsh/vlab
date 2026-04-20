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
    .select('id, completed_section_ids')
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
