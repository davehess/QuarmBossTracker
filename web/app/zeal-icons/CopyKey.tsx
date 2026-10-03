'use client';

import { useState } from 'react';

// A /tag key (^IEUR^) that copies itself, so nobody has to type the carets. Falls back to a
// prompt with the text selected when the Clipboard API is unavailable.
export default function CopyKey({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt('Copy:', text);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-xs text-[#f2ede1] transition-colors hover:border-[#d29922] focus-visible:border-[#d29922] focus-visible:outline-none"
      title={`Copy ${text}`}
      aria-label={`Copy ${label ?? text}`}
    >
      {text}
      <span className={copied ? 'text-green' : 'text-dim'}>{copied ? 'copied' : 'copy'}</span>
    </button>
  );
}
