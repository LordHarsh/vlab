import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { StudentShell } from '@/components/layout/StudentShell'

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, avatar_url, profile_completed, role, is_admin')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) {
    redirect('/onboarding')
  }

  if (!profile.profile_completed) {
    redirect('/onboarding')
  }

  // Educators and admins should not use the student shell. Route each to the
  // console it can actually enter: sending an admin whose role is still
  // 'student' to /educator bounced it straight back here, looping forever.
  if (profile.role === 'educator') {
    redirect('/educator')
  }
  if (profile.is_admin) {
    redirect('/admin')
  }

  return (
    <StudentShell profile={profile}>
      {children}
    </StudentShell>
  )
}
