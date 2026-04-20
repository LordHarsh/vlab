import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { LabsClient } from './labs-client'

export default async function LabsPage({
  params,
}: {
  params: Promise<{ classId: string }>
}) {
  const { classId } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')

  const { data: cls } = await supabase
    .from('classes')
    .select('id, name')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) notFound()

  const { data: assignedLabs } = await supabase
    .from('class_labs')
    .select(`
      id, lab_id, order_index, unlock_at,
      labs(id, title, slug, description, difficulty,
        experiments(id)
      )
    `)
    .eq('class_id', classId)
    .order('order_index', { ascending: true })

  const assignedLabIds = (assignedLabs ?? []).map((al) => al.lab_id)

  const { data: allLabs } = await supabase
    .from('labs')
    .select('id, title, slug, description, difficulty, experiments(id)')
    .eq('published', true)
    .order('title', { ascending: true })

  const availableLabs = (allLabs ?? []).filter(
    (l) => !assignedLabIds.includes(l.id),
  )

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6a6a6a] mb-6">
        <Link href="/educator" className="hover:text-[#222222] transition-colors">My Classes</Link>
        <span>/</span>
        <Link href={`/educator/classes/${classId}`} className="hover:text-[#222222] transition-colors">{cls.name}</Link>
        <span>/</span>
        <span className="text-[#222222]">Labs</span>
      </div>

      <LabsClient
        classId={classId}
        className={cls.name}
        assignedLabs={(assignedLabs ?? []).map((al) => {
          const lab = al.labs as {
            id: string
            title: string
            slug: string
            description: string | null
            difficulty: string | null
            experiments: { id: string }[]
          } | null
          return {
            id: al.id,
            lab_id: al.lab_id,
            order_index: al.order_index,
            unlock_at: al.unlock_at,
            lab: lab,
          }
        })}
        availableLabs={availableLabs.map((l) => ({
          id: l.id,
          title: l.title,
          slug: l.slug,
          description: l.description,
          difficulty: l.difficulty,
          experiment_count: (l.experiments as { id: string }[])?.length ?? 0,
        }))}
      />
    </div>
  )
}
