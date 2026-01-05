import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type AimData = {
  objectives?: string[]
  outcomes?: string[]
  note?: string
}

export default async function AimPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params
  const supabase = await createServerSupabaseClient()

  // Fetch experiment to get aim data
  const result = await supabase
    .from('experiments')
    .select('id, title, slug, aim, categories(slug)')
    .eq('slug', experimentId)
    .eq('published', true)
    .single()

  const experiment = result.data as { id: string; title: string; slug: string; aim: any } | null

  if (!experiment || !experiment.aim) {
    notFound()
  }

  const aimData = experiment.aim as AimData
  const objectives = aimData.objectives || []
  const outcomes = aimData.outcomes || []

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Aim</h1>
        <p className="text-muted-foreground">Understand the objective of this experiment</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="prose prose-slate max-w-none">
            {/* Objectives */}
            {objectives.length > 0 && (
              <>
                <h3 className="text-xl font-semibold mb-4">Objectives</h3>
                <p className="text-base leading-relaxed mb-4">
                  By the end of this experiment, you will be able to:
                </p>
                <ul className="space-y-2 text-base mb-6">
                  {objectives.map((objective, idx) => (
                    <li key={idx}>{objective}</li>
                  ))}
                </ul>
              </>
            )}

            {/* Learning Outcomes */}
            {outcomes.length > 0 && (
              <>
                <h3 className="text-xl font-semibold mb-4">Learning Outcomes</h3>
                <ul className="space-y-2 text-base mb-6">
                  {outcomes.map((outcome, idx) => (
                    <li key={idx}>{outcome}</li>
                  ))}
                </ul>
              </>
            )}

            {/* Note */}
            {aimData.note && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-900">
                  <strong>Note:</strong> {aimData.note}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex justify-end">
        <Button asChild>
          <Link href={`/labs/${category}/${experimentId}/theory`}>
            Next: Theory
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
