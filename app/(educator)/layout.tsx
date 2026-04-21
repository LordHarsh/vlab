import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { EducatorSidebar } from './educator-sidebar'

export default async function EducatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, is_admin, profile_completed, approval_status, first_name, last_name, email')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')
  if (!profile.profile_completed) redirect('/onboarding')
  if (profile.role === 'student') redirect('/dashboard')
  if (profile.role !== 'educator') redirect('/admin')
  // Pending or rejected educators cannot access the dashboard
  if (profile.approval_status === 'pending') redirect('/pending-approval')
  if (profile.approval_status === 'rejected') redirect('/pending-approval')

  return (
    <div className="min-h-screen bg-[#f2f2f2] flex">
      <EducatorSidebar profile={profile} />
      <main className="flex-1 min-w-0 p-6 lg:p-8">{children}</main>
    </div>
  )
}
