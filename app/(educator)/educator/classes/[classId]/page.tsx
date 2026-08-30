import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { CopyJoinCode } from './copy-join-code'
import {
  Users,
  FlaskConical,
  BookOpen,
  BarChart3,
  Settings,
  CheckCircle,
} from 'lucide-react'

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    completed: 'bg-blue-100 text-blue-700',
    archived: 'bg-vlab-surface text-vlab-muted',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${styles[status] ?? styles.archived}`}>
      {status}
    </span>
  )
}

export default async function ClassOverviewPage({
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
    .select(`
      id, name, description, status, join_code, join_code_expires_at,
      academic_year, semester, max_students, created_at,
      enrollments(id, status),
      class_labs(id, lab_id, order_index, unlock_at, labs(id, title, slug))
    `)
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) notFound()

  const enrollments = (cls.enrollments as { id: string; status: string }[]) ?? []
  const activeStudents = enrollments.filter((e) => e.status === 'active').length
  const classLabs = (cls.class_labs as {
    id: string
    lab_id: string
    order_index: number
    unlock_at: string | null
    labs: { id: string; title: string; slug: string } | null
  }[]) ?? []

  const droppedStudents = enrollments.length - activeStudents
  const availableLabs = classLabs.filter(
    (l) => !l.unlock_at || new Date(l.unlock_at) <= new Date(),
  ).length

  const tabs = [
    { href: `/educator/classes/${classId}/students`, label: 'Students', icon: Users },
    { href: `/educator/classes/${classId}/labs`, label: 'Labs', icon: FlaskConical },
    { href: `/educator/classes/${classId}/gradebook`, label: 'Gradebook', icon: BarChart3 },
    { href: `/educator/classes/${classId}/settings`, label: 'Settings', icon: Settings },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-vlab-muted mb-6">
        <Link href="/educator" className="hover:text-vlab-ink transition-colors">My Classes</Link>
        <span>/</span>
        <span className="text-vlab-ink">{cls.name}</span>
      </div>

      {/* Class header */}
      <div
        className="bg-white rounded-lg border border-vlab-rule-strong p-6 mb-6"
        style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold text-vlab-ink truncate">{cls.name}</h1>
              <StatusBadge status={cls.status} />
            </div>
            {cls.description && (
              <p className="text-vlab-muted text-sm mb-2">{cls.description}</p>
            )}
            {(cls.academic_year || cls.semester) && (
              <p className="text-xs text-vlab-muted">
                {[cls.academic_year, cls.semester ? `${cls.semester} semester` : ''].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-vlab-muted mb-1">Join Code</p>
            <CopyJoinCode joinCode={cls.join_code} />
            {cls.join_code_expires_at && (
              <p className="text-xs text-vlab-muted mt-1">
                Expires {new Date(cls.join_code_expires_at).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Users}
          label="Enrolled Students"
          value={activeStudents}
          color="text-blue-600"
          bg="bg-blue-50"
        />
        <StatCard
          icon={FlaskConical}
          label="Labs Assigned"
          value={classLabs.length}
          color="text-purple-600"
          bg="bg-purple-50"
        />
        <StatCard
          icon={CheckCircle}
          label="Open to Students"
          value={availableLabs}
          color="text-green-600"
          bg="bg-green-50"
        />
        <StatCard
          icon={BookOpen}
          label="Dropped"
          value={droppedStudents}
          color="text-orange-600"
          bg="bg-orange-50"
        />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 bg-white rounded-lg border border-vlab-rule-strong p-1" style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px' }}>
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-vlab-muted hover:text-vlab-ink hover:bg-vlab-surface transition-colors"
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Overview content */}
      <div
        className="bg-white rounded-lg border border-vlab-rule-strong p-6"
        style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
      >
        <h2 className="text-base font-semibold text-vlab-ink mb-4">Class Overview</h2>

        {classLabs.length === 0 ? (
          <div className="text-center py-8">
            <FlaskConical className="w-10 h-10 text-vlab-300 mx-auto mb-3" />
            <p className="text-vlab-muted text-sm mb-3">No labs assigned yet.</p>
            <Link
              href={`/educator/classes/${classId}/labs`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-vlab-600 text-white rounded-lg text-sm font-medium hover:bg-vlab-700 transition-colors"
            >
              Assign Labs
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {classLabs
              .sort((a, b) => a.order_index - b.order_index)
              .map((cl) => (
                <div
                  key={cl.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-vlab-surface"
                >
                  <div className="w-8 h-8 rounded-lg bg-white border border-vlab-rule-strong flex items-center justify-center text-xs font-semibold text-vlab-muted">
                    {cl.order_index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-vlab-ink">
                      {cl.labs?.title ?? 'Untitled Lab'}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ElementType
  label: string
  value: number
  color: string
  bg: string
}) {
  return (
    <div
      className="bg-white rounded-lg border border-vlab-rule-strong p-4"
      style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
    >
      <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center mb-3`}>
        <Icon className={`w-4.5 h-4.5 ${color}`} />
      </div>
      <p className="text-2xl font-bold text-vlab-ink">{value}</p>
      <p className="text-xs text-vlab-muted mt-0.5">{label}</p>
    </div>
  )
}
