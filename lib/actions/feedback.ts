'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export type FeedbackAnswer = {
  questionId: string
  questionTextSnapshot: string
  answer: string | number
}

export async function submitFeedback(
  formId: string,
  experimentId: string,
  classId: string,
  answers: FeedbackAnswer[],
): Promise<{ success: boolean; error?: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Check for existing submission (one per student/experiment/class)
  const { data: existing } = await supabase
    .from('feedback_responses')
    .select('id')
    .eq('form_id', formId)
    .eq('student_id', profile.id)
    .eq('experiment_id', experimentId)
    .eq('class_id', classId)
    .single()

  if (existing) {
    return { success: false, error: 'You have already submitted feedback for this experiment.' }
  }

  const { error: insertError } = await supabase.from('feedback_responses').insert({
    form_id: formId,
    student_id: profile.id,
    experiment_id: experimentId,
    class_id: classId,
    answers: answers,
  })

  if (insertError) {
    return { success: false, error: 'Failed to submit feedback. Please try again.' }
  }

  return { success: true }
}
