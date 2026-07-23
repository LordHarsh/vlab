'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type Supa = Awaited<ReturnType<typeof createServerSupabaseClient>>

/**
 * The caller's profile id, but only if they are an ACTIVE student in `classId`.
 *
 * Progress rows are written with just student_id, and RLS scopes them to the
 * student — but nothing stopped an enrolled student POSTing progress for a
 * different class they were never in, seeding phantom rows in that class's
 * gradebook. This is the app-layer enrollment gate that closes it, mirroring
 * lib/actions/simulator.ts's studentContext. Returns null (caller silently does
 * nothing) when there is no session, profile, or active enrollment.
 */
async function enrolledProfileId(supabase: Supa, classId: string): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()
  if (!profile) return null

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('class_id', classId)
    .eq('student_id', profile.id)
    .eq('status', 'active')
    .single()

  return enrollment ? profile.id : null
}

export async function markSectionVisited(
  experimentId: string,
  classId: string,
  sectionId: string,
): Promise<void> {
  const supabase = await createServerSupabaseClient()
  const profileId = await enrolledProfileId(supabase, classId)
  if (!profileId) return

  const { data: existing } = await supabase
    .from('student_progress')
    // completed_at is read to preserve the ORIGINAL completion time —
    // revisiting a finished experiment must not restamp it.
    .select('id, completed_section_ids, completed_at')
    .eq('student_id', profileId)
    .eq('experiment_id', experimentId)
    .eq('class_id', classId)
    .single()

  const now = new Date().toISOString()

  if (existing) {
    const completedIds: string[] = existing.completed_section_ids ?? []
    const updated = completedIds.includes(sectionId)
      ? completedIds
      : [...completedIds, sectionId]

    // Seeing every active section is what finishing an experiment means. This
    // is the ONLY writer of completed_at — nothing else marks completion.
    const done = await coversEverySection(supabase, experimentId, updated)

    const { error } = await supabase
      .from('student_progress')
      .update({
        completed_section_ids: updated,
        last_section_id: sectionId,
        last_accessed_at: now,
        ...(done ? { completed_at: existing.completed_at ?? now } : {}),
      })
      .eq('id', existing.id)
    if (error) console.error('[markSectionVisited] update failed:', error.message)
  } else {
    const { error } = await supabase.from('student_progress').insert({
      student_id: profileId,
      experiment_id: experimentId,
      class_id: classId,
      completed_section_ids: [sectionId],
      last_section_id: sectionId,
      started_at: now,
      last_accessed_at: now,
      total_time_seconds: 0,
    })
    if (error) console.error('[markSectionVisited] insert failed:', error.message)
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
  supabase: Supa,
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
