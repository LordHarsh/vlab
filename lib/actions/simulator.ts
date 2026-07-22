'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * Server actions for the native simulator.
 *
 * Every one of these re-derives the student from the Clerk session rather than
 * trusting an id from the client, and enrollment is checked before anything is
 * written. RLS enforces the same rules independently (migration 015) — this is
 * the app-layer half of the same gate, not a replacement for it.
 */

export interface CircuitGraph {
  parts: unknown[]
  wires: unknown[]
}

async function studentContext(classId: string) {
  const { userId } = await auth()
  if (!userId) return { error: 'Not authenticated' as const }

  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) return { error: 'Profile not found' as const }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('class_id', classId)
    .eq('student_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!enrollment) return { error: 'You are not enrolled in this class.' as const }

  return { supabase, profileId: profile.id }
}

/**
 * Write the student's working copy. Overwrites — this is autosave, not history.
 * Submissions, when they exist, will be a separate immutable table (§7).
 */
export async function saveAttempt(
  simulationId: string,
  classId: string,
  graph: CircuitGraph,
): Promise<{ success: boolean; error?: string }> {
  const ctx = await studentContext(classId)
  if ('error' in ctx) return { success: false, error: ctx.error }

  const { error } = await ctx.supabase.from('sim_attempts').upsert(
    {
      student_id: ctx.profileId,
      simulation_id: simulationId,
      class_id: classId,
      graph: graph as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,simulation_id,class_id' },
  )

  if (error) return { success: false, error: error.message }
  return { success: true }
}

/**
 * Load what the student should open with: their own saved work if any,
 * otherwise the authored starter circuit.
 *
 * Never returns role='reference' — that is the worked solution, and RLS blocks
 * students from reading it anyway.
 */
export async function loadAttempt(
  simulationId: string,
  classId: string,
): Promise<{ graph: CircuitGraph | null; source: 'attempt' | 'starter' | 'none'; error?: string }> {
  const ctx = await studentContext(classId)
  if ('error' in ctx) return { graph: null, source: 'none', error: ctx.error }

  const { data: attempt } = await ctx.supabase
    .from('sim_attempts')
    .select('graph')
    .eq('student_id', ctx.profileId)
    .eq('simulation_id', simulationId)
    .eq('class_id', classId)
    .single()

  if (attempt?.graph) {
    return { graph: attempt.graph as unknown as CircuitGraph, source: 'attempt' }
  }

  const { data: starter } = await ctx.supabase
    .from('circuits')
    .select('graph')
    .eq('simulation_id', simulationId)
    .eq('role', 'starter')
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (starter?.graph) {
    return { graph: starter.graph as unknown as CircuitGraph, source: 'starter' }
  }

  return { graph: null, source: 'none' }
}
