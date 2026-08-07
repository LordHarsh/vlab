import { Navbar } from '@/components/layout/navbar'
import { InstitutionalFooter } from '@/components/layout/InstitutionalFooter'

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Navbar />
      <main className="flex-1">{children}</main>
      {/* The reference dashboard is the one page on the whole site with no
          footer — the licence block lives only inside the labs. We put it here
          too: attribution belongs on the front door as much as anywhere. */}
      <InstitutionalFooter />
    </div>
  )
}
