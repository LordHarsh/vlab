import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { FlaskConical, BookOpen, Lock } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const difficultyConfig: Record<
  string,
  { label: string; className: string }
> = {
  beginner: {
    label: 'Beginner',
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  intermediate: {
    label: 'Intermediate',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  advanced: {
    label: 'Advanced',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
}

export default async function PublicLabsPage() {
  const supabase = await createServerSupabaseClient()

  // Fetch published labs
  const { data: labs } = await supabase
    .from('labs')
    .select('id, title, description, difficulty, slug, tags')
    .eq('published', true)
    .order('created_at', { ascending: true })

  // Fetch experiment counts per lab
  const { data: experimentCounts } = await supabase
    .from('experiments')
    .select('lab_id')
    .eq('published', true)

  const countMap: Record<string, number> = {}
  for (const row of experimentCounts ?? []) {
    countMap[row.lab_id] = (countMap[row.lab_id] ?? 0) + 1
  }

  const labList = labs ?? []

  return (
    <div className="bg-white min-h-screen">
      {/* Page header */}
      <div className="border-b border-[#ebebeb]">
        <div className="container mx-auto px-4 sm:px-6 py-10">
          <h1 className="text-3xl font-bold text-[#222222] mb-2">
            Virtual Labs
          </h1>
          <p className="text-[#6a6a6a] text-lg">
            Browse our collection of interactive IoT and electronics labs.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-10">
        {labList.length === 0 ? (
          /* Empty state */
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-[#f2f2f2] flex items-center justify-center mx-auto mb-4">
              <FlaskConical className="h-8 w-8 text-[#6a6a6a]" />
            </div>
            <h2 className="text-xl font-semibold text-[#222222] mb-2">
              No labs published yet
            </h2>
            <p className="text-[#6a6a6a]">
              Check back soon — experiments are on their way.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {labList.map((lab) => {
              const expCount = countMap[lab.id] ?? 0
              const diff = lab.difficulty
                ? difficultyConfig[lab.difficulty] ?? {
                    label: lab.difficulty,
                    className: 'bg-gray-50 text-gray-700 border-gray-200',
                  }
                : null

              return (
                <div
                  key={lab.id}
                  className="bg-white rounded-2xl overflow-hidden flex flex-col transition-all hover:-translate-y-0.5"
                  style={{
                    boxShadow:
                      'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
                  }}
                >
                  {/* Thumbnail placeholder */}
                  <div className="h-40 bg-gradient-to-br from-[#fff0f3] to-[#f2f2f2] flex items-center justify-center">
                    <FlaskConical className="h-12 w-12 text-[#ff385c]/40" />
                  </div>

                  <div className="p-6 flex flex-col flex-1">
                    {/* Difficulty + experiment count */}
                    <div className="flex items-center gap-2 mb-3">
                      {diff && (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${diff.className}`}
                        >
                          {diff.label}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-[#6a6a6a]">
                        <BookOpen className="h-3 w-3" />
                        {expCount} {expCount === 1 ? 'experiment' : 'experiments'}
                      </span>
                    </div>

                    <h2 className="text-base font-semibold text-[#222222] mb-2 leading-snug">
                      {lab.title}
                    </h2>

                    {lab.description && (
                      <p className="text-sm text-[#6a6a6a] line-clamp-3 leading-relaxed flex-1">
                        {lab.description}
                      </p>
                    )}

                    {/* Tags */}
                    {lab.tags && lab.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {lab.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full bg-[#f2f2f2] px-2 py-0.5 text-xs text-[#6a6a6a]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* CTA */}
                    <div className="mt-5 pt-4 border-t border-[#ebebeb]">
                      <Link
                        href="/sign-in"
                        className="flex items-center justify-center gap-2 w-full rounded-lg border border-[#ebebeb] px-4 py-2.5 text-sm font-medium text-[#222222] hover:border-[#222222] hover:bg-[#f7f7f7] transition-colors"
                      >
                        <Lock className="h-3.5 w-3.5 text-[#6a6a6a]" />
                        Sign in to access
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
