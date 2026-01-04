'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'

type QuizQuestion = {
  id: string
  question_text: string
  question_type: string
  options: string[]
  correct_answer: string
  explanation?: string
  order_number: number
}

type PosttestClientProps = {
  questions: QuizQuestion[]
  passingPercentage: number
  category: string
  experimentId: string
  quizId: string
}

export function PosttestClient({ questions, passingPercentage, category, experimentId, quizId }: PosttestClientProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [submitted, setSubmitted] = useState(false)

  const handleAnswerChange = (questionId: string, answerIndex: number) => {
    setAnswers(prev => ({ ...prev, [questionId]: answerIndex }))
  }

  const handleSubmit = async () => {
    if (Object.keys(answers).length === questions.length) {
      setSubmitted(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })

      // Calculate score
      let correct = 0
      questions.forEach(q => {
        if (answers[q.id] === parseInt(q.correct_answer)) {
          correct++
        }
      })
      const percentage = Math.round((correct / questions.length) * 100)

      // TODO: Submit to database via API route
      // await fetch('/api/quiz-submissions', {
      //   method: 'POST',
      //   body: JSON.stringify({
      //     quiz_id: quizId,
      //     answers,
      //     score: correct,
      //     percentage,
      //   }),
      // })
    }
  }

  const calculateScore = () => {
    let correct = 0
    questions.forEach(q => {
      if (answers[q.id] === parseInt(q.correct_answer)) {
        correct++
      }
    })
    return correct
  }

  const score = submitted ? calculateScore() : 0
  const percentage = submitted ? Math.round((score / questions.length) * 100) : 0

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Posttest</h1>
        <p className="text-muted-foreground">
          Test your understanding after completing the experiment
        </p>
      </div>

      {/* Results Card */}
      {submitted && (
        <Card className={`mb-6 ${
          percentage >= passingPercentage
            ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20'
            : 'border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20'
        }`}>
          <CardHeader>
            <CardTitle className={
              percentage >= passingPercentage
                ? 'text-green-900 dark:text-green-100'
                : 'text-orange-900 dark:text-orange-100'
            }>
              Test Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center mb-4">
              <div className={`text-5xl font-bold mb-2 ${
                percentage >= passingPercentage ? 'text-green-600' : 'text-orange-600'
              }`}>
                {percentage}%
              </div>
              <p className={
                percentage >= passingPercentage
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-orange-800 dark:text-orange-200'
              }>
                You scored {score} out of {questions.length} questions correctly
              </p>
            </div>
            <div className={`text-sm ${
              percentage >= passingPercentage
                ? 'text-green-800 dark:text-green-200'
                : 'text-orange-800 dark:text-orange-200'
            }`}>
              {percentage >= passingPercentage
                ? 'Excellent work! You have a strong understanding of the concepts.'
                : 'Good effort! Review the theory and procedure sections to strengthen your understanding.'}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Questions */}
      <div className="space-y-6">
        {questions.map((question, index) => {
          const userAnswer = answers[question.id]
          const isCorrect = userAnswer === parseInt(question.correct_answer)
          const showFeedback = submitted && userAnswer !== undefined

          return (
            <Card key={question.id} className={
              showFeedback
                ? isCorrect
                  ? 'border-green-200 dark:border-green-900'
                  : 'border-red-200 dark:border-red-900'
                : ''
            }>
              <CardHeader>
                <CardTitle className="text-lg flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                    {index + 1}
                  </span>
                  <span className="flex-1">{question.question_text}</span>
                  {showFeedback && (
                    isCorrect
                      ? <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
                      : <XCircle className="h-6 w-6 text-red-600 shrink-0" />
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={userAnswer?.toString()}
                  onValueChange={(value) => !submitted && handleAnswerChange(question.id, parseInt(value))}
                  disabled={submitted}
                >
                  <div className="space-y-3">
                    {question.options.map((option, optionIndex) => {
                      const isSelected = userAnswer === optionIndex
                      const isCorrectOption = optionIndex === parseInt(question.correct_answer)
                      const showCorrect = submitted && isCorrectOption
                      const showIncorrect = submitted && isSelected && !isCorrect

                      return (
                        <div
                          key={optionIndex}
                          className={`flex items-center space-x-3 p-3 rounded-lg border-2 transition-colors ${
                            showCorrect
                              ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                              : showIncorrect
                              ? 'border-red-500 bg-red-50 dark:bg-red-950/20'
                              : 'border-transparent bg-muted/50'
                          }`}
                        >
                          <RadioGroupItem value={optionIndex.toString()} id={`${question.id}-${optionIndex}`} />
                          <Label
                            htmlFor={`${question.id}-${optionIndex}`}
                            className="flex-1 cursor-pointer"
                          >
                            {option}
                          </Label>
                          {showCorrect && (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          )}
                          {showIncorrect && (
                            <XCircle className="h-5 w-5 text-red-600" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </RadioGroup>

                {/* Explanation */}
                {submitted && question.explanation && (
                  <div className="mt-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900">
                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                      Explanation:
                    </p>
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      {question.explanation}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Submit Button */}
      {!submitted && (
        <div className="mt-8 flex justify-center">
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={Object.keys(answers).length !== questions.length}
          >
            Submit Answers
          </Button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <Button variant="outline" asChild>
          <Link href={`/labs/${category}/${experimentId}/simulation`}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous: Simulation
          </Link>
        </Button>
        {submitted && (
          <Button asChild>
            <Link href={`/labs/${category}/${experimentId}/feedback`}>
              Next: Feedback
              <ChevronRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
