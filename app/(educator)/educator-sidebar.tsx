'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SignOutButton } from '@clerk/nextjs'
import { GraduationCap, LogOut, User, ShieldCheck } from 'lucide-react'
import { INSTITUTION } from '@/lib/institution'

type Profile = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  role: string
  is_admin: boolean
  profile_completed: boolean
}

/**
 * Educator console navigation.
 *
 * Same chrome as the student side — Raleway, steel-blue links, orange active
 * rule, squared corners. The reference department publishes three sub-sites
 * with three different design systems under one banner; the console and the
 * student lab here deliberately share one.
 */
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
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-vlab-rule bg-white">
      <div className="vlab-header-rule-thin px-4 py-3">
        <Link href="/educator" className="block">
          <span className="block font-display text-base font-bold leading-tight text-vlab-600">
            {INSTITUTION.platform.toUpperCase()}
          </span>
          <span className="vlab-eyebrow">Educator Console</span>
        </Link>
      </div>

      <nav className="flex-1 py-4">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className="vlab-nav-link"
            >
              <item.icon className="h-4 w-4 shrink-0 opacity-70" />
              {item.label}
            </Link>
          )
        })}

        {profile.is_admin && (
          <Link href="/admin" className="vlab-nav-link mt-2">
            <ShieldCheck className="h-4 w-4 shrink-0 opacity-70" />
            Administration
          </Link>
        )}
      </nav>

      <div className="border-t border-vlab-rule p-3">
        <Link
          href="/profile"
          className="flex items-center gap-3 px-1 py-2 transition-colors hover:bg-vlab-surface"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-vlab-surface">
            <User className="h-4 w-4 text-vlab-muted" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-chrome text-sm font-semibold text-vlab-ink">
              {displayName}
            </span>
            <span className="block truncate text-xs text-vlab-muted">{profile.email}</span>
          </span>
        </Link>
        <SignOutButton>
          <button className="vlab-nav-link mt-1 w-full">
            <LogOut className="h-4 w-4 shrink-0 opacity-70" />
            Sign out
          </button>
        </SignOutButton>
      </div>
    </aside>
  )
}
