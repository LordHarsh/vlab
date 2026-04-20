import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Plus, Users, FlaskConical, BookOpen } from 'lucide-react'

function StatusBadge({ status }: { status: string }) {
  const styles = {
    active: 'bg-green-100 text-green-700',
    completed: 'bg-blue-100 text-blue-700',
    archived: 'bg-[#f2f2f2] text-[#6a6a6a]',
  }
  const style = styles[status as keyof typeof styles] ?? styles.archived
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${style}`}>
      {status}
    </span>
  )
}

export default async function EducatorPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')

  const { data: classes } = await supabase
    .from('classes')
    .select(`
      id, name, description, status, academic_year, semester, join_code,
      enrollments(id, status),
      class_labs(id)
    `)
    .eq('educator_id', profile.id)
    .order('created_at', { ascending: false })

  const classList = classes ?? []

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-[#222222]">My Classes</h1>
          <p className="text-[#6a6a6a] mt-1">Manage your classes and student progress</p>
        </div>
        <Link
          href="/educator/classes/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#ff385c] text-white rounded-xl text-sm font-medium hover:bg-[#e0314f] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create New Class
        </Link>
      </div>

      {classList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#c1c1c1] p-12 text-center" style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}>
          <div className="w-16 h-16 bg-[#f2f2f2] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-[#6a6a6a]" />
          </div>
          <h2 className="text-lg font-semibold text-[#222222] mb-2">No classes yet</h2>
          <p className="text-[#6a6a6a] mb-6">Create your first class to start managing students and labs.</p>
          <Link
            href="/educator/classes/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#ff385c] text-white rounded-xl text-sm font-medium hover:bg-[#e0314f] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create New Class
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {classList.map((cls) => {
            const enrollments = (cls.enrollments as { id: string; status: string }[]) ?? []
            const activeStudents = enrollments.filter((e) => e.status === 'active').length
            const labCount = (cls.class_labs as { id: string }[])?.length ?? 0

            return (
              <Link
                key={cls.id}
                href={`/educator/classes/${cls.id}`}
                className="group bg-white rounded-2xl border border-[#c1c1c1] p-6 hover:shadow-lg transition-all"
                style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-[#ff385c]/10 rounded-xl flex items-center justify-center">
                    <GraduationCapIcon />
                  </div>
                  <StatusBadge status={cls.status} />
                </div>

                <h3 className="font-semibold text-[#222222] text-base mb-1 group-hover:text-[#ff385c] transition-colors">
                  {cls.name}
                </h3>
                {cls.description && (
                  <p className="text-[#6a6a6a] text-sm mb-3 line-clamp-2">{cls.description}</p>
                )}
                {(cls.academic_year || cls.semester) && (
                  <p className="text-xs text-[#6a6a6a] mb-4">
                    {[cls.academic_year, cls.semester].filter(Boolean).join(' · ')}
                  </p>
                )}

                <div className="flex items-center gap-4 pt-4 border-t border-[#f2f2f2]">
                  <div className="flex items-center gap-1.5 text-sm text-[#6a6a6a]">
                    <Users className="w-3.5 h-3.5" />
                    <span>{activeStudents} students</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-[#6a6a6a]">
                    <FlaskConical className="w-3.5 h-3.5" />
                    <span>{labCount} labs</span>
                  </div>
                </div>

                <div className="mt-3">
                  <span className="text-xs font-mono text-[#6a6a6a] bg-[#f2f2f2] px-2 py-1 rounded-lg">
                    {cls.join_code}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GraduationCapIcon() {
  return (
    <svg className="w-5 h-5 text-[#ff385c]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  )
}
