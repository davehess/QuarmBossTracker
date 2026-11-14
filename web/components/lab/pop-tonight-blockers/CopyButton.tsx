'use client';
import { useState } from 'react';

// Puts plain text on the clipboard. Says so for two seconds; says so if the browser refuses.
export default function CopyButton({ text, label = 'Copy names' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const go = async () => {
    try { await navigator.clipboard.writeText(text); setState('ok'); } catch { setState('fail'); }
    setTimeout(() => setState('idle'), 2000);
  };
  return (
    <button
      type="button" onClick={go}
      className="min-h-[32px] rounded border border-blue px-3 py-1 text-xs text-blue hover:bg-blue/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue"
    >
      {state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed' : label}
    </button>
  );
}
