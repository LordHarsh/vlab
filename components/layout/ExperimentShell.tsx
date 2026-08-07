'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, Check, Home } from 'lucide-react'

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

/**
 * Canonical labels for the fixed experiment sequence.
 *
 * The reference's every-experiment sidebar reads exactly:
 *
 *   Home · Aim · Theory · Pre Test · Procedure · Simulation · Post Test ·
 *   References · Feedback
 *
 * That 8-step pedagogical sequence — not any visual treatment — is the single
 * strongest "real academic lab" signal on the whole site, so the wording is
 * matched to it where our section types line up. A section carrying an explicit
 * title in the database still wins; these are the fallbacks.
 *
 * Icons are deliberately absent. The reference's sidebar is words only, and a
 * lucide glyph beside every step is what makes a nav read as a product.
 */
const sectionTypeLabel: Record<string, string> = {
  aim: 'Aim',
  theory: 'Theory',
  components: 'Components',
  circuit: 'Circuit',
  procedure: 'Procedure',
  code: 'Code',
  simulation: 'Simulation',
  quiz: 'Pre Test',
  feedback: 'Feedback',
  references: 'References',
  text: 'Reading',
  video: 'Video',
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

  const labelFor = (s: Section) => s.title ?? sectionTypeLabel[s.type] ?? s.type

  return (
    /* data-experiment-shell tells the surrounding StudentShell to stand its own
       sidebar down — see the `:has()` rule in app/globals.css. The reference
       REPLACES the lab sidebar with the experiment sidebar at this level rather
       than nesting two navigation columns, and so do we. */
    <div data-experiment-shell className="flex min-h-full flex-col">
      {/* ── Experiment sub-header ─────────────────────────────────────────
          Sticks directly below the 64px institutional header. A thinner 5px
          orange rule marks it as a subordinate band of the same system. */}
      <header className="vlab-header-rule-thin sticky top-16 z-20 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Link
            href={`/dashboard/class/${classId}/lab/${labSlug}`}
            className="flex shrink-0 items-center gap-1.5 font-chrome text-[13px] font-semibold text-vlab-steel transition-colors hover:text-vlab-orange-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Experiment list</span>
          </Link>

          <div className="h-5 w-px shrink-0 bg-vlab-rule" />

          <h1 className="min-w-0 flex-1 truncate font-chrome text-[15px] font-bold leading-tight text-vlab-800">
            {experiment.title}
          </h1>

          <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-vlab-surface">
              <div
                className="h-full bg-vlab-600 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="font-chrome text-xs tabular-nums text-vlab-muted">
              {completedCount}/{totalCount} complete
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* ── Section sidebar ────────────────────────────────────────────
            The fixed experiment sequence. Flat list, words not icons, "Home"
            at the top exactly as the reference has it.

            Sticky offset is 64px (institutional header) + 55px (this shell's
            sub-header: 26px content + 24px padding + the 5px rule) = 119px,
            measured off the rendered page rather than assumed. Written with
            underscores because a Tailwind arbitrary value may not contain a
            literal space, and `calc(a-b)` without spaces is invalid CSS — the
            declaration would be dropped silently rather than erroring. */}
        <aside className="sticky top-[119px] hidden h-[calc(100vh_-_119px)] w-52 shrink-0 overflow-y-auto border-r border-vlab-rule bg-white py-4 lg:block">
          <p className="vlab-eyebrow px-4 pb-2">Experiment</p>
          <nav>
            <Link href="/dashboard" className="vlab-nav-link">
              <Home className="h-4 w-4 shrink-0 opacity-70" />
              Home
            </Link>
            {sections.map((section) => {
              const isActive = section.id === activeSectionId
              const isCompleted = completedSectionIds.includes(section.id)

              return (
                <Link
                  key={section.id}
                  href={`${baseUrl}/section/${section.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  className="vlab-nav-link"
                >
                  <span className="flex-1 truncate">{labelFor(section)}</span>
                  {isCompleted && (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-vlab-green-ink"
                      aria-label="Completed"
                    />
                  )}
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* ── Content column ───────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col lg:vlab-dotted-divide">
          {/* Flush left, not centred: the reference's content column starts at
              the dotted rule and runs out to a measure, which reads as a
              document rather than a centred marketing page.

              max-w-3xl is load-bearing and not a taste call — components/static-
              simulator measures its own container with a ResizeObserver and was
              tuned against the ~720px this yields after padding. Widening the
              column would silently re-tune it. */}
          <div className="w-full max-w-3xl flex-1 px-5 py-8 sm:px-8">
            {/* Section rail for narrow viewports, where the sidebar is gone.
                Horizontally scrollable rather than folded behind a hamburger —
                the sequence IS the content model, so it stays visible. */}
            <nav className="vlab-rail-scroll -mx-5 mb-7 flex gap-1 overflow-x-auto border-b border-vlab-rule px-5 sm:-mx-8 sm:px-8 lg:hidden">
              {sections.map((section) => {
                const isActive = section.id === activeSectionId
                return (
                  <Link
                    key={section.id}
                    href={`${baseUrl}/section/${section.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={`shrink-0 whitespace-nowrap border-b-[3px] px-3 py-2 font-chrome text-[13px] font-semibold transition-colors ${
                      isActive
                        ? 'border-vlab-orange text-vlab-800'
                        : 'border-transparent text-vlab-steel hover:text-vlab-orange-ink'
                    }`}
                  >
                    {labelFor(section)}
                  </Link>
                )
              })}
            </nav>

            {children}
          </div>

          {/* ── Prev / next ─────────────────────────────────────────────── */}
          <div className="border-t border-vlab-rule bg-vlab-surface-alt px-5 py-4 sm:px-8">
            <div className="flex max-w-3xl items-center justify-between gap-4">
              {prevSection ? (
                <Link
                  href={`${baseUrl}/section/${prevSection.id}`}
                  className="inline-flex items-center gap-2 border border-vlab-rule-strong bg-white px-4 py-2 font-chrome text-[13px] font-semibold text-vlab-steel transition-colors hover:border-vlab-600 hover:text-vlab-800"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">{labelFor(prevSection)}</span>
                  <span className="sm:hidden">Previous</span>
                </Link>
              ) : (
                <div />
              )}

              {nextSection ? (
                <Link
                  href={`${baseUrl}/section/${nextSection.id}`}
                  className="inline-flex items-center gap-2 border border-vlab-600 bg-vlab-600 px-4 py-2 font-chrome text-[13px] font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
                >
                  <span className="hidden sm:inline">{labelFor(nextSection)}</span>
                  <span className="sm:hidden">Next</span>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <Link
                  href={`/dashboard/class/${classId}/lab/${labSlug}`}
                  className="inline-flex items-center gap-2 border border-vlab-green-ink bg-vlab-green-ink px-4 py-2 font-chrome text-[13px] font-semibold text-white transition-colors hover:opacity-90"
                >
                  Finish experiment
                  <Check className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
