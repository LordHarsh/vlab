'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { LayoutDashboard, Menu, X, LogOut, User, FlaskConical } from 'lucide-react'

type Profile = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  avatar_url: string | null
  profile_completed: boolean
  role: string
}

export function StudentShell({
  children,
  profile,
}: {
  children: React.ReactNode
  profile: Profile
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const { signOut } = useClerk()

  const displayName =
    profile.first_name || profile.last_name
      ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
      : profile.email

  const navLinks = [
    {
      href: '/dashboard',
      label: 'My Classes',
      icon: <LayoutDashboard className="w-5 h-5" />,
    },
  ]

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href))

  return (
    <div className="min-h-screen bg-white flex">
      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-white border-r border-[#c1c1c1] z-40 flex flex-col
          transition-transform duration-300
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:z-auto
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-6 py-5 border-b border-[#f2f2f2]">
          <div className="w-8 h-8 rounded-lg bg-[#ff385c] flex items-center justify-center">
            <FlaskConical className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-[#222222] text-lg tracking-tight">VLab</span>
          <button
            className="ml-auto lg:hidden text-[#6a6a6a] hover:text-[#222222]"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setSidebarOpen(false)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-500 transition-colors
                ${
                  isActive(link.href)
                    ? 'bg-[#ff385c]/10 text-[#ff385c] font-600'
                    : 'text-[#222222] hover:bg-[#f2f2f2]'
                }
              `}
            >
              {link.icon}
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Profile + Sign out */}
        <div className="border-t border-[#f2f2f2] px-4 py-4 space-y-1">
          {/* Profile display — not a link, just shows the user */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-[#222222]">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={displayName}
                className="w-7 h-7 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#f2f2f2] flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-[#6a6a6a]" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-medium truncate">{displayName}</p>
              <p className="text-xs text-[#6a6a6a] truncate">{profile.email}</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-[#6a6a6a] hover:bg-[#f2f2f2] hover:text-[#222222] transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 bg-white border-b border-[#f2f2f2] flex items-center gap-3 px-4 py-3 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-[#222222] hover:text-[#ff385c] transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#ff385c] flex items-center justify-center">
              <FlaskConical className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-[#222222]">VLab</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
