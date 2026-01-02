import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, FlaskConical, Clock } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const difficultyColors = {
  beginner: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category: categorySlug } = await params
  const supabase = await createServerSupabaseClient()

  // Fetch category by slug
  const { data: category, error: categoryError } = await supabase
    .from('categories')
    .select('*')
    .eq('slug', categorySlug)
    .single()

  // If category not found, show 404
  if (categoryError || !category) {
    notFound()
  }

  // Fetch experiments for this category
  const { data: experiments, error: experimentsError } = await supabase
    .from('experiments')
    .select('*')
    .eq('category_id', category.id)
    .eq('published', true)
    .order('created_at', { ascending: false })

  if (experimentsError) {
    console.error('Error fetching experiments:', experimentsError)
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Back Button */}
      <Button variant="ghost" asChild className="mb-6">
        <Link href="/labs">
          <ArrowLeft className="mr-2 h-4 w-4" />
          All Labs
        </Link>
      </Button>

      {/* Category Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-4xl">{category.icon || '📚'}</span>
          <h1 className="text-3xl font-bold">{category.name}</h1>
        </div>
        <p className="text-muted-foreground">{category.description}</p>
        <p className="text-sm text-muted-foreground mt-2">
          {experiments?.length || 0}{' '}
          {experiments?.length === 1 ? 'experiment' : 'experiments'} available
        </p>
      </div>

      {/* Experiments Grid */}
      {experiments && experiments.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {experiments.map((experiment) => (
            <Link key={experiment.id} href={`/labs/${categorySlug}/${experiment.slug}`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <CardTitle className="text-base leading-tight">
                      {experiment.title}
                    </CardTitle>
                    <FlaskConical className="h-5 w-5 text-muted-foreground shrink-0" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={difficultyColors[experiment.difficulty as keyof typeof difficultyColors]}
                    >
                      {experiment.difficulty}
                    </Badge>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{experiment.estimated_duration} min</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="line-clamp-3">
                    {experiment.description}
                  </CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="text-center py-12">
          <CardContent>
            <FlaskConical className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No experiments yet</h3>
            <p className="text-muted-foreground mb-4">
              Experiments for this category are coming soon
            </p>
            <Button asChild>
              <Link href="/labs">Browse Other Categories</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
