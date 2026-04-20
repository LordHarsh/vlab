type ProcedureContent = {
  steps?: string[]
}

export function ProcedureSection({ content }: { content: ProcedureContent | null }) {
  if (!content || !content.steps || content.steps.length === 0) {
    return <p className="text-[#6a6a6a]">No procedure steps available.</p>
  }

  return (
    <ol className="space-y-4">
      {content.steps.map((step, i) => (
        <li key={i} className="flex items-start gap-4">
          <div className="w-8 h-8 rounded-xl bg-[#ff385c] text-white text-sm font-700 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
            {i + 1}
          </div>
          <div className="flex-1 pt-1">
            <p className="text-sm text-[#222222] leading-relaxed">{step}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
