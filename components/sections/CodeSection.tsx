type CodeContent = {
  language?: string
  platform?: string
  code?: string
}

export function CodeSection({ content }: { content: CodeContent | null }) {
  if (!content || !content.code) {
    return <p className="text-[#6a6a6a]">No code content available.</p>
  }

  const language = content.language ?? 'text'
  const platform = content.platform

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a2e] rounded-t-xl border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white/80 uppercase tracking-wide">
            {language}
          </span>
          {platform && (
            <>
              <span className="text-white/30">·</span>
              <span className="text-xs text-white/60">{platform}</span>
            </>
          )}
        </div>
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/70" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
          <div className="w-3 h-3 rounded-full bg-green-500/70" />
        </div>
      </div>

      {/* Code block */}
      <div className="bg-[#1a1a2e] rounded-b-xl overflow-x-auto">
        <pre className="p-4 text-sm text-green-300 font-mono leading-relaxed">
          <code>{content.code}</code>
        </pre>
      </div>
    </div>
  )
}
