import { createServerSupabaseClient } from '@/lib/supabase/server'
import { UsersTable } from './_components/users-table'

async function getUsers() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('profiles')
    .select(
      'id, first_name, last_name, email, role, is_admin, profile_completed, approval_status, created_at',
    )
    .order('created_at', { ascending: false })
  return data ?? []
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const allUsers = await getUsers()

  const users = q
    ? allUsers.filter((u) => {
        const search = q.toLowerCase()
        const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.toLowerCase()
        return name.includes(search) || u.email.toLowerCase().includes(search)
      })
    : allUsers

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#222222]">Users</h1>
          <p className="text-sm text-[#6a6a6a] mt-1">{allUsers.length} user{allUsers.length !== 1 ? 's' : ''} total</p>
        </div>
      </div>

      {/* Search */}
      <form method="get" className="mb-4">
        <div className="relative max-w-sm">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] placeholder:text-[#c1c1c1] focus:outline-none focus:border-[#ff385c] focus:ring-1 focus:ring-[#ff385c] transition bg-white"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#c1c1c1]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx={11} cy={11} r={8} />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </div>
      </form>

      <div
        className="bg-white rounded-2xl overflow-hidden"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        {users.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#6a6a6a]">
            {q ? `No users matching "${q}".` : 'No users found.'}
          </div>
        ) : (
          <UsersTable users={users} />
        )}
      </div>
    </div>
  )
}
