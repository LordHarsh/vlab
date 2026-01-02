'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { ChevronLeft, CheckCircle2, Star } from 'lucide-react'

type RatingQuestion = {
  id: string
  question: string
  category: string
}

const ratingQuestions: RatingQuestion[] = [
  {
    id: 'content_quality',
    question: 'How would you rate the quality of the content?',
    category: 'Content'
  },
  {
    id: 'clarity',
    question: 'How clear and easy to understand was the material?',
    category: 'Clarity'
  },
  {
    id: 'simulation',
    question: 'How helpful was the interactive simulation?',
    category: 'Simulation'
  },
  {
    id: 'learning',
    question: 'How much did you learn from this experiment?',
    category: 'Learning'
  },
  {
    id: 'overall',
    question: 'Overall, how would you rate this experiment?',
    category: 'Overall'
  }
]

const ratingOptions = [
  { value: '5', label: 'Excellent' },
  { value: '4', label: 'Good' },
  { value: '3', label: 'Average' },
  { value: '2', label: 'Poor' },
  { value: '1', label: 'Very Poor' }
]

type FeedbackClientProps = {
  experimentId: string
  category: string
  experimentSlug: string
}

export function FeedbackClient({ experimentId, category, experimentSlug }: FeedbackClientProps) {
  const [ratings, setRatings] = useState<Record<string, string>>({})
  const [comments, setComments] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRatingChange = (questionId: string, value: string) => {
    setRatings(prev => ({ ...prev, [questionId]: value }))
  }

  const handleSubmit = async () => {
    if (Object.keys(ratings).length !== ratingQuestions.length) {
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          experiment_id: experimentId,
          ratings,
          comments: comments.trim() || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit feedback')
      }

      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  const isFormComplete = Object.keys(ratings).length === ratingQuestions.length

  if (submitted) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-green-900 dark:text-green-100 mb-2">
                Thank You for Your Feedback!
              </h2>
              <p className="text-green-800 dark:text-green-200 mb-6">
                Your response has been recorded and will help us improve this experiment.
              </p>
              <div className="flex gap-4 justify-center">
                <Button asChild variant="outline">
                  <Link href="/labs">Browse More Experiments</Link>
                </Button>
                <Button asChild>
                  <Link href="/">Return to Home</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-start mt-8">
          <Button variant="outline" asChild>
            <Link href={`/labs/${category}/${experimentSlug}/posttest`}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Previous: Posttest
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Experiment Feedback</h1>
        <p className="text-muted-foreground">
          Your feedback helps us improve the learning experience for future students
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <Card className="mb-6 border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
          <CardContent className="pt-6">
            <p className="text-sm text-red-800 dark:text-red-200">
              ⚠️ {error}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Rating Questions */}
      <div className="space-y-6 mb-6">
        {ratingQuestions.map((question, index) => (
          <Card key={question.id}>
            <CardHeader>
              <CardTitle className="text-lg flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <div>{question.question}</div>
                  <CardDescription className="mt-1">{question.category}</CardDescription>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={ratings[question.id]}
                onValueChange={(value) => handleRatingChange(question.id, value)}
              >
                <div className="space-y-3">
                  {ratingOptions.map((option) => (
                    <div
                      key={option.value}
                      className="flex items-center space-x-3 p-3 rounded-lg border-2 border-transparent bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <RadioGroupItem value={option.value} id={`${question.id}-${option.value}`} />
                      <Label
                        htmlFor={`${question.id}-${option.value}`}
                        className="flex-1 cursor-pointer flex items-center gap-2"
                      >
                        <span>{option.label}</span>
                        <div className="flex gap-0.5 ml-2">
                          {Array.from({ length: parseInt(option.value) }).map((_, i) => (
                            <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                          ))}
                        </div>
                      </Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Comments Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Additional Comments (Optional)</CardTitle>
          <CardDescription>
            Share any additional thoughts, suggestions, or issues you encountered
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Tell us what you think..."
            className="w-full min-h-32 p-3 rounded-lg border border-input bg-background resize-y"
            maxLength={1000}
          />
          <p className="text-xs text-muted-foreground mt-2">
            {comments.length} / 1000 characters
          </p>
        </CardContent>
      </Card>

      {/* Privacy Notice */}
      <Card className="mb-6 border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20">
        <CardContent className="pt-6">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            📌 Your feedback is anonymous and will be used solely to improve the quality of our experiments.
            We appreciate your honest responses.
          </p>
        </CardContent>
      </Card>

      {/* Submit Button */}
      <div className="flex justify-center mb-8">
        <Button
          size="lg"
          onClick={handleSubmit}
          disabled={!isFormComplete || submitting}
        >
          {submitting ? 'Submitting...' : 'Submit Feedback'}
        </Button>
      </div>

      {/* Navigation */}
      <div className="flex justify-start">
        <Button variant="outline" asChild>
          <Link href={`/labs/${category}/${experimentSlug}/posttest`}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous: Posttest
          </Link>
        </Button>
      </div>
    </div>
  )
}
