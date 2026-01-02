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
