'use client'

import { useSession } from '@clerk/nextjs'
import { createClient } from '@supabase/supabase-js'
import { useMemo } from 'react'
import type { Database } from '@/types/database'

/**
 * React hook to create a Supabase client for use in Client Components
 * Uses Clerk's native integration to pass session tokens to Supabase
 *
 * @returns Supabase client configured with Clerk authentication
 *
 * @example
 * ```tsx
 * 'use client'
 *
 * import { useSupabaseClient } from '@/lib/supabase/client'
 * import { useUser } from '@clerk/nextjs'
 * import { useEffect, useState } from 'react'
 *
 * export default function MyComponent() {
 *   const { user } = useUser()
 *   const supabase = useSupabaseClient()
 *   const [experiments, setExperiments] = useState([])
 *
 *   useEffect(() => {
 *     if (!user) return
 *
 *     supabase
 *       .from('experiments')
 *       .select('*')
 *       .then(({ data }) => setExperiments(data || []))
 *   }, [user, supabase])
 *
 *   return <div>{experiments.length} experiments</div>
 * }
 * ```
 */
export function useSupabaseClient() {
  const { session } = useSession()

  return useMemo(
    () =>
      createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          async accessToken() {
            // Get the Clerk session token and pass it to Supabase
            // Returns null if no active session
            return session?.getToken() ?? null
          },
        },
      ),
    [session],
  )
}
