import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FlaskConical, Clock } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type Category = Database['public']['Tables']['categories']['Row']
type Experiment = Database['public']['Tables']['experiments']['Row'] & {
  categories: Pick<Category, 'slug'>
}

const difficultyColors = {
  beginner: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
}

export default async function LabsPage() {
  const supabase = await createServerSupabaseClient()

  // Fetch categories with experiment counts
  const categoriesResult = await supabase
    .from('categories')
    .select('*, experiments(count)')
    .order('display_order', { ascending: true })

  const categories = (categoriesResult.data || []) as any[]

  // Fetch all published experiments with their categories
  const experimentsResult = await supabase
    .from('experiments')
    .select('*, categories(slug)')
    .eq('published', true)
    .order('created_at', { ascending: false })

  const experiments = (experimentsResult.data || []) as Experiment[]

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Virtual Labs</h1>
        <p className="text-muted-foreground">
          Explore our collection of interactive experiments across multiple disciplines
        </p>
      </div>

      {/* Categories Overview */}
      {categories.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Categories</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {categories.map((category) => {
              const experimentCount = category.experiments?.[0]?.count || 0
              return (
                <Link key={category.id} href={`/labs/${category.slug}`}>
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                    <CardHeader>
                      <div className="text-4xl mb-2">{getIconForCategory(category.icon)}</div>
                      <CardTitle className="text-lg">{category.name}</CardTitle>
                      <CardDescription>{category.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {experimentCount} {experimentCount === 1 ? 'experiment' : 'experiments'}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* All Experiments */}
      {experiments.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">All Experiments</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {experiments.map((experiment) => (
              <Link
                key={experiment.id}
                href={`/labs/${experiment.categories?.slug}/${experiment.slug}`}
              >
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
                    <CardDescription className="line-clamp-2">
                      {experiment.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {experiments.length === 0 && (
        <Card className="text-center py-12">
          <CardContent>
            <FlaskConical className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No experiments yet</h3>
            <p className="text-muted-foreground mb-4">
              Experiments will appear here once they are published
            </p>
          </CardContent>
        </Card>
      )}

      {/* CTA */}
      {experiments.length > 0 && (
        <div className="mt-12 text-center">
          <Card className="bg-muted/50">
            <CardContent className="pt-6">
              <h3 className="text-lg font-semibold mb-2">Ready to get started?</h3>
              <p className="text-muted-foreground mb-4">
                Choose an experiment above and begin your learning journey
              </p>
              <Button asChild>
                <Link href="#all-experiments">Browse Experiments</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// Helper function to convert icon name to emoji or icon
function getIconForCategory(iconName: string | null): string {
  if (!iconName) return '🔬'
  const iconMap: Record<string, string> = {
    'Cpu': '🌐',
    'Zap': '⚡',
    'Code': '💻',
  }
  return iconMap[iconName] || '🔬'
}
