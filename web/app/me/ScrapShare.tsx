'use client';

import { useState } from 'react';

// Copy-to-clipboard brag line for "The Scrap" so a member can paste their
// standing into Discord. Falls back to a select-all prompt if the Clipboard
// API is unavailable (older browsers / insecure context).
export default function ScrapShare({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt('Copy your standing:', text);
        }
      }}
      className="px-2 py-1 rounded border border-border bg-bg text-xs text-dim hover:border-blue hover:text-blue transition-colors"
      title="Copy a one-line brag to paste in Discord"
    >
      {copied ? '✓ Copied' : '📋 Share'}
    </button>
  );
}
