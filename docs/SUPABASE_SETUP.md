# Supabase Setup Guide with Clerk Authentication

This guide walks you through setting up Supabase with Clerk authentication for the Virtual Lab platform.

## Prerequisites

- Clerk account with an application created
- Supabase account
- Node.js and npm/bun installed

---

## Step 1: Create Supabase Project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Click "New Project"
3. Fill in:
   - **Name**: Virtual Lab
   - **Database Password**: (generate a strong password)
   - **Region**: (choose closest to your users)
4. Click "Create new project" and wait for it to finish setting up (~2 minutes)

---

## Step 2: Enable Clerk as Third-Party Auth Provider

### In Clerk Dashboard:

1. Navigate to [Clerk's Supabase Integration](https://dashboard.clerk.com/setup/supabase)
2. Select your Clerk application
3. Click **"Activate Supabase integration"**
4. Copy your **Clerk domain** (e.g., `your-app.clerk.accounts.dev`)

### In Supabase Dashboard:

1. Go to **Authentication > Sign In / Up** in your Supabase project
2. Scroll down to **Third-Party Auth**
3. Click **"Add provider"**
4. Select **"Clerk"** from the list
5. Paste your **Clerk domain**
6. Click **"Save"**

✅ **What this does**: Enables Supabase to accept Clerk-signed session tokens with the `role: authenticated` claim.

---

## Step 3: Get Supabase Credentials

In your Supabase project dashboard:

1. Go to **Project Settings > Data API**
2. Copy the following:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **Project API keys > anon public** key

---

## Step 4: Update Environment Variables

Add these to your `.env.local` file:

```env
# Existing Clerk variables
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Add Supabase variables
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Step 5: Run Database Migrations

### Option A: Using Supabase SQL Editor (Recommended for first-time setup)

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **"New query"**
3. Copy the contents of `supabase/migrations/001_initial_schema.sql`
4. Paste into the editor
5. Click **"Run"**
6. Verify all tables were created in **Database > Tables**

### Option B: Using Supabase CLI (For local development)

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref YOUR_PROJECT_REF

# Run migrations
supabase db push
```

---

## Step 6: Seed Initial Data

1. Go to **SQL Editor** in Supabase Dashboard
2. Create a new query
3. Copy contents of `supabase/seed.sql`
4. **Important**: Replace `'seed_user_id'` with your actual Clerk user ID:
   - Sign in to your app
   - Open browser console
   - Run: `console.log(await window.Clerk.user.id)`
   - Copy the ID and replace all instances of `'seed_user_id'` in the seed file
5. Run the query

---

## Step 7: Verify Setup

### Check Tables Created:

In Supabase Dashboard > Database > Tables, you should see:
- ✅ profiles
- ✅ categories
- ✅ experiments
- ✅ simulations
- ✅ quizzes
- ✅ quiz_questions
- ✅ user_progress
- ✅ quiz_submissions
- ✅ feedback

### Check RLS Policies:

1. Click on any table (e.g., `experiments`)
2. Go to **Policies** tab
3. Verify policies are enabled

### Test Data:

1. Go to **Table Editor**
2. Open `categories` table - should have 3 categories
3. Open `experiments` table - should have 8 experiments

---

## Step 8: Update Supabase Client Code

The Supabase client files have already been created, but verify they match the latest pattern:

### Server-side client (`lib/supabase/server.ts`):

```typescript
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

export async function createServerSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      async accessToken() {
        return (await auth()).getToken()
      },
    },
  )
}
```

### Client-side hook (`lib/supabase/client.ts`):

```typescript
'use client'

import { useSession } from '@clerk/nextjs'
import { createClient } from '@supabase/supabase-js'
import { useMemo } from 'react'
import type { Database } from '@/types/supabase'

export function useSupabaseClient() {
  const { session } = useSession()

  return useMemo(
    () =>
      createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          async accessToken() {
            return session?.getToken() ?? null
          },
        },
      ),
    [session],
  )
}
```

---

## Step 9: Generate TypeScript Types

Generate TypeScript types from your Supabase schema:

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_REF > types/supabase.ts
```

Or manually from the Supabase Dashboard:
1. Go to **Project Settings > API**
2. Scroll to **Schema**
3. Copy the TypeScript types
4. Save to `types/supabase.ts`

---

## Step 10: Create Your First Profile

When a user signs up via Clerk, you need to create their profile in Supabase. This is done via **Clerk Webhooks**.

### Set up Clerk Webhook:

1. In Clerk Dashboard, go to **Webhooks**
2. Click **"Add Endpoint"**
3. Endpoint URL: `https://your-domain.com/api/webhooks/clerk`
4. Subscribe to events:
   - `user.created`
   - `user.updated`
   - `user.deleted`
5. Copy the **Signing Secret**

### Add webhook handler (`app/api/webhooks/clerk/route.ts`):

```typescript
import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { WebhookEvent } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET

  if (!WEBHOOK_SECRET) {
    throw new Error('Missing CLERK_WEBHOOK_SECRET')
  }

  // Get headers
  const headerPayload = await headers()
  const svix_id = headerPayload.get('svix-id')
  const svix_timestamp = headerPayload.get('svix-timestamp')
  const svix_signature = headerPayload.get('svix-signature')

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error: Missing svix headers', { status: 400 })
  }

  // Get body
  const payload = await req.json()
  const body = JSON.stringify(payload)

  // Verify webhook
  const wh = new Webhook(WEBHOOK_SECRET)
  let evt: WebhookEvent

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent
  } catch (err) {
    console.error('Error verifying webhook:', err)
    return new Response('Error: Verification failed', { status: 400 })
  }

  const supabase = await createServerSupabaseClient()

  // Handle events
  if (evt.type === 'user.created' || evt.type === 'user.updated') {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data

    await supabase.from('profiles').upsert({
      clerk_user_id: id,
      email: email_addresses[0]?.email_address || '',
      first_name: first_name || null,
      last_name: last_name || null,
      avatar_url: image_url || null,
    })
  }

  if (evt.type === 'user.deleted') {
    const { id } = evt.data
    await supabase.from('profiles').delete().eq('clerk_user_id', id!)
  }

  return new Response('Success', { status: 200 })
}
```

Add to `.env.local`:
```env
CLERK_WEBHOOK_SECRET=whsec_...
```

---

## Step 11: Test the Integration

### 1. Test Authentication:

```typescript
// In a Server Component
import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function TestPage() {
  const { userId } = await auth()

  if (!userId) {
    return <div>Not signed in</div>
  }

  const supabase = await createServerSupabaseClient()

  // This should work because of RLS policies
  const { data: experiments } = await supabase
    .from('experiments')
    .select('*')
    .eq('published', true)

  return <div>Found {experiments?.length} experiments</div>
}
```

### 2. Test Client-side:

```typescript
'use client'

import { useSupabaseClient } from '@/lib/supabase/client'
import { useUser } from '@clerk/nextjs'
import { useEffect, useState } from 'react'

export default function ClientTest() {
  const { user } = useUser()
  const supabase = useSupabaseClient()
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!user) return

    supabase
      .from('experiments')
      .select('*')
      .then(({ data }) => setData(data))
  }, [user, supabase])

  return <div>{JSON.stringify(data)}</div>
}
```

---

## Troubleshooting

### Error: "JWT expired" or "Invalid JWT"

**Solution**: Make sure:
1. Clerk Supabase integration is activated
2. Clerk domain is correctly set in Supabase
3. You're using the latest `@clerk/nextjs` version

### Error: "Row Level Security policy violation"

**Solution**:
1. Check you're signed in with Clerk
2. Verify RLS policies are created correctly
3. Check that the Clerk user ID matches the policy requirements

### Error: "Failed to fetch"

**Solution**:
1. Verify Supabase URL and anon key are correct
2. Check network tab for CORS errors
3. Ensure Supabase project is not paused

### No data returned:

**Solution**:
1. Check RLS policies allow the operation
2. Verify data exists in the table
3. Make sure user is authenticated

---

## Next Steps

1. ✅ Replace mock data in experiment pages with Supabase queries
2. ✅ Implement quiz submission storage
3. ✅ Add user progress tracking
4. ✅ Create admin panel for managing experiments
5. ✅ Set up realtime subscriptions (optional)

---

## Resources

- [Clerk + Supabase Integration Docs](https://clerk.com/docs/guides/development/integrations/databases/supabase)
- [Supabase Third-Party Auth](https://supabase.com/docs/guides/auth/third-party/clerk)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
