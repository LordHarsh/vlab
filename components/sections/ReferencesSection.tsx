import { ExternalLink } from 'lucide-react'

type ReferenceItem = {
  title: string
  url: string
  type?: string
}

type ReferencesContent = {
  items?: ReferenceItem[]
}

export function ReferencesSection({ content }: { content: ReferencesContent | null }) {
  if (!content || !content.items || content.items.length === 0) {
    return <p className="text-[#6a6a6a]">No references available.</p>
  }

  return (
    <ul className="space-y-3">
      {content.items.map((item, i) => (
        <li key={i}>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 p-4 rounded-xl border border-[#c1c1c1] hover:border-[#ff385c] hover:bg-[#f2f2f2] transition-all group"
          >
            <ExternalLink className="w-4 h-4 text-[#6a6a6a] group-hover:text-[#ff385c] mt-0.5 shrink-0 transition-colors" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-500 text-[#222222] group-hover:text-[#ff385c] transition-colors leading-snug">
                {item.title}
              </p>
              <p className="text-xs text-[#6a6a6a] truncate mt-0.5">{item.url}</p>
            </div>
            {item.type && (
              <span className="text-xs text-[#6a6a6a] bg-[#f2f2f2] px-2 py-0.5 rounded-full shrink-0">
                {item.type}
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  )
}
