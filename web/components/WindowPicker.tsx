'use client';
// Time-window chip row — the shared expand/contract control for pages whose
// queries used to hardcode a lookback (docs/TIME-WINDOWS.md). Navigates via
// ?w=<key> (server components re-query) and records each EXPLICIT pick to
// ui_window_usage so we can see which windows members actually use.

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { recordWindowUse } from '@/lib/windowUsage';

const LABELS: Record<string, string> = {
  '1d': 'Day', '7d': 'Week', '30d': '30d', '60d': '60d', '90d': '90d',
  'exp': 'Expansion', 'life': 'Lifetime',
};

export default function WindowPicker(
  { page, current, options }: { page: string; current: string; options: string[] },
) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pick(w: string) {
    if (w === current) return;
    void recordWindowUse(page, w);           // fire-and-forget telemetry
    const next = new URLSearchParams(params.toString());
    next.set('w', w);
    startTransition(() => router.push(`${path}?${next.toString()}`));
  }

  return (
    <span className={`inline-flex flex-wrap gap-1 items-center ${pending ? 'opacity-60' : ''}`} title="Time window">
      {options.map(w => (
        <button key={w} type="button" onClick={() => pick(w)}
          className={[
            'px-2 py-0.5 rounded border text-[11px] transition-colors',
            w === current ? 'border-gold text-gold' : 'border-border text-dim hover:text-text',
          ].join(' ')}>
          {LABELS[w] ?? w}
        </button>
      ))}
    </span>
  );
}
