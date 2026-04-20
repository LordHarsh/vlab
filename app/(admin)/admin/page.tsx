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
    { label: 'Total Labs', value: stats.totalLabs, icon: FlaskConical, color: '#ff385c' },
    { label: 'Total Experiments', value: stats.totalExperiments, icon: Beaker, color: '#00a699' },
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: '#fc642d' },
    { label: 'Total Classes', value: stats.totalClasses, icon: BookOpen, color: '#484848' },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#222222]">Dashboard</h1>
        <p className="text-sm text-[#6a6a6a] mt-1">Overview of your VLab platform</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-white rounded-2xl p-6"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-[#6a6a6a]">{label}</span>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${color}18` }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
            </div>
            <div className="text-3xl font-bold text-[#222222]">{value}</div>
          </div>
        ))}
      </div>

      {/* Recent users */}
      <div
        className="bg-white rounded-2xl overflow-hidden"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <div className="px-6 py-4 border-b border-[#f2f2f2]">
          <h2 className="text-base font-semibold text-[#222222]">Recently Joined Users</h2>
        </div>
        {stats.recentUsers.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[#6a6a6a]">No users yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f2f2f2]">
                <th className="px-6 py-3 text-left font-medium text-[#6a6a6a]">Name</th>
                <th className="px-6 py-3 text-left font-medium text-[#6a6a6a]">Email</th>
                <th className="px-6 py-3 text-left font-medium text-[#6a6a6a]">Role</th>
                <th className="px-6 py-3 text-left font-medium text-[#6a6a6a]">Joined</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentUsers.map((user) => (
                <tr key={user.id} className="border-b border-[#f2f2f2] last:border-0 hover:bg-[#fafafa] transition-colors">
                  <td className="px-6 py-3 font-medium text-[#222222]">
                    {user.first_name || user.last_name
                      ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
                      : '—'}
                  </td>
                  <td className="px-6 py-3 text-[#6a6a6a]">{user.email}</td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#f2f2f2] text-[#6a6a6a] capitalize">
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[#6a6a6a]">
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
