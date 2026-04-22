type TheoryContent = {
  introduction?: string
  sections?: Array<{ heading: string; body: string }>
}

export function TheorySection({ content }: { content: TheoryContent | null }) {
  if (!content) {
    return <p className="text-[#6a6a6a]">No theory content available.</p>
  }

  return (
    <div className="space-y-6">
      {content.introduction && (
        <p className="text-sm text-[#222222] leading-relaxed">{content.introduction}</p>
      )}

      {content.sections && content.sections.length > 0 && (
        <div className="space-y-5">
          {content.sections.map((sec, i) => (
            <div key={i}>
              <h3 className="text-base font-semibold text-[#222222] mb-2 flex items-center gap-2">
                <span className="w-1 h-5 bg-[#ff385c] rounded-full inline-block shrink-0" />
                {sec.heading}
              </h3>
              <p className="text-sm text-[#222222] leading-relaxed whitespace-pre-wrap ml-3">
                {sec.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
