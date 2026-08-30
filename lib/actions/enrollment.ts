'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function joinByCode(
  code: string,
): Promise<{ success: boolean; classId?: string; error?: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()
  // Use admin client for class lookup — student has no RLS access to classes
  // they haven't joined yet, so the join_code lookup would return nothing otherwise.
  const adminSupabase = createAdminSupabaseClient()

  // Get the student's profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('clerk_user_id', userId)
    .single()

  if (profileError || !profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Enrollments model a student sitting in a class. An educator joining one
  // would land in a student dashboard their own role has no route to.
  if (profile.role !== 'student') {
    return { success: false, error: 'Only student accounts can join a class.' }
  }

  // Codes are stored uppercase. The join form uppercases as you type, but the
  // action is reachable directly, so normalise rather than miss an exact match.
  const { data: cls, error: classError } = await adminSupabase
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
  const { data: existingEnrollment } = await adminSupabase
    .from('enrollments')
    .select('id, status')
    .eq('class_id', cls.id)
    .eq('student_id', profile.id)
    .single()

  // Any existing row blocks a re-join — UNIQUE(class_id, student_id) means the
  // insert below would fail anyway, so return a useful message instead.
  if (existingEnrollment) {
    if (existingEnrollment.status === 'active') {
      return { success: false, error: 'You are already enrolled in this class.' }
    }
    if (existingEnrollment.status === 'dropped') {
      return { success: false, error: 'You previously dropped this class. Contact your educator.' }
    }
    return { success: false, error: 'You have already completed this class.' }
  }

  // Check max_students limit
  if (cls.max_students !== null) {
    const { count } = await adminSupabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', cls.id)
      .eq('status', 'active')

    if (count !== null && count >= cls.max_students) {
      return { success: false, error: 'This class is full.' }
    }
  }

  // Create enrollment using admin client — the student insert policy calls
  // auth_role() which may still recurse; admin client bypasses RLS safely
  // since we've already validated the student's identity above via Clerk auth.
  const { error: enrollError } = await adminSupabase.from('enrollments').insert({
    class_id: cls.id,
    student_id: profile.id,
    status: 'active',
    enrolled_via: 'code',
  })

  if (enrollError) {
    return { success: false, error: 'Failed to join class. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true, classId: cls.id }
}

export interface InvitePreview {
  className: string
  educatorName: string | null
  /** Set when the invite cannot be used; the page shows this instead of a join button. */
  problem?: string
  /** The student is already in this class — send them straight there. */
  alreadyEnrolledClassId?: string
}

/**
 * Read-only look at an invite token, for rendering /join/[token].
 *
 * Kept separate from acceptInvite so that merely opening the link — or having a
 * browser prefetch it — cannot enrol anyone. The write happens on submit.
 */
export async function previewInvite(
  token: string,
): Promise<InvitePreview | { notFound: true }> {
  const adminSupabase = createAdminSupabaseClient()

  const { data: invite } = await adminSupabase
    .from('class_invites')
    .select(
      'id, class_id, is_active, expires_at, max_uses, use_count, classes(name, status, educator:profiles!classes_educator_id_fkey(first_name, last_name))',
    )
    .eq('token', token)
    .maybeSingle()

  if (!invite || !invite.classes) return { notFound: true }

  const cls = invite.classes as unknown as {
    name: string
    status: string
    educator: { first_name: string | null; last_name: string | null } | null
  }
  const educatorName = cls.educator
    ? [cls.educator.first_name, cls.educator.last_name].filter(Boolean).join(' ') || null
    : null

  const preview: InvitePreview = { className: cls.name, educatorName }

  if (!invite.is_active) preview.problem = 'This invite link has been turned off.'
  else if (invite.expires_at && new Date(invite.expires_at) < new Date())
    preview.problem = 'This invite link has expired.'
  else if (invite.max_uses !== null && invite.use_count >= invite.max_uses)
    preview.problem = 'This invite link has already been used.'
  else if (cls.status !== 'active') preview.problem = 'This class is not accepting new students.'

  const { userId } = await auth()
  if (userId) {
    const supabase = await createServerSupabaseClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('clerk_user_id', userId)
      .single()
    if (profile) {
      const { data: existing } = await adminSupabase
        .from('enrollments')
        .select('class_id')
        .eq('class_id', invite.class_id)
        .eq('student_id', profile.id)
        .eq('status', 'active')
        .maybeSingle()
      if (existing) preview.alreadyEnrolledClassId = existing.class_id
    }
  }

  return preview
}

/**
 * Redeem an invite token generated by an educator on the class Students page.
 *
 * The link that page builds is /join/<token>; without this the token was a
 * dead end, since the only enrolment path was the typed class code.
 */
export async function acceptInvite(
  token: string,
): Promise<{ success: boolean; classId?: string; error?: string }> {
  const { userId } = await auth()
  if (!userId) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()
  const adminSupabase = createAdminSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, email, profile_completed')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) return { success: false, error: 'Profile not found' }
  if (!profile.profile_completed) {
    return { success: false, error: 'Finish setting up your profile first.' }
  }
  if (profile.role !== 'student') {
    return { success: false, error: 'Only student accounts can join a class.' }
  }

  const { data: invite } = await adminSupabase
    .from('class_invites')
    .select('id, class_id, is_active, expires_at, max_uses, use_count')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return { success: false, error: 'This invite link is not valid.' }
  if (!invite.is_active) return { success: false, error: 'This invite link has been turned off.' }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { success: false, error: 'This invite link has expired.' }
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return { success: false, error: 'This invite link has already been used.' }
  }

  const { data: cls } = await adminSupabase
    .from('classes')
    .select('id, status, max_students')
    .eq('id', invite.class_id)
    .single()

  if (!cls) return { success: false, error: 'This class no longer exists.' }
  if (cls.status !== 'active') {
    return { success: false, error: 'This class is not accepting new students.' }
  }

  const { data: existing } = await adminSupabase
    .from('enrollments')
    .select('id, status')
    .eq('class_id', cls.id)
    .eq('student_id', profile.id)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'active') return { success: true, classId: cls.id }
    return { success: false, error: 'You are no longer enrolled in this class. Contact your educator.' }
  }

  if (cls.max_students !== null) {
    const { count } = await adminSupabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', cls.id)
      .eq('status', 'active')
    if (count !== null && count >= cls.max_students) {
      return { success: false, error: 'This class is full.' }
    }
  }

  const { error: enrollError } = await adminSupabase.from('enrollments').insert({
    class_id: cls.id,
    student_id: profile.id,
    status: 'active',
    enrolled_via: 'invite_link',
  })

  if (enrollError) return { success: false, error: 'Failed to join class. Please try again.' }

  await adminSupabase
    .from('class_invites')
    .update({ use_count: invite.use_count + 1 })
    .eq('id', invite.id)

  // A manual invite was addressed to one email; close that row out so the
  // educator's Students page stops listing it as pending.
  if (profile.email) {
    await adminSupabase
      .from('invite_emails')
      .update({ status: 'accepted', student_id: profile.id })
      .eq('invite_id', invite.id)
      .eq('email', profile.email)
  }

  revalidatePath('/dashboard')
  return { success: true, classId: cls.id }
}
