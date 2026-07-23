import Link from 'next/link'
import { Navbar } from '@/components/layout/navbar'

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>

      <footer className="border-t border-[#ebebeb] bg-white">
        <div className="container mx-auto px-4 sm:px-6 py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-lg font-bold text-[#ff385c] tracking-tight">VLab</p>
              <p className="mt-1 text-sm text-[#6a6a6a]">
                Virtual laboratory for electronics &amp; IoT.
              </p>
            </div>
            <nav aria-label="Footer" className="flex items-center gap-6">
              <Link
                href="/labs"
                className="text-sm font-medium text-[#222222] hover:text-[#ff385c] transition-colors"
              >
                Labs
              </Link>
              <Link
                href="/sign-in"
                className="text-sm font-medium text-[#222222] hover:text-[#ff385c] transition-colors"
              >
                Sign In
              </Link>
            </nav>
          </div>
          <div className="mt-8 border-t border-[#ebebeb] pt-6">
            <p className="text-xs text-[#6a6a6a]">
              © {new Date().getFullYear()} VLab. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
