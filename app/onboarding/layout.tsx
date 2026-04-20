import Link from 'next/link'

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#f7f7f7] flex flex-col">
      {/* Minimal header — just the logo */}
      <header className="w-full bg-white border-b border-[#ebebeb]">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center">
          <Link
            href="/"
            className="text-xl font-bold text-[#ff385c] tracking-tight hover:opacity-90 transition-opacity"
          >
            VLab
          </Link>
        </div>
      </header>

      {/* Centered content */}
      <div className="flex-1 flex items-center justify-center py-12 px-4">
        {children}
      </div>
    </div>
  )
}
