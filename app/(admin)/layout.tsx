import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, FlaskConical, Users, ChevronRight, ShieldCheck } from 'lucide-react'

async function checkAdmin(): Promise<{ isAdmin: boolean; pendingCount: number }> {
  const { userId } = await auth()
  if (!userId) return { isAdmin: false, pendingCount: 0 }
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('clerk_user_id', userId)
    .single()
  if (!data?.is_admin) return { isAdmin: false, pendingCount: 0 }

  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'educator')
    .eq('approval_status', 'pending')

  return { isAdmin: true, pendingCount: count ?? 0 }
}

const baseNavItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/labs', label: 'Labs', icon: FlaskConical },
  { href: '/admin/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/admin/users', label: 'Users', icon: Users },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, pendingCount } = await checkAdmin()
  if (!isAdmin) redirect('/dashboard')

  const navItems = baseNavItems

  return (
    <div className="flex min-h-screen bg-[#f2f2f2]">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-white border-r border-[#e8e8e8] flex flex-col">
        <div className="px-6 py-5 border-b border-[#e8e8e8]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#ff385c] flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-[#222222] text-sm tracking-tight">Admin Panel</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#6a6a6a] hover:bg-[#f2f2f2] hover:text-[#222222] transition-colors group"
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {label === 'Approvals' && pendingCount > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold">
                  {pendingCount}
                </span>
              )}
              <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
            </Link>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-[#e8e8e8]">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-[#6a6a6a] hover:bg-[#f2f2f2] transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5 rotate-180" />
            Back to Dashboard
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
