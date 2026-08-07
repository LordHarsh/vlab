import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { EducatorSidebar } from './educator-sidebar'
import { InstitutionalFooter } from '@/components/layout/InstitutionalFooter'

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
    <div className="flex min-h-screen bg-white">
      <EducatorSidebar profile={profile} />
      <div className="flex min-w-0 flex-1 flex-col lg:vlab-dotted-divide">
        <main className="min-w-0 flex-1 p-5 lg:p-8">{children}</main>
        <InstitutionalFooter />
      </div>
    </div>
  )
}
