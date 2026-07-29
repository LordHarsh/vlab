type ReferenceItem = {
  title: string
  url: string
  type?: string
}

type ReferencesContent = {
  items?: ReferenceItem[]
}

/**
 * References, as an academic bibliography.
 *
 * The reference lab publishes per-experiment reference lists as a plain
 * numbered bibliography of real, purchasable textbooks — author, publisher,
 * city, year — e.g. "Power System Analysis by John J. Grainger, William D.
 * Stevenson, McGraw-Hill Education (India) Private Limited, New Delhi, 2015."
 * No cards, no favicons, no "Learn more" chips. A full citation signals
 * engineering-department rigour in a way a link tile cannot, so the treatment
 * here is a hanging-indent numbered list with a bracketed citation marker,
 * matching the `[1]` / `[3]` markers their Theory pages cite inline.
 *
 * A URL, where present, sits as the source line under the citation rather than
 * swallowing the title, so the citation still reads as a citation.
 */
export function ReferencesSection({ content }: { content: ReferencesContent | null }) {
  if (!content || !content.items || content.items.length === 0) {
    return <p className="text-vlab-muted">No references available.</p>
  }

  return (
    <ol className="vlab-citations">
      {content.items.map((item, i) => (
        <li key={i}>
          <p className="text-vlab-ink">
            {item.title}
            {item.type ? (
              <span className="ml-1.5 font-chrome text-[12px] uppercase tracking-wide text-vlab-faint">
                [{item.type}]
              </span>
            ) : null}
          </p>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block break-all font-chrome text-[13px] text-vlab-600 underline underline-offset-2 hover:text-vlab-800"
            >
              {item.url}
            </a>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
