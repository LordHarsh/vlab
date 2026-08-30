import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Users } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { previewInvite } from '@/lib/actions/enrollment'
import { JoinInviteForm } from './join-invite-client'

/**
 * Landing page for the invite links educators generate on the class Students
 * page. That UI has always built `${origin}/join/<token>`; until this route
 * existed every link it produced 404'd.
 */
export default async function JoinInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const { userId } = await auth()
  if (!userId) redirect(`/sign-in?redirect_url=/join/${encodeURIComponent(token)}`)

  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, profile_completed')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile || !profile.profile_completed) redirect('/onboarding')

  const preview = await previewInvite(token)

  if ('notFound' in preview) {
    return (
      <Card title="Invite not found">
        That invite link is not valid. Ask your educator for a new one, or join with a class
        code instead.
      </Card>
    )
  }

  if (preview.alreadyEnrolledClassId) {
    redirect(`/dashboard/class/${preview.alreadyEnrolledClassId}`)
  }

  if (profile.role !== 'student') {
    return (
      <Card title="Student accounts only">
        You are signed in with an educator account. Invite links enrol students, so sign in
        with a student account to accept this one.
      </Card>
    )
  }

  if (preview.problem) {
    return <Card title="This invite cannot be used">{preview.problem}</Card>
  }

  return (
    <Shell>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-vlab-600/10">
        <Users className="h-6 w-6 text-vlab-600" />
      </div>
      <h1 className="mb-1 text-xl font-bold text-vlab-ink">You have been invited</h1>
      <p className="mb-6 text-sm text-vlab-muted">
        Join <span className="font-semibold text-vlab-ink">{preview.className}</span>
        {preview.educatorName ? `, taught by ${preview.educatorName}` : ''}.
      </p>
      <JoinInviteForm token={token} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div
          className="rounded-lg bg-white p-8"
          style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-red-50">
        <AlertCircle className="h-6 w-6 text-red-600" />
      </div>
      <h1 className="mb-1 text-xl font-bold text-vlab-ink">{title}</h1>
      <p className="mb-6 text-sm text-vlab-muted">{children}</p>
      <Link
        href="/dashboard/join"
        className="inline-block w-full rounded-lg bg-vlab-600 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-vlab-700"
      >
        Join with a code instead
      </Link>
    </Shell>
  )
}
