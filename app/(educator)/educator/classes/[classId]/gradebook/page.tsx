import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function GradebookPage({
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

  // Get enrolled students
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(`
      id, student_id,
      profiles:student_id (id, first_name, last_name, email, registration_no)
    `)
    .eq('class_id', classId)
    .eq('status', 'active')
    .order('enrolled_at', { ascending: true })

  // Get experiments for this class (via class_labs → labs → experiments)
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

  // Collect all graded quizzes with experiment context
  type ExperimentCol = {
    experimentId: string
    experimentTitle: string
    quizId: string
    quizTitle: string
    quizType: string
  }

  const experimentCols: ExperimentCol[] = []
  for (const cl of classLabs ?? []) {
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
        experimentCols.push({
          experimentId: exp.id,
          experimentTitle: exp.title,
          quizId: quiz.id,
          quizTitle: quiz.title,
          quizType: quiz.type,
        })
      }
    }
  }

  // Get class_quiz_settings to know which are graded
  const quizIds = experimentCols.map((c) => c.quizId)
  const { data: quizSettings } = quizIds.length
    ? await supabase
        .from('class_quiz_settings')
        .select('quiz_id, is_graded, passing_percentage')
        .eq('class_id', classId)
        .in('quiz_id', quizIds)
    : { data: [] }

  const quizSettingsMap = new Map(
    (quizSettings ?? []).map((s) => [s.quiz_id, s]),
  )

  // Get all quiz submissions for this class
  const studentIds = (enrollments ?? []).map((e) => e.student_id)
  const { data: submissions } = studentIds.length && quizIds.length
    ? await supabase
        .from('quiz_submissions')
        .select('student_id, quiz_id, percentage, passed, attempt_number, score, max_score')
        .eq('class_id', classId)
        .in('student_id', studentIds)
        .in('quiz_id', quizIds)
    : { data: [] }

  // Build submission lookup: studentId → quizId → best submission
  type SubData = { percentage: number; passed: boolean; attempt_number: number }
  const subMap = new Map<string, Map<string, SubData>>()
  for (const sub of submissions ?? []) {
    if (!subMap.has(sub.student_id)) subMap.set(sub.student_id, new Map())
    const existing = subMap.get(sub.student_id)!.get(sub.quiz_id)
    if (!existing || sub.percentage > existing.percentage) {
      subMap.get(sub.student_id)!.set(sub.quiz_id, {
        percentage: sub.percentage,
        passed: sub.passed,
        attempt_number: sub.attempt_number,
      })
    }
  }

  const studentList = (enrollments ?? []).map((e) => {
    const p = e.profiles as {
      id: string
      first_name: string | null
      last_name: string | null
      email: string
      registration_no: string | null
    } | null
    return {
      enrollmentId: e.id,
      studentId: e.student_id,
      name: p?.first_name || p?.last_name
        ? `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
        : p?.email ?? 'Unknown',
      email: p?.email ?? '',
      registrationNo: p?.registration_no ?? '',
    }
  })

  return (
    <div className="max-w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6a6a6a] mb-6">
        <Link href="/educator" className="hover:text-[#222222] transition-colors">My Classes</Link>
        <span>/</span>
        <Link href={`/educator/classes/${classId}`} className="hover:text-[#222222] transition-colors">{cls.name}</Link>
        <span>/</span>
        <span className="text-[#222222]">Gradebook</span>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#222222]">Gradebook</h1>
        <p className="text-[#6a6a6a] text-sm mt-0.5">
          {studentList.length} students · {experimentCols.length} quiz(zes)
        </p>
      </div>

      {experimentCols.length === 0 ? (
        <div
          className="bg-white rounded-2xl border border-[#c1c1c1] p-12 text-center"
          style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
        >
          <p className="text-[#6a6a6a]">No quizzes found in assigned labs.</p>
          <Link
            href={`/educator/classes/${classId}/labs`}
            className="inline-block mt-3 text-sm text-[#ff385c] hover:underline"
          >
            Assign labs with quizzes
          </Link>
        </div>
      ) : studentList.length === 0 ? (
        <div
          className="bg-white rounded-2xl border border-[#c1c1c1] p-12 text-center"
          style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
        >
          <p className="text-[#6a6a6a]">No active students enrolled.</p>
        </div>
      ) : (
        <div
          className="bg-white rounded-2xl border border-[#c1c1c1] overflow-hidden"
          style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f9f9f9] border-b border-[#f2f2f2]">
                  <th className="text-left text-xs font-medium text-[#6a6a6a] px-4 py-3 sticky left-0 bg-[#f9f9f9] z-10 whitespace-nowrap min-w-[180px]">
                    Student
                  </th>
                  {experimentCols.map((col) => {
                    const settings = quizSettingsMap.get(col.quizId)
                    const isGraded = settings?.is_graded ?? false
                    return (
                      <th
                        key={col.quizId}
                        className="text-center text-xs font-medium text-[#6a6a6a] px-3 py-3 whitespace-nowrap min-w-[100px]"
                      >
                        <div>{col.experimentTitle}</div>
                        <div className="text-[10px] text-[#6a6a6a] font-normal mt-0.5">
                          {col.quizType} {isGraded && '• graded'}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f2f2f2]">
                {studentList.map((student) => (
                  <tr key={student.studentId} className="hover:bg-[#fafafa] transition-colors">
                    <td className="px-4 py-3 sticky left-0 bg-white hover:bg-[#fafafa] z-10">
                      <Link
                        href={`/educator/classes/${classId}/gradebook/${student.studentId}`}
                        className="group"
                      >
                        <p className="text-sm font-medium text-[#222222] group-hover:text-[#ff385c] transition-colors">
                          {student.name}
                        </p>
                        {student.registrationNo && (
                          <p className="text-xs text-[#6a6a6a]">{student.registrationNo}</p>
                        )}
                      </Link>
                    </td>
                    {experimentCols.map((col) => {
                      const settings = quizSettingsMap.get(col.quizId)
                      const isGraded = settings?.is_graded ?? false
                      const passingPct = settings?.passing_percentage ?? 60
                      const sub = subMap.get(student.studentId)?.get(col.quizId)

                      if (!sub) {
                        return (
                          <td key={col.quizId} className="px-3 py-3 text-center">
                            <span className="text-xs text-[#c1c1c1]">—</span>
                          </td>
                        )
                      }

                      if (!isGraded) {
                        return (
                          <td key={col.quizId} className="px-3 py-3 text-center">
                            <span className="inline-flex items-center justify-center w-12 h-7 rounded-lg bg-[#f2f2f2] text-xs font-medium text-[#6a6a6a]">
                              {sub.percentage.toFixed(0)}%
                            </span>
                          </td>
                        )
                      }

                      const passed = sub.percentage >= passingPct
                      return (
                        <td key={col.quizId} className="px-3 py-3 text-center">
                          <span
                            className={`inline-flex items-center justify-center w-12 h-7 rounded-lg text-xs font-bold ${
                              passed
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {sub.percentage.toFixed(0)}%
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-3 border-t border-[#f2f2f2] text-xs text-[#6a6a6a]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-green-100"></span> Passed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-red-100"></span> Failed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-[#f2f2f2]"></span> Ungraded attempt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[#c1c1c1]">—</span> Not attempted
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
