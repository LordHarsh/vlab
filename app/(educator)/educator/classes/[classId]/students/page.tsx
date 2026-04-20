import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { StudentsClient } from './students-client'

export default async function StudentsPage({
  params,
}: {
  params: Promise<{ classId: string }>
}) {
  const { classId } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')

  const { data: cls } = await supabase
    .from('classes')
    .select('id, name, join_code, join_code_expires_at, max_students')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) notFound()

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(`
      id, status, enrolled_at, enrolled_via,
      profiles:student_id (
        id, first_name, last_name, email, registration_no, class_section
      )
    `)
    .eq('class_id', classId)
    .order('enrolled_at', { ascending: false })

  const { data: pendingInvites } = await supabase
    .from('class_invites')
    .select(`
      id, token, type, expires_at, max_uses, use_count, is_active, created_at,
      invite_emails(id, email, status, accepted_at)
    `)
    .eq('class_id', classId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const enrollmentList = (enrollments ?? []).map((e) => {
    const p = e.profiles as {
      id: string
      first_name: string | null
      last_name: string | null
      email: string
      registration_no: string | null
      class_section: string | null
    } | null
    return {
      id: e.id,
      status: e.status,
      enrolled_at: e.enrolled_at,
      enrolled_via: e.enrolled_via,
      student: p,
    }
  })

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6a6a6a] mb-6">
        <Link href="/educator" className="hover:text-[#222222] transition-colors">My Classes</Link>
        <span>/</span>
        <Link href={`/educator/classes/${classId}`} className="hover:text-[#222222] transition-colors">{cls.name}</Link>
        <span>/</span>
        <span className="text-[#222222]">Students</span>
      </div>

      <StudentsClient
        classId={classId}
        className={cls.name}
        joinCode={cls.join_code}
        joinCodeExpiresAt={cls.join_code_expires_at}
        maxStudents={cls.max_students}
        enrollments={enrollmentList}
        invites={(pendingInvites ?? []).map((inv) => ({
          id: inv.id,
          token: inv.token,
          type: inv.type,
          expires_at: inv.expires_at,
          max_uses: inv.max_uses,
          use_count: inv.use_count,
          is_active: inv.is_active,
          created_at: inv.created_at,
          invite_emails: (inv.invite_emails as {
            id: string
            email: string
            status: string
            accepted_at: string | null
          }[]) ?? [],
        }))}
      />
    </div>
  )
}
