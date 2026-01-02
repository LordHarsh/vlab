import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export default async function AimPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params
  const supabase = await createServerSupabaseClient()

  // Fetch experiment with aim data
  const { data: experiment, error } = await supabase
    .from('experiments')
    .select('id, title, aim')
    .eq('slug', experimentId)
    .eq('published', true)
    .single()

  if (error || !experiment || !experiment.aim) {
    notFound()
  }

  const aimData = experiment.aim as {
    objectives?: string[]
    outcomes?: string[]
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Aim</h1>
        <p className="text-muted-foreground">Understand the objective of this experiment</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="prose prose-slate max-w-none">
            {aimData.objectives && aimData.objectives.length > 0 && (
              <>
                <h3 className="text-xl font-semibold mb-4">Learning Objectives</h3>
                <p className="text-base leading-relaxed mb-4">
                  By the end of this experiment, you will be able to:
                </p>
                <ul className="space-y-2 text-base mb-6">
                  {aimData.objectives.map((objective, index) => (
                    <li key={index}>{objective}</li>
                  ))}
                </ul>
              </>
            )}

            {aimData.outcomes && aimData.outcomes.length > 0 && (
              <>
                <h3 className="text-xl font-semibold mb-4">Expected Outcomes</h3>
                <ul className="space-y-2 text-base">
                  {aimData.outcomes.map((outcome, index) => (
                    <li key={index}>{outcome}</li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950/20 dark:border-blue-900">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                <strong>Note:</strong> This experiment provides hands-on learning experience.
                Complete all sections to gain comprehensive understanding of the topic.
              </p>
            </div>
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
