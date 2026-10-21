'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Show, UserButton } from '@clerk/nextjs'
import { Menu, X } from 'lucide-react'
import { InstitutionBrand } from './InstitutionBrand'

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
        <Link href="/" className="min-w-0">
          <InstitutionBrand />
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          <Link
            href="/labs"
            className="px-3 py-2 font-chrome text-sm font-semibold text-vlab-steel transition-colors hover:text-vlab-orange-ink"
          >
            List of Labs
          </Link>

          <Show when="signed-out">
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
          </Show>

          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="ml-1 border border-vlab-600 bg-vlab-600 px-4 py-2 font-chrome text-sm font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
            >
              Dashboard
            </Link>
            <span className="ml-2 flex items-center">
              <UserButton />
            </span>
          </Show>
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

          <Show when="signed-out">
            <Link href="/sign-in" onClick={() => setMenuOpen(false)} className="vlab-nav-link">
              Sign In
            </Link>
            <Link href="/sign-up" onClick={() => setMenuOpen(false)} className="vlab-nav-link">
              Register
            </Link>
          </Show>

          <Show when="signed-in">
            <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="vlab-nav-link">
              Dashboard
            </Link>
            <div className="px-4 py-2">
              <UserButton />
            </div>
          </Show>
        </nav>
      )}
    </header>
  )
}
