'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Target,
  BookOpen,
  Cpu,
  GitBranch,
  ListOrdered,
  Code2,
  PlayCircle,
  HelpCircle,
  MessageSquare,
  ExternalLink,
  AlignLeft,
  Video,
  ChevronRight,
  CheckCircle2,
  Circle,
} from 'lucide-react'

type Section = {
  id: string
  type: string
  title: string | null
  order_index: number
  is_required: boolean
}

type Experiment = {
  id: string
  slug: string
  title: string
  lab_id: string
}

const sectionTypeConfig: Record<
  string,
  { icon: React.ReactNode; defaultLabel: string }
> = {
  aim: { icon: <Target className="w-4 h-4" />, defaultLabel: 'Aim & Objectives' },
  theory: { icon: <BookOpen className="w-4 h-4" />, defaultLabel: 'Theory' },
  components: { icon: <Cpu className="w-4 h-4" />, defaultLabel: 'Components' },
  circuit: { icon: <GitBranch className="w-4 h-4" />, defaultLabel: 'Circuit' },
  procedure: { icon: <ListOrdered className="w-4 h-4" />, defaultLabel: 'Procedure' },
  code: { icon: <Code2 className="w-4 h-4" />, defaultLabel: 'Code' },
  simulation: { icon: <PlayCircle className="w-4 h-4" />, defaultLabel: 'Simulation' },
  quiz: { icon: <HelpCircle className="w-4 h-4" />, defaultLabel: 'Quiz' },
  feedback: { icon: <MessageSquare className="w-4 h-4" />, defaultLabel: 'Feedback' },
  references: { icon: <ExternalLink className="w-4 h-4" />, defaultLabel: 'References' },
  text: { icon: <AlignLeft className="w-4 h-4" />, defaultLabel: 'Reading' },
  video: { icon: <Video className="w-4 h-4" />, defaultLabel: 'Video' },
}

export function ExperimentShell({
  classId,
  labSlug,
  experiment,
  sections,
  completedSectionIds,
  children,
}: {
  classId: string
  labSlug: string
  experiment: Experiment
  sections: Section[]
  completedSectionIds: string[]
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Determine active section from URL
  const sectionIdMatch = pathname.match(/\/section\/([^/]+)/)
  const activeSectionId = sectionIdMatch?.[1] ?? sections[0]?.id

  const baseUrl = `/dashboard/class/${classId}/lab/${labSlug}/${experiment.slug}`

  const completedCount = completedSectionIds.length
  const totalCount = sections.length
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  // Active section index for prev/next
  const activeSectionIndex = sections.findIndex((s) => s.id === activeSectionId)
  const prevSection = activeSectionIndex > 0 ? sections[activeSectionIndex - 1] : null
  const nextSection =
    activeSectionIndex < sections.length - 1 ? sections[activeSectionIndex + 1] : null

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky top header */}
      <header className="sticky top-0 z-20 bg-white border-b border-[#f2f2f2] px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/dashboard/class/${classId}/lab/${labSlug}`}
            className="flex items-center gap-1 text-sm text-[#6a6a6a] hover:text-[#222222] transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>

          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="text-sm font-semibold text-[#222222] truncate leading-tight">{experiment.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1 bg-[#f2f2f2] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff385c] rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs text-[#6a6a6a] shrink-0 tabular-nums">
                {completedCount}/{totalCount}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Section sidebar */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-[#f2f2f2] bg-white sticky top-[61px] h-[calc(100vh-61px)] overflow-y-auto">
          <div className="px-4 py-4">
            <p className="text-xs font-600 text-[#6a6a6a] uppercase tracking-wide mb-3">
              Sections
            </p>
            <nav className="space-y-0.5">
              {sections.map((section) => {
                const isActive = section.id === activeSectionId
                const isCompleted = completedSectionIds.includes(section.id)
                const cfg = sectionTypeConfig[section.type] ?? {
                  icon: <Circle className="w-4 h-4" />,
                  defaultLabel: section.type,
                }
                const label = section.title ?? cfg.defaultLabel

                return (
                  <Link
                    key={section.id}
                    href={`${baseUrl}/section/${section.id}`}
                    className={`
                      flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors group
                      ${
                        isActive
                          ? 'bg-[#ff385c]/10 text-[#ff385c] font-600'
                          : 'text-[#222222] hover:bg-[#f2f2f2]'
                      }
                    `}
                  >
                    <span
                      className={`shrink-0 ${isActive ? 'text-[#ff385c]' : 'text-[#6a6a6a]'}`}
                    >
                      {cfg.icon}
                    </span>
                    <span className="flex-1 truncate">{label}</span>
                    {isCompleted && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    )}
                  </Link>
                )
              })}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 px-6 py-8 max-w-3xl mx-auto w-full">
            {children}
          </div>

          {/* Prev / Next navigation */}
          <div className="border-t border-[#f2f2f2] px-6 py-4">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
              {prevSection ? (
                <Link
                  href={`${baseUrl}/section/${prevSection.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#c1c1c1] text-sm text-[#222222] hover:border-[#ff385c] hover:text-[#ff385c] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {prevSection.title ??
                      sectionTypeConfig[prevSection.type]?.defaultLabel ??
                      prevSection.type}
                  </span>
                  <span className="sm:hidden">Previous</span>
                </Link>
              ) : (
                <div />
              )}

              {nextSection ? (
                <Link
                  href={`${baseUrl}/section/${nextSection.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#ff385c] text-white text-sm font-500 hover:bg-[#e0324f] transition-colors"
                >
                  <span className="hidden sm:inline">
                    {nextSection.title ??
                      sectionTypeConfig[nextSection.type]?.defaultLabel ??
                      nextSection.type}
                  </span>
                  <span className="sm:hidden">Next</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              ) : (
                <Link
                  href={`/dashboard/class/${classId}/lab/${labSlug}`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 text-white text-sm font-500 hover:bg-green-700 transition-colors"
                >
                  Finish Experiment
                  <CheckCircle2 className="w-4 h-4" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
