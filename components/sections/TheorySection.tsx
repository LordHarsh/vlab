type TheoryContent = {
  introduction?: string
  sections?: Array<{ heading: string; body: string }>
}

/**
 * Theory.
 *
 * The reference's theory pages are full academic write-ups broken by all-caps
 * subsection headings ("INTRODUCTION", "CONCEPT") with inline citation markers.
 * Density is the point — long paragraphs, no summarising, no pull quotes.
 *
 * One thing is deliberately not copied: their `text-align: justify`. In a
 * ~720px column it opens rivers of white space between words. Left-aligned is
 * more readable and is what `.vlab-prose` sets.
 */
export function TheorySection({ content }: { content: TheoryContent | null }) {
  if (!content) {
    return <p className="text-vlab-muted">No theory content available.</p>
  }

  return (
    <div className="vlab-prose">
      {content.introduction && (
        <p className="text-vlab-ink">{content.introduction}</p>
      )}

      {content.sections && content.sections.length > 0 && (
        <div className="mt-6 space-y-6">
          {content.sections.map((sec, i) => (
            <section key={i}>
              <h3 className="mt-0 border-b border-vlab-rule pb-1.5 font-chrome text-[14px] font-bold uppercase tracking-[0.07em] text-vlab-800">
                {sec.heading}
              </h3>
              <p className="mt-2.5 whitespace-pre-wrap text-vlab-ink">{sec.body}</p>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
