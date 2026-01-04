'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, XCircle } from 'lucide-react'

type QuizQuestion = {
  id: string
  question_text: string
  question_type: string
  options: string[]
  correct_answer: string
  explanation?: string
  order_number: number
}

type QuizClientProps = {
  questions: QuizQuestion[]
  passingPercentage: number
  category: string
  experimentId: string
  quizId: string
}

export function QuizClient({ questions, passingPercentage, category, experimentId, quizId }: QuizClientProps) {
  const router = useRouter()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState(0)

  const handleSubmit = async () => {
    let correctCount = 0
    questions.forEach((q) => {
      if (answers[q.id] === q.correct_answer) {
        correctCount++
      }
    })
    const calculatedScore = correctCount
    const percentage = (correctCount / questions.length) * 100

    setScore(calculatedScore)
    setSubmitted(true)

    // TODO: Submit to database via API route
    // await fetch('/api/quiz-submissions', {
    //   method: 'POST',
    //   body: JSON.stringify({
    //     quiz_id: quizId,
    //     answers,
    //     score: calculatedScore,
    //     percentage,
    //   }),
    // })
  }

  const handleContinue = () => {
    router.push(`/labs/${category}/${experimentId}/procedure`)
  }

  const allAnswered = questions.every(q => answers[q.id] !== undefined)
  const percentage = submitted ? (score / questions.length) * 100 : 0

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Pretest</h1>
        <p className="text-muted-foreground">
          Test your understanding before starting the experiment
        </p>
      </div>

      {!submitted ? (
        <div className="space-y-6">
          {questions.map((question, index) => (
            <Card key={question.id}>
              <CardHeader>
                <CardTitle className="text-lg">
                  Question {index + 1}: {question.question_text}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={answers[question.id]}
                  onValueChange={(value) =>
                    setAnswers({ ...answers, [question.id]: value })
                  }
                >
                  {question.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="flex items-center space-x-2 mb-2">
                      <RadioGroupItem
                        value={optionIndex.toString()}
                        id={`${question.id}-${optionIndex}`}
                      />
                      <Label htmlFor={`${question.id}-${optionIndex}`} className="cursor-pointer">
                        {option}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </CardContent>
            </Card>
          ))}

          <div className="flex justify-between">
            <Button variant="outline" asChild>
              <Link href={`/labs/${category}/${experimentId}/theory`}>
                Previous: Theory
              </Link>
            </Button>
            <Button onClick={handleSubmit} disabled={!allAnswered}>
              Submit Answers
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <h3 className="text-2xl font-bold mb-2">Results</h3>
                <p className="text-5xl font-bold mb-4">{percentage.toFixed(0)}%</p>
                <p className="text-muted-foreground mb-6">
                  You scored {score} out of {questions.length} questions correctly
                </p>
                {percentage >= passingPercentage ? (
                  <div className="flex items-center justify-center gap-2 text-green-600">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">Great job! You passed the pretest.</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-yellow-600">
                    <XCircle className="h-5 w-5" />
                    <span className="font-medium">You can review the theory and try again.</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {questions.map((question, index) => {
              const userAnswer = answers[question.id]
              const isCorrect = userAnswer === question.correct_answer

              return (
                <Card key={question.id} className={isCorrect ? 'border-green-200' : 'border-red-200'}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">
                        Question {index + 1}: {question.question_text}
                      </CardTitle>
                      {isCorrect ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-600" />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm mb-2">
                      <strong>Your answer:</strong> {question.options[parseInt(userAnswer)]}
                    </p>
                    {!isCorrect && (
                      <p className="text-sm text-green-600 mb-2">
                        <strong>Correct answer:</strong> {question.options[parseInt(question.correct_answer)]}
                      </p>
                    )}
                    {question.explanation && (
                      <p className="text-sm text-muted-foreground mt-3 p-3 bg-muted rounded-md">
                        <strong>Explanation:</strong> {question.explanation}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleContinue}>
              Continue to Procedure
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
