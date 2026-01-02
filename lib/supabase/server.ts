import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Create a Supabase client for use in Server Components and Server Actions
 * Uses Clerk's native integration to pass session tokens to Supabase
 *
 * @returns Supabase client configured with Clerk authentication
 *
 * @example
 * ```tsx
 * // In a Server Component
 * const supabase = await createServerSupabaseClient()
 * const { data } = await supabase.from('experiments').select('*')
 * ```
 *
 * @example
 * ```tsx
 * // In a Server Action
 * 'use server'
 * async function myAction() {
 *   const supabase = await createServerSupabaseClient()
 *   await supabase.from('tasks').insert({ name: 'New task' })
 * }
 * ```
 */
export async function createServerSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      async accessToken() {
        // Get the Clerk session token and pass it to Supabase
        // This enables Row Level Security policies to work with Clerk user IDs
        return (await auth()).getToken()
      },
    },
  )
}
