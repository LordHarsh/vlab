'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full bg-white border-b border-[#ebebeb]">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="text-xl font-bold text-[#ff385c] tracking-tight hover:opacity-90 transition-opacity"
          >
            VLab
          </Link>

          {/* Center nav links (desktop) */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/labs"
              className="text-sm font-medium text-[#222222] hover:text-[#ff385c] transition-colors"
            >
              Labs
            </Link>
          </nav>

          {/* Auth buttons (desktop) */}
          <div className="hidden md:flex items-center gap-3">
            <SignedOut>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button
                size="sm"
                className="bg-[#ff385c] hover:bg-[#e0334f] text-white rounded-lg font-semibold"
                asChild
              >
                <Link href="/sign-up">Sign Up</Link>
              </Button>
            </SignedOut>

            <SignedIn>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg font-medium border-[#ebebeb] hover:border-[#222222]"
                asChild
              >
                <Link href="/dashboard">Dashboard</Link>
              </Button>
              <UserButton />
            </SignedIn>
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="md:hidden -mr-1 p-1 text-[#222222] hover:text-[#ff385c] transition-colors"
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      {menuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="md:hidden border-t border-[#ebebeb] bg-white px-4 sm:px-6 py-3"
        >
          <div className="flex flex-col gap-1">
            <Link
              href="/labs"
              onClick={() => setMenuOpen(false)}
              className="px-2 py-2.5 rounded-lg text-sm font-medium text-[#222222] hover:bg-[#f2f2f2] transition-colors"
            >
              Labs
            </Link>

            <SignedOut>
              <Link
                href="/sign-in"
                onClick={() => setMenuOpen(false)}
                className="px-2 py-2.5 rounded-lg text-sm font-medium text-[#222222] hover:bg-[#f2f2f2] transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                onClick={() => setMenuOpen(false)}
                className="px-2 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#ff385c] hover:bg-[#e0334f] transition-colors"
              >
                Sign Up
              </Link>
            </SignedOut>

            <SignedIn>
              <Link
                href="/dashboard"
                onClick={() => setMenuOpen(false)}
                className="px-2 py-2.5 rounded-lg text-sm font-medium text-[#222222] hover:bg-[#f2f2f2] transition-colors"
              >
                Dashboard
              </Link>
              <div className="px-2 py-2">
                <UserButton />
              </div>
            </SignedIn>
          </div>
        </nav>
      )}
    </header>
  )
}
