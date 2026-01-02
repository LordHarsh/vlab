import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FlaskConical, Clock } from 'lucide-react'

// Mock data - will be replaced with Supabase queries
const categories = [
  {
    id: 'iot',
    name: 'Internet of Things',
    description: 'Learn about IoT devices, sensors, and connectivity',
    icon: '🌐',
    count: 3
  },
  {
    id: 'electronics',
    name: 'Electronics',
    description: 'Explore circuits, components, and electronic systems',
    icon: '⚡',
    count: 2
  },
  {
    id: 'computer-science',
    name: 'Computer Science',
    description: 'Study algorithms, data structures, and programming',
    icon: '💻',
    count: 3
  }
]

const experiments = [
  {
    id: 'raspberry-pi-intro',
    category: 'iot',
    title: 'Introduction to Raspberry Pi',
    description: 'Learn the basics of Raspberry Pi, its components, and how to set it up for your first project.',
    difficulty: 'beginner' as const,
    duration: 45
  },
  {
    id: 'arduino-basics',
    category: 'iot',
    title: 'Arduino Programming Basics',
    description: 'Get started with Arduino microcontrollers and learn to program digital circuits.',
    difficulty: 'beginner' as const,
    duration: 60
  },
  {
    id: 'mqtt-protocol',
    category: 'iot',
    title: 'MQTT Protocol for IoT',
    description: 'Learn about MQTT, a lightweight messaging protocol perfect for IoT applications.',
    difficulty: 'intermediate' as const,
    duration: 90
  },
  {
    id: 'led-circuit',
    category: 'electronics',
    title: 'LED Circuit Design',
    description: 'Learn to design and build basic LED circuits with resistors.',
    difficulty: 'beginner' as const,
    duration: 30
  },
  {
    id: 'transistor-basics',
    category: 'electronics',
    title: 'Transistor Fundamentals',
    description: 'Explore how transistors work as switches and amplifiers.',
    difficulty: 'intermediate' as const,
    duration: 75
  },
  {
    id: 'binary-search',
    category: 'computer-science',
    title: 'Binary Search Algorithm',
    description: 'Master the binary search algorithm and understand its efficiency.',
    difficulty: 'beginner' as const,
    duration: 40
  },
  {
    id: 'sorting-algorithms',
    category: 'computer-science',
    title: 'Sorting Algorithms Comparison',
    description: 'Compare different sorting algorithms and their performance characteristics.',
    difficulty: 'intermediate' as const,
    duration: 90
  },
  {
    id: 'data-structures',
    category: 'computer-science',
    title: 'Essential Data Structures',
    description: 'Learn about stacks, queues, linked lists, and trees.',
    difficulty: 'intermediate' as const,
    duration: 120
  }
]

const difficultyColors = {
  beginner: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
}

export default function LabsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Virtual Labs</h1>
        <p className="text-muted-foreground">
          Explore our collection of interactive experiments across multiple disciplines
        </p>
      </div>

      {/* Categories Overview */}
      <div className="mb-12">
        <h2 className="text-xl font-semibold mb-4">Categories</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {categories.map((category) => (
            <Link key={category.id} href={`/labs/${category.id}`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="text-4xl mb-2">{category.icon}</div>
                  <CardTitle className="text-lg">{category.name}</CardTitle>
                  <CardDescription>{category.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {category.count} {category.count === 1 ? 'experiment' : 'experiments'}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* All Experiments */}
      <div>
        <h2 className="text-xl font-semibold mb-4">All Experiments</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {experiments.map((experiment) => (
            <Link
              key={experiment.id}
              href={`/labs/${experiment.category}/${experiment.id}`}
            >
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <CardTitle className="text-base leading-tight">
                      {experiment.title}
                    </CardTitle>
                    <FlaskConical className="h-5 w-5 text-muted-foreground shrink-0" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={difficultyColors[experiment.difficulty]}
                    >
                      {experiment.difficulty}
                    </Badge>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{experiment.duration} min</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="line-clamp-2">
                    {experiment.description}
                  </CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-12 text-center">
        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <h3 className="text-lg font-semibold mb-2">Ready to get started?</h3>
            <p className="text-muted-foreground mb-4">
              Choose an experiment above and begin your learning journey
            </p>
            <Button asChild>
              <Link href="#all-experiments">Browse Experiments</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
