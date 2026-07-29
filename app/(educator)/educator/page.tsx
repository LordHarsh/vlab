import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Plus, Users, FlaskConical, BookOpen } from 'lucide-react'

function StatusBadge({ status }: { status: string }) {
  const styles = {
    active: 'bg-green-100 text-green-700',
    completed: 'bg-blue-100 text-blue-700',
    archived: 'bg-vlab-surface text-vlab-muted',
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
          <h1 className="text-2xl font-semibold text-vlab-ink">My Classes</h1>
          <p className="text-vlab-muted mt-1">Manage your classes and student progress</p>
        </div>
        <Link
          href="/educator/classes/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-vlab-600 text-white rounded-lg text-sm font-medium hover:bg-vlab-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create New Class
        </Link>
      </div>

      {classList.length === 0 ? (
        <div className="bg-white rounded-lg border border-vlab-rule-strong p-12 text-center" style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}>
          <div className="w-16 h-16 bg-vlab-surface rounded-lg flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-vlab-muted" />
          </div>
          <h2 className="text-lg font-semibold text-vlab-ink mb-2">No classes yet</h2>
          <p className="text-vlab-muted mb-6">Create your first class to start managing students and labs.</p>
          <Link
            href="/educator/classes/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-vlab-600 text-white rounded-lg text-sm font-medium hover:bg-vlab-700 transition-colors"
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
                className="group bg-white rounded-lg border border-vlab-rule-strong p-6 hover:shadow-lg transition-all"
                style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-vlab-600/10 rounded-lg flex items-center justify-center">
                    <GraduationCapIcon />
                  </div>
                  <StatusBadge status={cls.status} />
                </div>

                <h3 className="font-semibold text-vlab-ink text-base mb-1 group-hover:text-vlab-600 transition-colors">
                  {cls.name}
                </h3>
                {cls.description && (
                  <p className="text-vlab-muted text-sm mb-3 line-clamp-2">{cls.description}</p>
                )}
                {(cls.academic_year || cls.semester) && (
                  <p className="text-xs text-vlab-muted mb-4">
                    {[cls.academic_year, cls.semester].filter(Boolean).join(' · ')}
                  </p>
                )}

                <div className="flex items-center gap-4 pt-4 border-t border-vlab-surface">
                  <div className="flex items-center gap-1.5 text-sm text-vlab-muted">
                    <Users className="w-3.5 h-3.5" />
                    <span>{activeStudents} students</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-vlab-muted">
                    <FlaskConical className="w-3.5 h-3.5" />
                    <span>{labCount} labs</span>
                  </div>
                </div>

                <div className="mt-3">
                  <span className="text-xs font-mono text-vlab-muted bg-vlab-surface px-2 py-1 rounded-lg">
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
    <svg className="w-5 h-5 text-vlab-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  )
}
