import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type ProcedureStep = {
  title: string
  description: string
  instructions: string[]
}

type ProcedureData = {
  steps?: ProcedureStep[]
  safety_precautions?: string[]
}

export default async function ProcedurePage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params
  const supabase = await createServerSupabaseClient()

  const result = await supabase
    .from('experiments')
    .select('id, title, procedure, categories(slug)')
    .eq('slug', experimentId)
    .eq('published', true)
    .single()

  const experiment = result.data as { id: string; title: string; procedure: any } | null

  if (!experiment || !experiment.procedure) {
    notFound()
  }

  const procedureData = experiment.procedure as ProcedureData
  const steps = procedureData.steps || []
  const safetyPrecautions = procedureData.safety_precautions || []

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Procedure</h1>
        <p className="text-muted-foreground">
          Follow these step-by-step instructions to set up and test your Raspberry Pi
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-6">
        {steps.map((step, index) => (
          <Card key={index}>
            <CardHeader>
              <div className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 ml-12">
                {step.instructions.map((instruction, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="text-muted-foreground">•</span>
                    <span>{instruction}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Safety Notice */}
      {safetyPrecautions.length > 0 && (
        <Card className="mt-6 border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20">
          <CardHeader>
            <CardTitle className="text-base text-orange-900 dark:text-orange-100">
              Safety Precautions
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-orange-800 dark:text-orange-200">
            <ul className="space-y-1">
              {safetyPrecautions.map((precaution, index) => (
                <li key={index}>• {precaution}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <Button variant="outline" asChild>
          <Link href={`/labs/${category}/${experimentId}/pretest`}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous: Pretest
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/labs/${category}/${experimentId}/simulation`}>
            Next: Simulation
            <ChevronRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
