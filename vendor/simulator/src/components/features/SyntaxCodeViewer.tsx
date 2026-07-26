import React, { useRef } from 'react';
import { Code2, Copy, Check } from 'lucide-react';

interface SyntaxCodeViewerProps {
  code: string;
  language?: string;
  fileName?: string;
}

export const SyntaxCodeViewer: React.FC<SyntaxCodeViewerProps> = ({ 
  code, 
  language = 'javascript',
  fileName = 'experiment.js'
}) => {
  const [copied, setCopied] = React.useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const handleCopy = () => {
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
            {code}
          </code>
        </pre>
      </div>
    </article>
  );
};
