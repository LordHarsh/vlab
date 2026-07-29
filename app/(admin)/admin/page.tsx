import { createServerSupabaseClient } from '@/lib/supabase/server'
import { FlaskConical, Beaker, Users, BookOpen } from 'lucide-react'

async function getStats() {
  const supabase = await createServerSupabaseClient()

  const [labsRes, experimentsRes, usersRes, classesRes, recentUsersRes] = await Promise.all([
    supabase.from('labs').select('id', { count: 'exact', head: true }),
    supabase.from('experiments').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('classes').select('id', { count: 'exact', head: true }),
    supabase
      .from('profiles')
      .select('id, first_name, last_name, email, role, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return {
    totalLabs: labsRes.count ?? 0,
    totalExperiments: experimentsRes.count ?? 0,
    totalUsers: usersRes.count ?? 0,
    totalClasses: classesRes.count ?? 0,
    recentUsers: recentUsersRes.data ?? [],
  }
}

export default async function AdminDashboardPage() {
  const stats = await getStats()

  const statCards = [
    { label: 'Total Labs', value: stats.totalLabs, icon: FlaskConical, color: '#337ab7' },
    { label: 'Total Experiments', value: stats.totalExperiments, icon: Beaker, color: '#00a699' },
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: '#fc642d' },
    { label: 'Total Classes', value: stats.totalClasses, icon: BookOpen, color: '#484848' },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-vlab-ink">Dashboard</h1>
        <p className="text-sm text-vlab-muted mt-1">Overview of your VLab platform</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-white rounded-lg p-6"
            style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-vlab-muted">{label}</span>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${color}18` }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
            </div>
            <div className="text-3xl font-bold text-vlab-ink">{value}</div>
          </div>
        ))}
      </div>

      {/* Recent users */}
      <div
        className="bg-white rounded-lg overflow-hidden"
        style={{ boxShadow: '0 1px 2px rgba(15,48,80,0.05)' }}
      >
        <div className="px-6 py-4 border-b border-vlab-surface">
          <h2 className="text-base font-semibold text-vlab-ink">Recently Joined Users</h2>
        </div>
        {stats.recentUsers.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-vlab-muted">No users yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-vlab-surface">
                <th className="px-6 py-3 text-left font-medium text-vlab-muted">Name</th>
                <th className="px-6 py-3 text-left font-medium text-vlab-muted">Email</th>
                <th className="px-6 py-3 text-left font-medium text-vlab-muted">Role</th>
                <th className="px-6 py-3 text-left font-medium text-vlab-muted">Joined</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentUsers.map((user) => (
                <tr key={user.id} className="border-b border-vlab-surface last:border-0 hover:bg-vlab-surface-alt transition-colors">
                  <td className="px-6 py-3 font-medium text-vlab-ink">
                    {user.first_name || user.last_name
                      ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
                      : '—'}
                  </td>
                  <td className="px-6 py-3 text-vlab-muted">{user.email}</td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-vlab-surface text-vlab-muted capitalize">
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-vlab-muted">
                    {user.created_at
                      ? new Date(user.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
