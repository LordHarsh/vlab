import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SettingsClient } from './settings-client'

export default async function SettingsPage({
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
    .select('id, name, description, status, join_code, join_code_expires_at, max_students, academic_year, semester')
    .eq('id', classId)
    .eq('educator_id', profile.id)
    .single()

  if (!cls) notFound()

  // Get labs with experiments and quizzes for this class
  const { data: classLabs } = await supabase
    .from('class_labs')
    .select(`
      order_index,
      labs(id, title,
        experiments(id, title, order_index,
          quizzes(id, title, type)
        )
      )
    `)
    .eq('class_id', classId)
    .order('order_index', { ascending: true })

  type QuizRow = {
    experimentId: string
    experimentTitle: string
    labTitle: string
    quizId: string
    quizTitle: string
    quizType: string
  }

  const quizRows: QuizRow[] = []
  for (const cl of (classLabs ?? []).sort((a, b) => a.order_index - b.order_index)) {
    const lab = cl.labs as {
      id: string
      title: string
      experiments: {
        id: string
        title: string
        order_index: number
        quizzes: { id: string; title: string; type: string }[]
      }[]
    } | null
    if (!lab) continue
    for (const exp of (lab.experiments ?? []).sort((a, b) => a.order_index - b.order_index)) {
      for (const quiz of exp.quizzes ?? []) {
        quizRows.push({
          experimentId: exp.id,
          experimentTitle: exp.title,
          labTitle: lab.title,
          quizId: quiz.id,
          quizTitle: quiz.title,
          quizType: quiz.type,
        })
      }
    }
  }

  // Get existing quiz settings
  const quizIds = quizRows.map((q) => q.quizId)
  const { data: existingSettings } = quizIds.length
    ? await supabase
        .from('class_quiz_settings')
        .select('quiz_id, passing_percentage, max_attempts, show_score, show_answers, due_date, is_graded')
        .eq('class_id', classId)
        .in('quiz_id', quizIds)
    : { data: [] }

  const settingsMap = new Map(
    (existingSettings ?? []).map((s) => [s.quiz_id, s]),
  )

  return (
    <div className="max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6a6a6a] mb-6">
        <Link href="/educator" className="hover:text-[#222222] transition-colors">My Classes</Link>
        <span>/</span>
        <Link href={`/educator/classes/${classId}`} className="hover:text-[#222222] transition-colors">{cls.name}</Link>
        <span>/</span>
        <span className="text-[#222222]">Settings</span>
      </div>

      <SettingsClient
        classId={classId}
        classData={{
          name: cls.name,
          description: cls.description,
          status: cls.status,
          join_code: cls.join_code,
          join_code_expires_at: cls.join_code_expires_at,
          max_students: cls.max_students,
          academic_year: cls.academic_year,
          semester: cls.semester,
        }}
        quizRows={quizRows.map((q) => {
          const s = settingsMap.get(q.quizId)
          return {
            ...q,
            settings: {
              passing_percentage: s?.passing_percentage ?? null,
              max_attempts: s?.max_attempts ?? null,
              show_score: s?.show_score ?? null,
              show_answers: s?.show_answers ?? null,
              due_date: s?.due_date ?? null,
              is_graded: s?.is_graded ?? false,
            },
          }
        })}
      />
    </div>
  )
}
