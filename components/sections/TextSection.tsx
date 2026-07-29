type TextContent = {
  content?: string
}

export function TextSection({ content }: { content: TextContent | null }) {
  if (!content || !content.content) {
    return <p className="text-vlab-muted">No content available.</p>
  }

  return (
    <div className="vlab-prose">
      <p className="whitespace-pre-wrap text-vlab-ink">{content.content}</p>
    </div>
  )
}
