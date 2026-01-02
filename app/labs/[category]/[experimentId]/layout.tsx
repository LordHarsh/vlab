import { SiteLayout } from '@/components/layout/site-layout'
import { ExperimentNav } from '@/components/experiment/experiment-nav'

export default async function ExperimentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params

  return (
    <SiteLayout>
      <div className="flex h-full">
        {/* Left Navigation */}
        <aside className="w-64 border-r bg-muted/30 p-4 hidden lg:block">
          <div className="sticky top-4">
            <h2 className="text-lg font-semibold mb-4">Raspberry Pi Introduction</h2>
            <ExperimentNav category={category} experimentId={experimentId} />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </SiteLayout>
  )
}
