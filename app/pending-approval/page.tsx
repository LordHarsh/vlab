import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Clock, XCircle, CheckCircle, LogOut } from 'lucide-react'
import Link from 'next/link'
import { SignOutButton } from '@clerk/nextjs'

export default async function PendingApprovalPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, role, approval_status, profile_completed')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')
  if (!profile.profile_completed) redirect('/onboarding')

  // Approved educators should go to their dashboard
  if (profile.role === 'educator' && profile.approval_status === 'approved') {
    redirect('/educator')
  }
  // Students never land here
  if (profile.role === 'student') redirect('/dashboard')

  const isRejected = profile.approval_status === 'rejected'

  return (
    <div className="min-h-screen bg-[#f7f7f7] flex items-center justify-center px-4">
      <div
        className="bg-white rounded-2xl p-10 max-w-md w-full text-center"
        style={{
          boxShadow:
            'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="text-xl font-bold text-[#ff385c]">VLab</span>
        </div>

        {isRejected ? (
          <>
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-[#222222] mb-3">
              Account Not Approved
            </h1>
            <p className="text-[#6a6a6a] text-sm leading-relaxed mb-6">
              Your educator account request was not approved. This may be due to
              unverifiable credentials. Please contact your institution
              administrator for assistance.
            </p>
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700 text-left mb-6">
              If you believe this is an error, reach out to the platform admin
              with your employee number and department details.
            </div>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-5">
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="text-xl font-bold text-[#222222] mb-3">
              Awaiting Admin Approval
            </h1>
            <p className="text-[#6a6a6a] text-sm leading-relaxed mb-6">
              Hi{profile.first_name ? ` ${profile.first_name}` : ''}! Your
              educator account is pending approval from the platform
              administrator. You&apos;ll be able to create classes and manage
              students once approved.
            </p>
            <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-700 text-left mb-6 flex items-start gap-2">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Your profile is complete. No further action needed — the admin
                will review and approve your account shortly.
              </span>
            </div>
          </>
        )}

        <div className="flex flex-col gap-3">
          <Link
            href="/labs"
            className="w-full py-2.5 rounded-xl border border-[#c1c1c1] text-sm font-medium text-[#222222] hover:bg-[#f2f2f2] transition-colors"
          >
            Browse Public Labs
          </Link>
          <SignOutButton redirectUrl="/sign-in">
            <button className="w-full py-2.5 rounded-xl text-sm text-[#6a6a6a] hover:text-[#222222] hover:bg-[#f2f2f2] transition-colors flex items-center justify-center gap-2">
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  )
}
