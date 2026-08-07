import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, FlaskConical, Users, ChevronRight, ShieldCheck } from 'lucide-react'
import { InstitutionalFooter } from '@/components/layout/InstitutionalFooter'
import { INSTITUTION } from '@/lib/institution'

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
    <div className="flex min-h-screen bg-white">
      {/* Same chrome as the student and educator shells — one design system
          across the whole platform, which is the opposite of what the reference
          department ended up with across its three lab sub-sites. */}
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-vlab-rule bg-white">
        <div className="vlab-header-rule-thin px-4 py-3">
          <span className="block font-display text-base font-bold leading-tight text-vlab-600">
            {INSTITUTION.platform.toUpperCase()}
          </span>
          <span className="vlab-eyebrow">Administration</span>
        </div>

        <nav className="flex-1 py-4">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="vlab-nav-link">
              <Icon className="h-4 w-4 shrink-0 opacity-70" />
              <span className="flex-1">{label}</span>
              {label === 'Approvals' && pendingCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center border border-vlab-orange bg-vlab-orange-50 px-1 text-xs font-bold tabular-nums text-vlab-orange-ink">
                  {pendingCount}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="border-t border-vlab-rule py-2">
          <Link href="/educator" className="vlab-nav-link">
            <ChevronRight className="h-4 w-4 shrink-0 rotate-180 opacity-70" />
            Educator console
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:vlab-dotted-divide">
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        <InstitutionalFooter />
      </div>
    </div>
  )
}
