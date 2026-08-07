import { notFound } from 'next/navigation'
import { StaticSimulator } from '@/components/static-simulator/StaticSimulator'
import { SLUG_TO_STATIC_EXPERIMENT_ID } from '@/components/static-simulator/experiment-map'

/**
 * Harness for the read-only reference circuits. Development only, gated the
 * same way as /dev/editor and /dev/sims — see proxy.ts and the NODE_ENV check
 * below.
 *
 * It renders all twelve experiments through the SAME component the lesson page
 * mounts, which is the only way to actually look at the twelve circuits: the
 * student route needs a Clerk session, a class enrolment and a `simulations`
 * row typed `static`, so reviewing a drawing would otherwise mean seeding a
 * database first. Every circuit here is one a student can reach.
 *
 * All twelve autoplay their scripted sequence at once, which is exactly the
 * point of reviewing them here: twelve loops running side by side is the
 * honest test of whether the fake holds up and of what it costs to render.
 * Nothing on this page can be clicked except the code panels' Copy buttons.
 */
export default function DevStaticSimPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const slugs = Object.keys(SLUG_TO_STATIC_EXPERIMENT_ID)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-bold text-vlab-ink">Static simulator harness</h1>
      <p className="mt-1 text-sm text-vlab-muted">
        The read-only reference circuit and code view, for each of the twelve experiment slugs. Every
        drawing is one of our own <code className="font-mono text-[13px]">CircuitDoc</code>s from{' '}
        <code className="font-mono text-[13px]">circuits.ts</code>, rendered by the lab editor&rsquo;s
        own <code className="font-mono text-[13px]">CircuitCanvas</code> in{' '}
        <code className="font-mono text-[13px]">lockTopology</code> — same parts, same wires. Pan,
        zoom and selection are the editor&rsquo;s own; what cannot change is the wiring and the
        code. Each panel plays a scripted sequence from{' '}
        <code className="font-mono text-[13px]">showreel/timelines.ts</code>: hand-written stage
        direction, not a simulation. No interpreter, no solver, no computed voltages.
      </p>

      <div className="mt-8 space-y-12">
        {slugs.map((slug) => (
          <section key={slug}>
            <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.08em] text-vlab-muted">
              {SLUG_TO_STATIC_EXPERIMENT_ID[slug]} · {slug}
            </h2>
            <StaticSimulator experimentSlug={slug} />
          </section>
        ))}

        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.08em] text-vlab-muted">
            unmapped slug · expected fallback
          </h2>
          <StaticSimulator experimentSlug="not-a-real-experiment" />
        </section>
      </div>
    </div>
  )
}
