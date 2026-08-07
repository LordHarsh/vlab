type AimContent = {
  objectives?: string[]
  outcomes?: string[]
  note?: string
}

/**
 * Aim.
 *
 * The reference's aim.md is one sentence of objective followed by a plain
 * numbered list of sub-objectives — "1. Mathematical Modelling of Synchronous
 * Generator...". No badge circles, no icons. Numbers set in the margin, text
 * running to a readable measure.
 */
export function AimSection({ content }: { content: AimContent | null }) {
  if (!content) {
    return <p className="text-vlab-muted">No aim content available.</p>
  }

  return (
    <div className="vlab-prose space-y-7">
      {content.objectives && content.objectives.length > 0 && (
        <section>
          <h2 className="mt-0 font-chrome text-[15px] font-bold uppercase tracking-[0.06em] text-vlab-800">
            Objectives
          </h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-6 marker:font-bold marker:text-vlab-600">
            {content.objectives.map((obj, i) => (
              <li key={i} className="pl-1 text-vlab-ink">
                {obj}
              </li>
            ))}
          </ol>
        </section>
      )}

      {content.outcomes && content.outcomes.length > 0 && (
        <section>
          <h2 className="mt-0 font-chrome text-[15px] font-bold uppercase tracking-[0.06em] text-vlab-800">
            Learning Outcomes
          </h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-6 marker:text-vlab-600">
            {content.outcomes.map((outcome, i) => (
              <li key={i} className="pl-1 text-vlab-ink">
                {outcome}
              </li>
            ))}
          </ul>
        </section>
      )}

      {content.note && (
        <aside className="border-l-4 border-vlab-orange bg-vlab-orange-50 px-4 py-3">
          <p className="text-sm text-vlab-ink">
            <strong className="font-chrome font-bold uppercase tracking-wide text-vlab-orange-ink">
              Note:
            </strong>{' '}
            {content.note}
          </p>
        </aside>
      )}
    </div>
  )
}
