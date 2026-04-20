type AimContent = {
  objectives?: string[]
  outcomes?: string[]
  note?: string
}

export function AimSection({ content }: { content: AimContent | null }) {
  if (!content) {
    return <p className="text-[#6a6a6a]">No aim content available.</p>
  }

  return (
    <div className="space-y-6">
      {content.objectives && content.objectives.length > 0 && (
        <div>
          <h2 className="text-base font-600 text-[#222222] mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-[#ff385c] rounded-full inline-block" />
            Objectives
          </h2>
          <ol className="space-y-2">
            {content.objectives.map((obj, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#ff385c]/10 text-[#ff385c] text-xs font-700 flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-[#222222] leading-relaxed">{obj}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {content.outcomes && content.outcomes.length > 0 && (
        <div>
          <h2 className="text-base font-600 text-[#222222] mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-[#ff385c] rounded-full inline-block" />
            Learning Outcomes
          </h2>
          <ul className="space-y-2">
            {content.outcomes.map((outcome, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ff385c] mt-2 shrink-0" />
                <span className="text-sm text-[#222222] leading-relaxed">{outcome}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {content.note && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm text-amber-800">
            <strong className="font-600">Note:</strong> {content.note}
          </p>
        </div>
      )}
    </div>
  )
}
