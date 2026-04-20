'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function joinByCode(
  code: string,
): Promise<{ success: boolean; classId?: string; error?: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  // Get the student's profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (profileError || !profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Find class by join code
  const { data: cls, error: classError } = await supabase
    .from('classes')
    .select('id, status, join_code_expires_at, max_students')
    .eq('join_code', code.trim().toUpperCase())
    .single()

  if (classError || !cls) {
    return { success: false, error: 'Invalid class code. Please check and try again.' }
  }

  // Check class is active
  if (cls.status !== 'active') {
    return { success: false, error: 'This class is not accepting new students.' }
  }

  // Check join code expiry
  if (cls.join_code_expires_at) {
    const expiresAt = new Date(cls.join_code_expires_at)
    if (expiresAt < new Date()) {
      return { success: false, error: 'This join code has expired.' }
    }
  }

  // Check if already enrolled
  const { data: existingEnrollment } = await supabase
    .from('enrollments')
    .select('id, status')
    .eq('class_id', cls.id)
    .eq('student_id', profile.id)
    .single()

  if (existingEnrollment) {
    if (existingEnrollment.status === 'active') {
      return { success: false, error: 'You are already enrolled in this class.' }
    }
    if (existingEnrollment.status === 'dropped') {
      return { success: false, error: 'You previously dropped this class. Contact your educator.' }
    }
  }

  // Check max_students limit
  if (cls.max_students !== null) {
    const { count } = await supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', cls.id)
      .eq('status', 'active')

    if (count !== null && count >= cls.max_students) {
      return { success: false, error: 'This class is full.' }
    }
  }

  // Create enrollment
  const { error: enrollError } = await supabase.from('enrollments').insert({
    class_id: cls.id,
    student_id: profile.id,
    status: 'active',
    enrolled_via: 'join_code',
  })

  if (enrollError) {
    return { success: false, error: 'Failed to join class. Please try again.' }
  }

  return { success: true, classId: cls.id }
}
