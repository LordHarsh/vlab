'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function generateJoinCode(): string {
  const letters = Math.random().toString(36).slice(2, 5).toUpperCase()
  const alphanumeric = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${letters}-${alphanumeric}`
}

async function getEducatorProfile() {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('clerk_user_id', userId)
    .single()

  return data
}

export async function createClass(data: {
  name: string
  description?: string
  academic_year?: string
  semester?: string
  max_students?: number
}): Promise<{ success: boolean; classId?: string; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }
  if (profile.role !== 'educator') return { success: false, error: 'Not an educator' }

  const supabase = await createServerSupabaseClient()
  const joinCode = generateJoinCode()

  const { data: created, error } = await supabase
    .from('classes')
    .insert({
      educator_id: profile.id,
      name: data.name,
      description: data.description ?? null,
      academic_year: data.academic_year ?? null,
      semester: data.semester ?? null,
      max_students: data.max_students ?? null,
      join_code: joinCode,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) return { success: false, error: error.message }
  revalidatePath('/educator')
  return { success: true, classId: created.id }
}

export async function updateClass(
  classId: string,
  data: Partial<{
    name: string
    description: string
    status: string
    join_code_expires_at: string | null
    max_students: number | null
  }>,
): Promise<{ success: boolean; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  // Verify ownership
  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  const { error } = await supabase
    .from('classes')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', classId)

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${classId}`)
  revalidatePath(`/educator/classes/${classId}/settings`)
  return { success: true }
}

export async function assignLab(
  classId: string,
  labId: string,
  orderIndex: number,
): Promise<{ success: boolean; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  const { error } = await supabase.from('class_labs').insert({
    class_id: classId,
    lab_id: labId,
    order_index: orderIndex,
  })

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${classId}/labs`)
  return { success: true }
}

export async function removeLabFromClass(
  classId: string,
  labId: string,
): Promise<{ success: boolean; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  const { error } = await supabase
    .from('class_labs')
    .delete()
    .eq('class_id', classId)
    .eq('lab_id', labId)

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${classId}/labs`)
  return { success: true }
}

export async function reorderLab(
  classId: string,
  labId: string,
  newOrderIndex: number,
): Promise<{ success: boolean; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  const { error } = await supabase
    .from('class_labs')
    .update({ order_index: newOrderIndex })
    .eq('class_id', classId)
    .eq('lab_id', labId)

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${classId}/labs`)
  return { success: true }
}

export async function updateLabUnlockAt(
  classId: string,
  labId: string,
  unlockAt: string | null,
): Promise<{ success: boolean; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  const { error } = await supabase
    .from('class_labs')
    .update({ unlock_at: unlockAt })
    .eq('class_id', classId)
    .eq('lab_id', labId)

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${classId}/labs`)
  return { success: true }
}

export async function generateInviteLink(
  classId: string,
  options?: { expiresInDays?: number; maxUses?: number },
): Promise<{ success: boolean; token?: string; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  const token =
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)

  let expiresAt: string | null = null
  if (options?.expiresInDays) {
    const d = new Date()
    d.setDate(d.getDate() + options.expiresInDays)
    expiresAt = d.toISOString()
  }

  const { error } = await supabase.from('class_invites').insert({
    class_id: classId,
    created_by: profile.id,
    type: 'link',
    token,
    expires_at: expiresAt,
    max_uses: options?.maxUses ?? null,
    is_active: true,
    use_count: 0,
  })

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${classId}/students`)
  return { success: true, token }
}

export async function addStudentManual(
  classId: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  // Create a manual invite record
  const token =
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)

  const { data: invite, error: inviteError } = await supabase
    .from('class_invites')
    .insert({
      class_id: classId,
      created_by: profile.id,
      type: 'manual',
      token,
      is_active: true,
      max_uses: 1,
      use_count: 0,
    })
    .select('id')
    .single()

  if (inviteError) return { success: false, error: inviteError.message }

  // Check if student with this email already exists
  const { data: studentProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()

  const { error: emailError } = await supabase.from('invite_emails').insert({
    invite_id: invite.id,
    email,
    status: 'pending',
    student_id: studentProfile?.id ?? null,
  })

  if (emailError) return { success: false, error: emailError.message }

  // If student exists, enroll them directly
  if (studentProfile) {
    const { error: enrollError } = await supabase.from('enrollments').insert({
      class_id: classId,
      student_id: studentProfile.id,
      status: 'active',
      enrolled_via: 'manual',
    })
    if (enrollError && !enrollError.message.includes('duplicate')) {
      return { success: false, error: enrollError.message }
    }
  }

  revalidatePath(`/educator/classes/${classId}/students`)
  return { success: true }
}

export async function updateEnrollment(
  enrollmentId: string,
  status: 'active' | 'dropped' | 'completed',
): Promise<{ success: boolean; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  // Verify educator owns the class for this enrollment
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, class_id')
    .eq('id', enrollmentId)
    .single()

  if (!enrollment) return { success: false, error: 'Enrollment not found' }

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', enrollment.class_id)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Access denied' }

  const updateData: Record<string, string | null> = {
    status,
    dropped_at: status === 'dropped' ? new Date().toISOString() : null,
  }

  const { error } = await supabase
    .from('enrollments')
    .update(updateData)
    .eq('id', enrollmentId)

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${enrollment.class_id}/students`)
  return { success: true }
}

export async function regenerateJoinCode(
  classId: string,
): Promise<{ success: boolean; joinCode?: string; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  const newCode = generateJoinCode()

  const { error } = await supabase
    .from('classes')
    .update({ join_code: newCode, updated_at: new Date().toISOString() })
    .eq('id', classId)

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${classId}`)
  revalidatePath(`/educator/classes/${classId}/settings`)
  return { success: true, joinCode: newCode }
}

export async function updateClassQuizSettings(
  classId: string,
  quizId: string,
  settings: {
    passing_percentage?: number | null
    max_attempts?: number | null
    show_score?: boolean | null
    show_answers?: string | null
    due_date?: string | null
    is_graded?: boolean
  },
): Promise<{ success: boolean; error?: string }> {
  const profile = await getEducatorProfile()
  if (!profile) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()

  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) return { success: false, error: 'Class not found or access denied' }

  // Upsert — insert or update
  const { error } = await supabase.from('class_quiz_settings').upsert(
    {
      class_id: classId,
      quiz_id: quizId,
      ...settings,
    },
    { onConflict: 'class_id,quiz_id' },
  )

  if (error) return { success: false, error: error.message }
  revalidatePath(`/educator/classes/${classId}/settings`)
  return { success: true }
}
