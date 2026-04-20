type TextContent = {
  content?: string
}

export function TextSection({ content }: { content: TextContent | null }) {
  if (!content || !content.content) {
    return <p className="text-[#6a6a6a]">No content available.</p>
  }

  return (
    <div className="prose prose-sm max-w-none">
      <p className="text-sm text-[#222222] leading-relaxed whitespace-pre-wrap">
        {content.content}
      </p>
    </div>
  )
}
