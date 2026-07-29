type CodeContent = {
  language?: string
  platform?: string
  code?: string
}

/**
 * The published listing for an experiment.
 *
 * Chrome is a titled panel header — language and target board stated as facts —
 * rather than the three fake macOS traffic-light dots the previous treatment
 * drew. A listing in a lab sheet is a listing, not a screenshot of an editor.
 */
export function CodeSection({ content }: { content: CodeContent | null }) {
  if (!content || !content.code) {
    return <p className="text-vlab-muted">No code content available.</p>
  }

  const language = content.language ?? 'text'
  const platform = content.platform
  const lineCount = content.code.replace(/\n$/, '').split('\n').length

  return (
    <div className="border border-vlab-rule-strong">
      <div className="vlab-panel-header justify-between">
        <span>
          {language.replace(/_/g, ' ')}
          {platform ? ` · ${platform}` : ''}
        </span>
        <span className="font-normal normal-case tracking-normal text-vlab-faint">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      </div>
      <div className="overflow-x-auto bg-vlab-900">
        <pre className="p-4 font-mono text-[13px] leading-relaxed text-[#e2e8f0]">
          <code>{content.code}</code>
        </pre>
      </div>
    </div>
  )
}
