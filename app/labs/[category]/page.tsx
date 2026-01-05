import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, FlaskConical, Clock } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type Category = Database['public']['Tables']['categories']['Row']
type Experiment = Database['public']['Tables']['experiments']['Row']

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
  const { category } = await params
  const supabase = await createServerSupabaseClient()

  // Fetch category
  const categoryResult = await supabase
    .from('categories')
    .select('*')
    .eq('slug', category)
    .single()

  const categoryData = categoryResult.data as Category | null

  if (!categoryData) {
    notFound()
  }

  // Fetch experiments for this category
  const experimentsResult = await supabase
    .from('experiments')
    .select('*')
    .eq('category_id', categoryData.id)
    .eq('published', true)
    .order('created_at', { ascending: false })

  const experiments = (experimentsResult.data || []) as Experiment[]

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
          <span className="text-4xl">{getIconForCategory(categoryData.icon)}</span>
          <h1 className="text-3xl font-bold">{categoryData.name}</h1>
        </div>
        <p className="text-muted-foreground">{categoryData.description}</p>
        <p className="text-sm text-muted-foreground mt-2">
          {experiments.length}{' '}
          {experiments.length === 1 ? 'experiment' : 'experiments'} available
        </p>
      </div>

      {/* Experiments Grid */}
      {experiments.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {experiments.map((experiment) => (
            <Link key={experiment.id} href={`/labs/${category}/${experiment.slug}`}>
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
      )}

      {/* Empty State */}
      {experiments.length === 0 && (
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
