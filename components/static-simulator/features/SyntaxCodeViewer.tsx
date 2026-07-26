'use client';

/**
 * PORT of vendor/simulator/src/components/features/SyntaxCodeViewer.tsx
 * (upstream 1a1eb78). Deviations are marked `PORT:`.
 */

import React, { useMemo, useRef } from 'react';
import { Code2, Copy, Check } from 'lucide-react';
import { tokenize } from '../utils/highlight';

interface SyntaxCodeViewerProps {
  code: string;
  /**
   * PORT: narrowed from `string` to the two languages these twelve experiments
   * are actually written in, and the default changed from 'javascript' —
   * nothing in this lab is JavaScript.
   */
  language?: 'cpp' | 'python';
  fileName?: string;
}

export const SyntaxCodeViewer: React.FC<SyntaxCodeViewerProps> = ({
  code,
  language = 'cpp',
  fileName = 'experiment.ino'
}) => {
  const [copied, setCopied] = React.useState(false);
  const codeRef = useRef<HTMLElement>(null);

  // PORT: upstream set `className="language-cpp"` and stopped there, leaving the
  // panel monochrome. Tokenised here instead — see utils/highlight.ts.
  const tokens = useMemo(() => tokenize(code, language), [code, language]);

  const handleCopy = () => {
    // Copies the ORIGINAL string, not the rendered spans, so indentation and
    // line endings survive the round trip.
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article className="snitch-code-block snitch-h-full">
      <header className="snitch-code-header">
        <div className="snitch-flex snitch-items-center snitch-gap-sm">
          <Code2 style={{ width: '16px', height: '16px', color: 'var(--snitch-text-muted)' }} />
          <span style={{ fontSize: '12px' }}>{fileName}</span>
        </div>
        
        <button 
          onClick={handleCopy}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            padding: '6px 12px', 
            borderRadius: 'var(--snitch-radius-sm)', 
            background: 'rgba(255,255,255,0.05)', 
            border: 'none', 
            color: copied ? '#10b981' : '#e2e8f0', 
            cursor: 'pointer',
            fontSize: '12px'
          }}
          aria-label="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check style={{ width: '14px', height: '14px' }} />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy style={{ width: '14px', height: '14px' }} />
              <span>Copy</span>
            </>
          )}
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <pre className="snitch-code-content">
          <code
            ref={codeRef}
            className={`language-${language}`}
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {/* PORT: `{code}` replaced by the tokenised spans. Concatenating the
                token values reproduces `code` byte for byte. */}
            {tokens.map((t, i) =>
              t.kind === 'plain' ? (
                <React.Fragment key={i}>{t.value}</React.Fragment>
              ) : (
                <span key={i} className={`tok-${t.kind}`}>
                  {t.value}
                </span>
              ),
            )}
          </code>
        </pre>
      </div>
    </article>
  );
};
