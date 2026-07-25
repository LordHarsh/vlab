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
  // supabase-js primes a Realtime auth token the moment the client is
  // constructed: its constructor synchronously calls `accessToken()` once and
  // pushes the result into `realtime.setAuth()`. We never use Realtime on the
  // server, and that single priming call runs during static generation, where
  // Clerk's `auth()` reads `headers` and throws DYNAMIC_SERVER_USAGE — which
  // supabase-js swallows and logs as "Failed to set initial Realtime auth
  // token" (six-ish times across the prerendered routes during `next build`).
  //
  // The priming call is the ONLY `accessToken()` invocation that happens while
  // the constructor is still running; every real PostgREST request calls it
  // afterwards. So we skip just that construction-time call and return the live
  // Clerk token for everything after, leaving the authenticated data path
  // untouched (its `auth()` still throws when appropriate, keeping routes
  // dynamic exactly as before).
  let constructed = false
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      async accessToken() {
        // Construction-time priming call for the unused server-side Realtime
        // socket — hand back nothing so no Clerk token is fetched here.
        if (!constructed) return null
        // Get the Clerk session token and pass it to Supabase.
        // This enables Row Level Security policies to work with Clerk user IDs.
        return (await auth()).getToken()
      },
    },
  )
  constructed = true
  return client
}
