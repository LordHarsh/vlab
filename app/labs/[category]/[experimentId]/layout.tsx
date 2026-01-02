import Link from 'next/link'
import { ExperimentNav } from '@/components/experiment/experiment-nav'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default async function ExperimentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <header className="border-b bg-background sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/labs">
                <ArrowLeft className="h-4 w-4 mr-2" />
                All Labs
              </Link>
            </Button>
            <div className="flex-1">
              <h1 className="text-xl font-semibold">Raspberry Pi Introduction</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Left Navigation */}
        <aside className="w-64 border-r bg-muted/30 p-4 hidden lg:block sticky top-[73px] h-[calc(100vh-73px)] overflow-y-auto">
          <ExperimentNav category={category} experimentId={experimentId} />
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
