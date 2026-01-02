import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}min`
    : `${hours}h`
}

export function calculateScore(
  answers: Record<string, string>,
  correctAnswers: Record<string, string>
): { score: number; total: number; percentage: number } {
  const total = Object.keys(correctAnswers).length
  let score = 0

  Object.entries(answers).forEach(([questionId, answer]) => {
    if (correctAnswers[questionId] === answer) {
      score++
    }
  })

  return {
    score,
    total,
    percentage: Math.round((score / total) * 100),
  }
}
