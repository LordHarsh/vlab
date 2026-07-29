import Link from 'next/link'
import { INSTITUTION } from '@/lib/institution'

/**
 * Front door.
 *
 * The reference department's landing page carries almost no copy: a nav bar, a
 * one-line description of who runs it, and a grid of labs. Everything of
 * substance lives inside a lab. This page follows that — terse on the
 * navigational surface, no CTA gradients, no testimonials, no "powerful" or
 * "seamless", no pricing. The one decorative move is the tiled circuit-board
 * background over the sage/cream dashboard palette, lifted from their
 * default.css, because it says "electronics department" for free.
 */

/** The fixed pedagogical sequence, stated plainly. This is the product. */
const EXPERIMENT_STRUCTURE = [
  ['Aim', 'The objective of the experiment and its sub-objectives.'],
  ['Theory', 'The underlying principle, written up with citations to the reference texts.'],
  ['Pre Test', 'A short assessment taken before the simulation, to establish preparedness.'],
  ['Procedure', 'Numbered steps to be followed on the simulator, each annotated.'],
  ['Simulation', 'The interactive circuit, run in the browser against a real solver.'],
  ['Post Test', 'The same assessment taken after, to measure what the experiment taught.'],
  ['References', 'The textbooks and standards the theory is drawn from, cited in full.'],
  ['Feedback', 'Remarks recorded against the experiment and returned to the department.'],
] as const

export default function LandingPage() {
  return (
    <div className="bg-white">
      {/* ── Banner ────────────────────────────────────────────────────────
          Sage body, cream plaque, tiled circuit board — the reference
          dashboard's `body { background-color: #5F7161 }`, `nav {
          background-color: #EFEAD8 }` and `background-image:
          url(/images/circuit-board.svg)`, kept verbatim. */}
      <section className="vlab-circuit-bg bg-vlab-sage">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
          <div className="max-w-3xl border-l-8 border-vlab-orange bg-vlab-cream px-6 py-7 shadow-card sm:px-9 sm:py-9">
            <p className="vlab-eyebrow text-vlab-muted">{INSTITUTION.department}</p>
            <h1 className="mt-2 font-display text-2xl leading-tight text-vlab-800 sm:text-3xl md:text-[2.15rem]">
              {INSTITUTION.tagline}
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-vlab-ink">
              The objective of this virtual laboratory is to let students study and analyse the
              behaviour of electronic circuits and embedded systems in a simulated environment,
              and to make the practical component of the curriculum available without access to
              physical hardware. Each experiment is presented in the same order as it would be
              conducted in the laboratory.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
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

      {/* ── Structure of an experiment ────────────────────────────────────
          A syllabus table, not a three-up feature grid. The numbered rows are
          the point: this is a curriculum unit with a fixed shape. */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div>
            <h2 className="vlab-page-title">Structure of an experiment</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-vlab-muted">
              Every experiment in every laboratory runs the same eight steps, in the same
              order. The sequence is fixed so that a student moving between laboratories
              already knows where everything is.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="vlab-table">
              <thead>
                <tr>
                  <th scope="col">S.No</th>
                  <th scope="col">Step</th>
                  <th scope="col">Contents</th>
                </tr>
              </thead>
              <tbody>
                {EXPERIMENT_STRUCTURE.map(([step, detail], i) => (
                  <tr key={step}>
                    <th scope="row">{i + 1}</th>
                    <td className="whitespace-nowrap font-chrome font-bold text-vlab-800">
                      {step}
                    </td>
                    <td className="text-vlab-ink">{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Facilities ────────────────────────────────────────────────────
          Three short factual statements about what the simulator actually is.
          Specific claims (MNA, AVR, RP2040) rather than adjectives — precision
          reads as credible in an engineering context in a way "powerful" does
          not. */}
      <section className="border-t border-vlab-rule bg-vlab-surface-alt">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-14">
          <h2 className="vlab-page-title mb-6">Simulation facilities</h2>
          <div className="grid gap-px overflow-hidden border border-vlab-rule-strong bg-vlab-rule-strong sm:grid-cols-3">
            {[
              [
                'Circuit solution',
                'Nodal analysis over the assembled netlist, solved on every step rather than replayed from a recording. Component values, sources and loads are the student’s to set.',
              ],
              [
                'Device emulation',
                'ATmega328P and RP2040 cores are emulated instruction by instruction, so the sketch a student writes is the sketch that runs — timers, interrupts and serial output included.',
              ],
              [
                'Assessment',
                'Pre-test and post-test are recorded per student per experiment, along with section completion, and returned to the class educator as a gradebook.',
              ],
            ].map(([title, body]) => (
              <div key={title} className="bg-white p-6">
                <h3 className="font-chrome text-[15px] font-bold text-vlab-800">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-vlab-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
