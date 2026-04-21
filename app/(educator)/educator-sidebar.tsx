'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SignOutButton } from '@clerk/nextjs'
import { BookOpen, GraduationCap, LogOut, User, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

type Profile = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  role: string
  is_admin: boolean
  profile_completed: boolean
}

export function EducatorSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname()

  const navItems = [
    {
      href: '/educator',
      label: 'My Classes',
      icon: GraduationCap,
      exact: true,
    },
  ]

  const displayName =
    profile.first_name || profile.last_name
      ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
      : profile.email

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-[#c1c1c1] flex flex-col sticky top-0 h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-[#c1c1c1]">
        <Link href="/educator" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#ff385c] flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-[#222222] text-lg">VLab</span>
        </Link>
        <p className="text-xs text-[#6a6a6a] mt-1 ml-10">Educator Dashboard</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[#ff385c]/10 text-[#ff385c]'
                  : 'text-[#6a6a6a] hover:bg-[#f2f2f2] hover:text-[#222222]',
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Admin shortcut — only shown to admin users */}
      {profile.is_admin && (
        <div className="px-4 pb-2">
          <Link
            href="/admin"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#6a6a6a] hover:bg-[#fff0f3] hover:text-[#ff385c] transition-colors border border-[#f2f2f2]"
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            Admin Panel
          </Link>
        </div>
      )}

      {/* Profile & Sign out */}
      <div className="p-4 border-t border-[#c1c1c1] space-y-2">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[#f2f2f2] flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-[#6a6a6a]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#222222] truncate">{displayName}</p>
            <p className="text-xs text-[#6a6a6a] truncate">{profile.email}</p>
          </div>
        </div>
        <SignOutButton>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#6a6a6a] hover:bg-[#f2f2f2] hover:text-[#222222] transition-colors">
            <LogOut className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
        </SignOutButton>
      </div>
    </aside>
  )
}
