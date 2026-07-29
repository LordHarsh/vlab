'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyJoinCode({ joinCode }: { joinCode: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(joinCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-vlab-surface border border-vlab-rule-strong rounded-lg hover:bg-vlab-rule transition-colors group"
      title="Click to copy join code"
    >
      <span className="font-mono font-bold text-vlab-ink text-lg tracking-widest">
        {joinCode}
      </span>
      {copied ? (
        <Check className="w-4 h-4 text-green-600" />
      ) : (
        <Copy className="w-4 h-4 text-vlab-muted group-hover:text-vlab-ink" />
      )}
    </button>
  )
}
