'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { Menu, X } from 'lucide-react'
import { INSTITUTION } from '@/lib/institution'

/**
 * Public header.
 *
 * Same treatment as the signed-in lab header — white, sticky, 8px solid orange
 * rule. The reference department runs three lab sub-sites with three different
 * header designs (an orange border-bottom, a 12px red <hr>, a cursive wordmark);
 * that drift is what its inconsistency looks like from the outside, so VLab uses
 * one header everywhere instead.
 */
export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="vlab-header-rule sticky top-0 z-50 w-full bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-vlab-200 bg-vlab-50">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                d="M2 12h3.5l1.4-4.6 2.2 9.2 2.2-9.2 2.2 9.2 1.4-4.6H22"
                fill="none"
                stroke="var(--vlab-blue-600)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block font-display text-base font-bold leading-tight text-vlab-600 sm:text-lg">
              {INSTITUTION.platform.toUpperCase()}
            </span>
            <span className="hidden truncate font-chrome text-[11px] uppercase tracking-[0.11em] text-vlab-muted sm:block">
              {INSTITUTION.department}
            </span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          <Link
            href="/labs"
            className="px-3 py-2 font-chrome text-sm font-semibold text-vlab-steel transition-colors hover:text-vlab-orange-ink"
          >
            List of Labs
          </Link>

          <SignedOut>
            <Link
              href="/sign-in"
              className="px-3 py-2 font-chrome text-sm font-semibold text-vlab-steel transition-colors hover:text-vlab-orange-ink"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="ml-1 border border-vlab-600 bg-vlab-600 px-4 py-2 font-chrome text-sm font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
            >
              Register
            </Link>
          </SignedOut>

          <SignedIn>
            <Link
              href="/dashboard"
              className="ml-1 border border-vlab-600 bg-vlab-600 px-4 py-2 font-chrome text-sm font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
            >
              Dashboard
            </Link>
            <span className="ml-2 flex items-center">
              <UserButton />
            </span>
          </SignedIn>
        </nav>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          className="-mr-1 ml-auto rounded-sm p-1 text-vlab-steel transition-colors hover:text-vlab-800 md:hidden"
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {menuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="border-t border-vlab-rule bg-white py-2 md:hidden"
        >
          <Link href="/labs" onClick={() => setMenuOpen(false)} className="vlab-nav-link">
            List of Labs
          </Link>

          <SignedOut>
            <Link href="/sign-in" onClick={() => setMenuOpen(false)} className="vlab-nav-link">
              Sign In
            </Link>
            <Link href="/sign-up" onClick={() => setMenuOpen(false)} className="vlab-nav-link">
              Register
            </Link>
          </SignedOut>

          <SignedIn>
            <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="vlab-nav-link">
              Dashboard
            </Link>
            <div className="px-4 py-2">
              <UserButton />
            </div>
          </SignedIn>
        </nav>
      )}
    </header>
  )
}
