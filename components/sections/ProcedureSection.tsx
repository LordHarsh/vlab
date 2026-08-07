type ProcedureContent = {
  steps?: string[]
}

/**
 * Procedure.
 *
 * The reference's procedure.md opens "These procedure steps will be followed on
 * the simulator" and then runs short imperative numbered steps — "Enter the
 * inputs for the component.", "Then click check calculated impedance button." —
 * each paired with a screenshot of exactly what to click. It is lab-manual
 * tone, not UI-copy tone, and the numbering carries the whole structure.
 *
 * Ours has no screenshots to pair (the content model stores steps as strings),
 * so the numbering does the work: a ruled table of steps, index in the margin,
 * which is how a printed lab manual sets them.
 */
export function ProcedureSection({ content }: { content: ProcedureContent | null }) {
  if (!content || !content.steps || content.steps.length === 0) {
    return <p className="text-vlab-muted">No procedure steps available.</p>
  }

  return (
    <div>
      <p className="mb-4 text-[15px] leading-relaxed text-vlab-muted">
        These steps are to be followed on the simulator.
      </p>
      <ol className="border-t border-vlab-rule">
        {content.steps.map((step, i) => (
          <li
            key={i}
            className="flex gap-4 border-b border-vlab-rule px-1 py-3 hover:bg-vlab-50"
          >
            <span className="w-7 shrink-0 pt-px text-right font-chrome text-sm font-bold tabular-nums text-vlab-600">
              {i + 1}.
            </span>
            <p className="flex-1 text-[15px] leading-relaxed text-vlab-ink">{step}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
