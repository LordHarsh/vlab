# Virtual Lab - Complete Setup Guide

## 🚀 Quick Setup (Follow These Steps)

### Step 1: Initialize Next.js 15 Project

```bash
# Create Next.js project with latest versions
npx create-next-app@latest . --typescript --tailwind --app --use-npm

# When prompted, choose:
# ✅ TypeScript: Yes
# ✅ ESLint: Yes
# ✅ Tailwind CSS: Yes
# ✅ `src/` directory: No
# ✅ App Router: Yes
# ✅ Turbopack: Yes (for faster dev)
# ✅ Customize import alias: Yes (@/*)
```

### Step 2: Install shadcn/ui

```bash
# Initialize shadcn/ui
npx shadcn@latest init

# When prompted, choose:
# ✅ Style: New York
# ✅ Base color: Slate
# ✅ CSS variables: Yes

# Install essential components
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add input
npx shadcn@latest add label
npx shadcn@latest add tabs
npx shadcn@latest add radio-group
npx shadcn@latest add progress
npx shadcn@latest add toast
npx shadcn@latest add dialog
npx shadcn@latest add dropdown-menu
npx shadcn@latest add separator
npx shadcn@latest add badge
npx shadcn@latest add form
```

### Step 3: Install Supabase

```bash
# Install Supabase packages
npm install @supabase/supabase-js @supabase/ssr
```

### Step 4: Install Clerk

```bash
# Install Clerk
npm install @clerk/nextjs
```

### Step 5: Install Additional Dependencies

```bash
# Simulation & Charts
npm install react-konva konva use-image recharts

# Form handling
npm install react-hook-form @hookform/resolvers zod

# Icons
npm install lucide-react

# Utilities
npm install class-variance-authority clsx tailwind-merge
```

### Step 6: Create Environment Variables

Create `.env.local` file:

```bash
cat > .env.local << 'EOF'
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key_here
CLERK_SECRET_KEY=your_clerk_secret_key_here
CLERK_WEBHOOK_SECRET=your_webhook_secret_here

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF
```

---

## 📁 Step 7: Create Project Structure

```bash
# Create folder structure
mkdir -p app/{api,labs,dashboard,admin} \
         app/api/{webhooks,simulations} \
         components/{ui,experiment,simulations,shared,layout} \
         lib/{supabase,actions,hooks} \
         types \
         public/{images,videos,experiments}

# Create subdirectories
mkdir -p app/labs/\[category\]/\[experimentId\]/{aim,theory,pretest,procedure,simulation,posttest,feedback}
```

---

## 🗄️ Step 8: Set Up Supabase Database

### 8.1 Create Supabase Project

```bash
# 1. Go to https://supabase.com
# 2. Click "New Project"
# 3. Fill in details:
#    - Name: virtual-lab
#    - Database Password: (generate strong password)
#    - Region: (choose closest to you)
# 4. Click "Create new project"
# 5. Wait for project to be ready (~2 minutes)
```

### 8.2 Run Database Schema

Copy this SQL and run it in Supabase SQL Editor:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  role TEXT CHECK (role IN ('student', 'instructor', 'admin')) DEFAULT 'student',
  institution TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categories
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  icon_url TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Experiments
CREATE TABLE experiments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')) DEFAULT 'beginner',
  duration_minutes INTEGER DEFAULT 30,

  -- Content sections
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

-- Simulations
CREATE TABLE simulations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE UNIQUE,
  type TEXT CHECK (type IN ('parametric', 'interactive', 'code', 'visual')) DEFAULT 'interactive',
  config JSONB NOT NULL,
  instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quizzes
CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('pretest', 'posttest', 'assignment')) NOT NULL,
  title TEXT,
  questions JSONB NOT NULL,
  passing_score INTEGER DEFAULT 70,
  time_limit_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Progress
CREATE TABLE user_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,

  sections_completed JSONB DEFAULT '{}',
  pretest_score INTEGER,
  pretest_attempts INTEGER DEFAULT 0,
  posttest_score INTEGER,
  posttest_attempts INTEGER DEFAULT 0,
  simulation_state JSONB,
  simulation_completed BOOLEAN DEFAULT false,

  completed_at TIMESTAMPTZ,
  time_spent_minutes INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, experiment_id)
);

-- Quiz Submissions
CREATE TABLE quiz_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score INTEGER,
  max_score INTEGER,
  passed BOOLEAN,
  time_taken_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feedback
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
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

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- RLS Policies for experiments
CREATE POLICY "Anyone can view published experiments"
  ON experiments FOR SELECT
  USING (is_published = true OR auth.role() = 'authenticated');

-- RLS Policies for user_progress
CREATE POLICY "Users can view own progress"
  ON user_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress"
  ON user_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress"
  ON user_progress FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for quiz_submissions
CREATE POLICY "Users can view own submissions"
  ON quiz_submissions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own submissions"
  ON quiz_submissions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for feedback
CREATE POLICY "Users can view own feedback"
  ON feedback FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert feedback"
  ON feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('images', 'images', true),
  ('videos', 'videos', true),
  ('documents', 'documents', true);

-- Storage policies
CREATE POLICY "Anyone can view images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'images');

CREATE POLICY "Authenticated users can upload images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'images' AND auth.role() = 'authenticated');

-- Insert sample category
INSERT INTO categories (name, slug, description) VALUES
  ('Internet of Things (IoT)', 'iot', 'Learn about IoT devices, sensors, and applications'),
  ('Computer Science', 'cs', 'Fundamental computer science concepts'),
  ('Electronics', 'electronics', 'Basic electronics and circuits');
```

### 8.3 Get Supabase Credentials

```bash
# In Supabase Dashboard:
# 1. Go to Project Settings > API
# 2. Copy:
#    - Project URL → NEXT_PUBLIC_SUPABASE_URL
#    - anon public → NEXT_PUBLIC_SUPABASE_ANON_KEY
#    - service_role → SUPABASE_SERVICE_ROLE_KEY
# 3. Paste into .env.local
```

---

## 🔐 Step 9: Set Up Clerk

### 9.1 Create Clerk Application

```bash
# 1. Go to https://clerk.com
# 2. Sign up / Sign in
# 3. Click "Add Application"
# 4. Name: "Virtual Lab"
# 5. Choose sign-in options:
#    ✅ Email
#    ✅ Google
#    ✅ GitHub (optional)
# 6. Click "Create Application"
```

### 9.2 Get Clerk Credentials

```bash
# In Clerk Dashboard:
# 1. Go to API Keys
# 2. Copy:
#    - Publishable key → NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
#    - Secret key → CLERK_SECRET_KEY
# 3. Paste into .env.local
```

### 9.3 Configure Clerk Webhook (Optional - for Supabase sync)

```bash
# In Clerk Dashboard:
# 1. Go to Webhooks
# 2. Click "Add Endpoint"
# 3. Endpoint URL: https://your-app.vercel.app/api/webhooks/clerk
# 4. Subscribe to events:
#    - user.created
#    - user.updated
#    - user.deleted
# 5. Copy "Signing Secret" → CLERK_WEBHOOK_SECRET
```

---

## 🎨 Step 10: Create Essential Files

Now I'll create only the essential configuration files manually:

### Create middleware.ts

```bash
cat > middleware.ts << 'EOF'
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/labs(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
EOF
```

### Create Supabase client utilities

```bash
# Create lib/supabase/client.ts
cat > lib/supabase/client.ts << 'EOF'
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
EOF

# Create lib/supabase/server.ts
cat > lib/supabase/server.ts << 'EOF'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
EOF
```

### Create TypeScript types

```bash
cat > types/database.ts << 'EOF'
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          role: 'student' | 'instructor' | 'admin'
          institution: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      // Add other tables as needed
    }
  }
}
EOF
```

### Update app/layout.tsx

```bash
cat > app/layout.tsx << 'EOF'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Virtual Lab - Interactive Learning Platform',
  description: 'Learn through interactive simulations and experiments',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={inter.className}>{children}</body>
      </html>
    </ClerkProvider>
  )
}
EOF
```

### Create a simple homepage

```bash
cat > app/page.tsx << 'EOF'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">Virtual Lab</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Learn through interactive simulations and experiments
          </p>
          <div className="flex gap-4 justify-center">
            <Button asChild size="lg">
              <Link href="/labs">Explore Labs</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Interactive Simulations</CardTitle>
              <CardDescription>
                Hands-on learning with real-time simulations
              </CardDescription>
            </CardHeader>
            <CardContent>
              Explore IoT, electronics, and computer science through interactive experiments.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Track Progress</CardTitle>
              <CardDescription>
                Monitor your learning journey
              </CardDescription>
            </CardHeader>
            <CardContent>
              Complete quizzes, earn badges, and track your progress across all experiments.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Learn Anywhere</CardTitle>
              <CardDescription>
                Access from any device
              </CardDescription>
            </CardHeader>
            <CardContent>
              Study at your own pace with 24/7 access to all labs and resources.
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
EOF
```

---

## ▶️ Step 11: Run the Project

```bash
# Install all dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

---

## 📋 Step 12: Verify Everything Works

### Check these URLs:

1. **Homepage**: http://localhost:3000
2. **Sign In**: http://localhost:3000/sign-in (Clerk auth page)
3. **Sign Up**: http://localhost:3000/sign-up (Clerk auth page)

### Test Supabase Connection:

Create a test page:

```bash
cat > app/test-db/page.tsx << 'EOF'
import { createClient } from '@/lib/supabase/server'

export default async function TestDB() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('categories').select('*')

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Database Test</h1>
      {error ? (
        <p className="text-red-500">Error: {error.message}</p>
      ) : (
        <pre className="bg-gray-100 p-4 rounded">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}
EOF

# Visit http://localhost:3000/test-db to verify Supabase works
```

---

## 🎯 Next Steps

After setup is complete:

1. **Create your first experiment** - Add Raspberry Pi introduction
2. **Build simulation components** - Interactive canvas with React Konva
3. **Add quiz functionality** - MCQ with scoring
4. **Create dashboard** - User progress tracking

---

## 📦 Complete Package.json Reference

Your `package.json` should look like this after all installations:

```json
{
  "name": "virtual-lab",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@clerk/nextjs": "^6.9.3",
    "@hookform/resolvers": "^3.9.1",
    "@radix-ui/react-*": "latest",
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.46.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "konva": "^9.3.16",
    "lucide-react": "latest",
    "next": "^15.1.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.54.2",
    "react-konva": "^18.2.10",
    "recharts": "^2.15.0",
    "tailwind-merge": "^2.5.5",
    "tailwindcss-animate": "^1.0.7",
    "use-image": "^1.1.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "^15.1.3",
    "postcss": "^8",
    "tailwindcss": "^3.4",
    "typescript": "^5"
  }
}
```

---

## 🚨 Troubleshooting

### If you get module not found errors:
```bash
rm -rf node_modules package-lock.json
npm install
```

### If Clerk auth doesn't work:
- Check `.env.local` has correct keys
- Restart dev server after adding env vars

### If Supabase queries fail:
- Verify database schema is created
- Check RLS policies are enabled
- Confirm `.env.local` has correct credentials

---

## ✅ Success Checklist

- [ ] Next.js 15 installed with TypeScript & Tailwind
- [ ] shadcn/ui components added
- [ ] Supabase project created & schema applied
- [ ] Clerk application created & configured
- [ ] All dependencies installed
- [ ] `.env.local` configured with all keys
- [ ] Dev server runs without errors
- [ ] Homepage loads at localhost:3000
- [ ] Clerk sign-in page works
- [ ] Supabase database connection verified

---

**You're all set! Ready to start building? 🚀**

Let me know when you've completed the setup and I'll help you build the first experiment page!
