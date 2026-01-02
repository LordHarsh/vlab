# Virtual Lab - Simplified Modern Tech Stack

## Visual Analysis from Screenshots

### UI Structure Observed
```
┌─────────────────────────────────────────────────────────┐
│  Header: Logo | Breadcrumb | Star Rating | Rate/Report  │
├─────────────────────────────────────────────────────────┤
│  Sidebar (Left)    │    Main Content Area              │
│  ┌──────────────┐  │                                   │
│  │ - Aim        │  │   Theory Content:                 │
│  │ - Theory     │  │   - Rich text with images         │
│  │ - Pretest    │  │   - Labeled diagrams              │
│  │ - Procedure  │  │   - Bullet points                 │
│  │ - Simulation │  │                                   │
│  │ - Posttest   │  │   Pretest:                        │
│  │ - References │  │   - Radio button MCQs             │
│  │ - Contributors│ │                                   │
│  │ - Feedback   │  │   Simulation:                     │
│  └──────────────┘  │   - Instructions panel (left)     │
│                    │   - Interactive canvas (right)    │
│                    │   - Drag/drop components          │
│                    │   - RESET button                  │
│                    │   - Connector info tooltip        │
│                    │                                   │
│                    │   Feedback:                       │
│                    │   - Simple form                   │
│                    │   - "Share Your Experience" btn   │
└─────────────────────────────────────────────────────────┘
│  Footer: Community Links | Contact | Social Media       │
└─────────────────────────────────────────────────────────┘
```

### Key Features Identified
1. **Left sidebar navigation** - Fixed, always visible
2. **Active section highlighting** - Orange/colored text for current section
3. **Star rating system** - User engagement feature
4. **Breadcrumb navigation** - Category > Subcategory > Experiments
5. **Interactive simulation** - Drag-drop with visual feedback
6. **Tooltip system** - "CONNECTOR INFO" on hover
7. **Clean, minimal design** - Focus on content
8. **Responsive layout** - Sidebar + content area

---

## RECOMMENDED SIMPLIFIED TECH STACK

### 🎯 The Modern, Simple Approach

```
Next.js 14 (App Router)
       ↓
TypeScript + TailwindCSS + shadcn/ui
       ↓
Supabase (Database + Auth + Storage + Edge Functions)
       ↓
Clerk (Alternative Auth - More features)
       ↓
Vercel (Hosting + CDN)
```

---

## 1. FRONTEND: Next.js 14 (App Router)

### Why Next.js?
✅ **Server Components** - Faster page loads, better SEO
✅ **API Routes** - Backend in the same codebase
✅ **Server Actions** - No API endpoints needed for mutations
✅ **Built-in optimization** - Image, font, script optimization
✅ **File-based routing** - Easy to organize
✅ **Streaming & Suspense** - Progressive UI loading
✅ **Vercel integration** - One-click deployment

### Project Structure
```
virtual-lab/
├── app/
│   ├── (auth)/                    # Auth routes
│   │   ├── sign-in/
│   │   └── sign-up/
│   ├── (dashboard)/               # Protected routes
│   │   ├── dashboard/
│   │   └── profile/
│   ├── labs/
│   │   └── [category]/
│   │       └── [experimentId]/
│   │           ├── page.tsx       # Main experiment page
│   │           ├── aim/
│   │           ├── theory/
│   │           ├── pretest/
│   │           ├── simulation/
│   │           ├── posttest/
│   │           └── feedback/
│   ├── api/                       # API routes (if needed)
│   │   ├── simulations/
│   │   └── assessments/
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                        # shadcn/ui components
│   ├── experiment/
│   │   ├── ExperimentLayout.tsx
│   │   ├── ExperimentSidebar.tsx
│   │   ├── TheoryContent.tsx
│   │   ├── QuizComponent.tsx
│   │   └── SimulationCanvas.tsx
│   ├── simulations/
│   │   ├── RaspberryPiSim.tsx
│   │   ├── CircuitSim.tsx
│   │   └── BaseSimulation.tsx
│   └── shared/
│       ├── Header.tsx
│       ├── Footer.tsx
│       └── Breadcrumb.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── utils.ts
│   └── hooks/
│       ├── useSimulation.ts
│       └── useProgress.ts
├── public/
│   ├── images/
│   ├── videos/
│   └── simulations/
└── types/
    ├── experiment.ts
    ├── simulation.ts
    └── user.ts
```

---

## 2. STYLING: TailwindCSS + shadcn/ui

### Why This Combo?
✅ **TailwindCSS** - Utility-first, fast development, small bundle
✅ **shadcn/ui** - Beautiful, accessible components (copy-paste, not npm package)
✅ **Radix UI** - Unstyled, accessible primitives (under the hood)
✅ **Customizable** - Full control over styling

### Installation
```bash
# Initialize Next.js with TailwindCSS
npx create-next-app@latest virtual-lab --typescript --tailwind --app

# Add shadcn/ui
npx shadcn-ui@latest init

# Add needed components
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add tabs
npx shadcn-ui@latest add form
npx shadcn-ui@latest add radio-group
npx shadcn-ui@latest add toast
npx shadcn-ui@latest add progress
```

### Key Components Needed
```typescript
// components/experiment/ExperimentLayout.tsx
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function ExperimentLayout({ experiment, children }) {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-background">
        <ExperimentNav sections={experiment.sections} />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  )
}
```

---

## 3. DATABASE & BACKEND: Supabase

### Why Supabase?
✅ **PostgreSQL** - Powerful relational database
✅ **Built-in Auth** - Email, OAuth, magic links
✅ **Row Level Security (RLS)** - Database-level permissions
✅ **Storage** - File uploads for videos, images, PDFs
✅ **Real-time subscriptions** - Live updates
✅ **Edge Functions** - Serverless functions (Deno runtime)
✅ **Auto-generated APIs** - REST & GraphQL
✅ **Free tier** - Generous limits for development

### Database Schema

```sql
-- Users (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  role TEXT CHECK (role IN ('student', 'instructor', 'admin')),
  institution TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categories
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  icon_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Experiments
CREATE TABLE experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  duration_minutes INTEGER,

  -- Content sections (JSONB for flexibility)
  aim JSONB,
  theory JSONB,
  procedure JSONB,
  references JSONB,

  -- Metadata
  prerequisites TEXT[],
  learning_outcomes TEXT[],
  tags TEXT[],

  -- Status
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Simulations (configuration)
CREATE TABLE simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID REFERENCES experiments(id) UNIQUE,
  type TEXT CHECK (type IN ('parametric', 'interactive', 'code', 'visual')),

  -- Simulation configuration (JSONB for flexibility)
  config JSONB NOT NULL,
  -- Example: { components: [...], connections: [...], parameters: {...} }

  instructions TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quizzes (Pretest & Posttest)
CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID REFERENCES experiments(id),
  type TEXT CHECK (type IN ('pretest', 'posttest', 'assignment')),
  title TEXT,

  -- Questions array
  questions JSONB NOT NULL,
  /* Example structure:
  [
    {
      id: "q1",
      question: "What does GPIO stand for?",
      type: "mcq",
      options: ["A", "B", "C", "D"],
      correct_answer: "A",
      explanation: "..."
    }
  ]
  */

  passing_score INTEGER DEFAULT 70,
  time_limit_minutes INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Progress
CREATE TABLE user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  experiment_id UUID REFERENCES experiments(id),

  -- Section completion
  sections_completed JSONB DEFAULT '{}',
  -- { "aim": true, "theory": true, "pretest": false, ... }

  -- Quiz attempts
  pretest_score INTEGER,
  pretest_attempts INTEGER DEFAULT 0,
  posttest_score INTEGER,
  posttest_attempts INTEGER DEFAULT 0,

  -- Simulation data
  simulation_state JSONB,
  simulation_completed BOOLEAN DEFAULT false,

  -- Overall
  completed_at TIMESTAMPTZ,
  time_spent_minutes INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, experiment_id)
);

-- Quiz Submissions
CREATE TABLE quiz_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  quiz_id UUID REFERENCES quizzes(id),

  answers JSONB NOT NULL,
  score INTEGER,
  max_score INTEGER,
  passed BOOLEAN,

  time_taken_seconds INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feedback
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  experiment_id UUID REFERENCES experiments(id),

  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Everyone can read published experiments
CREATE POLICY "Anyone can view published experiments"
  ON experiments FOR SELECT
  USING (is_published = true);

-- Users can view own progress
CREATE POLICY "Users can view own progress"
  ON user_progress FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update own progress
CREATE POLICY "Users can update own progress"
  ON user_progress FOR UPDATE
  USING (auth.uid() = user_id);
```

### Supabase Setup
```typescript
// lib/supabase/client.ts (Client-side)
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/types/supabase'

export const supabase = createClientComponentClient<Database>()

// lib/supabase/server.ts (Server-side)
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'

export const createClient = () => {
  const cookieStore = cookies()
  return createServerComponentClient<Database>({ cookies: () => cookieStore })
}
```

---

## 4. AUTHENTICATION: Clerk vs Supabase Auth

### Option A: Supabase Auth (Simpler, Integrated)

**Pros:**
✅ Already included with Supabase
✅ No extra cost
✅ Works seamlessly with RLS
✅ Email/password, magic links, OAuth
✅ Good for most use cases

**Cons:**
❌ Less feature-rich than Clerk
❌ Basic UI components
❌ Manual organization management

**Code Example:**
```typescript
// app/sign-in/page.tsx
'use client'
import { supabase } from '@/lib/supabase/client'

export default function SignIn() {
  const handleSignIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
  }

  return <SignInForm onSubmit={handleSignIn} />
}
```

### Option B: Clerk (Recommended for Better UX)

**Pros:**
✅ Beautiful pre-built UI components
✅ Organization/team management built-in
✅ User management dashboard
✅ Social logins (Google, GitHub, etc.)
✅ Multi-factor authentication
✅ Session management
✅ Better developer experience

**Cons:**
❌ Additional cost ($25/mo after free tier)
❌ Need to sync with Supabase
❌ Slightly more setup

**Free Tier:**
- Up to 10,000 monthly active users
- Perfect for starting out!

**Setup with Clerk:**
```bash
npm install @clerk/nextjs
```

```typescript
// app/layout.tsx
import { ClerkProvider } from '@clerk/nextjs'

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}

// middleware.ts
import { authMiddleware } from "@clerk/nextjs"

export default authMiddleware({
  publicRoutes: ["/", "/labs/(.*)", "/api/public/(.*)"],
})

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
}

// Sync Clerk user with Supabase
// app/api/webhooks/clerk/route.ts
import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET!

  const headerPayload = headers()
  const svix_id = headerPayload.get("svix-id")
  const svix_timestamp = headerPayload.get("svix-timestamp")
  const svix_signature = headerPayload.get("svix-signature")

  const payload = await req.json()
  const body = JSON.stringify(payload)

  const wh = new Webhook(WEBHOOK_SECRET)
  const evt = wh.verify(body, {
    "svix-id": svix_id,
    "svix-timestamp": svix_timestamp,
    "svix-signature": svix_signature,
  })

  // Sync to Supabase
  const supabase = createClient()

  if (evt.type === 'user.created') {
    await supabase.from('profiles').insert({
      id: evt.data.id,
      email: evt.data.email_addresses[0].email_address,
      full_name: `${evt.data.first_name} ${evt.data.last_name}`,
    })
  }

  return new Response('OK', { status: 200 })
}
```

### 🎯 Recommendation: Use Clerk

**Why Clerk is better for this project:**
1. Better onboarding experience for students
2. Easy Google/social sign-in (students prefer this)
3. Built-in organization management (for schools/institutions)
4. Professional UI out of the box
5. Better security features
6. You can always switch to Supabase Auth later

---

## 5. BACKEND LOGIC: Next.js Server Actions + Supabase Edge Functions

### When to Use What?

**Next.js Server Actions** (Preferred for most operations)
- Form submissions
- Data mutations (create, update, delete)
- Simple data fetching
- Progress tracking
- Quiz submissions

**Supabase Edge Functions** (For complex operations)
- Complex simulations that need server-side computation
- Heavy mathematical calculations
- Image/video processing
- Sending emails
- Scheduled tasks

### Example: Server Actions

```typescript
// app/actions/progress.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { auth } from '@clerk/nextjs'
import { revalidatePath } from 'next/cache'

export async function updateProgress(
  experimentId: string,
  section: string,
  completed: boolean
) {
  const { userId } = auth()
  if (!userId) throw new Error('Unauthorized')

  const supabase = createClient()

  // Get current progress
  const { data: progress } = await supabase
    .from('user_progress')
    .select('sections_completed')
    .eq('user_id', userId)
    .eq('experiment_id', experimentId)
    .single()

  const sectionsCompleted = progress?.sections_completed || {}
  sectionsCompleted[section] = completed

  // Update progress
  await supabase
    .from('user_progress')
    .upsert({
      user_id: userId,
      experiment_id: experimentId,
      sections_completed: sectionsCompleted,
      updated_at: new Date().toISOString(),
    })

  revalidatePath(`/labs/${experimentId}`)

  return { success: true }
}

// app/actions/quiz.ts
'use server'

export async function submitQuiz(
  quizId: string,
  answers: Record<string, string>
) {
  const { userId } = auth()
  if (!userId) throw new Error('Unauthorized')

  const supabase = createClient()

  // Get quiz questions
  const { data: quiz } = await supabase
    .from('quizzes')
    .select('questions')
    .eq('id', quizId)
    .single()

  // Calculate score
  let score = 0
  const maxScore = quiz.questions.length

  quiz.questions.forEach((q: any) => {
    if (answers[q.id] === q.correct_answer) {
      score++
    }
  })

  // Save submission
  await supabase.from('quiz_submissions').insert({
    user_id: userId,
    quiz_id: quizId,
    answers,
    score,
    max_score: maxScore,
    passed: (score / maxScore) >= 0.7,
  })

  return { score, maxScore, passed: (score / maxScore) >= 0.7 }
}
```

### Usage in Components

```typescript
// app/labs/[id]/pretest/page.tsx
'use client'

import { useState } from 'react'
import { submitQuiz } from '@/app/actions/quiz'
import { Button } from '@/components/ui/button'

export default function PretestPage({ params }) {
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)

  const handleSubmit = async () => {
    const result = await submitQuiz(params.quizId, answers)
    setResult(result)
  }

  return (
    <div>
      {/* Quiz questions */}
      <Button onClick={handleSubmit}>Submit Quiz</Button>

      {result && (
        <div>
          Score: {result.score}/{result.maxScore}
          {result.passed ? '✅ Passed' : '❌ Failed'}
        </div>
      )}
    </div>
  )
}
```

---

## 6. SIMULATION ENGINE: React + Canvas/SVG

### Architecture

```typescript
// types/simulation.ts
export interface SimulationComponent {
  id: string
  type: 'raspberry-pi' | 'led' | 'resistor' | 'wire' | 'button'
  position: { x: number; y: number }
  properties: Record<string, any>
  connections: Connection[]
}

export interface Connection {
  fromComponent: string
  fromPin: string
  toComponent: string
  toPin: string
}

export interface SimulationState {
  components: SimulationComponent[]
  connections: Connection[]
  running: boolean
  outputs: Record<string, any>
}

// components/simulations/BaseSimulation.tsx
'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'

interface BaseSimulationProps {
  config: any
  onStateChange?: (state: SimulationState) => void
}

export function BaseSimulation({ config, onStateChange }: BaseSimulationProps) {
  const [state, setState] = useState<SimulationState>({
    components: config.initialComponents || [],
    connections: [],
    running: false,
    outputs: {},
  })

  const addComponent = useCallback((type: string, position: { x: number; y: number }) => {
    const newComponent = {
      id: `${type}-${Date.now()}`,
      type,
      position,
      properties: {},
      connections: [],
    }

    setState(prev => ({
      ...prev,
      components: [...prev.components, newComponent],
    }))
  }, [])

  const reset = useCallback(() => {
    setState({
      components: config.initialComponents || [],
      connections: [],
      running: false,
      outputs: {},
    })
  }, [config])

  return (
    <div className="flex gap-4">
      {/* Left panel - Instructions */}
      <div className="w-64 bg-muted p-4 rounded-lg">
        <h3 className="font-semibold mb-2">Instructions</h3>
        <ul className="text-sm space-y-2">
          {config.instructions?.map((instruction: string, i: number) => (
            <li key={i}>• {instruction}</li>
          ))}
        </ul>
      </div>

      {/* Canvas area */}
      <div className="flex-1 border rounded-lg relative bg-white">
        <SimulationCanvas
          components={state.components}
          connections={state.connections}
          onComponentAdd={addComponent}
        />

        <Button
          onClick={reset}
          className="absolute top-4 right-4"
          variant="outline"
        >
          RESET
        </Button>
      </div>
    </div>
  )
}

// components/simulations/RaspberryPiSim.tsx
'use client'

import { useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Text, Circle } from 'react-konva'
import useImage from 'use-image'

export function RaspberryPiSimulation() {
  const [image] = useImage('/images/raspberry-pi.png')
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)

  const gpioPins = [
    { id: 'GPIO1', x: 50, y: 30, label: 'GPIO 1' },
    { id: 'GPIO2', x: 70, y: 30, label: 'GPIO 2' },
    // ... more pins
  ]

  return (
    <div className="relative">
      <Stage width={800} height={600}>
        <Layer>
          {/* Raspberry Pi image */}
          <KonvaImage
            image={image}
            x={100}
            y={100}
            width={400}
            height={300}
          />

          {/* GPIO pins */}
          {gpioPins.map(pin => (
            <Circle
              key={pin.id}
              x={pin.x}
              y={pin.y}
              radius={5}
              fill={hoveredPin === pin.id ? '#ff6600' : '#4CAF50'}
              onMouseEnter={() => setHoveredPin(pin.id)}
              onMouseLeave={() => setHoveredPin(null)}
            />
          ))}
        </Layer>
      </Stage>

      {/* Connector info tooltip */}
      {hoveredPin && (
        <div className="absolute top-4 right-4 bg-gray-800 text-white p-3 rounded shadow-lg">
          <h4 className="font-semibold">CONNECTOR INFO</h4>
          <p className="text-sm mt-1">
            {gpioPins.find(p => p.id === hoveredPin)?.label}
          </p>
        </div>
      )}
    </div>
  )
}
```

### Simulation Libraries

```bash
# For 2D interactive simulations
npm install react-konva konva use-image

# For physics (if needed)
npm install matter-js @types/matter-js

# For 3D (if needed)
npm install three @react-three/fiber @react-three/drei

# For charts/graphs
npm install recharts
```

---

## 7. FILE STORAGE: Supabase Storage

```typescript
// lib/storage.ts
import { supabase } from '@/lib/supabase/client'

export async function uploadFile(
  bucket: 'videos' | 'images' | 'documents',
  file: File,
  path: string
) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) throw error

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(path)

  return publicUrl
}

// Usage in Server Action
export async function uploadTheoryImage(formData: FormData) {
  'use server'

  const file = formData.get('file') as File
  const experimentId = formData.get('experimentId') as string

  const url = await uploadFile(
    'images',
    file,
    `experiments/${experimentId}/${file.name}`
  )

  return { url }
}
```

---

## 8. DEPLOYMENT: Vercel

### Why Vercel?
✅ **Made for Next.js** - Optimal performance
✅ **Zero config** - Just connect Git repo
✅ **Automatic deployments** - Push to deploy
✅ **Edge network** - Global CDN
✅ **Serverless functions** - Scales automatically
✅ **Preview deployments** - Every PR gets a URL
✅ **Free tier** - Generous for hobby projects

### Deployment Steps

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel

# Or just push to GitHub and connect via Vercel dashboard
```

### Environment Variables
```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
```

---

## 9. COMPLETE TECH STACK SUMMARY

```
┌─────────────────────────────────────────────┐
│           FRONTEND                          │
│  Next.js 14 (App Router) + TypeScript       │
│  TailwindCSS + shadcn/ui                    │
│  React Konva (Simulations)                  │
│  Recharts (Graphs)                          │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│           AUTHENTICATION                     │
│  Clerk (Recommended)                        │
│  or Supabase Auth (Simpler)                 │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│           BACKEND                           │
│  Next.js Server Actions (Primary)           │
│  Supabase Edge Functions (Heavy compute)    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│           DATABASE & STORAGE                │
│  Supabase (PostgreSQL)                      │
│  Supabase Storage (Files)                   │
│  Row Level Security (RLS)                   │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│           DEPLOYMENT                        │
│  Vercel (Frontend + API Routes)             │
│  Supabase (Database + Edge Functions)       │
│  Vercel Analytics (Optional)                │
└─────────────────────────────────────────────┘
```

---

## 10. QUICK START GUIDE

### Step 1: Create Next.js Project
```bash
npx create-next-app@latest virtual-lab \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*"

cd virtual-lab
```

### Step 2: Install Dependencies
```bash
# UI Components
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card tabs form radio-group toast progress

# Supabase
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs

# Clerk (if using)
npm install @clerk/nextjs

# Simulation libraries
npm install react-konva konva use-image recharts

# Utilities
npm install zod react-hook-form @hookform/resolvers
npm install lucide-react # Icons
```

### Step 3: Set Up Supabase
```bash
# 1. Go to https://supabase.com
# 2. Create new project
# 3. Copy credentials to .env.local
# 4. Run the SQL schema from section 3
```

### Step 4: Set Up Clerk (Optional)
```bash
# 1. Go to https://clerk.com
# 2. Create application
# 3. Copy keys to .env.local
# 4. Set up webhook for user sync
```

### Step 5: Create Basic Structure
```bash
# Create folder structure
mkdir -p app/{api,labs,dashboard} \
         components/{ui,experiment,simulations,shared} \
         lib/{supabase,utils,hooks} \
         types \
         public/{images,videos}
```

### Step 6: Run Development Server
```bash
npm run dev
# Open http://localhost:3000
```

---

## 11. ESTIMATED COSTS (Monthly)

### Hobby/Development (< 1,000 users)
- **Next.js/Vercel**: FREE
- **Supabase**: FREE (500MB database, 1GB storage, 2GB bandwidth)
- **Clerk**: FREE (10,000 MAU)
- **Domain**: $12/year (~$1/month)
- **Total**: ~$1/month

### Small Scale (1,000 - 10,000 users)
- **Vercel Pro**: $20/month (if needed, otherwise free)
- **Supabase Pro**: $25/month (8GB database, 100GB storage)
- **Clerk**: FREE or $25/month
- **Total**: $45-70/month

### Medium Scale (10,000 - 100,000 users)
- **Vercel Pro**: $20/month
- **Supabase Pro**: $25/month + overages (~$50/month total)
- **Clerk Pro**: $25/month
- **CDN**: Included in Vercel
- **Total**: $95-120/month

---

## 12. DEVELOPMENT TIMELINE

### Week 1-2: Setup & Foundation
- [x] Initialize Next.js project
- [x] Set up Supabase database
- [x] Configure Clerk authentication
- [x] Create basic UI components (Header, Footer, Sidebar)
- [x] Set up routing structure
- [x] Implement authentication flow

### Week 3-4: Core Features
- [x] Build experiment layout
- [x] Create theory content renderer (with LaTeX support)
- [x] Implement quiz component (MCQ, radio buttons)
- [x] Build progress tracking system
- [x] Create user dashboard

### Week 5-6: Simulations
- [x] Build base simulation framework
- [x] Create Raspberry Pi simulation
- [x] Add 2-3 more simulations
- [x] Implement drag-drop functionality
- [x] Add tooltip/connector info

### Week 7-8: Polish & Deploy
- [x] Add feedback system
- [x] Implement analytics
- [x] Testing (unit + E2E)
- [x] Performance optimization
- [x] Deploy to Vercel
- [x] Set up CI/CD

---

## 13. KEY ADVANTAGES OF THIS STACK

### Developer Experience
✅ **Single language** - TypeScript everywhere
✅ **Fast development** - Server actions eliminate API boilerplate
✅ **Great tooling** - VS Code, Prettier, ESLint
✅ **Hot reload** - Instant feedback
✅ **Type safety** - Catch errors early

### Performance
✅ **Server components** - Reduced client JS
✅ **Automatic code splitting** - Faster loads
✅ **Edge runtime** - Global low latency
✅ **Image optimization** - Next.js Image component
✅ **Caching** - Supabase + Vercel

### Cost Efficiency
✅ **Free tier** - Start without paying
✅ **Pay as you grow** - No upfront costs
✅ **No infrastructure management** - Serverless
✅ **Included CDN** - No extra cost

### Scalability
✅ **Automatic scaling** - Vercel handles it
✅ **Database pooling** - Supabase manages connections
✅ **Edge functions** - Run close to users
✅ **Real-time** - Built into Supabase

---

## 14. NEXT STEPS

1. **Choose your auth**: Clerk (better UX) or Supabase Auth (simpler)
2. **Set up project**: Follow Quick Start Guide (Section 10)
3. **Design first experiment**: Start with Raspberry Pi introduction
4. **Build MVP**: Aim, Theory, Pretest, Simulation
5. **Test with users**: Get feedback early
6. **Iterate**: Add more experiments and features

---

## 15. ADDITIONAL RESOURCES

### Official Docs
- [Next.js 14 Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Clerk Docs](https://clerk.com/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [TailwindCSS](https://tailwindcss.com/docs)

### Tutorials
- [Next.js + Supabase Tutorial](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)
- [Next.js + Clerk Tutorial](https://clerk.com/docs/quickstarts/nextjs)
- [Server Actions Guide](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)

### Example Projects
- [Next.js Examples](https://github.com/vercel/next.js/tree/canary/examples)
- [Supabase Examples](https://github.com/supabase/supabase/tree/master/examples)

---

**Ready to build?** This stack is production-ready and used by thousands of successful projects. You can start building immediately and scale as you grow!
