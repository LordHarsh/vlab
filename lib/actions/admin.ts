'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ─── Helper ──────────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<void> {
  const { userId } = await auth()
  if (!userId) throw new Error('Not authenticated')

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('clerk_user_id', userId)
    .single()

  if (error || !data || !data.is_admin) {
    throw new Error('Not authorized: admin only')
  }
}

// ─── Labs ─────────────────────────────────────────────────────────────────────

export async function createLab(data: {
  slug: string
  title: string
  description?: string
  difficulty?: string
  tags?: string[]
}): Promise<{ success: boolean; labId?: string; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { data: lab, error } = await supabase
      .from('labs')
      .insert({
        slug: data.slug,
        title: data.title,
        description: data.description ?? null,
        difficulty: data.difficulty ?? null,
        tags: data.tags ?? null,
        published: false,
      })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true, labId: lab.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateLab(
  labId: string,
  data: Partial<{
    title: string
    description: string
    difficulty: string
    tags: string[]
    published: boolean
    thumbnail_url: string
  }>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('labs')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', labId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteLab(labId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase.from('labs').delete().eq('id', labId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Experiments ──────────────────────────────────────────────────────────────

export async function createExperiment(
  labId: string,
  data: {
    slug: string
    title: string
    description?: string
    difficulty?: string
    estimated_duration?: number
  },
): Promise<{ success: boolean; experimentId?: string; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    // Calculate next order_index
    const { data: existing } = await supabase
      .from('experiments')
      .select('order_index')
      .eq('lab_id', labId)
      .order('order_index', { ascending: false })
      .limit(1)

    const nextOrder = existing && existing.length > 0 ? existing[0].order_index + 1 : 1

    const { data: experiment, error } = await supabase
      .from('experiments')
      .insert({
        lab_id: labId,
        slug: data.slug,
        title: data.title,
        description: data.description ?? null,
        difficulty: data.difficulty ?? null,
        estimated_duration: data.estimated_duration ?? null,
        order_index: nextOrder,
        published: false,
      })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true, experimentId: experiment.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateExperiment(
  experimentId: string,
  data: Partial<{
    title: string
    description: string
    difficulty: string
    estimated_duration: number
    published: boolean
    order_index: number
  }>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('experiments')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', experimentId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteExperiment(
  experimentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase.from('experiments').delete().eq('id', experimentId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Sections ─────────────────────────────────────────────────────────────────

export async function createSection(
  experimentId: string,
  type: string,
  title: string,
  orderIndex: number,
  content: unknown,
  isRequired = false,
): Promise<{ success: boolean; sectionId?: string; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { data: section, error } = await supabase
      .from('experiment_sections')
      .insert({
        experiment_id: experimentId,
        type,
        title,
        order_index: orderIndex,
        content: content as import('@/types/database').Json,
        is_required: isRequired,
        status: 'active',
      })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true, sectionId: section.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateSection(
  sectionId: string,
  data: {
    title?: string
    content?: unknown
    order_index?: number
    is_required?: boolean
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (data.title !== undefined) updateData.title = data.title
    if (data.content !== undefined) updateData.content = data.content
    if (data.order_index !== undefined) updateData.order_index = data.order_index
    if (data.is_required !== undefined) updateData.is_required = data.is_required

    const { error } = await supabase
      .from('experiment_sections')
      .update(updateData)
      .eq('id', sectionId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function archiveSection(
  sectionId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('experiment_sections')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', sectionId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Quiz Questions ────────────────────────────────────────────────────────────

export async function addQuizQuestion(
  quizId: string,
  data: {
    question_text: string
    options: { id: string; text: string }[]
    correct_answer: string
    explanation?: string
    points?: number
  },
): Promise<{ success: boolean; questionId?: string; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    // Calculate next order_number
    const { data: existing } = await supabase
      .from('quiz_questions')
      .select('order_number')
      .eq('quiz_id', quizId)
      .eq('status', 'active')
      .order('order_number', { ascending: false })
      .limit(1)

    const nextOrder = existing && existing.length > 0 ? existing[0].order_number + 1 : 1

    const { data: question, error } = await supabase
      .from('quiz_questions')
      .insert({
        quiz_id: quizId,
        question_text: data.question_text,
        question_type: 'multiple_choice',
        options: data.options as import('@/types/database').Json,
        correct_answer: data.correct_answer,
        explanation: data.explanation ?? null,
        points: data.points ?? 1,
        order_number: nextOrder,
        status: 'active',
      })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true, questionId: question.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function editQuizQuestion(
  questionId: string,
  data: {
    question_text?: string
    options?: { id: string; text: string }[]
    correct_answer?: string
    explanation?: string
    points?: number
  },
): Promise<{ success: boolean; newQuestionId?: string; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    // Get old question
    const { data: old, error: fetchError } = await supabase
      .from('quiz_questions')
      .select('*')
      .eq('id', questionId)
      .single()

    if (fetchError || !old) return { success: false, error: fetchError?.message ?? 'Question not found' }

    // Create new question with merged data
    const { data: newQ, error: insertError } = await supabase
      .from('quiz_questions')
      .insert({
        quiz_id: old.quiz_id,
        question_text: data.question_text ?? old.question_text,
        question_type: old.question_type,
        options: (data.options ?? old.options) as import('@/types/database').Json,
        correct_answer: data.correct_answer ?? old.correct_answer,
        explanation: data.explanation ?? old.explanation,
        points: data.points ?? old.points,
        order_number: old.order_number,
        status: 'active',
      })
      .select('id')
      .single()

    if (insertError) return { success: false, error: insertError.message }

    // Archive old question and set superseded_by
    const { error: archiveError } = await supabase
      .from('quiz_questions')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        superseded_by: newQ.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', questionId)

    if (archiveError) return { success: false, error: archiveError.message }
    revalidatePath('/admin/labs')
    return { success: true, newQuestionId: newQ.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function archiveQuizQuestion(
  questionId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('quiz_questions')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', questionId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function approveEducator(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase
      .from('profiles')
      .update({ approval_status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', userId)
      .eq('role', 'educator')
    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/users')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function rejectEducator(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase
      .from('profiles')
      .update({ approval_status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', userId)
      .eq('role', 'educator')
    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/users')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateUserRole(
  userId: string,
  role: 'student' | 'educator',
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/users')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function toggleAdminFlag(
  userId: string,
  isAdmin: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('profiles')
      .update({ is_admin: isAdmin, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/users')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Feedback Form ────────────────────────────────────────────────────────────

export async function updateFeedbackForm(
  formId: string,
  data: { title?: string; description?: string; is_enabled?: boolean },
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('feedback_forms')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', formId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function addFeedbackQuestion(
  formId: string,
  data: {
    question_text: string
    question_type: 'rating' | 'text' | 'scale' | 'multiple_choice'
    options?: unknown
    config?: unknown
    is_required?: boolean
  },
): Promise<{ success: boolean; questionId?: string; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { data: existing } = await supabase
      .from('feedback_questions')
      .select('order_index')
      .eq('form_id', formId)
      .eq('status', 'active')
      .order('order_index', { ascending: false })
      .limit(1)

    const nextOrder = existing && existing.length > 0 ? existing[0].order_index + 1 : 1

    const { data: q, error } = await supabase
      .from('feedback_questions')
      .insert({
        form_id: formId,
        question_text: data.question_text,
        question_type: data.question_type,
        options: (data.options ?? null) as import('@/types/database').Json,
        config: (data.config ?? null) as import('@/types/database').Json,
        is_required: data.is_required ?? false,
        order_index: nextOrder,
        status: 'active',
      })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true, questionId: q.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function archiveFeedbackQuestion(
  questionId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('feedback_questions')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', questionId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Quiz settings ────────────────────────────────────────────────────────────

export async function updateQuiz(
  quizId: string,
  data: Partial<{
    title: string
    description: string
    time_limit_minutes: number
    default_max_attempts: number
    default_passing_percentage: number
    default_show_score: boolean
    default_show_answers: string
    randomize_questions: boolean
  }>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('quizzes')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', quizId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}


// ─── Simulations ──────────────────────────────────────────────────────────────

export async function updateSimulation(
  simulationId: string,
  data: { title?: string; design_id: string; height?: number },
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const supabase = await createServerSupabaseClient()

    const { error } = await supabase
      .from('simulations')
      .update({
        title: data.title ?? null,
        config: {
          design_id: data.design_id,
          height: data.height ?? 500,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', simulationId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/admin/labs')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
