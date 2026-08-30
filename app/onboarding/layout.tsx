import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { AuthShell } from '@/components/layout/AuthShell'

/**
 * Onboarding is for accounts that have not finished it.
 *
 * Without this guard the page stayed reachable afterwards, and re-submitting it
 * rewrote role and approval_status — an approved educator who opened the link
 * again was silently dropped back to 'pending'.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, profile_completed, approval_status')
    .eq('clerk_user_id', userId)
    .single()

  if (profile?.profile_completed) {
    if (profile.role === 'educator') {
      redirect(profile.approval_status === 'approved' ? '/educator' : '/pending-approval')
    }
    redirect(profile.is_admin ? '/admin' : '/dashboard')
  }

  return <AuthShell>{children}</AuthShell>
}
