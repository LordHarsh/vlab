import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { auth } from '@clerk/nextjs/server'

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { experiment_id, ratings, comments } = body

    // Validate required fields
    if (!experiment_id || !ratings || typeof ratings !== 'object') {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Calculate average rating from all rating questions
    const ratingValues = Object.values(ratings) as string[]
    const numericRatings = ratingValues.map(r => parseInt(r))
    const averageRating = Math.round(
      numericRatings.reduce((sum, r) => sum + r, 0) / numericRatings.length
    )

    // Validate rating range
    if (averageRating < 1 || averageRating > 5) {
      return NextResponse.json(
        { error: 'Invalid rating value' },
        { status: 400 }
      )
    }

    const supabase = await createServerSupabaseClient()

    // Insert feedback
    const { data, error } = await supabase
      .from('feedback')
      .insert({
        user_id: userId,
        experiment_id,
        rating: averageRating,
        comments: comments || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Error inserting feedback:', error)
      return NextResponse.json(
        { error: 'Failed to submit feedback' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: true, data },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error in feedback API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
