'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'

type Question = {
  id: string
  question: string
  options: string[]
  correctAnswer: number
  explanation: string
}

const questions: Question[] = [
  {
    id: 'q1',
    question: 'When a GPIO pin is set to HIGH state, what voltage does it output?',
    options: [
      '5V',
      '3.3V',
      '1.8V',
      '12V'
    ],
    correctAnswer: 1,
    explanation: 'Raspberry Pi GPIO pins output 3.3V when set to HIGH state. Using 5V can damage the board.'
  },
  {
    id: 'q2',
    question: 'What is the purpose of GPIO.cleanup() in Python code?',
    options: [
      'To delete Python files',
      'To reset the Raspberry Pi',
      'To release GPIO resources and reset pin states',
      'To clean the SD card'
    ],
    correctAnswer: 2,
    explanation: 'GPIO.cleanup() releases GPIO resources and resets pins to their default state, preventing conflicts with future programs.'
  },
  {
    id: 'q3',
    question: 'Which pin numbering mode uses the Broadcom SOC channel numbers?',
    options: [
      'GPIO.BOARD',
      'GPIO.BCM',
      'GPIO.PHYSICAL',
      'GPIO.WPI'
    ],
    correctAnswer: 1,
    explanation: 'GPIO.BCM uses Broadcom SOC channel numbers (e.g., GPIO17, GPIO18), while GPIO.BOARD uses physical pin numbers.'
  },
  {
    id: 'q4',
    question: 'What happens if you connect an LED directly to a GPIO pin without a resistor?',
    options: [
      'The LED will work perfectly',
      'Nothing will happen',
      'The LED or GPIO pin could be damaged due to excessive current',
      'The Raspberry Pi will shut down'
    ],
    correctAnswer: 2,
    explanation: 'Without a current-limiting resistor, excessive current can flow through the LED and GPIO pin, potentially damaging both.'
  },
  {
    id: 'q5',
    question: 'Which command can you use to view the GPIO pin layout in the terminal?',
    options: [
      'ls -gpio',
      'gpio readall',
      'cat /gpio',
      'show pins'
    ],
    correctAnswer: 1,
    explanation: 'The command "gpio readall" displays a detailed table of all GPIO pins, their modes, and current states.'
  }
]

export default function PosttestPage() {
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [submitted, setSubmitted] = useState(false)

  const handleAnswerChange = (questionId: string, answerIndex: number) => {
    setAnswers(prev => ({ ...prev, [questionId]: answerIndex }))
  }

  const handleSubmit = () => {
    if (Object.keys(answers).length === questions.length) {
      setSubmitted(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const calculateScore = () => {
    let correct = 0
    questions.forEach(q => {
      if (answers[q.id] === q.correctAnswer) {
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
          Test your understanding of Raspberry Pi concepts and GPIO programming
        </p>
      </div>

      {/* Results Card */}
      {submitted && (
        <Card className={`mb-6 ${
          percentage >= 70
            ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20'
            : 'border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20'
        }`}>
          <CardHeader>
            <CardTitle className={
              percentage >= 70
                ? 'text-green-900 dark:text-green-100'
                : 'text-orange-900 dark:text-orange-100'
            }>
              Test Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center mb-4">
              <div className={`text-5xl font-bold mb-2 ${
                percentage >= 70 ? 'text-green-600' : 'text-orange-600'
              }`}>
                {percentage}%
              </div>
              <p className={
                percentage >= 70
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-orange-800 dark:text-orange-200'
              }>
                You scored {score} out of {questions.length} questions correctly
              </p>
            </div>
            <div className={`text-sm ${
              percentage >= 70
                ? 'text-green-800 dark:text-green-200'
                : 'text-orange-800 dark:text-orange-200'
            }`}>
              {percentage >= 70
                ? '🎉 Excellent work! You have a strong understanding of Raspberry Pi basics.'
                : '💡 Good effort! Review the theory and procedure sections to strengthen your understanding.'}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Questions */}
      <div className="space-y-6">
        {questions.map((question, index) => {
          const userAnswer = answers[question.id]
          const isCorrect = userAnswer === question.correctAnswer
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
                  <span className="flex-1">{question.question}</span>
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
                      const isCorrectOption = optionIndex === question.correctAnswer
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
                {submitted && (
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
          <Link href={`/labs/iot/raspberry-pi-intro/simulation`}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous: Simulation
          </Link>
        </Button>
        {submitted && (
          <Button asChild>
            <Link href={`/labs/iot/raspberry-pi-intro/feedback`}>
              Next: Feedback
              <ChevronRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
