import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { CheckCircle, XCircle, Clock, BookOpen, MessageSquare } from 'lucide-react'

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ classId: string; studentId: string }>
}) {
  const { classId, studentId } = await params
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

  // Get student profile
  const { data: student } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, registration_no, class_section, year, department')
    .eq('id', studentId)
    .single()

  if (!student) notFound()

  // Verify enrollment
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, status, enrolled_at')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .single()

  if (!enrollment) notFound()

  // Get experiments for this class
  const { data: classLabs } = await supabase
    .from('class_labs')
    .select(`
      order_index,
      labs(id, title,
        experiments(id, title, order_index,
          experiment_sections(id, title, is_required),
          quizzes(id, title, type,
            class_quiz_settings(passing_percentage, max_attempts, is_graded)
          ),
          feedback_forms(id, title)
        )
      )
    `)
    .eq('class_id', classId)
    .order('order_index', { ascending: true })

  // Get student progress
  const { data: progressData } = await supabase
    .from('student_progress')
    .select('experiment_id, completed_section_ids, completed_at, total_time_seconds')
    .eq('class_id', classId)
    .eq('student_id', studentId)

  const progressMap = new Map(
    (progressData ?? []).map((p) => [p.experiment_id, p]),
  )

  // Get quiz submissions
  const { data: quizSubmissions } = await supabase
    .from('quiz_submissions')
    .select('quiz_id, attempt_number, score, max_score, percentage, passed, submitted_at')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: true })

  type QuizSub = {
    quiz_id: string
    attempt_number: number
    score: number
    max_score: number
    percentage: number
    passed: boolean
    submitted_at: string | null
  }

  const submissionsMap = new Map<string, QuizSub[]>()
  for (const sub of quizSubmissions ?? []) {
    if (!submissionsMap.has(sub.quiz_id)) submissionsMap.set(sub.quiz_id, [])
    submissionsMap.get(sub.quiz_id)!.push(sub)
  }

  // Get feedback submissions
  const { data: feedbackData } = await supabase
    .from('feedback_responses')
    .select('experiment_id, form_id, submitted_at')
    .eq('class_id', classId)
    .eq('student_id', studentId)

  const feedbackSet = new Set(
    (feedbackData ?? []).map((f) => `${f.experiment_id}:${f.form_id}`),
  )

  const studentName =
    student.first_name || student.last_name
      ? `${student.first_name ?? ''} ${student.last_name ?? ''}`.trim()
      : student.email

  // Flatten experiments
  type ExpData = {
    labTitle: string
    experimentId: string
    experimentTitle: string
    sections: { id: string; title: string | null; is_required: boolean }[]
    quizzes: {
      id: string
      title: string
      type: string
      class_quiz_settings: { passing_percentage: number | null; max_attempts: number | null; is_graded: boolean }[]
    }[]
    feedbackForms: { id: string; title: string }[]
  }

  const experiments: ExpData[] = []
  for (const cl of (classLabs ?? []).sort((a, b) => a.order_index - b.order_index)) {
    const lab = cl.labs as {
      id: string
      title: string
      experiments: {
        id: string
        title: string
        order_index: number
        experiment_sections: { id: string; title: string | null; is_required: boolean }[]
        quizzes: {
          id: string
          title: string
          type: string
          class_quiz_settings: { passing_percentage: number | null; max_attempts: number | null; is_graded: boolean }[]
        }[]
        feedback_forms: { id: string; title: string } | null
      }[]
    } | null
    if (!lab) continue
    for (const exp of (lab.experiments ?? []).sort((a, b) => a.order_index - b.order_index)) {
      experiments.push({
        labTitle: lab.title,
        experimentId: exp.id,
        experimentTitle: exp.title,
        sections: exp.experiment_sections ?? [],
        quizzes: exp.quizzes ?? [],
        feedbackForms: exp.feedback_forms ? [exp.feedback_forms] : [],
      })
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6a6a6a] mb-6 flex-wrap">
        <Link href="/educator" className="hover:text-[#222222] transition-colors">My Classes</Link>
        <span>/</span>
        <Link href={`/educator/classes/${classId}`} className="hover:text-[#222222] transition-colors">{cls.name}</Link>
        <span>/</span>
        <Link href={`/educator/classes/${classId}/gradebook`} className="hover:text-[#222222] transition-colors">Gradebook</Link>
        <span>/</span>
        <span className="text-[#222222]">{studentName}</span>
      </div>

      {/* Student info card */}
      <div
        className="bg-white rounded-2xl border border-[#c1c1c1] p-6 mb-6"
        style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-[#ff385c]/10 flex items-center justify-center text-[#ff385c] font-bold text-lg shrink-0">
            {(student.first_name?.[0] ?? student.email[0]).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-[#222222]">{studentName}</h1>
            <p className="text-[#6a6a6a] text-sm">{student.email}</p>
            <div className="flex flex-wrap gap-3 mt-2">
              {student.registration_no && (
                <InfoChip label="Reg. No" value={student.registration_no} />
              )}
              {student.class_section && (
                <InfoChip label="Section" value={student.class_section} />
              )}
              {student.year && (
                <InfoChip label="Year" value={String(student.year)} />
              )}
              {student.department && (
                <InfoChip label="Dept" value={student.department} />
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-[#6a6a6a]">Enrolled</p>
            <p className="text-sm font-medium text-[#222222]">
              {enrollment.enrolled_at ? new Date(enrollment.enrolled_at).toLocaleDateString() : '—'}
            </p>
            <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
              enrollment.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-[#f2f2f2] text-[#6a6a6a]'
            }`}>
              {enrollment.status}
            </span>
          </div>
        </div>
      </div>

      {/* Experiments */}
      <div className="space-y-4">
        {experiments.length === 0 ? (
          <div
            className="bg-white rounded-2xl border border-[#c1c1c1] p-10 text-center"
            style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px' }}
          >
            <p className="text-[#6a6a6a]">No experiments found in assigned labs.</p>
          </div>
        ) : (
          experiments.map((exp) => {
            const progress = progressMap.get(exp.experimentId)
            const completedIds = new Set(progress?.completed_section_ids ?? [])
            const requiredSections = exp.sections.filter((s) => s.is_required)
            const completedRequired = requiredSections.filter((s) => completedIds.has(s.id)).length
            const isExpCompleted = !!progress?.completed_at

            return (
              <div
                key={exp.experimentId}
                className="bg-white rounded-2xl border border-[#c1c1c1] overflow-hidden"
                style={{ boxShadow: 'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px' }}
              >
                {/* Experiment header */}
                <div className="px-6 py-4 border-b border-[#f2f2f2] flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[#6a6a6a] mb-0.5">{exp.labTitle}</p>
                    <h3 className="text-base font-semibold text-[#222222]">{exp.experimentTitle}</h3>
                  </div>
                  {isExpCompleted && (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Completed
                    </span>
                  )}
                </div>

                <div className="px-6 py-4 space-y-5">
                  {/* Sections */}
                  <div>
                    <h4 className="text-xs font-semibold text-[#6a6a6a] uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" />
                      Sections ({completedIds.size}/{exp.sections.length})
                    </h4>
                    {exp.sections.length === 0 ? (
                      <p className="text-xs text-[#c1c1c1]">No sections</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {exp.sections.map((sec) => {
                          const done = completedIds.has(sec.id)
                          return (
                            <div
                              key={sec.id}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
                                done
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-[#f2f2f2] text-[#6a6a6a]'
                              }`}
                            >
                              {done ? (
                                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <div className="w-3.5 h-3.5 rounded-full border border-[#c1c1c1] shrink-0" />
                              )}
                              <span className="truncate">{sec.title ?? 'Untitled'}</span>
                              {sec.is_required && (
                                <span className="text-[10px] text-[#ff385c] ml-auto shrink-0">*</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {progress?.total_time_seconds != null && progress.total_time_seconds > 0 && (
                      <p className="text-xs text-[#6a6a6a] mt-2 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.round(progress.total_time_seconds / 60)} min spent
                      </p>
                    )}
                  </div>

                  {/* Quizzes */}
                  {exp.quizzes.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-[#6a6a6a] uppercase tracking-wide mb-2">
                        Quizzes
                      </h4>
                      <div className="space-y-3">
                        {exp.quizzes.map((quiz) => {
                          const subs = submissionsMap.get(quiz.id) ?? []
                          const settings = quiz.class_quiz_settings?.[0]
                          const passingPct = settings?.passing_percentage ?? 60
                          const isGraded = settings?.is_graded ?? false

                          return (
                            <div key={quiz.id} className="rounded-xl border border-[#f2f2f2] overflow-hidden">
                              <div className="flex items-center justify-between px-4 py-2 bg-[#f9f9f9]">
                                <div>
                                  <span className="text-xs font-semibold text-[#222222]">{quiz.title}</span>
                                  <span className="ml-2 text-xs text-[#6a6a6a]">({quiz.type})</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-[#6a6a6a]">
                                  {isGraded && (
                                    <span className="text-[10px] bg-[#ff385c]/10 text-[#ff385c] px-2 py-0.5 rounded-full font-medium">
                                      Graded
                                    </span>
                                  )}
                                  <span>Pass: {passingPct}%</span>
                                  {settings?.max_attempts && (
                                    <span>Max: {settings.max_attempts} attempts</span>
                                  )}
                                </div>
                              </div>
                              {subs.length === 0 ? (
                                <div className="px-4 py-2 text-xs text-[#c1c1c1]">Not attempted</div>
                              ) : (
                                <div className="divide-y divide-[#f2f2f2]">
                                  {subs.map((sub) => (
                                    <div
                                      key={sub.attempt_number}
                                      className="flex items-center gap-3 px-4 py-2"
                                    >
                                      <span className="text-xs text-[#6a6a6a] w-16 shrink-0">
                                        Attempt {sub.attempt_number}
                                      </span>
                                      <span
                                        className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                                          sub.percentage >= passingPct
                                            ? 'bg-green-100 text-green-700'
                                            : 'bg-red-100 text-red-700'
                                        }`}
                                      >
                                        {sub.percentage.toFixed(0)}%
                                      </span>
                                      <span className="text-xs text-[#6a6a6a]">
                                        {sub.score}/{sub.max_score} pts
                                      </span>
                                      {sub.passed ? (
                                        <CheckCircle className="w-3.5 h-3.5 text-green-600 ml-auto" />
                                      ) : (
                                        <XCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />
                                      )}
                                      {sub.submitted_at && (
                                        <span className="text-[10px] text-[#c1c1c1] shrink-0">
                                          {new Date(sub.submitted_at).toLocaleDateString()}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Feedback */}
                  {exp.feedbackForms.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-[#6a6a6a] uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5" />
                        Feedback
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {exp.feedbackForms.map((form) => {
                          const submitted = feedbackSet.has(`${exp.experimentId}:${form.id}`)
                          return (
                            <div
                              key={form.id}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${
                                submitted
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-[#f2f2f2] text-[#6a6a6a]'
                              }`}
                            >
                              {submitted ? (
                                <CheckCircle className="w-3.5 h-3.5" />
                              ) : (
                                <div className="w-3.5 h-3.5 rounded-full border border-[#c1c1c1]" />
                              )}
                              {form.title}: {submitted ? 'Submitted' : 'Not submitted'}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-[#f2f2f2] px-2.5 py-1 rounded-lg text-[#222222]">
      <span className="text-[#6a6a6a]">{label}:</span>
      {value}
    </span>
  )
}
