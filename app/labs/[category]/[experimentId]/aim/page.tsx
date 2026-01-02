import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export default async function AimPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Aim</h1>
        <p className="text-muted-foreground">Understand the objective of this experiment</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="prose prose-slate max-w-none">
            <h3 className="text-xl font-semibold mb-4">Objective</h3>
            <p className="text-base leading-relaxed mb-4">
              The aim of this experiment is to gain an understanding of the <strong>Raspberry Pi</strong>,
              including its features, capabilities, and applications in various real-world scenarios.
            </p>

            <p className="text-base leading-relaxed mb-4">
              By the end of this experiment, you will be able to:
            </p>

            <ul className="space-y-2 text-base">
              <li>Identify the major components and hardware features of the Raspberry Pi</li>
              <li>Understand the different models and their specifications</li>
              <li>Recognize common use cases and applications of Raspberry Pi</li>
              <li>Explain the basic architecture and connectivity options</li>
              <li>Describe how Raspberry Pi fits into IoT and embedded systems</li>
            </ul>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <strong>Note:</strong> This experiment provides a foundation for working with Raspberry Pi.
                Future experiments will build upon this knowledge with hands-on programming and hardware integration.
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
