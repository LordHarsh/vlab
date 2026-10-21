'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { Menu, X, LogOut, User, CircuitBoard, LayoutList } from 'lucide-react'
import { InstitutionalFooter } from './InstitutionalFooter'
import { INSTITUTION } from '@/lib/institution'
import { InstitutionBrand } from './InstitutionBrand'

type Profile = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  avatar_url: string | null
  profile_completed: boolean
  role: string
}

/**
 * The lab-platform shell.
 *
 * Structure is lifted from the reference lab template rather than from a
 * product dashboard:
 *
 *   full-width sticky header  ← institutional mark + lab name, 8px orange rule
 *   ├─ persistent left sidebar (3 flat links, no groups, no icons-as-decoration)
 *   └─ content column, separated by a 2px dotted rule
 *   institutional footer      ← department + programme + CC licence, every page
 *
 * The reference puts the header ABOVE the sidebar and runs its orange rule the
 * full width of the viewport; that single 8px bar is the whole brand, so it is
 * reproduced exactly rather than softened into a shadow.
 */
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
      icon: <LayoutList className="h-4 w-4" />,
    },
    {
      href: '/dashboard/workspace',
      label: 'Workspace',
      icon: <CircuitBoard className="h-4 w-4" />,
    },
  ]

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href))

  return (
    <div className="vlab-shell flex min-h-screen flex-col bg-white">
      {/* ── Institutional header ───────────────────────────────────────────
          White, sticky, 8px solid orange bottom rule — OBSERVED
          `.vlabs-header { border-bottom: 8px solid #ff6600 }`. */}
      <header className="vlab-header-rule sticky top-0 z-40 bg-white">
        {/* Fixed 56px + the 8px rule = a 64px header, so the sidebar's sticky
            offset below can be a plain `top-16` instead of a calc() that has to
            guess at the content height. */}
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            className="-ml-1 rounded-sm p-1 text-vlab-steel transition-colors hover:text-vlab-800 lg:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>

          <Link href="/dashboard" className="min-w-0">
            <InstitutionBrand />
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/profile"
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-vlab-ink transition-colors hover:bg-vlab-surface"
            >
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-vlab-surface">
                  <User className="h-4 w-4 text-vlab-muted" />
                </span>
              )}
              <span className="hidden max-w-[14ch] truncate font-chrome text-[13px] font-semibold sm:block">
                {displayName}
              </span>
            </Link>
            <button
              onClick={() => signOut({ redirectUrl: '/sign-in' })}
              title="Sign out"
              className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-vlab-muted transition-colors hover:bg-vlab-surface hover:text-vlab-orange-ink"
            >
              <LogOut className="h-[18px] w-[18px]" />
              <span className="sr-only">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Mobile scrim */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-vlab-900/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar ──────────────────────────────────────────────────────
            Flat, short, no section groups. OBSERVED: `.sidebar { font-size:
            1.2rem; font-weight: bold }`, links #3e6389.

            Collapsed behind a toggle below lg by a media query, NOT by the
            reference's `navigator.userAgent` device sniff. */}
        <aside
          className={`
            vlab-lab-sidebar fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-vlab-rule bg-white
            transition-transform duration-200
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            lg:sticky lg:top-16 lg:z-auto lg:h-[calc(100vh_-_64px)] lg:w-56 lg:translate-x-0
          `}
        >
          <div className="flex items-center justify-between border-b border-vlab-rule px-4 py-3 lg:hidden">
            <img src={INSTITUTION.logo} alt={INSTITUTION.name} className="h-8 w-auto" />
            <button
              aria-label="Close menu"
              className="rounded-sm p-1 text-vlab-muted hover:text-vlab-ink"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setSidebarOpen(false)}
                aria-current={isActive(link.href) ? 'page' : undefined}
                className="vlab-nav-link"
              >
                <span className="shrink-0 opacity-70">{link.icon}</span>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="border-t border-vlab-rule px-4 py-3">
            <p className="font-chrome text-[11px] leading-snug text-vlab-faint">
              Signed in as
              <br />
              <span className="text-vlab-muted">{profile.email}</span>
            </p>
          </div>
        </aside>

        {/* ── Content column ───────────────────────────────────────────────
            OBSERVED `.vlabs-page-content { border-left: 2px dotted #89a7c4 }`.
            Only from lg up, where the sidebar it separates is actually there. */}
        <div className="vlab-lab-content flex min-w-0 flex-1 flex-col lg:vlab-dotted-divide">
          <main className="flex-1">{children}</main>
          <InstitutionalFooter />
        </div>
      </div>
    </div>
  )
}
