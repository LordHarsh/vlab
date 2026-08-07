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
      {/* `flex flex-col` so a page that wants the leftover height can claim it
          with `flex-1`/`h-full`. Without it, `flex-1` here sizes the <main>
          box correctly but its child still resolves `h-full` against an
          auto height and collapses to its own content, leaving a dead white
          strip between a short page and the footer. */}
      <main className="flex flex-1 flex-col">{children}</main>
      {/* The reference dashboard is the one page on the whole site with no
          footer — the licence block lives only inside the labs. We put it here
          too: attribution belongs on the front door as much as anywhere. */}
      <InstitutionalFooter />
    </div>
  )
}
