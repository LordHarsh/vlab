'use server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Tables, TablesUpdate } from '@/types/database'

export type Profile = Tables<'profiles'>

export type OnboardingData = {
  role: 'student' | 'educator'
  first_name: string
  last_name: string
  department: string
  phone?: string
  // Student-specific
  registration_no?: string
  year?: number
  class_section?: string
  // Educator-specific
  employee_no?: string
}

/**
 * Ensures a profile row exists for the current Clerk user.
 * Creates one from Clerk data if it doesn't yet exist.
 * Call this from authenticated layouts to bootstrap the profile on first sign-in.
 */
export async function ensureProfile(): Promise<Profile | null> {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createServerSupabaseClient()

  // Check if profile already exists
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('clerk_user_id', userId)
    .single()

  if (existing) return existing

  // Profile doesn't exist — fetch Clerk user data and create it
  const clerkUser = await currentUser()
  if (!clerkUser) return null

  const email =
    clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? ''

  const { data: created, error } = await supabase
    .from('profiles')
    .insert({
      clerk_user_id: userId,
      email,
      first_name: clerkUser.firstName ?? null,
      last_name: clerkUser.lastName ?? null,
      avatar_url: clerkUser.imageUrl ?? null,
      profile_completed: false,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[ensureProfile] insert error:', error)
    return null
  }

  return created
}

/**
 * Completes onboarding by updating profile fields and marking profile_completed = true.
 * Redirects to /dashboard on success (via the caller).
 */
export async function completeOnboarding(
  data: OnboardingData,
): Promise<{ success: boolean; error?: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  const updatePayload: TablesUpdate<'profiles'> = {
    role: data.role,
    first_name: data.first_name,
    last_name: data.last_name,
    department: data.department,
    phone: data.phone ?? null,
    profile_completed: true,
    // Educators are pending until an admin approves them; students are auto-approved
    approval_status: data.role === 'educator' ? 'pending' : 'approved',
  }

  if (data.role === 'student') {
    updatePayload.registration_no = data.registration_no ?? null
    updatePayload.year = data.year ?? null
    updatePayload.class_section = data.class_section ?? null
  } else {
    updatePayload.employee_no = data.employee_no ?? null
  }

  const { error } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('clerk_user_id', userId)

  if (error) {
    console.error('[completeOnboarding] update error:', error)
    return { success: false, error: 'Failed to save profile. Please try again.' }
  }

  return { success: true }
}

/**
 * Returns the profile for the currently authenticated user.
 */
export async function getMyProfile(): Promise<Profile | null> {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('clerk_user_id', userId)
    .single()

  if (error) return null
  return data
}
