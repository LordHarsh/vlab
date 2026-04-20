import Link from 'next/link'
import { SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'

export function Navbar() {
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

          {/* Center nav links */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/labs"
              className="text-sm font-medium text-[#222222] hover:text-[#ff385c] transition-colors"
            >
              Labs
            </Link>
          </nav>

          {/* Auth buttons */}
          <div className="flex items-center gap-3">
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
        </div>
      </div>
    </header>
  )
}
