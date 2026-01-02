#!/bin/bash

# Virtual Lab - Quick Setup Script
# Updated for Next.js 16 (October 2025)
# Run this script to set up the entire project

echo "🚀 Starting Virtual Lab Setup with Next.js 16..."
echo ""

# Step 1: Create Next.js 16 Project
echo "📦 Step 1: Creating Next.js 16 project..."
echo "   ⚡ Turbopack is now stable and default!"
npx create-next-app@latest . --typescript --tailwind --app --use-npm

# Step 2: Install shadcn/ui
echo ""
echo "🎨 Step 2: Setting up shadcn/ui..."
npx shadcn@latest init -y

# Install all components
echo "Installing UI components..."
npx shadcn@latest add button -y
npx shadcn@latest add card -y
npx shadcn@latest add input -y
npx shadcn@latest add label -y
npx shadcn@latest add tabs -y
npx shadcn@latest add radio-group -y
npx shadcn@latest add progress -y
npx shadcn@latest add toast -y
npx shadcn@latest add dialog -y
npx shadcn@latest add dropdown-menu -y
npx shadcn@latest add separator -y
npx shadcn@latest add badge -y
npx shadcn@latest add form -y

# Step 3: Install dependencies
echo ""
echo "📚 Step 3: Installing additional dependencies..."
npm install @supabase/supabase-js @supabase/ssr
npm install @clerk/nextjs
npm install react-konva konva use-image recharts
npm install react-hook-form @hookform/resolvers zod
npm install lucide-react

# Step 4: Create folder structure
echo ""
echo "📁 Step 4: Creating folder structure..."
mkdir -p app/{api,labs,dashboard,admin}
mkdir -p app/api/{webhooks,simulations}
mkdir -p components/{experiment,simulations,shared,layout}
mkdir -p lib/{supabase,actions,hooks}
mkdir -p types
mkdir -p public/{images,videos,experiments}

# Step 5: Create environment file template
echo ""
echo "📝 Step 5: Creating .env.local template..."
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

# Step 6: Create proxy.ts (Next.js 16)
echo ""
echo "🔐 Step 6: Creating proxy.ts (Next.js 16 network boundary)..."
cat > proxy.ts << 'EOF'
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/labs(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
])

// Next.js 16: Export function named 'proxy' (not 'default')
export async function proxy(auth: any, request: Request) {
  const clerkProxy = clerkMiddleware(async (auth, request) => {
    if (!isPublicRoute(request)) {
      await auth.protect()
    }
  })

  return clerkProxy(auth, request)
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
EOF

# Step 7: Create Supabase utilities
echo ""
echo "🗄️  Step 7: Creating Supabase utilities..."
cat > lib/supabase/client.ts << 'EOF'
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
EOF

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
            // Ignore errors in Server Components
          }
        },
      },
    }
  )
}
EOF

# Step 8: Update layout with Clerk
echo ""
echo "⚛️  Step 8: Updating app layout..."
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

# Step 9: Create homepage
echo ""
echo "🏠 Step 9: Creating homepage..."
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

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update .env.local with your Supabase and Clerk credentials"
echo "2. Run 'npm run dev' to start the development server"
echo "3. Visit http://localhost:3000"
echo ""
echo "📚 See SETUP_GUIDE.md for detailed instructions on:"
echo "   - Setting up Supabase database"
echo "   - Configuring Clerk authentication"
echo "   - Creating your first experiment"
echo ""
