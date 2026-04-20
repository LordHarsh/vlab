import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { LabsTable } from './_components/labs-table'

async function getLabs() {
  const supabase = await createServerSupabaseClient()
  const { data: labs } = await supabase
    .from('labs')
    .select('id, slug, title, difficulty, published, created_at')
    .order('created_at', { ascending: false })

  if (!labs) return []

  // Get experiment counts per lab
  const { data: expCounts } = await supabase
    .from('experiments')
    .select('lab_id')

  const countMap: Record<string, number> = {}
  for (const exp of expCounts ?? []) {
    countMap[exp.lab_id] = (countMap[exp.lab_id] ?? 0) + 1
  }

  return labs.map((lab) => ({ ...lab, experimentCount: countMap[lab.id] ?? 0 }))
}

export default async function AdminLabsPage() {
  const labs = await getLabs()

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#222222]">Labs</h1>
          <p className="text-sm text-[#6a6a6a] mt-1">{labs.length} lab{labs.length !== 1 ? 's' : ''} total</p>
        </div>
        <Link
          href="/admin/labs/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#ff385c] text-white text-sm font-medium hover:bg-[#e0314f] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create New Lab
        </Link>
      </div>

      <div
        className="bg-white rounded-2xl overflow-hidden"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        {labs.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[#6a6a6a] text-sm">No labs yet. Create your first lab to get started.</p>
          </div>
        ) : (
          <LabsTable labs={labs} />
        )}
      </div>
    </div>
  )
}
