import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type TheorySection = {
  title: string
  content: string | string[]
  subsections?: Array<{
    title: string
    description: string
  }>
}

type TheoryData = {
  introduction?: string | string[]
  sections?: TheorySection[]
}

export default async function TheoryPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params
  const supabase = await createServerSupabaseClient()

  const result = await supabase
    .from('experiments')
    .select('id, title, theory, categories(slug)')
    .eq('slug', experimentId)
    .eq('published', true)
    .single()

  const experiment = result.data as { id: string; title: string; theory: any } | null

  if (!experiment || !experiment.theory) {
    notFound()
  }

  const theoryData = experiment.theory as TheoryData

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Theory</h1>
        <p className="text-muted-foreground">Learn the fundamental concepts</p>
      </div>

      <div className="space-y-6">
        {/* Introduction */}
        {theoryData.introduction && (
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-xl font-semibold mb-4">Introduction</h3>
              {Array.isArray(theoryData.introduction) ? (
                theoryData.introduction.map((paragraph, idx) => (
                  <p key={idx} className="text-base leading-relaxed mb-4 last:mb-0">
                    {paragraph}
                  </p>
                ))
              ) : (
                <p className="text-base leading-relaxed">{theoryData.introduction}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Sections */}
        {theoryData.sections?.map((section, idx) => (
          <Card key={idx}>
            <CardContent className="pt-6">
              <h3 className="text-xl font-semibold mb-4">{section.title}</h3>

              {/* Section Content */}
              {Array.isArray(section.content) ? (
                section.content.map((paragraph, pIdx) => (
                  <p key={pIdx} className="text-base leading-relaxed mb-4 last:mb-0">
                    {paragraph}
                  </p>
                ))
              ) : (
                <p className="text-base leading-relaxed mb-4">{section.content}</p>
              )}

              {/* Subsections */}
              {section.subsections && section.subsections.length > 0 && (
                <div className="space-y-4 mt-4">
                  {section.subsections.map((subsection, subIdx) => (
                    <div key={subIdx}>
                      <h4 className="font-semibold mb-2">{subsection.title}</h4>
                      <p className="text-sm text-muted-foreground">
                        {subsection.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex justify-between">
        <Button variant="outline" asChild>
          <Link href={`/labs/${category}/${experimentId}/aim`}>
            Previous: Aim
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/labs/${category}/${experimentId}/pretest`}>
            Next: Pretest
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
