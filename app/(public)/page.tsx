import Link from 'next/link'
import { INSTITUTION } from '@/lib/institution'

/**
 * Front door. As simple as this gets: a headline and two links to get in.
 * No syllabus table, no facilities grid, no department line — those read as
 * marketing copy on a page whose only job is "go to a lab or sign in".
 */
export default function LandingPage() {
  return (
    // `h-full` rather than a guessed `min-h-[calc(100vh-Npx)]`: the parent
    // layout is already `flex flex-col` with this section's `<main>` as the
    // `flex-1` child, so the browser has already worked out exactly how much
    // room is left after the header and footer. Stretching into that with
    // `h-full` and centring gets a sage backdrop that fills the gap instead
    // of a short hero floating over a dead strip of white, and it can never
    // itself force a scrollbar — the flex remainder already accounts for
    // both siblings.
    <section className="vlab-circuit-bg flex flex-1 items-center bg-vlab-sage">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="border-l-8 border-vlab-orange bg-vlab-cream px-6 py-7 shadow-card sm:px-9 sm:py-8">
          <h1 className="font-display text-2xl leading-tight text-vlab-800 sm:text-3xl">
            {INSTITUTION.tagline}
          </h1>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/labs"
              className="border border-vlab-600 bg-vlab-600 px-5 py-2.5 font-chrome text-sm font-semibold text-white transition-colors hover:border-vlab-700 hover:bg-vlab-700"
            >
              List of Laboratories
            </Link>
            <Link
              href="/sign-in"
              className="border border-vlab-steel bg-transparent px-5 py-2.5 font-chrome text-sm font-semibold text-vlab-steel transition-colors hover:bg-white/50"
            >
              Sign in to your class
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
