'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Target,
  BookOpen,
  ClipboardCheck,
  ListChecks,
  Sparkles,
  Award,
  MessageSquare,
  CheckCircle2
} from 'lucide-react'

interface ExperimentNavProps {
  category: string
  experimentId: string
}

const sections = [
  { id: 'aim', label: 'Aim', icon: Target },
  { id: 'theory', label: 'Theory', icon: BookOpen },
  { id: 'pretest', label: 'Pretest', icon: ClipboardCheck },
  { id: 'procedure', label: 'Procedure', icon: ListChecks },
  { id: 'simulation', label: 'Simulation', icon: Sparkles },
  { id: 'posttest', label: 'Posttest', icon: Award },
  { id: 'feedback', label: 'Feedback', icon: MessageSquare },
]

export function ExperimentNav({ category, experimentId }: ExperimentNavProps) {
  const pathname = usePathname()

  return (
    <nav className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground mb-2 px-3">
        SECTIONS
      </div>
      {sections.map((section) => {
        const href = `/labs/${category}/${experimentId}/${section.id}`
        const isActive = pathname === href
        const Icon = section.icon

        return (
          <Link
            key={section.id}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{section.label}</span>
            {isActive && <CheckCircle2 className="h-3 w-3 ml-auto text-green-600" />}
          </Link>
        )
      })}
    </nav>
  )
}
