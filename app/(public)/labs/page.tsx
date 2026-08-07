import Link from 'next/link'
import { Lock } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/PageHeader'

/**
 * "List of Laboratories".
 *
 * The reference presents its experiment index as a literal HTML table with two
 * columns — S.No and Experiment — rather than a card grid, and that single
 * choice does more to make the site read as a syllabus than any styling does.
 * A numbered table says "curriculum"; a gallery of thumbnails says "storefront".
 * So this is a table.
 */
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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Virtual Laboratories"
        title="List of Laboratories"
        description="Laboratories published by the department. Each is a set of experiments running the standard eight-step sequence. Sign in with your class code to open one."
      />

      {labList.length === 0 ? (
        <div className="border border-vlab-rule-strong bg-vlab-surface-alt px-6 py-16 text-center">
          <p className="font-chrome text-base font-bold text-vlab-800">
            No laboratories published yet
          </p>
          <p className="mt-1 text-sm text-vlab-muted">
            Experiments are prepared by the department and published here as they are completed.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-vlab-rule-strong">
          <table className="vlab-table">
            <thead>
              <tr>
                <th scope="col">S.No</th>
                <th scope="col">Laboratory</th>
                <th scope="col">Experiments</th>
                <th scope="col">Level</th>
                <th scope="col">Topics</th>
                <th scope="col">
                  <span className="sr-only">Access</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {labList.map((lab, i) => {
                const expCount = countMap[lab.id] ?? 0

                return (
                  <tr key={lab.id}>
                    <th scope="row">{i + 1}</th>
                    <td>
                      <span className="font-chrome font-bold text-vlab-600">{lab.title}</span>
                      {lab.description && (
                        <p className="mt-0.5 max-w-xl text-[13px] leading-relaxed text-vlab-muted">
                          {lab.description}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-vlab-ink">{expCount}</td>
                    <td className="whitespace-nowrap capitalize text-vlab-ink">
                      {lab.difficulty ?? '—'}
                    </td>
                    <td className="text-[13px] text-vlab-muted">
                      {lab.tags && lab.tags.length > 0 ? lab.tags.join(', ') : '—'}
                    </td>
                    <td className="whitespace-nowrap">
                      <Link
                        href="/sign-in"
                        className="inline-flex items-center gap-1.5 border border-vlab-rule-strong px-3 py-1.5 font-chrome text-[13px] font-semibold text-vlab-steel transition-colors hover:border-vlab-600 hover:text-vlab-800"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Sign in
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[13px] leading-relaxed text-vlab-muted">
        Access to a laboratory is granted through class enrolment. Students join with the code
        issued by their instructor; instructors assign laboratories to a class from the educator
        console.
      </p>
    </div>
  )
}
